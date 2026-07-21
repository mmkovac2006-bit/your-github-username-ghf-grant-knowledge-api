import type {
  DatabaseDiagnostic,
  DownloadedText,
  FileCandidate,
  SourceRepository,
  SourceSearchInput,
  SourceSearchResult
} from "../types/search";
import type { AppConfig } from "../utils/config";
import { createDatabaseClient } from "../utils/database";
import { upstreamError } from "../utils/errors";
import { isBlockedPath, isInsideAllowedRoots, normalizeDropboxPath } from "../utils/security";
import { tokenize, uniqueTerms } from "../utils/search";

type CandidateRow = {
  source_file: string;
  path: string;
  server_modified: string | null;
  size: number | string | null;
  rank: number | string;
};

type TextRow = {
  source_file: string;
  path: string;
  text: string;
};

type CountRow = {
  documents: number;
  chunks: number;
};

export class PostgresRepository implements SourceRepository {
  private readonly sql: ReturnType<typeof createDatabaseClient>;

  constructor(private readonly config: AppConfig) {
    this.sql = createDatabaseClient(config);
  }

  async searchFiles(input: SourceSearchInput): Promise<SourceSearchResult> {
    const queryText = this.toWebsearchQuery(input.terms);
    const allowedRootsJson = JSON.stringify(this.config.dropboxAllowedRoots);
    const candidateLimit = Math.max(input.maxCandidates, input.maxCandidates * this.config.dropboxAllowedRoots.length * 2);

    try {
      const rows = await this.sql<CandidateRow[]>`
        with allowed_roots as (
          select
            value as root,
            value || '/' as root_prefix
          from jsonb_array_elements_text(${allowedRootsJson}::jsonb)
        ),
        query as (
          select websearch_to_tsquery('english', ${queryText}) as value
        ),
        ranked as (
          select
            d.source_file,
            d.path,
            d.server_modified,
            d.size_bytes as size,
            max(ts_rank_cd(d.search_text || c.search_text, query.value)) as rank
          from grant_documents d
          join grant_chunks c on c.path = d.path
          cross join query
          where exists (
            select 1
            from allowed_roots ar
            where d.path = ar.root or left(d.path, length(ar.root_prefix)) = ar.root_prefix
          )
          and (d.search_text || c.search_text) @@ query.value
          group by d.source_file, d.path, d.server_modified, d.size_bytes
        )
        select source_file, path, server_modified, size, rank
        from ranked
        order by rank desc, server_modified desc nulls last, source_file asc
        limit ${candidateLimit}
      `;

      return {
        files: rows
          .map((row) => this.toCandidate(row))
          .filter((candidate) => this.isCandidateAllowed(candidate))
          .slice(0, input.maxCandidates),
        restrictedSkipped: 0
      };
    } catch {
      throw upstreamError();
    }
  }

  async downloadText(path: string): Promise<DownloadedText> {
    const normalizedPath = normalizeDropboxPath(path);

    if (!isInsideAllowedRoots(normalizedPath, this.config.dropboxAllowedRoots) || isBlockedPath(normalizedPath)) {
      throw upstreamError();
    }

    try {
      const rows = await this.sql<TextRow[]>`
        select
          d.source_file,
          d.path,
          string_agg(
            concat_ws(E'\n', nullif(c.heading, ''), c.text),
            E'\n\n'
            order by c.chunk_index asc
          ) as text
        from grant_documents d
        join grant_chunks c on c.path = d.path
        where d.path = ${normalizedPath}
        group by d.source_file, d.path
        limit 1
      `;

      const row = rows[0];
      if (!row?.text) {
        throw upstreamError();
      }

      return {
        source_file: row.source_file,
        path: row.path,
        text: row.text
      };
    } catch {
      throw upstreamError();
    }
  }

  async diagnoseDatabase(): Promise<DatabaseDiagnostic> {
    const diagnostic: DatabaseDiagnostic = {
      configured: {
        backend: this.config.searchBackend,
        database_url: Boolean(this.config.databaseUrl)
      },
      connection_check: {
        ok: false
      },
      index_counts: {
        documents: 0,
        chunks: 0
      },
      lyda_hill_search: {
        ok: false,
        query: "Lyda Hill",
        result_count: 0,
        sample_paths: []
      },
      notes: []
    };

    if (!this.config.databaseUrl) {
      diagnostic.connection_check = {
        ok: false,
        skipped: "DATABASE_URL is not configured."
      };
      return diagnostic;
    }

    try {
      const allowedRootsJson = JSON.stringify(this.config.dropboxAllowedRoots);
      const counts = await this.sql<CountRow[]>`
        with allowed_roots as (
          select
            value as root,
            value || '/' as root_prefix
          from jsonb_array_elements_text(${allowedRootsJson}::jsonb)
        )
        select
          (
            select count(*)::int
            from grant_documents d
            where exists (
              select 1
              from allowed_roots ar
              where d.path = ar.root or left(d.path, length(ar.root_prefix)) = ar.root_prefix
            )
          ) as documents,
          (
            select count(*)::int
            from grant_chunks c
            where exists (
              select 1
              from allowed_roots ar
              where c.path = ar.root or left(c.path, length(ar.root_prefix)) = ar.root_prefix
            )
          ) as chunks
      `;

      diagnostic.connection_check = { ok: true };
      diagnostic.index_counts = {
        documents: counts[0]?.documents ?? 0,
        chunks: counts[0]?.chunks ?? 0
      };
    } catch {
      diagnostic.connection_check = {
        ok: false,
        error: "Database check failed."
      };
      return diagnostic;
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
        sample_paths: searchResult.files.map((file) => file.path).slice(0, 5)
      };
    } catch {
      diagnostic.lyda_hill_search = {
        ok: false,
        query: "Lyda Hill",
        result_count: 0,
        sample_paths: [],
        error: "Database search check failed."
      };
    }

    return diagnostic;
  }

  private toCandidate(row: CandidateRow): FileCandidate {
    return {
      source_file: row.source_file,
      path: row.path,
      server_modified: row.server_modified,
      size: row.size === null ? null : Number(row.size)
    };
  }

  private isCandidateAllowed(candidate: FileCandidate): boolean {
    return isInsideAllowedRoots(candidate.path, this.config.dropboxAllowedRoots) && !isBlockedPath(candidate.path);
  }

  private toWebsearchQuery(terms: string[]): string {
    const searchableTerms = uniqueTerms([
      ...terms,
      ...terms.flatMap((term) => tokenize(term))
    ])
      .map((term) => term.trim())
      .filter((term) => term.length > 1)
      .slice(0, 18);

    if (searchableTerms.length === 0) {
      return "grant";
    }

    return searchableTerms.join(" OR ");
  }
}
