import postgres from "postgres";
import type { AppConfig } from "./config";

export function createDatabaseClient(config: AppConfig) {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return postgres(config.databaseUrl, {
    ssl: "require",
    prepare: false,
    max: config.databaseMaxConnections,
    idle_timeout: 20,
    connect_timeout: Math.max(5, Math.ceil(config.requestTimeoutMs / 1000))
  });
}
