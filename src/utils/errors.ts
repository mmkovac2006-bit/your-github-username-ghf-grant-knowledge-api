import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  statusCode: number;
  code: string;
  safeMessage: string;

  constructor(statusCode: number, code: string, safeMessage: string) {
    super(safeMessage);
    this.statusCode = statusCode;
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

export function unauthorizedError(): AppError {
  return new AppError(401, "unauthorized", "Missing or invalid API key.");
}

export function blockedPathError(): AppError {
  return new AppError(403, "blocked_path", "This path is restricted and cannot be searched or returned.");
}

export function invalidRequestError(message = "Request validation failed."): AppError {
  return new AppError(400, "invalid_request", message);
}

export function upstreamError(): AppError {
  return new AppError(502, "upstream_error", "Unable to retrieve source material at this time.");
}

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "invalid_request",
      message: "Request validation failed."
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.code,
      message: err.safeMessage
    });
    return;
  }

  res.status(500).json({
    error: "internal_error",
    message: "An unexpected error occurred."
  });
}
