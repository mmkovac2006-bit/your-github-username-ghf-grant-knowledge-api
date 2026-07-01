export const APPROVED_CATEGORIES = [
  "organization overview",
  "mission and history",
  "population served",
  "demographics",
  "geographic area served",
  "need statement",
  "education programming",
  "Peer Helpers",
  "Peer Helpers PLUS",
  "Thrive",
  "HOPE Framework",
  "Here For Texas",
  "Navigation Line",
  "outcomes and impact",
  "evaluation",
  "financial health",
  "funding diversification",
  "sustainability",
  "partnerships",
  "equity and access",
  "organizational capacity",
  "leadership"
] as const;

export const CATEGORY_TERMS: Record<string, string[]> = {
  "organization overview": ["organization overview", "Grant Halliburton Foundation", "founded", "nonprofit", "mission"],
  "mission and history": ["mission", "history", "founded", "Grant Halliburton", "mental health", "suicide prevention"],
  "population served": ["population served", "students served", "families served", "youth", "North Texas"],
  demographics: ["demographics", "population served", "race", "ethnicity", "income", "students served", "families served"],
  "geographic area served": ["geographic area", "North Texas", "Dallas", "schools", "communities served", "service area"],
  "need statement": ["need statement", "mental health needs", "youth mental health", "suicide", "access to care"],
  "education programming": ["education programming", "mental health education", "Building Blocks", "Peer Helpers", "Thrive", "HOPE Framework"],
  "Peer Helpers": ["Peer Helpers", "peer support", "student leaders", "school-based", "training"],
  "Peer Helpers PLUS": ["Peer Helpers PLUS", "Peer Helpers", "student leaders", "expanded training", "school-based"],
  Thrive: ["Thrive", "resilience", "mental wellness", "education", "students"],
  "HOPE Framework": ["HOPE Framework", "hope", "resilience", "positive experiences", "mental health"],
  "Here For Texas": ["Here For Texas", "Navigation Line", "mental health resources", "provider database"],
  "Navigation Line": ["Navigation Line", "Here For Texas", "mental health resources", "provider referrals", "navigation"],
  "outcomes and impact": ["outcomes", "impact", "results", "students served", "metrics", "measurable"],
  evaluation: ["evaluation", "outcomes", "metrics", "survey", "pre/post", "impact", "measure"],
  "financial health": ["financial", "financial stability", "financial position", "operating budget", "budget", "revenue", "sustainability", "diversified revenue"],
  "funding diversification": ["diversified funding", "diverse revenue", "funding sources", "grants", "individual donors", "corporate", "events"],
  sustainability: ["sustainability", "long-term", "continue", "future funding", "revenue model"],
  partnerships: ["partnership", "collaboration", "schools", "districts", "Region 10", "NAMI"],
  "equity and access": ["equity", "access", "barriers", "underserved", "inclusive", "culturally responsive"],
  "organizational capacity": ["capacity", "leadership", "staff", "experience", "track record"],
  leadership: ["leadership", "executive", "staff", "experience", "management"]
};

export function getCategoryKey(category: string): string | null {
  const normalized = category.trim().toLowerCase();
  return APPROVED_CATEGORIES.find((candidate) => candidate.toLowerCase() === normalized) ?? null;
}

export function getCategoryTerms(category?: string | null): string[] {
  if (!category) {
    return [];
  }

  const key = getCategoryKey(category);
  if (!key) {
    return [category];
  }

  return CATEGORY_TERMS[key] ?? [key];
}
