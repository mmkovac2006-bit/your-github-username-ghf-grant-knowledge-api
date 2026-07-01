import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../utils/config";

export function requestTimeout(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    req.setTimeout(config.requestTimeoutMs);
    res.setTimeout(config.requestTimeoutMs);

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({
          error: "request_timeout",
          message: "The request took too long to complete."
        });
      }
    }, config.requestTimeoutMs);

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));

    next();
  };
}
