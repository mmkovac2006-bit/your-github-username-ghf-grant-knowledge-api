import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { coverageExcerpt, passageScore } from "../src/utils/search";
import { createConfig, DEFAULT_DROPBOX_ALLOWED_ROOTS, type AppConfig } from "../src/utils/config";
import { MockDropboxRepository, type MockDropboxFile } from "./mockDropboxRepository";

const allowedRoot = "/4 - Development/Test Current Grant Library";
const apiKey = "test-api-key";

function makeConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  return createConfig({
    NODE_ENV: "test",
    PORT: "3000",
    GHF_ACTION_API_KEY: apiKey,
    DROPBOX_APP_KEY: "client",
    DROPBOX_APP_SECRET: "secret",
    DROPBOX_REFRESH_TOKEN: "refresh",
    DROPBOX_PATH_ROOT_NAMESPACE_ID: "",
    DROPBOX_ALLOWED_SEARCH_FOLDERS: "",
    DROPBOX_ALLOWED_ROOTS: DEFAULT_DROPBOX_ALLOWED_ROOTS.join("|"),
    DROPBOX_ALLOWED_ROOT: "",
    MAX_RESULTS_DEFAULT: "3",
    MAX_RESULTS_LIMIT: "3",
    MAX_EXCERPT_CHARS: "1600",
    REQUEST_TIMEOUT_MS: "5000",
    LOG_LEVEL: "silent",
    ...overrides
  });
}

// Mirrors the observed live failure: one document holding both a generic
// narrative paragraph and a program-list paragraph. Before the coverage
// change, only the single best-scoring paragraph could be returned, so broad
// program questions never surfaced the program names.
const grantIntroText = [
  "Grant Halliburton Foundation seeks funding to expand mental health education and suicide prevention programs for children and youth across North Texas. Funds will support program delivery, materials, and educator training for school communities.",
  "Our programs by grade level include the following. Early Risers serves Pre-K through third grade with play-based lessons on emotions and empathy. Building Blocks of Mental Health offers interactive presentations for grades 4-12 on stress, anxiety, and suicide prevention. Peer Helpers PLUS serves grades K-12, training peer leaders to recognize distress and connect classmates with trusted adults.",
  "The Foundation collaborates with schools and community organizations and evaluates outcomes annually to improve program quality."
].join("\n\n");

function programFiles(): MockDropboxFile[] {
  return [
    {
      path: `${allowedRoot}/2026 Grants/Collaborative/GHF Collaborative Grant Intro.docx`,
      source_file: "GHF Collaborative Grant Intro.docx",
      text: grantIntroText
    }
  ];
}

describe("passageScore frequency weighting", () => {
  it("ranks a passage that discusses a topic repeatedly above one that mentions it once", () => {
    const repeated = "Our programs include education programs, peer programs, and family programs for youth.";
    const single = "The organization delivers one program and other unrelated services for youth families.";

    expect(passageScore(repeated, ["programs"])).toBeGreaterThan(passageScore(single, ["programs"]));
  });
});

describe("coverageExcerpt", () => {
  it("combines passages so a broad program query surfaces the program-list paragraph", () => {
    const result = coverageExcerpt(grantIntroText, ["programs", "children", "youth", "funds"], 1600);

    expect(result.excerpt).toContain("Early Risers");
    expect(result.excerpt).toContain("Building Blocks of Mental Health");
    expect(result.excerpt).toContain("Funds will support");
  });

  it("covers tokens from distinct paragraphs for a mixed-topic query", () => {
    const result = coverageExcerpt(grantIntroText, ["funds", "grade", "collaborates"], 1600);

    expect(result.excerpt).toContain("Funds will support");
    expect(result.excerpt).toContain("grade level");
  });

  it("respects the character budget", () => {
    const result = coverageExcerpt(grantIntroText, ["programs", "funds"], 300);

    expect(result.excerpt.length).toBeLessThanOrEqual(300);
  });

  it("returns a single passage when the budget cannot fit additions", () => {
    const result = coverageExcerpt(grantIntroText, ["programs", "funds"], 260);

    expect(result.excerpt).not.toContain("[…]");
  });

  it("returns empty for empty text", () => {
    expect(coverageExcerpt("", ["programs"], 1200).excerpt).toBe("");
  });
});

describe("search endpoint retrieval consistency", () => {
  it("surfaces program names for a broad program question", async () => {
    const app = createApp({
      config: makeConfig(),
      sourceRepository: new MockDropboxRepository(programFiles())
    });

    const response = await request(app)
      .post("/search")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ query: "our education programs for children and youth", character_limit: 1600 });

    expect(response.status).toBe(200);
    expect(response.body.results.length).toBeGreaterThan(0);
    const excerpt = response.body.results[0].excerpt as string;
    expect(excerpt).toContain("Early Risers");
    expect(excerpt).toContain("Building Blocks of Mental Health");
  });

  it("still returns focused excerpts for a specific question", async () => {
    const app = createApp({
      config: makeConfig(),
      sourceRepository: new MockDropboxRepository(programFiles())
    });

    const response = await request(app)
      .post("/search")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ query: "programs by grade level", character_limit: 1600 });

    expect(response.status).toBe(200);
    const excerpt = response.body.results[0].excerpt as string;
    expect(excerpt).toContain("grade level");
    expect(excerpt).toContain("Peer Helpers PLUS");
  });
});
