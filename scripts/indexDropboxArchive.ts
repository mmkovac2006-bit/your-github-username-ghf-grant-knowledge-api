import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { extractTextFromBuffer, getSourceFileName } from "../src/services/textExtraction";
import { createConfig, DEFAULT_DROPBOX_ALLOWED_ROOTS, type AppConfig } from "../src/utils/config";
import {
  inferDocumentMetadata,
  isExtractableExtension,
  isScannableExtension,
  safeSkipReason
} from "../src/utils/documentMetadata";
import { normalizeDropboxPath } from "../src/utils/security";
import { buildSearchTerms, passageScore, tokenize, truncateAtWord, uniqueTerms } from "../src/utils/search";

type DropboxFileMetadata = {
  ".tag"?: string;
  name?: string;
  path_lower?: string;
  path_display?: string;
  server_modified?: string;
  client_modified?: string;
  size?: number;
};

type DropboxListFolderResponse = {
  entries?: DropboxFileMetadata[];
  cursor?: string;
  has_more?: boolean;
};

type IndexedChunk = {
  chunk_id: string;
  source_file: string;
  path: string;
  year: string | null;
  funder: string | null;
  document_type: string;
  topic_tags: string[];
  heading: string | null;
  text: string;
  character_count: number;
};

type IndexedDocument = {
  source_file: string;
  path: string;
  year: string | null;
  funder: string | null;
  document_type: string;
  topic_tags: string[];
  server_modified: string | null;
  client_modified: string | null;
  size: number | null;
  indexed_at: string;
  chunk_count: number;
  status: "indexed";
  chunks: IndexedChunk[];
};

type FileStatus = {
  source_file: string;
  path: string;
  root: string;
  status: "indexed" | "skipped" | "failed";
  reason: string | null;
  year: string | null;
  funder: string | null;
  document_type: string | null;
  server_modified: string | null;
  size: number | null;
};

type SearchResult = {
  source_file: string;
  path: string;
  excerpt: string;
  year: string | null;
  funder: string | null;
  document_type: string;
  topic_tags: string[];
  score: number;
};

type IndexReport = {
  generated_at: string;
  roots: string[];
  output_files: {
    private_index: string;
    report: string;
  };
  totals: {
    files_scanned: number;
    indexed: number;
    skipped: number;
    failed: number;
    chunks: number;
  };
  counts: {
    by_root: Record<string, number>;
    by_year: Record<string, number>;
    by_funder: Record<string, number>;
    by_document_type: Record<string, number>;
  };
  skipped_files: FileStatus[];
  failed_files: FileStatus[];
  sample_searches: Array<{
    query: string;
    result_count: number;
    results: SearchResult[];
  }>;
  limitations: string[];
};

const DEFAULT_ROOTS = DEFAULT_DROPBOX_ALLOWED_ROOTS;

const SAMPLE_SEARCHES = [
  "Find prior Lyda Hill grant materials from 2024-2026.",
  "Find prior education programming language.",
  "Find prior evaluation language.",
  "Find submitted proposal language about Peer Helpers.",
  "Find grant reports from 2024.",
  "Find budget narratives from 2025."
];

const INDEXED_AT = new Date().toISOString();
const CHUNK_TARGET_CHARS = readPositiveInteger("INDEX_CHUNK_TARGET_CHARS", 1500);
const CHUNK_MAX_CHARS = readPositiveInteger("INDEX_CHUNK_MAX_CHARS", 2400);
const MAX_FILES = process.env.INDEX_MAX_FILES ? readPositiveInteger("INDEX_MAX_FILES", Number.MAX_SAFE_INTEGER) : null;

class DropboxArchiveClient {
  private accessToken: { token: string; expiresAt: number } | null = null;
  private readonly requestTimeoutMs: number;

  constructor(private readonly config: AppConfig) {
    this.requestTimeoutMs = readPositiveInteger("INDEX_REQUEST_TIMEOUT_MS", Math.max(config.requestTimeoutMs, 30000));
  }

  async listFolderRecursive(root: string): Promise<DropboxFileMetadata[]> {
    const entries: DropboxFileMetadata[] = [];
    let response = await this.rpc<DropboxListFolderResponse>("files/list_folder", {
      path: normalizeDropboxPath(root),
      recursive: true,
      include_deleted: false,
      include_non_downloadable_files: false,
      limit: 1000
    });

    while (true) {
      entries.push(...(response.entries ?? []));

      if (!response.has_more || !response.cursor) {
        break;
      }

      response = await this.rpc<DropboxListFolderResponse>("files/list_folder/continue", {
        cursor: response.cursor
      });
    }

    return entries;
  }

  async download(pathDisplay: string): Promise<Buffer> {
    const token = await this.getAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...this.pathRootHeaders(),
          "Dropbox-API-Arg": JSON.stringify({ path: normalizeDropboxPath(pathDisplay) })
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Dropbox download failed with status ${response.status}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }
  }

  private async rpc<T>(endpoint: string, body: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...this.pathRootHeaders()
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Dropbox ${endpoint} failed with status ${response.status}`);
      }

      return (await response.json()) as T;
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
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

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
        throw new Error(`Dropbox token refresh failed with status ${response.status}`);
      }

      const json = (await response.json()) as { access_token?: string; expires_in?: number };
      if (!json.access_token) {
        throw new Error("Dropbox token refresh did not return an access token.");
      }

      this.accessToken = {
        token: json.access_token,
        expiresAt: now + (json.expires_in ?? 14_400) * 1000
      };

      return this.accessToken.token;
    } finally {
      clearTimeout(timeout);
    }
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
}

async function main(): Promise<void> {
  const config = createConfig();
  assertDropboxConfigured(config);

  const roots = configuredRoots();
  const outputDir = path.resolve(process.env.INDEX_OUTPUT_DIR ?? "work/index");
  const privateIndexPath = path.join(outputDir, "grant-document-index.local-index.json");
  const reportPath = path.join(outputDir, "indexing-report.index-report.json");
  const client = new DropboxArchiveClient(config);

  await fs.mkdir(outputDir, { recursive: true });

  const indexedDocuments: IndexedDocument[] = [];
  const statuses: FileStatus[] = [];

  for (const root of roots) {
    const entries = await client.listFolderRecursive(root);
    const files = entries.filter((entry) => entry[".tag"] === "file" && entry.path_display && entry.name);

    for (const metadata of files) {
      if (MAX_FILES !== null && statuses.length >= MAX_FILES) {
        break;
      }

      const fileStatus = await indexFile(client, root, metadata);
      statuses.push(fileStatus.status);

      if (fileStatus.document) {
        indexedDocuments.push(fileStatus.document);
      }
    }

    if (MAX_FILES !== null && statuses.length >= MAX_FILES) {
      break;
    }
  }

  const sampleSearches = SAMPLE_SEARCHES.map((query) => ({
    query,
    result_count: 0,
    results: searchIndex(indexedDocuments, query, 5)
  })).map((sample) => ({
    ...sample,
    result_count: sample.results.length
  }));

  const report = buildReport({
    roots,
    statuses,
    indexedDocuments,
    privateIndexPath,
    reportPath,
    sampleSearches
  });

  await fs.writeFile(privateIndexPath, JSON.stringify({ generated_at: INDEXED_AT, roots, documents: indexedDocuments }, null, 2));
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    generated_at: report.generated_at,
    files_scanned: report.totals.files_scanned,
    indexed: report.totals.indexed,
    skipped: report.totals.skipped,
    failed: report.totals.failed,
    chunks: report.totals.chunks,
    report: reportPath,
    private_index: privateIndexPath
  }, null, 2));
}

async function indexFile(
  client: DropboxArchiveClient,
  root: string,
  metadata: DropboxFileMetadata
): Promise<{ status: FileStatus; document: IndexedDocument | null }> {
  const sourceFile = metadata.name ?? getSourceFileName(metadata.path_display ?? "");
  const dropboxPath = normalizeDropboxPath(metadata.path_display ?? sourceFile);
  const baseStatus = baseFileStatus(root, metadata, sourceFile, dropboxPath);
  const skipReason = safeSkipReason(dropboxPath);

  if (skipReason) {
    return {
      status: { ...baseStatus, status: "skipped", reason: skipReason },
      document: null
    };
  }

  if (!isScannableExtension(sourceFile)) {
    return {
      status: { ...baseStatus, status: "skipped", reason: "unsupported_file_type" },
      document: null
    };
  }

  if (!isExtractableExtension(sourceFile)) {
    return {
      status: { ...baseStatus, status: "failed", reason: "unsupported_legacy_doc_convert_to_docx_or_pdf" },
      document: null
    };
  }

  try {
    const buffer = await client.download(dropboxPath);
    const text = await extractTextFromBuffer(buffer, sourceFile);
    const normalizedText = normalizeExtractedText(text);

    if (normalizedText.length < 40) {
      return {
        status: { ...baseStatus, status: "skipped", reason: "no_extractable_text" },
        document: null
      };
    }

    const documentMetadata = inferDocumentMetadata(dropboxPath, sourceFile, normalizedText);
    const chunks = chunkDocumentText(normalizedText, {
      sourceFile,
      dropboxPath,
      year: documentMetadata.year,
      funder: documentMetadata.funder,
      documentType: documentMetadata.document_type,
      topicTags: documentMetadata.topic_tags
    });

    if (chunks.length === 0) {
      return {
        status: { ...baseStatus, status: "skipped", reason: "no_indexable_chunks" },
        document: null
      };
    }

    const document: IndexedDocument = {
      source_file: sourceFile,
      path: dropboxPath,
      year: documentMetadata.year,
      funder: documentMetadata.funder,
      document_type: documentMetadata.document_type,
      topic_tags: documentMetadata.topic_tags,
      server_modified: metadata.server_modified ?? null,
      client_modified: metadata.client_modified ?? null,
      size: metadata.size ?? null,
      indexed_at: INDEXED_AT,
      chunk_count: chunks.length,
      status: "indexed",
      chunks
    };

    return {
      status: {
        ...baseStatus,
        status: "indexed",
        reason: null,
        year: document.year,
        funder: document.funder,
        document_type: document.document_type
      },
      document
    };
  } catch (error) {
    return {
      status: {
        ...baseStatus,
        status: "failed",
        reason: error instanceof Error ? sanitizeReason(error.message) : "unknown_parse_error"
      },
      document: null
    };
  }
}

function baseFileStatus(
  root: string,
  metadata: DropboxFileMetadata,
  sourceFile: string,
  dropboxPath: string
): FileStatus {
  const documentMetadata = inferDocumentMetadata(dropboxPath, sourceFile);
  return {
    source_file: sourceFile,
    path: dropboxPath,
    root,
    status: "skipped",
    reason: null,
    year: documentMetadata.year,
    funder: documentMetadata.funder,
    document_type: null,
    server_modified: metadata.server_modified ?? null,
    size: metadata.size ?? null
  };
}

function chunkDocumentText(
  text: string,
  metadata: {
    sourceFile: string;
    dropboxPath: string;
    year: string | null;
    funder: string | null;
    documentType: string;
    topicTags: string[];
  }
): IndexedChunk[] {
  const units = buildTextUnits(text);
  const chunks: IndexedChunk[] = [];
  let currentHeading: string | null = null;
  let currentParts: string[] = [];

  function flush(): void {
    const textValue = currentParts.join("\n\n").trim();
    if (!textValue) {
      return;
    }

    chunks.push({
      chunk_id: stableChunkId(metadata.dropboxPath, chunks.length),
      source_file: metadata.sourceFile,
      path: metadata.dropboxPath,
      year: metadata.year,
      funder: metadata.funder,
      document_type: metadata.documentType,
      topic_tags: metadata.topicTags,
      heading: currentHeading,
      text: textValue,
      character_count: textValue.length
    });

    currentParts = [];
  }

  for (const unit of units) {
    if (unit.heading) {
      if (currentParts.join("\n\n").length >= CHUNK_TARGET_CHARS) {
        flush();
      }
      currentHeading = unit.heading;
    }

    for (const piece of splitOversizedUnit(unit.text, CHUNK_MAX_CHARS)) {
      const next = [...currentParts, piece].join("\n\n");
      if (currentParts.length > 0 && next.length > CHUNK_TARGET_CHARS) {
        flush();
      }
      currentParts.push(piece);
    }
  }

  flush();
  return chunks;
}

function buildTextUnits(text: string): Array<{ heading: string | null; text: string }> {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const units: Array<{ heading: string | null; text: string }> = [];
  let activeHeading: string | null = null;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    if (looksLikeHeading(block)) {
      activeHeading = normalizeHeading(block);
      continue;
    }

    if (looksLikeQuestion(block) && blocks[index + 1] && !looksLikeHeading(blocks[index + 1])) {
      units.push({
        heading: activeHeading,
        text: `${block}\n\n${blocks[index + 1]}`
      });
      index += 1;
      continue;
    }

    units.push({
      heading: activeHeading,
      text: block
    });
  }

  return units;
}

function looksLikeHeading(block: string): boolean {
  const normalized = block.replace(/\s+/g, " ").trim();
  if (normalized.length < 4 || normalized.length > 120) {
    return false;
  }

  if (/[:?]$/.test(normalized) && normalized.length <= 90) {
    return true;
  }

  const words = normalized.split(/\s+/);
  const uppercaseWords = words.filter((word) => /^[A-Z0-9&/-]+$/.test(word));
  return words.length <= 10 && uppercaseWords.length / words.length >= 0.65;
}

function normalizeHeading(block: string): string {
  return block.replace(/\s+/g, " ").replace(/:$/, "").trim();
}

function looksLikeQuestion(block: string): boolean {
  return /(\?|^q[:.)\s]|^question[:.)\s]|^prompt[:.)\s])/i.test(block.trim());
}

function splitOversizedUnit(value: string, maxChars: number): string[] {
  if (value.length <= maxChars) {
    return [value];
  }

  const sentences = value.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) {
        pieces.push(current);
      }
      current = sentence;
    }
  }

  if (current) {
    pieces.push(current);
  }

  return pieces.flatMap((piece) => {
    if (piece.length <= maxChars) {
      return [piece];
    }

    const sliced: string[] = [];
    for (let index = 0; index < piece.length; index += maxChars) {
      sliced.push(piece.slice(index, index + maxChars));
    }
    return sliced;
  });
}

function searchIndex(documents: IndexedDocument[], query: string, maxResults: number): SearchResult[] {
  const terms = searchTermsForQuery(query);
  const requestedYears: string[] = query.match(/\b20\d{2}\b/g) ?? [];
  const scored: SearchResult[] = [];

  for (const document of documents) {
    for (const chunk of document.chunks) {
      const haystack = `${chunk.source_file} ${chunk.path} ${chunk.funder ?? ""} ${chunk.year ?? ""} ${chunk.document_type} ${chunk.topic_tags.join(" ")}`;
      let score = passageScore(chunk.text, terms) + passageScore(haystack, terms) * 2;

      if (requestedYears.length > 0 && chunk.year && requestedYears.includes(chunk.year)) {
        score += 8;
      }

      if (query.toLowerCase().includes("report") && chunk.document_type.includes("report")) {
        score += 8;
      }

      if (query.toLowerCase().includes("budget") && chunk.document_type.includes("budget")) {
        score += 8;
      }

      if (/proposal|submitted|application/i.test(query) && /application|proposal|submitted/.test(chunk.document_type)) {
        score += 8;
      }

      if (chunk.year) {
        score += Math.max(0, Number.parseInt(chunk.year, 10) - 2022);
      }

      if (score <= 0) {
        continue;
      }

      scored.push({
        source_file: chunk.source_file,
        path: chunk.path,
        excerpt: truncateAtWord(chunk.text, 900),
        year: chunk.year,
        funder: chunk.funder,
        document_type: chunk.document_type,
        topic_tags: chunk.topic_tags,
        score
      });
    }
  }

  const bestByPath = new Map<string, SearchResult>();
  for (const result of scored.sort((a, b) => b.score - a.score)) {
    if (!bestByPath.has(result.path)) {
      bestByPath.set(result.path, result);
    }
  }

  return [...bestByPath.values()].slice(0, maxResults);
}

function searchTermsForQuery(query: string): string[] {
  const directTerms: string[] = [];

  if (/lyda\s+hill/i.test(query)) {
    directTerms.push("Lyda Hill");
  }
  if (/peer\s+helpers?/i.test(query)) {
    directTerms.push("Peer Helpers");
  }
  if (/education/i.test(query)) {
    directTerms.push("education programming", "mental health education");
  }
  if (/evaluation/i.test(query)) {
    directTerms.push("evaluation", "outcomes", "metrics");
  }
  if (/budget/i.test(query)) {
    directTerms.push("budget narrative", "budget justification", "budget");
  }

  return uniqueTerms([
    ...directTerms,
    ...buildSearchTerms({ question: query, category: query }),
    ...tokenize(query)
  ]);
}

function buildReport(input: {
  roots: string[];
  statuses: FileStatus[];
  indexedDocuments: IndexedDocument[];
  privateIndexPath: string;
  reportPath: string;
  sampleSearches: IndexReport["sample_searches"];
}): IndexReport {
  const indexedStatuses = input.statuses.filter((status) => status.status === "indexed");
  const skippedStatuses = input.statuses.filter((status) => status.status === "skipped");
  const failedStatuses = input.statuses.filter((status) => status.status === "failed");

  return {
    generated_at: INDEXED_AT,
    roots: input.roots,
    output_files: {
      private_index: input.privateIndexPath,
      report: input.reportPath
    },
    totals: {
      files_scanned: input.statuses.length,
      indexed: indexedStatuses.length,
      skipped: skippedStatuses.length,
      failed: failedStatuses.length,
      chunks: input.indexedDocuments.reduce((sum, document) => sum + document.chunk_count, 0)
    },
    counts: {
      by_root: countBy(indexedStatuses, (status) => status.root),
      by_year: countBy(indexedStatuses, (status) => status.year ?? "unknown"),
      by_funder: countBy(indexedStatuses, (status) => status.funder ?? "unknown"),
      by_document_type: countBy(indexedStatuses, (status) => status.document_type ?? "unknown")
    },
    skipped_files: skippedStatuses,
    failed_files: failedStatuses,
    sample_searches: input.sampleSearches,
    limitations: [
      "Legacy .doc files are scanned and reported, but they are not parsed unless converted to .docx or PDF.",
      "Image-only PDFs may extract little or no text because OCR is not enabled in this project.",
      "The generated local index can contain grant excerpts, so it is written under work/index and intentionally ignored by Git.",
      "This script builds a local/private keyword index and report. A production persistent index would need private storage, such as a database or vector store, instead of a public repository artifact."
    ]
  };
}

function countBy<T>(items: T[], selector: (item: T) => string): Record<string, number> {
  const counts = new Map<string, { label: string; count: number }>();

  for (const item of items) {
    const label = selector(item) || "unknown";
    const normalized = label.toLowerCase();
    const existing = counts.get(normalized);

    if (existing) {
      existing.count += 1;
    } else {
      counts.set(normalized, { label, count: 1 });
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .reduce<Record<string, number>>((output, item) => {
      output[item.label] = item.count;
      return output;
    }, {});
}

function configuredRoots(): string[] {
  const raw = process.env.INDEX_DROPBOX_ROOTS ?? process.env.DROPBOX_ALLOWED_ROOTS;
  if (!raw) {
    return DEFAULT_ROOTS;
  }

  const configured = raw
    .split("|")
    .map((root) => normalizeDropboxPath(root))
    .filter(Boolean);

  return configured.length > 0 ? [...new Set(configured)] : DEFAULT_ROOTS;
}

function assertDropboxConfigured(config: AppConfig): void {
  if (!config.dropboxClientId || !config.dropboxClientSecret || !config.dropboxRefreshToken) {
    throw new Error("Dropbox credentials are not configured. Check DROPBOX_CLIENT_ID, DROPBOX_CLIENT_SECRET, and DROPBOX_REFRESH_TOKEN.");
  }
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stableChunkId(dropboxPath: string, index: number): string {
  return crypto.createHash("sha256").update(`${dropboxPath}:${index}`).digest("hex").slice(0, 20);
}

function sanitizeReason(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/(access|refresh)_token[^\s,}]*/gi, "$1_token[redacted]")
    .slice(0, 300);
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? sanitizeReason(error.message) : "Indexing failed.");
  process.exitCode = 1;
});
