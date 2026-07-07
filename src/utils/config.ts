import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  GHF_ACTION_API_KEY: z.string().default(""),
  DROPBOX_CLIENT_ID: z.string().default(""),
  DROPBOX_CLIENT_SECRET: z.string().default(""),
  DROPBOX_REFRESH_TOKEN: z.string().default(""),
  DROPBOX_NAMESPACE_ID: z.string().default(""),
  DROPBOX_ALLOWED_ROOT: z.string().default("/4 - Development/1 - Grants"),
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
  dropboxAllowedRoot: string;
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

export function createConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    actionApiKey: parsed.GHF_ACTION_API_KEY,
    dropboxClientId: parsed.DROPBOX_CLIENT_ID,
    dropboxClientSecret: parsed.DROPBOX_CLIENT_SECRET,
    dropboxRefreshToken: parsed.DROPBOX_REFRESH_TOKEN,
    dropboxNamespaceId: parsed.DROPBOX_NAMESPACE_ID.trim(),
    dropboxAllowedRoot: normalizeConfiguredDropboxPath(parsed.DROPBOX_ALLOWED_ROOT),
    searchBackend: parsed.SEARCH_BACKEND,
    databaseUrl: parsed.DATABASE_URL.trim(),
    databaseMaxConnections: parsed.DATABASE_MAX_CONNECTIONS,
    maxResultsDefault: parsed.MAX_RESULTS_DEFAULT,
    maxResultsLimit: parsed.MAX_RESULTS_LIMIT,
    maxExcerptChars: parsed.MAX_EXCERPT_CHARS,
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    logLevel: parsed.LOG_LEVEL
  };
}
