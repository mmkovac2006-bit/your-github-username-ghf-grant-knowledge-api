import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

export const DEFAULT_DROPBOX_ALLOWED_ROOTS = [
  "/4 - Development/Test Current Grant Library"
];

const LEGACY_BROAD_DROPBOX_ROOT = "/4 - Development/1 - Grants";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  GHF_ACTION_API_KEY: z.string().default(""),
  DROPBOX_APP_KEY: z.string().default(""),
  DROPBOX_APP_SECRET: z.string().default(""),
  DROPBOX_CLIENT_ID: z.string().default(""),
  DROPBOX_CLIENT_SECRET: z.string().default(""),
  DROPBOX_REFRESH_TOKEN: z.string().default(""),
  DROPBOX_PATH_ROOT_NAMESPACE_ID: z.string().default(""),
  DROPBOX_NAMESPACE_ID: z.string().default(""),
  DROPBOX_ALLOWED_SEARCH_FOLDERS: z.string().default(""),
  DROPBOX_ALLOWED_ROOTS: z.string().default(""),
  DROPBOX_ALLOWED_ROOT: z.string().default(""),
  DROPBOX_WRITE_ENABLED: z.string().default("false"),
  DROPBOX_CURRENT_LIBRARY_ROOT: z.string().default(""),
  DROPBOX_ARCHIVE_LIBRARY_ROOT: z.string().default("/4 - Development/Archive Grant Documents"),
  DROPBOX_CURRENT_SUBMITTED_ROOT: z.string().default("/4 - Development/Current Grants Submitted"),
  DROPBOX_ARCHIVE_SUBMITTED_ROOT: z.string().default("/4 - Development/Archive Grants Submitted"),
  DROPBOX_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().max(10_000_000).default(5_000_000),
  SEARCH_BACKEND: z.enum(["dropbox", "database"]).default("dropbox"),
  DATABASE_URL: z.string().default(""),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(3),
  MAX_RESULTS_DEFAULT: z.coerce.number().int().positive().default(5),
  MAX_RESULTS_LIMIT: z.coerce.number().int().positive().default(10),
  MAX_EXCERPT_CHARS: z.coerce.number().int().positive().default(2000),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  LOG_LEVEL: z.string().default("info")
});

export type AppConfig = {
  nodeEnv: string;
  port: number;
  actionApiKey: string;
  dropboxClientId: string;
  dropboxClientSecret: string;
  dropboxRefreshToken: string;
  dropboxNamespaceId: string;
  dropboxAllowedRoots: string[];
  dropboxAllowedRoot: string;
  dropboxWriteEnabled: boolean;
  dropboxCurrentLibraryRoot: string;
  dropboxArchiveLibraryRoot: string;
  dropboxCurrentSubmittedRoot: string;
  dropboxArchiveSubmittedRoot: string;
  dropboxMaxUploadBytes: number;
  searchBackend: "dropbox" | "database";
  databaseUrl: string;
  databaseMaxConnections: number;
  maxResultsDefault: number;
  maxResultsLimit: number;
  maxExcerptChars: number;
  requestTimeoutMs: number;
  logLevel: string;
};

function normalizeConfiguredDropboxPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
  const absolute = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return absolute.length > 1 && absolute.endsWith("/") ? absolute.slice(0, -1) : absolute;
}

function firstConfiguredValue(...values: string[]): string {
  return values.find((value) => value.trim().length > 0)?.trim() ?? "";
}

function parseBoolean(value: string): boolean {
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function uniqueNormalizedRoots(rawRoots: string): string[] {
  const roots = rawRoots
    .split(/[|,]/)
    .map((root) => normalizeConfiguredDropboxPath(root))
    .filter((root) => root.length > 1);

  return [...new Set(roots)];
}

export function parseDropboxAllowedRoots(
  allowedRootsValue?: string,
  legacySearchFolders?: string,
  legacyRootValue?: string
): string[] {
  const configuredRoots = allowedRootsValue?.trim() ? uniqueNormalizedRoots(allowedRootsValue) : [];
  if (configuredRoots.length > 0) {
    return configuredRoots;
  }

  const legacyRoots = legacySearchFolders?.trim() ? uniqueNormalizedRoots(legacySearchFolders) : [];
  if (legacyRoots.length > 0 && !(legacyRoots.length === 1 && legacyRoots[0] === LEGACY_BROAD_DROPBOX_ROOT)) {
    return legacyRoots;
  }

  const legacyRoot = legacyRootValue?.trim() ? normalizeConfiguredDropboxPath(legacyRootValue) : "";
  if (legacyRoot && legacyRoot !== LEGACY_BROAD_DROPBOX_ROOT) {
    return [legacyRoot];
  }

  return DEFAULT_DROPBOX_ALLOWED_ROOTS;
}

export function createConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const dropboxAllowedRoots = parseDropboxAllowedRoots(
    parsed.DROPBOX_ALLOWED_ROOTS,
    parsed.DROPBOX_ALLOWED_SEARCH_FOLDERS,
    parsed.DROPBOX_ALLOWED_ROOT
  );

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    actionApiKey: parsed.GHF_ACTION_API_KEY,
    dropboxClientId: firstConfiguredValue(parsed.DROPBOX_APP_KEY, parsed.DROPBOX_CLIENT_ID),
    dropboxClientSecret: firstConfiguredValue(parsed.DROPBOX_APP_SECRET, parsed.DROPBOX_CLIENT_SECRET),
    dropboxRefreshToken: parsed.DROPBOX_REFRESH_TOKEN,
    dropboxNamespaceId: firstConfiguredValue(parsed.DROPBOX_PATH_ROOT_NAMESPACE_ID, parsed.DROPBOX_NAMESPACE_ID),
    dropboxAllowedRoots,
    dropboxAllowedRoot: dropboxAllowedRoots[0],
    dropboxWriteEnabled: parseBoolean(parsed.DROPBOX_WRITE_ENABLED),
    dropboxCurrentLibraryRoot: parsed.DROPBOX_CURRENT_LIBRARY_ROOT.trim()
      ? normalizeConfiguredDropboxPath(parsed.DROPBOX_CURRENT_LIBRARY_ROOT)
      : dropboxAllowedRoots[0],
    dropboxArchiveLibraryRoot: normalizeConfiguredDropboxPath(parsed.DROPBOX_ARCHIVE_LIBRARY_ROOT),
    dropboxCurrentSubmittedRoot: normalizeConfiguredDropboxPath(parsed.DROPBOX_CURRENT_SUBMITTED_ROOT),
    dropboxArchiveSubmittedRoot: normalizeConfiguredDropboxPath(parsed.DROPBOX_ARCHIVE_SUBMITTED_ROOT),
    dropboxMaxUploadBytes: parsed.DROPBOX_MAX_UPLOAD_BYTES,
    searchBackend: "dropbox",
    databaseUrl: parsed.DATABASE_URL.trim(),
    databaseMaxConnections: parsed.DATABASE_MAX_CONNECTIONS,
    maxResultsDefault: parsed.MAX_RESULTS_DEFAULT,
    maxResultsLimit: parsed.MAX_RESULTS_LIMIT,
    maxExcerptChars: parsed.MAX_EXCERPT_CHARS,
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    logLevel: parsed.LOG_LEVEL
  };
}
