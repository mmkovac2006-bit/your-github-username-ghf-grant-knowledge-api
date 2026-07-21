import type { AppConfig } from "../utils/config";
import { blockedPathError } from "../utils/errors";
import { getCategoryKey } from "../utils/categories";
import { isBlockedPath, isInsideAllowedRoot, isInsideAllowedRoots, normalizeDropboxPath } from "../utils/security";
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
  truncateAtWord,
  uniqueTerms
} from "../utils/search";
import type { FileCandidate, SearchResult, ServiceResult, SourceRepository } from "../types/search";

type SearchInput = {
  query: string;
  character_limit?: number;
  max_results?: number;
};

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
  freshnessScore: number;
};

export class GrantSearchService {
  constructor(
    private readonly sourceRepository: SourceRepository,
    private readonly config: AppConfig
  ) {}

  async search(input: SearchInput): Promise<ServiceResult<{
    query: string;
    query_characters: number;
    source: "dropbox";
    searched_folders: string[];
    results: SearchResult[];
  }>> {
    const normalizedQuery = input.query.replace(/\s+/g, " ").trim();
    const maxResults = this.maxResults(input.max_results);
    const terms = buildSearchTerms({
      question: normalizedQuery,
      years: "2024-2026"
    });

    const { files, restrictedSkipped } = await this.sourceRepository.searchFiles({
      terms,
      maxCandidates: maxResults * 6
    });

    const results = await this.resultsFromCandidates(files, terms, maxResults, {
      maxChars: this.searchExcerptLimit(input.character_limit),
      note: "Dropbox source excerpt for drafting."
    });

    return {
      response: {
        query: truncateAtWord(normalizedQuery, 500),
        query_characters: normalizedQuery.length,
        source: "dropbox",
        searched_folders: this.config.dropboxAllowedRoots,
        results
      },
      meta: { restrictedSkipped }
    };
  }

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
      years: input.preferred_years ?? "2024-2026"
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
          preferred_years: input.preferred_years ?? "2024-2026"
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
      years: input.years ?? "2024-2026"
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
      years: "2024-2026"
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

    if (!isInsideAllowedRoots(normalizedPath, this.config.dropboxAllowedRoots) || isBlockedPath(normalizedPath)) {
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
        ...this.sourceMetadata(candidate),
        source_file: candidate.source_file,
        funder: inferFunder(candidate),
        year: extractYear(candidate),
        path: candidate.path,
        excerpt: excerpt.excerpt,
        confidence: confidenceFromScore(score),
        document_type: inferDocumentType(candidate),
        character_count: excerpt.excerpt.length,
        notes: options.note,
        score,
        freshnessScore: this.freshnessScore(candidate.path)
      });

      if (rankedResults.length >= maxResults * 2) {
        break;
      }
    }

    return rankedResults
      .sort((a, b) => this.compareRankedResults(a, b))
      .slice(0, maxResults)
      .map(({ score: _score, freshnessScore: _freshnessScore, ...result }, index) => ({
        ...result,
        rank: index + 1
      }));
  }

  private isCandidateAllowed(candidate: FileCandidate): boolean {
    return isInsideAllowedRoots(candidate.path, this.config.dropboxAllowedRoots) && !isBlockedPath(candidate.path);
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

  private compareRankedResults(a: RankedResult, b: RankedResult): number {
    const relevanceDifference = b.score - a.score;

    if (Math.abs(relevanceDifference) <= 2) {
      return b.freshnessScore - a.freshnessScore || relevanceDifference;
    }

    return relevanceDifference;
  }

  private sourceMetadata(candidate: FileCandidate): Pick<SearchResult, "title" | "source_path" | "source_folder" | "source_category"> {
    const sourceRoot = this.config.dropboxAllowedRoots.find((root) => isInsideAllowedRoot(candidate.path, root));
    const folderName = sourceRoot?.split("/").filter(Boolean).pop() ?? "Approved Dropbox folder";

    return {
      title: candidate.source_file.replace(/\.[^.]+$/, ""),
      source_path: candidate.path,
      source_folder: folderName,
      source_category: /grantwriting resources/i.test(folderName) ? "grantwriting_resources" : "approved_grant_folder"
    };
  }

  private freshnessScore(path: string): number {
    const lowerPath = normalizeDropboxPath(path).toLowerCase();

    if (lowerPath.includes("/_2026 grants/") || lowerPath.endsWith("/_2026 grants")) {
      return 4;
    }
    if (lowerPath.includes("/2025 grants/") || lowerPath.endsWith("/2025 grants")) {
      return 3;
    }
    if (lowerPath.includes("/2024 grants/") || lowerPath.endsWith("/2024 grants")) {
      return 2;
    }
    if (lowerPath.includes("/grantwriting resources/") || lowerPath.endsWith("/grantwriting resources")) {
      return 1;
    }

    return 0;
  }
}
