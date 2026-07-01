import crypto from "node:crypto";
import type { AppConfig } from "./config";

export const BLOCKED_PATTERNS = [
  "W-9",
  "W9",
  "Audit",
  "990",
  "Insurance",
  "Board",
  "Donor",
  "Bank",
  "HR",
  "Personnel",
  "Payroll",
  "Tax",
  "Check",
  "ACH",
  "Account",
  "Routing",
  "Staff Contact",
  "Personal",
  "Confidential"
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BLOCKED_PATTERN_REGEXES = BLOCKED_PATTERNS.map((pattern) => {
  if (pattern === "Audit") {
    return /(^|[^a-z0-9])audit[a-z]*([^a-z0-9]|$)/i;
  }

  const escaped = escapeRegExp(pattern).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
});

export function normalizeDropboxPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
  if (!normalized.startsWith("/")) {
    return `/${normalized}`;
  }
  return normalized;
}

export function normalizeAllowedRoot(path: string): string {
  const normalized = normalizeDropboxPath(path);
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function isBlockedPath(path: string): boolean {
  const normalizedPath = normalizeDropboxPath(path);
  return BLOCKED_PATTERN_REGEXES.some((pattern) => pattern.test(normalizedPath));
}

export function isInsideAllowedRoot(path: string, allowedRoot: string): boolean {
  const normalizedPath = normalizeDropboxPath(path).toLowerCase();
  const normalizedRoot = normalizeAllowedRoot(allowedRoot).toLowerCase();
  return normalizedPath === normalizedRoot.slice(0, -1) || normalizedPath.startsWith(normalizedRoot);
}

export function isSafeDropboxPath(path: string, allowedRoot: string): boolean {
  return isInsideAllowedRoot(path, allowedRoot) && !isBlockedPath(path);
}

export function safeCompareSecret(actual: string, expected: string): boolean {
  if (!actual || !expected) {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function authKeyFingerprint(value: string): string {
  return crypto.createHash("sha256").update(value || "anonymous").digest("hex").slice(0, 16);
}

export function sanitizeLogValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }

  const safe = isBlockedPath(compact) ? "[restricted]" : compact;
  return safe.length > 120 ? `${safe.slice(0, 117)}...` : safe;
}

export function getAuthorizationToken(headerValue: string | undefined): string {
  if (!headerValue) {
    return "";
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function hasConfiguredDropbox(config: AppConfig): boolean {
  return Boolean(config.dropboxClientId && config.dropboxClientSecret && config.dropboxRefreshToken);
}
