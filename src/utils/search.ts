import type { Confidence, FileCandidate } from "../types/search";
import { getCategoryTerms } from "./categories";
import {
  inferDocumentTypeFromText,
  inferFunderFromPath,
  inferYearFromPath,
  isExtractableExtension
} from "./documentMetadata";
import { BLOCKED_PATTERNS } from "./security";

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "can",
  "describe",
  "for",
  "from",
  "have",
  "how",
  "into",
  "our",
  "that",
  "the",
  "their",
  "this",
  "under",
  "what",
  "when",
  "where",
  "with",
  "your"
]);

export function isSupportedFile(fileName: string): boolean {
  return isExtractableExtension(fileName);
}

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

export function uniqueTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      output.push(trimmed);
    }
  }

  return output;
}

export function buildSearchTerms(input: {
  question?: string;
  category?: string | null;
  funder?: string | null;
  years?: string | null;
}): string[] {
  const terms: string[] = [];

  if (input.funder) {
    terms.push(input.funder);
  }

  if (input.category) {
    if (shouldSearchRawCategory(input.category)) {
      terms.push(input.category);
    }
    terms.push(...getCategoryTerms(input.category));
  }

  if (input.question) {
    terms.push(...tokenize(input.question).slice(0, 10));
  }

  if (input.years) {
    terms.push(...input.years.match(/20\d{2}/g) ?? []);
  }

  return uniqueTerms(terms)
    .filter((term) => !isRestrictedSearchTerm(term))
    .slice(0, 20);
}

function shouldSearchRawCategory(category: string): boolean {
  return category.trim().toLowerCase() !== "financial health";
}

function isRestrictedSearchTerm(term: string): boolean {
  const lower = term.toLowerCase();
  return BLOCKED_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()));
}

export function clampPositiveInteger(value: number | undefined, defaultValue: number, maxValue: number): number {
  if (!value || Number.isNaN(value)) {
    return Math.min(defaultValue, maxValue);
  }

  return Math.min(Math.max(1, Math.floor(value)), maxValue);
}

export function extractYear(candidate: FileCandidate | string): string | null {
  const value = typeof candidate === "string" ? candidate : `${candidate.path} ${candidate.source_file}`;
  return inferYearFromPath(value);
}

export function inferFunder(candidate: FileCandidate): string | null {
  const pathFunder = inferFunderFromPath(candidate.path);
  if (pathFunder && !/grantwriting resources/i.test(pathFunder)) {
    return pathFunder;
  }

  const cleaned = candidate.source_file
    .replace(/\.[^.]+$/, "")
    .replace(/\b20\d{2}\b/g, "")
    .replace(/\b(application|proposal|report|copy|final|draft|grant)\b/gi, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

export function inferDocumentType(candidate: FileCandidate): string {
  return inferDocumentTypeFromText(`${candidate.path} ${candidate.source_file}`);
}

export function candidatePriority(candidate: FileCandidate): number {
  const value = `${candidate.path} ${candidate.source_file}`.toLowerCase();
  const year = extractYear(candidate);
  let score = 0;

  if (year === "2026") score += 8;
  if (year === "2025") score += 7;
  if (year === "2024") score += 6;
  if (year === "2023") score += 5;

  if (value.includes("copy")) score += 6;
  if (value.includes("successful") || value.includes("funded")) score += 5;
  if (value.includes("application") || value.includes("proposal")) score += 4;
  if (value.includes("report")) score += 4;
  if (value.includes("summary")) score += 4;
  if (value.includes("budget narrative")) score += 4;
  if (value.includes("loi") || value.includes("letter of inquiry")) score += 4;
  if (value.includes("renewal")) score += 4;
  if (value.includes("program")) score += 3;
  if (candidate.server_modified) score += 1;

  return score;
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function passageScore(passage: string, terms: string[]): number {
  const lower = passage.toLowerCase();
  let score = 0;

  for (const term of terms) {
    const lowerTerm = term.toLowerCase();
    if (lowerTerm.length <= 2) {
      continue;
    }

    if (lower.includes(lowerTerm)) {
      score += lowerTerm.includes(" ") ? 3 : 1;
    }
  }

  for (const token of tokenize(terms.join(" "))) {
    if (lower.includes(token)) {
      score += 1;
    }
  }

  return score;
}

export function confidenceFromScore(score: number): Confidence {
  if (score >= 8) {
    return "high";
  }
  if (score >= 3) {
    return "medium";
  }
  return "low";
}

function chunkLongParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }

    if (`${current} ${sentence}`.length <= maxChars) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxChars) {
      return [chunk];
    }

    const pieces: string[] = [];
    for (let index = 0; index < chunk.length; index += maxChars) {
      pieces.push(chunk.slice(index, index + maxChars));
    }
    return pieces;
  });
}

export function splitIntoPassages(text: string, maxChars: number): string[] {
  const targetChars = Math.min(Math.max(800, Math.floor(maxChars * 0.7)), maxChars);
  const paragraphs = text
    .split(/\n{2,}/)
    .map(normalizeText)
    .filter(Boolean);

  if (paragraphs.length === 0) {
    const normalized = normalizeText(text);
    return normalized ? [normalized.slice(0, maxChars)] : [];
  }

  const passages: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) {
        passages.push(current);
        current = "";
      }
      passages.push(...chunkLongParagraph(paragraph, maxChars));
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= targetChars) {
      current = next;
    } else {
      if (current) {
        passages.push(current);
      }
      current = paragraph;
    }
  }

  if (current) {
    passages.push(current);
  }

  return passages;
}

export function truncateAtWord(value: string, maxChars: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const sliceLimit = Math.max(1, maxChars - 3);
  const sliced = normalized.slice(0, sliceLimit);
  const lastSpace = sliced.lastIndexOf(" ");
  const trimmed = sliced.slice(0, lastSpace > 80 ? lastSpace : sliceLimit).trim();
  return `${trimmed}...`;
}

export function bestExcerpt(text: string, terms: string[], maxChars: number): { excerpt: string; score: number } {
  const passages = splitIntoPassages(text, maxChars);

  if (passages.length === 0) {
    return { excerpt: "", score: 0 };
  }

  const scored = passages
    .map((passage) => ({ passage, score: passageScore(passage, terms) }))
    .sort((a, b) => b.score - a.score || b.passage.length - a.passage.length);

  return {
    excerpt: truncateAtWord(scored[0].passage, maxChars),
    score: scored[0].score
  };
}
