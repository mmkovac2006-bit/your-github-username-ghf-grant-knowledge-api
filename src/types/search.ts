export type Confidence = "high" | "medium" | "low";

export type SearchResult = {
  source_file: string;
  funder?: string | null;
  year?: string | null;
  path: string;
  excerpt: string;
  confidence: Confidence;
  document_type?: string | null;
  character_count?: number;
  notes?: string;
};

export type FileCandidate = {
  source_file: string;
  path: string;
  server_modified?: string | null;
  size?: number | null;
};

export type DownloadedText = {
  source_file: string;
  path: string;
  text: string;
};

export type SourceSearchInput = {
  terms: string[];
  maxCandidates: number;
};

export type SourceSearchResult = {
  files: FileCandidate[];
  restrictedSkipped: number;
};

export type DropboxDiagnostic = {
  configured: {
    credentials: {
      client_id: boolean;
      client_secret: boolean;
      refresh_token: boolean;
      all: boolean;
    };
    namespace_id: boolean;
    allowed_root: string;
  };
  account_check: Record<string, unknown>;
  allowed_root_check: Record<string, unknown>;
  lyda_hill_search: Record<string, unknown>;
  notes: string[];
};

export type DatabaseDiagnostic = {
  configured: {
    backend: "dropbox" | "database";
    database_url: boolean;
  };
  connection_check: Record<string, unknown>;
  index_counts: {
    documents: number;
    chunks: number;
  };
  lyda_hill_search: Record<string, unknown>;
  notes: string[];
};

export interface SourceRepository {
  searchFiles(input: SourceSearchInput): Promise<SourceSearchResult>;
  downloadText(path: string): Promise<DownloadedText>;
  diagnoseDropbox?(): Promise<DropboxDiagnostic>;
  diagnoseDatabase?(): Promise<DatabaseDiagnostic>;
}

export type ServiceMeta = {
  restrictedSkipped: number;
};

export type ServiceResult<T> = {
  response: T;
  meta: ServiceMeta;
};
