import express from "express";
import { z } from "zod";
import type { DropboxFileManager } from "../types/files";
import type { AppConfig } from "../utils/config";
import {
  dropboxWriteDisabledError,
  dropboxWriteUnavailableError,
  invalidRequestError
} from "../utils/errors";
import { isScannableExtension } from "../utils/documentMetadata";

const moveSchema = z.object({
  source_path: z.string().min(1).max(1000),
  confirmed: z.literal(true)
}).strict();

export function createFilesRouter(config: AppConfig, fileManager: DropboxFileManager | null) {
  const router = express.Router();
  const uploadJsonLimit = Math.ceil(config.dropboxMaxUploadBytes * 1.5) + 65_536;

  router.post("/files/upload", express.json({ limit: uploadJsonLimit }), async (req, res, next) => {
    try {
      assertWritesAvailable(config, fileManager);
      const input = createUploadSchema(config).parse(req.body);
      const content = decodeUploadContent(input, config);
      const result = await fileManager!.uploadFile({
        target: input.target,
        fileName: input.file_name,
        content
      });

      res.status(201).json({
        status: "uploaded",
        target: input.target,
        file: result
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/files/move-to-archive", express.json({ limit: "64kb" }), async (req, res, next) => {
    try {
      assertWritesAvailable(config, fileManager);
      const input = moveSchema.parse(req.body);
      const result = await fileManager!.moveToArchive(input.source_path);

      res.json({
        status: "moved_to_archive",
        file: result
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function createUploadSchema(config: AppConfig) {
  return z.object({
    target: z.enum(["current_grant_library", "current_grants_submitted"]),
    file_name: z.string().min(1).max(180),
    content_base64: z.string().max(Math.ceil(config.dropboxMaxUploadBytes * 1.4)).optional(),
    content_text: z.string().max(config.dropboxMaxUploadBytes).optional(),
    confirmed: z.literal(true)
  }).strict().refine(
    (value) => Boolean(value.content_base64) !== Boolean(value.content_text),
    { message: "Provide exactly one of content_base64 or content_text." }
  );
}

function assertWritesAvailable(config: AppConfig, fileManager: DropboxFileManager | null): void {
  if (!config.dropboxWriteEnabled) {
    throw dropboxWriteDisabledError();
  }

  if (!fileManager) {
    throw dropboxWriteUnavailableError();
  }
}

function decodeUploadContent(
  input: {
    file_name: string;
    content_base64?: string;
    content_text?: string;
  },
  config: AppConfig
): Buffer {
  if (!isScannableExtension(input.file_name)) {
    throw invalidRequestError("This file type is not allowed.");
  }

  let content: Buffer;
  if (input.content_text !== undefined) {
    if (!/\.(txt|md|csv)$/i.test(input.file_name)) {
      throw invalidRequestError("Text content must use a .txt, .md, or .csv filename.");
    }
    content = Buffer.from(input.content_text, "utf8");
  } else {
    content = decodeBase64(input.content_base64 ?? "");
  }

  if (content.length === 0 || content.length > config.dropboxMaxUploadBytes) {
    throw invalidRequestError("The uploaded file is empty or exceeds the configured size limit.");
  }

  return content;
}

function decodeBase64(value: string): Buffer {
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw invalidRequestError("The file content is not valid base64.");
  }

  const content = Buffer.from(compact, "base64");
  const normalizedInput = compact.replace(/=+$/, "");
  const normalizedOutput = content.toString("base64").replace(/=+$/, "");
  if (normalizedInput !== normalizedOutput) {
    throw invalidRequestError("The file content is not valid base64.");
  }

  return content;
}
