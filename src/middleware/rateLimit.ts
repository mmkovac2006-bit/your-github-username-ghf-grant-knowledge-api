import type { NextFunction, Request, Response } from "express";
import { authKeyFingerprint, getAuthorizationToken } from "../utils/security";

type RateEntry = {
  count: number;
  resetAt: number;
};

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const buckets = new Map<string, RateEntry>();

export function basicRateLimit() {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = getAuthorizationToken(req.header("authorization"));
    const identity = token ? `key:${authKeyFingerprint(token)}` : `ip:${req.ip}`;
    const now = Date.now();
    const existing = buckets.get(identity);

    if (!existing || existing.resetAt <= now) {
      buckets.set(identity, { count: 1, resetAt: now + WINDOW_MS });
      next();
      return;
    }

    if (existing.count >= MAX_REQUESTS_PER_WINDOW) {
      res.status(429).json({
        error: "rate_limited",
        message: "Too many requests. Please retry shortly."
      });
      return;
    }

    existing.count += 1;
    next();
  };
}
