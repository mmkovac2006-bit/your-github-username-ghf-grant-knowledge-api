import path from "node:path";
import mammoth from "mammoth";
import * as xlsx from "xlsx";
import { invalidRequestError } from "../utils/errors";

export async function extractTextFromBuffer(buffer: Buffer, fileName: string): Promise<string> {
  const extension = path.extname(fileName).toLowerCase();

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (extension === ".pdf") {
    const pdfModule = (await import("pdf-parse")) as unknown as {
      default?: (input: Buffer) => Promise<{ text: string }>;
    } & ((input: Buffer) => Promise<{ text: string }>);
    const pdfParse = pdfModule.default ?? pdfModule;
    const result = await pdfParse(buffer);
    return result.text;
  }

  if ([".txt", ".md", ".csv"].includes(extension)) {
    return buffer.toString("utf8");
  }

  if (extension === ".xlsx") {
    const workbook = xlsx.read(buffer, { type: "buffer" });
    return workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return `Sheet: ${sheetName}\n${xlsx.utils.sheet_to_csv(sheet)}`;
    }).join("\n\n");
  }

  throw invalidRequestError("Unsupported file type.");
}

export function getSourceFileName(dropboxPath: string): string {
  return dropboxPath.split("/").filter(Boolean).pop() ?? "source";
}
