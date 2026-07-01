import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../utils/config";

export function requestLogger(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();

    res.on("finish", () => {
      if (config.logLevel === "silent") {
        return;
      }

      const payload = {
        timestamp: new Date().toISOString(),
        endpoint: req.path,
        method: req.method,
        status: res.statusCode,
        duration_ms: Date.now() - startedAt,
        result_count: res.locals.resultCount ?? null,
        restricted_files_skipped: Boolean(res.locals.restrictedSkipped),
        context: res.locals.logContext ?? {}
      };

      console.info(JSON.stringify(payload));
    });

    next();
  };
}
