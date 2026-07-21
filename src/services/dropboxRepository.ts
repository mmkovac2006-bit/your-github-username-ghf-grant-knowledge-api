import type { AppConfig } from "../utils/config";
import { AppError, upstreamError } from "../utils/errors";
import {
  hasConfiguredDropbox,
  isBlockedPath,
  isInsideAllowedRoots,
  normalizeDropboxPath
} from "../utils/security";
import { candidatePriority, isSupportedFile, tokenize, uniqueTerms } from "../utils/search";
import type {
  DownloadedText,
  DropboxDiagnostic,
  FileCandidate,
  SourceRepository,
  SourceSearchInput,
  SourceSearchResult
} from "../types/search";
import { extractTextFromBuffer, getSourceFileName } from "./textExtraction";

type DropboxFileMetadata = {
  ".tag"?: string;
  name?: string;
  path_lower?: string;
  path_display?: string;
  server_modified?: string;
  size?: number;
};

type DropboxSearchMatch = {
  metadata?: {
    metadata?: DropboxFileMetadata;
  };
};

type DropboxSearchResponse = {
  matches?: DropboxSearchMatch[];
};

type DropboxListFolderResponse = {
  entries?: DropboxFileMetadata[];
  cursor?: string;
  has_more?: boolean;
};

type DropboxAccountResponse = {
  account_id?: string;
  root_info?: {
    ".tag"?: string;
    root_namespace_id?: string;
    home_namespace_id?: string;
  };
};

type AccessTokenState = {
  token: string;
  expiresAt: number;
};

export class DropboxRepository implements SourceRepository {
  private accessToken: AccessTokenState | null = null;

  constructor(private readonly config: AppConfig) {}

  async searchFiles(input: SourceSearchInput): Promise<SourceSearchResult> {
    this.assertConfigured();

    const terms = uniqueTerms(input.terms).slice(0, 20);
    const queryTerms = this.dropboxQueryTerms(terms).slice(0, 8);
    const candidateMap = new Map<string, FileCandidate>();
    let restrictedSkipped = 0;

    for (const root of this.config.dropboxAllowedRoots) {
      for (const term of queryTerms.length ? queryTerms : ["grant"]) {
        const response = await this.rpc<DropboxSearchResponse>("files/search_v2", {
          query: term,
          options: {
            path: root,
            max_results: Math.min(input.maxCandidates, 25),
            filename_only: false,
            file_status: "active"
          }
        });

        restrictedSkipped += this.addMetadataCandidates(response.matches?.map((match) => match.metadata?.metadata) ?? [], candidateMap);
      }
    }

    if (candidateMap.size === 0) {
      const fallbackResult = await this.listFolderFallback(queryTerms.length ? queryTerms : terms, input.maxCandidates);
      restrictedSkipped += fallbackResult.restrictedSkipped;

      for (const candidate of fallbackResult.files) {
        candidateMap.set(candidate.path.toLowerCase(), candidate);
      }
    }

    return {
      files: [...candidateMap.values()].slice(0, input.maxCandidates),
      restrictedSkipped
    };
  }

  async downloadText(path: string): Promise<DownloadedText> {
    this.assertConfigured();

    const normalizedPath = normalizeDropboxPath(path);
    const token = await this.getAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: {
          ...this.authorizationHeaders(token),
          ...this.pathRootHeaders(),
          "Dropbox-API-Arg": JSON.stringify({ path: normalizedPath })
        },
        signal: controller.signal
      });

      if (!response.ok) {
        await this.logFailedResponse("files/download", response);
        throw upstreamError();
      }

      const arrayBuffer = await response.arrayBuffer();
      const sourceFile = getSourceFileName(normalizedPath);
      const text = await extractTextFromBuffer(Buffer.from(arrayBuffer), sourceFile);

      return {
        source_file: sourceFile,
        path: normalizedPath,
        text
      };
    } catch (error) {
      if (error instanceof AppError && error.code === "invalid_request") {
        throw error;
      }

      this.logDropboxException("files/download", error);
      throw upstreamError();
    } finally {
      clearTimeout(timeout);
    }
  }

  async diagnoseDropbox(): Promise<DropboxDiagnostic> {
    const diagnostic: DropboxDiagnostic = {
      configured: {
        credentials: {
          client_id: Boolean(this.config.dropboxClientId),
          client_secret: Boolean(this.config.dropboxClientSecret),
          refresh_token: Boolean(this.config.dropboxRefreshToken),
          all: hasConfiguredDropbox(this.config)
        },
        namespace_id: Boolean(this.config.dropboxNamespaceId),
        allowed_root: this.config.dropboxAllowedRoot,
        allowed_roots: this.config.dropboxAllowedRoots
      },
      account_check: {
        ok: false,
        skipped: "Dropbox credentials are not fully configured."
      },
      allowed_root_check: {
        ok: false,
        paths: this.config.dropboxAllowedRoots,
        skipped: "Dropbox credentials are not fully configured."
      },
      lyda_hill_search: {
        ok: false,
        query: "Lyda Hill",
        result_count: 0,
        sample_paths: [],
        skipped: "Dropbox credentials are not fully configured."
      },
      notes: []
    };

    if (!hasConfiguredDropbox(this.config)) {
      return diagnostic;
    }

    try {
      const account = await this.rpc<DropboxAccountResponse>("users/get_current_account", null, { pathRoot: false });
      diagnostic.account_check = {
        ok: true,
        account_id_present: Boolean(account.account_id),
        root_info_tag: account.root_info?.[".tag"] ?? null,
        root_namespace_id: account.root_info?.root_namespace_id ?? null,
        home_namespace_id: account.root_info?.home_namespace_id ?? null
      };
    } catch (error) {
      diagnostic.account_check = this.safeDiagnosticError(error);
    }

    try {
      const rootChecks: Array<Record<string, unknown>> = [];

      for (const root of this.config.dropboxAllowedRoots) {
        try {
          const metadata = await this.rpc<DropboxFileMetadata>("files/get_metadata", {
            path: root,
            include_deleted: false
          });

          rootChecks.push({
            ok: true,
            path: root,
            tag: metadata[".tag"] ?? null,
            name: metadata.name ?? null
          });
        } catch (error) {
          rootChecks.push({
            ...this.safeDiagnosticError(error),
            path: root
          });
        }
      }

      diagnostic.allowed_root_check = {
        ok: rootChecks.every((check) => check.ok === true),
        roots: rootChecks
      };
    } catch (error) {
      diagnostic.allowed_root_check = this.safeDiagnosticError(error);
    }

    try {
      const searchResult = await this.searchFiles({
        terms: ["Lyda Hill"],
        maxCandidates: 5
      });

      diagnostic.lyda_hill_search = {
        ok: true,
        query: "Lyda Hill",
        result_count: searchResult.files.length,
        sample_paths: searchResult.files.map((file) => file.path).slice(0, 5),
        restricted_skipped: searchResult.restrictedSkipped
      };
    } catch (error) {
      diagnostic.lyda_hill_search = {
        ...this.safeDiagnosticError(error),
        query: "Lyda Hill",
        result_count: 0,
        sample_paths: []
      };
    }

    if (!this.config.dropboxNamespaceId) {
      diagnostic.notes.push("DROPBOX_PATH_ROOT_NAMESPACE_ID is not set; shared/team folders may not be visible.");
    }

    return diagnostic;
  }

  private async listFolderFallback(terms: string[], maxCandidates: number): Promise<SourceSearchResult> {
    const candidateMap = new Map<string, FileCandidate>();
    let restrictedSkipped = 0;
    let scannedEntries = 0;
    const maxScannedEntries = Math.max(500, Math.min(maxCandidates * 200, 5000));

    for (const root of this.config.dropboxAllowedRoots) {
      let response = await this.rpc<DropboxListFolderResponse>("files/list_folder", {
        path: root,
        recursive: true,
        include_deleted: false,
        include_non_downloadable_files: false,
        limit: 1000
      });

      while (true) {
        const entries = response.entries ?? [];
        scannedEntries += entries.length;
        restrictedSkipped += this.addMetadataCandidates(
          entries.filter((entry) => this.matchesLocalTerms(entry, terms)),
          candidateMap
        );

        if (!response.has_more || !response.cursor || scannedEntries >= maxScannedEntries) {
          break;
        }

        response = await this.rpc<DropboxListFolderResponse>("files/list_folder/continue", {
          cursor: response.cursor
        });
      }

      if (scannedEntries >= maxScannedEntries) {
        break;
      }
    }

    return {
      files: [...candidateMap.values()]
        .sort((a, b) => candidatePriority(b) - candidatePriority(a))
        .slice(0, maxCandidates),
      restrictedSkipped
    };
  }

  private addMetadataCandidates(
    metadataItems: Array<DropboxFileMetadata | undefined>,
    candidateMap: Map<string, FileCandidate>
  ): number {
    let restrictedSkipped = 0;

    for (const metadata of metadataItems) {
      if (metadata?.[".tag"] !== "file" || !metadata.path_display || !metadata.name) {
        continue;
      }

      const normalizedPath = normalizeDropboxPath(metadata.path_display);
      if (!isInsideAllowedRoots(normalizedPath, this.config.dropboxAllowedRoots) || isBlockedPath(normalizedPath)) {
        restrictedSkipped += 1;
        continue;
      }

      if (!isSupportedFile(metadata.name)) {
        continue;
      }

      candidateMap.set(normalizedPath.toLowerCase(), {
        source_file: metadata.name,
        path: normalizedPath,
        server_modified: metadata.server_modified ?? null,
        size: metadata.size ?? null
      });
    }

    return restrictedSkipped;
  }

  private matchesLocalTerms(metadata: DropboxFileMetadata, terms: string[]): boolean {
    if (metadata[".tag"] !== "file") {
      return false;
    }

    const localTerms = uniqueTerms(terms.flatMap((term) => [term, ...tokenize(term)]))
      .map((term) => term.toLowerCase())
      .filter((term) => term.length > 2);

    if (localTerms.length === 0) {
      return true;
    }

    const haystack = `${metadata.path_display ?? ""} ${metadata.name ?? ""}`.toLowerCase();
    return localTerms.some((term) => haystack.includes(term));
  }

  private dropboxQueryTerms(terms: string[]): string[] {
    const nonYearTerms = terms.filter((term) => !/^20\d{2}$/.test(term.trim()));
    return nonYearTerms.length > 0 ? nonYearTerms : terms;
  }

  private assertConfigured() {
    if (!hasConfiguredDropbox(this.config)) {
      throw upstreamError();
    }
  }

  private async rpc<T>(endpoint: string, body: unknown, options: { pathRoot?: boolean } = {}): Promise<T> {
    const token = await this.getAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const shouldUsePathRoot = options.pathRoot ?? true;

    try {
      const response = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
        method: "POST",
        headers: {
          ...this.authorizationHeaders(token),
          ...this.jsonHeaders(),
          ...(shouldUsePathRoot ? this.pathRootHeaders() : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        await this.logFailedResponse(endpoint, response);
        throw upstreamError();
      }

      return (await response.json()) as T;
    } catch (error) {
      this.logDropboxException(endpoint, error);
      throw upstreamError();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt > now + 60_000) {
      return this.accessToken.token;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.config.dropboxRefreshToken
      });

      const basicAuth = Buffer.from(`${this.config.dropboxClientId}:${this.config.dropboxClientSecret}`).toString("base64");
      const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body,
        signal: controller.signal
      });

      if (!response.ok) {
        await this.logFailedResponse("oauth2/token", response);
        throw upstreamError();
      }

      const json = (await response.json()) as { access_token?: string; expires_in?: number };
      if (!json.access_token) {
        throw upstreamError();
      }

      this.accessToken = {
        token: json.access_token,
        expiresAt: now + (json.expires_in ?? 14_400) * 1000
      };

      return this.accessToken.token;
    } catch (error) {
      this.logDropboxException("oauth2/token", error);
      throw upstreamError();
    } finally {
      clearTimeout(timeout);
    }
  }

  private authorizationHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`
    };
  }

  private jsonHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json"
    };
  }

  private pathRootHeaders(): Record<string, string> {
    if (!this.config.dropboxNamespaceId) {
      return {};
    }

    return {
      "Dropbox-API-Path-Root": JSON.stringify({
        ".tag": "namespace_id",
        namespace_id: this.config.dropboxNamespaceId
      })
    };
  }

  private async logFailedResponse(endpoint: string, response: Response): Promise<void> {
    if (this.config.nodeEnv !== "development") {
      return;
    }

    const body = await response.text();
    console.error("Dropbox API response failed", {
      endpoint,
      status: response.status,
      body: this.sanitizeDebugBody(body)
    });
  }

  private logDropboxException(endpoint: string, error: unknown): void {
    if (this.config.nodeEnv !== "development") {
      return;
    }

    if (error instanceof AppError) {
      return;
    }

    console.error("Dropbox API call failed", {
      endpoint,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }

  private sanitizeDebugBody(value: string): string {
    const secrets = [
      this.config.actionApiKey,
      this.config.dropboxClientId,
      this.config.dropboxClientSecret,
      this.config.dropboxRefreshToken,
      this.accessToken?.token ?? ""
    ].filter((secret) => secret.length >= 6);

    let sanitized = value;
    for (const secret of secrets) {
      sanitized = sanitized.split(secret).join("[redacted]");
    }

    sanitized = sanitized
      .replace(/("?(?:access|refresh)_token"?\s*[:=]\s*"?)[^",\s}]+/gi, "$1[redacted]")
      .replace(/("?(?:client_secret|app_secret|api_key)"?\s*[:=]\s*"?)[^",\s}]+/gi, "$1[redacted]");

    return sanitized.length > 2000 ? `${sanitized.slice(0, 2000)}...` : sanitized;
  }

  private safeDiagnosticError(error: unknown): { ok: false; error: string } {
    if (error instanceof AppError) {
      return {
        ok: false,
        error: error.safeMessage
      };
    }

    return {
      ok: false,
      error: "Dropbox check failed."
    };
  }
}
