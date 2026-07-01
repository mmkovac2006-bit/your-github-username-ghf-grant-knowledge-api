import type { AppConfig } from "../utils/config";
import { blockedPathError } from "../utils/errors";
import { getCategoryKey } from "../utils/categories";
import { isBlockedPath, isInsideAllowedRoot, normalizeDropboxPath } from "../utils/security";
import {
  bestExcerpt,
  buildSearchTerms,
  candidatePriority,
  clampPositiveInteger,
  confidenceFromScore,
  extractYear,
  inferDocumentType,
  inferFunder,
  isSupportedFile,
  passageScore,
  tokenize,
  uniqueTerms
} from "../utils/search";
import type { FileCandidate, SearchResult, ServiceResult, SourceRepository } from "../types/search";

type SearchGrantLanguageInput = {
  question: string;
  category?: string;
  character_limit?: number;
  funder?: string;
  preferred_years?: string;
  max_results?: number;
};

type SearchByFunderInput = {
  funder: string;
  years?: string;
  max_results?: number;
};

type SearchAnswerCategoryInput = {
  category: string;
  character_limit?: number;
  max_results?: number;
};

type FetchSourceExcerptInput = {
  path: string;
  topic: string;
  max_characters?: number;
};

type RankedResult = SearchResult & {
  score: number;
};

export class GrantSearchService {
  constructor(
    private readonly sourceRepository: SourceRepository,
    private readonly config: AppConfig
  ) {}

  async searchGrantLanguage(input: SearchGrantLanguageInput): Promise<ServiceResult<{
    query: {
      question: string;
      category: string | null;
      character_limit: number | null;
      funder: string | null;
      preferred_years: string;
    };
    results: SearchResult[];
  }>> {
    const maxResults = this.maxResults(input.max_results);
    const terms = buildSearchTerms({
      question: input.question,
      category: input.category,
      funder: input.funder,
      years: input.preferred_years ?? "2023-2026"
    });

    const { files, restrictedSkipped } = await this.sourceRepository.searchFiles({
      terms,
      maxCandidates: maxResults * 5
    });

    const results = await this.resultsFromCandidates(files, terms, maxResults, {
      note: "Possible reusable language. Verify current figures, dates, and funder-specific details before submission."
    });

    return {
      response: {
        query: {
          question: input.question,
          category: input.category ?? null,
          character_limit: input.character_limit ?? null,
          funder: input.funder ?? null,
          preferred_years: input.preferred_years ?? "2023-2026"
        },
        results
      },
      meta: { restrictedSkipped }
    };
  }

  async searchByFunder(input: SearchByFunderInput): Promise<ServiceResult<{
    funder: string;
    results: Array<SearchResult & {
      grant_type?: string | null;
      amount_requested?: number | null;
      amount_awarded?: number | null;
    }>;
  }>> {
    const maxResults = this.maxResults(input.max_results);
    const terms = buildSearchTerms({
      funder: input.funder,
      years: input.years ?? "2023-2026"
    });

    const { files, restrictedSkipped } = await this.sourceRepository.searchFiles({
      terms,
      maxCandidates: maxResults * 5
    });

    const results = await this.resultsFromCandidates(files, terms, maxResults, {
      note: "Amount fields may require grant summary lookup."
    });

    return {
      response: {
        funder: input.funder,
        results: results.map((result) => ({
          ...result,
          grant_type: result.document_type ?? null,
          amount_requested: null,
          amount_awarded: null
        }))
      },
      meta: { restrictedSkipped }
    };
  }

  async searchAnswerCategory(input: SearchAnswerCategoryInput): Promise<ServiceResult<{
    category: string;
    examples: Array<SearchResult & {
      needs_verification: string;
    }>;
  }>> {
    const maxResults = this.maxResults(input.max_results);
    const categoryKey = getCategoryKey(input.category) ?? input.category;
    const terms = buildSearchTerms({
      category: categoryKey,
      years: "2023-2026"
    });

    const { files, restrictedSkipped } = await this.sourceRepository.searchFiles({
      terms,
      maxCandidates: maxResults * 5
    });

    const results = await this.resultsFromCandidates(files, terms, maxResults, {
      maxChars: this.searchExcerptLimit(input.character_limit),
      note: "Verify current data before submission."
    });

    return {
      response: {
        category: categoryKey,
        examples: results.map((result) => ({
          ...result,
          needs_verification: "Verify current data before submission."
        }))
      },
      meta: { restrictedSkipped }
    };
  }

  async fetchSourceExcerpt(input: FetchSourceExcerptInput): Promise<ServiceResult<{
    source_file: string;
    path: string;
    topic: string;
    excerpt: string;
    character_count: number;
    notes: string;
  }>> {
    const normalizedPath = normalizeDropboxPath(input.path);

    if (!isInsideAllowedRoot(normalizedPath, this.config.dropboxAllowedRoot) || isBlockedPath(normalizedPath)) {
      throw blockedPathError();
    }

    const maxChars = this.searchExcerptLimit(input.max_characters);
    const downloaded = await this.sourceRepository.downloadText(normalizedPath);
    const terms = buildSearchTerms({ question: input.topic, category: input.topic });
    const excerpt = bestExcerpt(downloaded.text, terms, maxChars);

    return {
      response: {
        source_file: downloaded.source_file,
        path: downloaded.path,
        topic: input.topic,
        excerpt: excerpt.excerpt,
        character_count: excerpt.excerpt.length,
        notes: "Excerpt only. Full document not returned."
      },
      meta: { restrictedSkipped: 0 }
    };
  }

  private maxResults(value?: number): number {
    return clampPositiveInteger(value, this.config.maxResultsDefault, this.config.maxResultsLimit);
  }

  private searchExcerptLimit(value?: number): number {
    return clampPositiveInteger(value, Math.min(1200, this.config.maxExcerptChars), this.config.maxExcerptChars);
  }

  private async resultsFromCandidates(
    candidates: FileCandidate[],
    terms: string[],
    maxResults: number,
    options: { maxChars?: number; note: string }
  ): Promise<SearchResult[]> {
    const maxChars = options.maxChars ?? Math.min(1200, this.config.maxExcerptChars);
    const rankedCandidates = candidates
      .filter((candidate) => this.isCandidateAllowed(candidate))
      .filter((candidate) => isSupportedFile(candidate.source_file))
      .sort((a, b) => this.candidateSearchPriority(b, terms) - this.candidateSearchPriority(a, terms));

    const rankedResults: RankedResult[] = [];

    for (const candidate of rankedCandidates.slice(0, maxResults * 4)) {
      let excerpt: { excerpt: string; score: number };

      try {
        const downloaded = await this.sourceRepository.downloadText(candidate.path);
        excerpt = bestExcerpt(downloaded.text, terms, maxChars);
      } catch {
        continue;
      }

      if (!excerpt.excerpt) {
        continue;
      }

      const priorityScore = this.candidateSearchPriority(candidate, terms);
      const score = passageScore(excerpt.excerpt, terms) + Math.floor(priorityScore / 3);

      rankedResults.push({
        source_file: candidate.source_file,
        funder: inferFunder(candidate),
        year: extractYear(candidate),
        path: candidate.path,
        excerpt: excerpt.excerpt,
        confidence: confidenceFromScore(score),
        document_type: inferDocumentType(candidate),
        character_count: excerpt.excerpt.length,
        notes: options.note,
        score
      });

      // TODO: Replace keyword overlap with vector search once a nightly index exists.
      // TODO: Add source ranking by funded/successful grant outcomes from a curated grant summary table.
      if (rankedResults.length >= maxResults * 2) {
        break;
      }
    }

    return rankedResults
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(({ score: _score, ...result }) => result);
  }

  private isCandidateAllowed(candidate: FileCandidate): boolean {
    return isInsideAllowedRoot(candidate.path, this.config.dropboxAllowedRoot) && !isBlockedPath(candidate.path);
  }

  private candidateSearchPriority(candidate: FileCandidate, terms: string[]): number {
    const haystack = `${candidate.path} ${candidate.source_file}`.toLowerCase();
    let score = candidatePriority(candidate);

    for (const term of uniqueTerms(terms)) {
      const lowerTerm = term.toLowerCase().trim();
      if (!lowerTerm || /^20\d{2}$/.test(lowerTerm)) {
        continue;
      }

      if (haystack.includes(lowerTerm)) {
        score += lowerTerm.includes(" ") ? 18 : 8;
      }

      for (const token of tokenize(lowerTerm)) {
        if (haystack.includes(token)) {
          score += 2;
        }
      }
    }

    return score;
  }
}
