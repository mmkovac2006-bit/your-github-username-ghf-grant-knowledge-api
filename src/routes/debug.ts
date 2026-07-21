import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { SourceRepository } from "../types/search";
import type { AppConfig } from "../utils/config";
import { hasConfiguredDropbox } from "../utils/security";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function createDebugRouter(config: AppConfig, sourceRepository: SourceRepository) {
  const router = Router();

  router.get("/debug/database", asyncHandler(async (_req, res) => {
    res.locals.logContext = {
      diagnostic: "database"
    };

    res.json({
      configured: {
        backend: "dropbox",
        database_url: false
      },
      connection_check: {
        ok: false,
        skipped: "Version 1 search is Dropbox-only; no private database is used."
      },
      index_counts: {
        documents: 0,
        chunks: 0
      },
      lyda_hill_search: {
        ok: false,
        query: "Lyda Hill",
        result_count: 0,
        sample_paths: [],
        skipped: "Version 1 search is Dropbox-only; no private database is used."
      },
      notes: [
        "Dropbox is the live master source for v1."
      ]
    });
  }));

  router.get("/debug/dropbox", asyncHandler(async (_req, res) => {
    res.locals.logContext = {
      diagnostic: "dropbox"
    };

    if (sourceRepository.diagnoseDropbox) {
      const diagnostic = await sourceRepository.diagnoseDropbox();
      res.locals.resultCount = Number(diagnostic.lyda_hill_search.result_count ?? 0);
      res.json(diagnostic);
      return;
    }

    const lydaHillSearch = await sourceRepository.searchFiles({
      terms: ["Lyda Hill"],
      maxCandidates: 5
    });

    res.locals.resultCount = lydaHillSearch.files.length;
    res.locals.restrictedSkipped = lydaHillSearch.restrictedSkipped > 0;
    res.json({
      configured: {
        credentials: {
          client_id: Boolean(config.dropboxClientId),
          client_secret: Boolean(config.dropboxClientSecret),
          refresh_token: Boolean(config.dropboxRefreshToken),
          all: hasConfiguredDropbox(config)
        },
        namespace_id: Boolean(config.dropboxNamespaceId),
        allowed_root: config.dropboxAllowedRoot,
        allowed_roots: config.dropboxAllowedRoots
      },
      account_check: {
        ok: false,
        skipped: "Dropbox account diagnostics are unavailable for this repository."
      },
      allowed_root_check: {
        ok: false,
        paths: config.dropboxAllowedRoots,
        skipped: "Dropbox root diagnostics are unavailable for this repository."
      },
      lyda_hill_search: {
        ok: true,
        query: "Lyda Hill",
        result_count: lydaHillSearch.files.length,
        sample_paths: lydaHillSearch.files.map((file) => file.path).slice(0, 5),
        restricted_skipped: lydaHillSearch.restrictedSkipped
      },
      notes: []
    });
  }));

  return router;
}
