import fs from "node:fs/promises";
import path from "node:path";
import { createConfig } from "../src/utils/config";
import { createDatabaseClient } from "../src/utils/database";

type IndexedChunk = {
  chunk_id: string;
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
  chunks: IndexedChunk[];
};

type LocalIndex = {
  generated_at: string;
  documents: IndexedDocument[];
};

async function main(): Promise<void> {
  const config = createConfig();
  const sql = createDatabaseClient(config);
  const indexPath = path.resolve(process.env.INDEX_FILE_PATH ?? "work/index/grant-document-index.local-index.json");
  const index = JSON.parse(await fs.readFile(indexPath, "utf8")) as LocalIndex;

  try {
    await sql.begin(async (tx) => {
      await tx`truncate table grant_chunks, grant_documents`;

      for (const document of index.documents) {
        await tx`
          insert into grant_documents (
            path,
            source_file,
            year,
            funder,
            document_type,
            topic_tags,
            server_modified,
            client_modified,
            size_bytes,
            indexed_at
          ) values (
            ${document.path},
            ${document.source_file},
            ${document.year},
            ${document.funder},
            ${document.document_type},
            ${document.topic_tags},
            ${document.server_modified},
            ${document.client_modified},
            ${document.size},
            ${document.indexed_at}
          )
          on conflict (path) do update set
            source_file = excluded.source_file,
            year = excluded.year,
            funder = excluded.funder,
            document_type = excluded.document_type,
            topic_tags = excluded.topic_tags,
            server_modified = excluded.server_modified,
            client_modified = excluded.client_modified,
            size_bytes = excluded.size_bytes,
            indexed_at = excluded.indexed_at
        `;

        for (const [chunkIndex, chunk] of document.chunks.entries()) {
          await tx`
            insert into grant_chunks (
              chunk_id,
              path,
              chunk_index,
              heading,
              text,
              character_count
            ) values (
              ${chunk.chunk_id},
              ${document.path},
              ${chunkIndex},
              ${chunk.heading},
              ${chunk.text},
              ${chunk.character_count}
            )
          `;
        }
      }
    });

    const counts = await sql<{ documents: number; chunks: number }[]>`
      select
        (select count(*)::int from grant_documents) as documents,
        (select count(*)::int from grant_chunks) as chunks
    `;

    console.log(JSON.stringify({
      ok: true,
      index: indexPath,
      documents: counts[0]?.documents ?? 0,
      chunks: counts[0]?.chunks ?? 0
    }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Database import failed.");
  process.exitCode = 1;
});
