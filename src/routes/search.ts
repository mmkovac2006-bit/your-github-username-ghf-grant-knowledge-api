import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import type { GrantSearchService } from "../services/grantSearchService";
import { sanitizeLogValue } from "../utils/security";

const optionalText = z.string().trim().min(1).max(500).optional();
const maxResults = z.number().int().positive().optional();

const searchGrantLanguageSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  category: optionalText,
  character_limit: z.number().int().positive().max(50_000).optional(),
  funder: optionalText,
  preferred_years: optionalText,
  max_results: maxResults
});

const searchByFunderSchema = z.object({
  funder: z.string().trim().min(1).max(500),
  years: optionalText,
  max_results: maxResults
});

const searchAnswerCategorySchema = z.object({
  category: z.string().trim().min(1).max(200),
  character_limit: z.number().int().positive().max(50_000).optional(),
  max_results: maxResults
});

const fetchSourceExcerptSchema = z.object({
  path: z.string().trim().min(1).max(2000),
  topic: z.string().trim().min(1).max(500),
  max_characters: z.number().int().positive().max(50_000).optional()
});

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function createSearchRouter(searchService: GrantSearchService) {
  const router = Router();

  router.post("/search_grant_language", asyncHandler(async (req, res) => {
    const body = searchGrantLanguageSchema.parse(req.body);
    res.locals.logContext = {
      question: sanitizeLogValue(body.question),
      category: sanitizeLogValue(body.category),
      funder: sanitizeLogValue(body.funder)
    };

    const result = await searchService.searchGrantLanguage(body);
    res.locals.resultCount = result.response.results.length;
    res.locals.restrictedSkipped = result.meta.restrictedSkipped > 0;
    res.json(result.response);
  }));

  router.post("/search_by_funder", asyncHandler(async (req, res) => {
    const body = searchByFunderSchema.parse(req.body);
    res.locals.logContext = {
      funder: sanitizeLogValue(body.funder)
    };

    const result = await searchService.searchByFunder(body);
    res.locals.resultCount = result.response.results.length;
    res.locals.restrictedSkipped = result.meta.restrictedSkipped > 0;
    res.json(result.response);
  }));

  router.post("/search_answer_category", asyncHandler(async (req, res) => {
    const body = searchAnswerCategorySchema.parse(req.body);
    res.locals.logContext = {
      category: sanitizeLogValue(body.category)
    };

    const result = await searchService.searchAnswerCategory(body);
    res.locals.resultCount = result.response.examples.length;
    res.locals.restrictedSkipped = result.meta.restrictedSkipped > 0;
    res.json(result.response);
  }));

  router.post("/fetch_source_excerpt", asyncHandler(async (req, res) => {
    const body = fetchSourceExcerptSchema.parse(req.body);
    res.locals.logContext = {
      topic: sanitizeLogValue(body.topic)
    };

    const result = await searchService.fetchSourceExcerpt(body);
    res.locals.resultCount = 1;
    res.locals.restrictedSkipped = result.meta.restrictedSkipped > 0;
    res.json(result.response);
  }));

  return router;
}
