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
  "characters",
  "concise",
  "describe",
  "explain",
  "fewer",
  "for",
  "from",
  "have",
  "how",
  "including",
  "into",
  "our",
  "please",
  "primary",
  "principal",
  "prospective",
  "provide",
  "summarize",
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

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
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
    // Frequency-weighted (capped) so a passage that discusses a topic
    // repeatedly outranks one that mentions it in passing.
    score += Math.min(countOccurrences(lower, token), 3);
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

const COVERAGE_SEPARATOR = " […] ";
const COVERAGE_MAX_EXTRA_PASSAGES = 3;
const COVERAGE_MIN_REMAINING_CHARS = 160;
const COVERAGE_OVERFLOW_ALLOWANCE = 200;
const COVERAGE_NEW_TOKEN_BONUS = 2;
const COVERAGE_MIN_ADDITION_VALUE = 1;

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (a.size + b.size - intersection);
}

/**
 * Coverage-aware excerpt selection. Starts from the single best passage, then
 * greedily appends further passages using a relevance-with-diversity rule:
 * a candidate's value is its query relevance (plus a bonus for covering query
 * tokens the excerpt does not yet contain) scaled down by its textual
 * similarity to the passages already selected. This keeps one strong
 * paragraph from hiding the rest of a document, and — unlike pure new-token
 * coverage — still adds passages that match the same query tokens but carry
 * different content (e.g. a second program's description for a broad
 * "programs" question, or a county-name list after an intro that already
 * mentions "counties").
 */
export function coverageExcerpt(text: string, terms: string[], maxChars: number): { excerpt: string; score: number } {
  const passages = splitIntoPassages(text, maxChars);

  if (passages.length === 0) {
    return { excerpt: "", score: 0 };
  }

  const queryTokens = uniqueTerms(tokenize(terms.join(" "))).map((token) => token.toLowerCase());
  const scored = passages
    .map((passage, index) => ({
      passage,
      index,
      score: passageScore(passage, terms),
      tokens: new Set(tokenize(passage))
    }))
    .sort((a, b) => b.score - a.score || b.passage.length - a.passage.length);

  const selected = [scored[0]];
  const covered = new Set(queryTokens.filter((token) => scored[0].passage.toLowerCase().includes(token)));
  let usedChars = scored[0].passage.length;

  for (let additions = 0; additions < COVERAGE_MAX_EXTRA_PASSAGES; additions += 1) {
    const remaining = maxChars - usedChars;
    if (remaining < COVERAGE_MIN_REMAINING_CHARS) {
      break;
    }

    let bestAddition: (typeof scored)[number] | null = null;
    let bestValue = 0;

    for (const candidate of scored) {
      if (selected.includes(candidate) || candidate.score < 1) {
        continue;
      }

      if (candidate.passage.length > remaining + COVERAGE_OVERFLOW_ALLOWANCE) {
        continue;
      }

      const lower = candidate.passage.toLowerCase();
      const newTokens = queryTokens.filter((token) => !covered.has(token) && lower.includes(token)).length;
      const maxSimilarity = Math.max(
        ...selected.map((entry) => jaccardSimilarity(candidate.tokens, entry.tokens))
      );
      const value = (candidate.score + COVERAGE_NEW_TOKEN_BONUS * newTokens) * (1 - maxSimilarity);

      if (value > bestValue) {
        bestAddition = candidate;
        bestValue = value;
      }
    }

    if (!bestAddition || bestValue < COVERAGE_MIN_ADDITION_VALUE) {
      break;
    }

    selected.push(bestAddition);
    for (const token of queryTokens) {
      if (bestAddition.passage.toLowerCase().includes(token)) {
        covered.add(token);
      }
    }
    usedChars += COVERAGE_SEPARATOR.length + bestAddition.passage.length;
  }

  const joined = selected
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.passage)
    .join(COVERAGE_SEPARATOR);
  const excerpt = truncateAtWord(joined, maxChars);

  return {
    excerpt,
    score: passageScore(excerpt, terms)
  };
}
