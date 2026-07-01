import path from "node:path";
import { CATEGORY_TERMS } from "./categories";
import { isBlockedPath, normalizeDropboxPath } from "./security";

export type DocumentMetadata = {
  year: string | null;
  funder: string | null;
  document_type: string;
  topic_tags: string[];
};

export const SCANNABLE_EXTENSIONS = new Set([".pdf", ".docx", ".doc", ".xlsx", ".xls", ".txt", ".md", ".csv"]);
export const EXTRACTABLE_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".xls", ".txt", ".md", ".csv"]);

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".webp",
  ".svg"
]);

const EXTRA_SKIP_RULES: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "temporary_or_duplicate_file", pattern: /(^|\/)~\$|\.tmp$|\.temp$|\.bak$|\.ds_store$/i },
  { reason: "receipt_or_invoice", pattern: /(^|[^a-z0-9])(receipt|invoice|reimbursement)([^a-z0-9]|$)/i },
  { reason: "banking_or_payment_sensitive", pattern: /(^|[^a-z0-9])(wire|voided\s+check|check\s+copy|routing|account\s+number|credit\s+card|donor\s+payment|payment\s+info|deposit)([^a-z0-9]|$)/i },
  { reason: "credential_sensitive", pattern: /(^|[^a-z0-9])(password|credential|login|username|secret)([^a-z0-9]|$)/i },
  { reason: "blank_form", pattern: /(^|[^a-z0-9])(blank\s+form|fillable\s+form|empty\s+form)([^a-z0-9]|$)/i },
  { reason: "vendor_logistics", pattern: /(^|[^a-z0-9])(vendor|catering|hotel|travel|logistics)([^a-z0-9]|$)/i }
];

const DOCUMENT_TYPE_RULES: Array<{ type: string; pattern: RegExp }> = [
  { type: "budget_narrative", pattern: /budget\s+narrative|budget\s+justification|narrative\s+budget/i },
  { type: "budget", pattern: /(^|[^a-z0-9])budget([^a-z0-9]|$)/i },
  { type: "letter_of_inquiry", pattern: /letter\s+of\s+inquiry|(^|[^a-z0-9])loi([^a-z0-9]|$)/i },
  { type: "submitted_portal_response", pattern: /portal|submitted|submission|online\s+application|response/i },
  { type: "renewal_request", pattern: /renewal|renew/i },
  { type: "interim_report", pattern: /interim\s+report|progress\s+report/i },
  { type: "final_report", pattern: /final\s+report/i },
  { type: "grant_report", pattern: /grant\s+report|report/i },
  { type: "past_grant_application", pattern: /application|proposal|request/i },
  { type: "case_statement", pattern: /case\s+statement|case\s+for\s+support/i },
  { type: "program_description", pattern: /program\s+description|program\s+overview|program\s+summary/i },
  { type: "evaluation_outcomes", pattern: /evaluation|outcomes?|impact|metrics?|survey|measur/i },
  { type: "sustainability_language", pattern: /sustainability|sustainable|future\s+funding/i },
  { type: "award_letter", pattern: /award\s+letter|award|funded|congratulations/i },
  { type: "grant_agreement", pattern: /grant\s+agreement|agreement|contract/i },
  { type: "donation_letter", pattern: /donation\s+letter|donor\s+letter|gift\s+letter/i },
  { type: "annual_report", pattern: /annual\s+report/i },
  { type: "brochure", pattern: /brochure|flyer|one\s+pager|one-pager/i },
  { type: "strategic_plan", pattern: /strategic\s+plan|strategy/i },
  { type: "financial_summary", pattern: /financial\s+summary|financials|statement\s+of\s+activities|revenue\s+summary/i },
  { type: "reusable_copy", pattern: /copy|boilerplate|template|grantwriting\s+resources/i }
];

const TOPIC_TAG_RULES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "Education", pattern: /education|mental\s+health\s+education|school|student|classroom/i },
  { tag: "Peer Helpers", pattern: /peer\s+helpers?/i },
  { tag: "Peer Helpers PLUS", pattern: /peer\s+helpers?\s+plus/i },
  { tag: "Thrive", pattern: /(^|[^a-z0-9])thrive([^a-z0-9]|$)/i },
  { tag: "Navigation Line", pattern: /navigation\s+line/i },
  { tag: "Here For Texas", pattern: /here\s+for\s+texas/i },
  { tag: "HOPE Framework", pattern: /hope\s+framework/i },
  { tag: "evaluation", pattern: /evaluation|survey|pre\/post|pre-post|measure/i },
  { tag: "outcomes", pattern: /outcomes?|impact|metrics?|results/i },
  { tag: "sustainability", pattern: /sustainability|sustainable|future\s+funding/i },
  { tag: "budget", pattern: /budget|expense|revenue|cost/i },
  { tag: "organization overview", pattern: /organization\s+overview|mission|history|founded|nonprofit/i },
  { tag: "need statement", pattern: /need\s+statement|mental\s+health\s+needs|access\s+to\s+care/i }
];

export function isScannableExtension(fileName: string): boolean {
  return SCANNABLE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function isExtractableExtension(fileName: string): boolean {
  return EXTRACTABLE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function safeSkipReason(dropboxPath: string): string | null {
  const normalizedPath = normalizeDropboxPath(dropboxPath);
  const extension = path.extname(normalizedPath).toLowerCase();

  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image_or_ocr_not_supported";
  }

  if (isBlockedPath(normalizedPath)) {
    return "sensitive_path_rule";
  }

  for (const rule of EXTRA_SKIP_RULES) {
    if (rule.pattern.test(normalizedPath)) {
      return rule.reason;
    }
  }

  return null;
}

export function inferYearFromPath(dropboxPath: string): string | null {
  const normalizedPath = normalizeDropboxPath(dropboxPath);
  const yearFolder = normalizedPath
    .split("/")
    .filter(Boolean)
    .find((segment) => /^_?20\d{2}\s+grants$/i.test(segment.trim()));

  const folderMatch = yearFolder?.match(/20\d{2}/);
  if (folderMatch) {
    return folderMatch[0];
  }

  return normalizedPath.match(/\b(20\d{2})\b/)?.[1] ?? null;
}

export function inferFunderFromPath(dropboxPath: string): string | null {
  const segments = normalizeDropboxPath(dropboxPath).split("/").filter(Boolean);
  const yearFolderIndex = segments.findIndex((segment) => /^_?20\d{2}\s+grants$/i.test(segment.trim()));

  if (yearFolderIndex >= 0) {
    for (let index = yearFolderIndex + 1; index < segments.length - 1; index += 1) {
      const candidate = cleanFunderSegment(segments[index]);
      if (candidate) {
        return candidate;
      }
    }
  }

  const resourceIndex = segments.findIndex((segment) => /^grantwriting resources$/i.test(segment.trim()));
  if (resourceIndex >= 0) {
    return "Grantwriting Resources";
  }

  return null;
}

export function inferDocumentTypeFromText(pathOrName: string, textSample = ""): string {
  const haystack = `${pathOrName} ${textSample.slice(0, 4000)}`;
  for (const rule of DOCUMENT_TYPE_RULES) {
    if (rule.pattern.test(haystack)) {
      return rule.type;
    }
  }
  return "source_document";
}

export function inferTopicTags(pathOrName: string, textSample = ""): string[] {
  const haystack = `${pathOrName} ${textSample.slice(0, 8000)}`;
  const tags = new Set<string>();

  for (const rule of TOPIC_TAG_RULES) {
    if (rule.pattern.test(haystack)) {
      tags.add(rule.tag);
    }
  }

  for (const [category, terms] of Object.entries(CATEGORY_TERMS)) {
    if (terms.some((term) => haystack.toLowerCase().includes(term.toLowerCase()))) {
      tags.add(category);
    }
  }

  return [...tags].sort((a, b) => a.localeCompare(b));
}

export function inferDocumentMetadata(dropboxPath: string, sourceFile: string, textSample = ""): DocumentMetadata {
  const haystack = `${dropboxPath} ${sourceFile}`;
  return {
    year: inferYearFromPath(dropboxPath),
    funder: inferFunderFromPath(dropboxPath),
    document_type: inferDocumentTypeFromText(haystack, textSample),
    topic_tags: inferTopicTags(haystack, textSample)
  };
}

function cleanFunderSegment(segment: string): string | null {
  const raw = segment.trim();
  if (!raw || isGenericFolderSegment(raw)) {
    return null;
  }

  const cleaned = segment
    .replace(/^copy\s+of\s+/i, "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\b(copy|draft|final|submitted|application|proposal|grant)\b/gi, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || isGenericFolderSegment(cleaned)) {
    return null;
  }

  return cleaned;
}

function isGenericFolderSegment(segment: string): boolean {
  const normalized = segment
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return /^(copy|copies|budgets?|[0-9]+\s+budgets?|[0-9]+\s+program|programs?|reports?|grant reports?|applications?|forms?|attachments?|old grant attachments?|informational pieces?|misc|templates?|resources?|successful|declined|pending|not submitted)$/.test(normalized);
}
