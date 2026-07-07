import fs from "node:fs/promises";
import path from "node:path";
import { createConfig } from "../src/utils/config";
import { createDatabaseClient } from "../src/utils/database";

async function main(): Promise<void> {
  const config = createConfig();
  const sql = createDatabaseClient(config);
  const migrationPath = path.resolve("migrations/001_grant_search_index.sql");
  const migration = await fs.readFile(migrationPath, "utf8");

  try {
    await sql.unsafe(migration);
    console.log(JSON.stringify({
      ok: true,
      migration: migrationPath
    }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Database setup failed.");
  process.exitCode = 1;
});
