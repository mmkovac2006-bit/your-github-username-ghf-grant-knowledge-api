import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../utils/config";
import { unauthorizedError } from "../utils/errors";
import { getAuthorizationToken, safeCompareSecret } from "../utils/security";

export function requireApiKey(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const providedToken = getAuthorizationToken(req.header("authorization"));

    if (!safeCompareSecret(providedToken, config.actionApiKey)) {
      next(unauthorizedError());
      return;
    }

    next();
  };
}
