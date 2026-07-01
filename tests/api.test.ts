import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createConfig, type AppConfig } from "../src/utils/config";
import { isBlockedPath } from "../src/utils/security";
import { MockDropboxRepository, type MockDropboxFile } from "./mockDropboxRepository";

const allowedRoot = "/4 - Development/1 - Grants";
const apiKey = "test-api-key";

function makeConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  return createConfig({
    NODE_ENV: "test",
    PORT: "3000",
    GHF_ACTION_API_KEY: apiKey,
    DROPBOX_CLIENT_ID: "client",
    DROPBOX_CLIENT_SECRET: "secret",
    DROPBOX_REFRESH_TOKEN: "refresh",
    DROPBOX_NAMESPACE_ID: "",
    DROPBOX_ALLOWED_ROOT: allowedRoot,
    MAX_RESULTS_DEFAULT: "5",
    MAX_RESULTS_LIMIT: "3",
    MAX_EXCERPT_CHARS: "120",
    REQUEST_TIMEOUT_MS: "5000",
    LOG_LEVEL: "silent",
    ...overrides
  });
}

function grantText(topic = "demographics"): string {
  return [
    `Grant Halliburton Foundation provides ${topic} language for youth mental health programs in North Texas.`,
    "The organization serves students, educators, families, and community partners through education programming and resource navigation.",
    "This reusable proposal language should be treated as source material only and reviewed before submission."
  ].join("\n\n");
}

function makeApp(files: MockDropboxFile[] = baseFiles(), config = makeConfig()) {
  return createApp({
    config,
    sourceRepository: new MockDropboxRepository(files)
  });
}

function baseFiles(): MockDropboxFile[] {
  return [
    {
      path: `${allowedRoot}/2025 Grants/Copy/Demographics.docx`,
      source_file: "Demographics.docx",
      text: grantText("demographics")
    },
    {
      path: `${allowedRoot}/2025 Grants/Simmons Foundation/Simmons Foundation 2025 Application.docx`,
      source_file: "Simmons Foundation 2025 Application.docx",
      text: grantText("funding diversification")
    },
    {
      path: `${allowedRoot}/2025 Grants/Lyda Hill/Lyda Hill Grant Backup.pdf`,
      source_file: "Lyda Hill Grant Backup.pdf",
      text: [
        "Lyda Hill Foundation proposal language describes Grant Halliburton Foundation education programming for students, educators, and families.",
        "The proposal also explains financial health, diversified revenue, sustainability, and a stable operating budget."
      ].join("\n\n")
    },
    {
      path: `${allowedRoot}/2023 Grants/Grant Summary 2023.docx`,
      source_file: "Grant Summary 2023.docx",
      text: "The annual grant summary mentions Lyda Hill alongside several other funders."
    },
    {
      path: `${allowedRoot}/2025 Grants/Audit/Audit Narrative.docx`,
      source_file: "Audit Narrative.docx",
      text: grantText("demographics")
    }
  ];
}

describe("GHF Grant Knowledge API", () => {
  it("returns ok from /health without querying Dropbox", async () => {
    const response = await request(makeApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "GHF Grant Knowledge API",
      version: "1.0.0"
    });
  });

  it("returns 401 when the API key is missing", async () => {
    const response = await request(makeApp())
      .post("/search_answer_category")
      .send({ category: "demographics" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "unauthorized",
      message: "Missing or invalid API key."
    });
  });

  it("returns 401 when the API key is invalid", async () => {
    const response = await request(makeApp())
      .post("/search_answer_category")
      .set("Authorization", "Bearer wrong-key")
      .send({ category: "demographics" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("unauthorized");
  });

  it("allows a valid API key to search", async () => {
    const response = await request(makeApp())
      .post("/search_answer_category")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ category: "demographics" });

    expect(response.status).toBe(200);
    expect(response.body.category).toBe("demographics");
    expect(response.body.examples.length).toBeGreaterThan(0);
  });

  it("parses namespace-enabled Dropbox root configuration", () => {
    const config = makeConfig({
      DROPBOX_NAMESPACE_ID: "5698749680",
      DROPBOX_ALLOWED_ROOT: "/4 - Development/1 - Grants/"
    });

    expect(config.dropboxNamespaceId).toBe("5698749680");
    expect(config.dropboxAllowedRoot).toBe("/4 - Development/1 - Grants");
  });

  it("requires auth for the Dropbox diagnostic endpoint", async () => {
    const response = await request(makeApp()).get("/debug/dropbox");

    expect(response.status).toBe(401);
  });

  it("returns sanitized Dropbox diagnostic information", async () => {
    const response = await request(makeApp())
      .get("/debug/dropbox")
      .set("Authorization", `Bearer ${apiKey}`);

    expect(response.status).toBe(200);
    expect(response.body.configured.credentials.all).toBe(true);
    expect(response.body.configured.allowed_root).toBe(allowedRoot);
    expect(response.body.lyda_hill_search).toMatchObject({
      ok: true,
      query: "Lyda Hill"
    });
    expect(response.body.lyda_hill_search.result_count).toBeGreaterThan(0);
    const diagnosticJson = JSON.stringify(response.body);
    expect(diagnosticJson).not.toContain(`"client_secret":"secret"`);
    expect(diagnosticJson).not.toContain(`"refresh_token":"refresh"`);
    expect(diagnosticJson).not.toContain(apiKey);
  });

  it("returns direct results for Lyda Hill and key grant categories", async () => {
    const app = makeApp();
    const authHeader = `Bearer ${apiKey}`;

    const lydaHill = await request(app)
      .post("/search_by_funder")
      .set("Authorization", authHeader)
      .send({ funder: "Lyda Hill", max_results: 2 });

    expect(lydaHill.status).toBe(200);
    expect(lydaHill.body.results[0]).toMatchObject({
      source_file: "Lyda Hill Grant Backup.pdf",
      funder: "Lyda Hill"
    });

    const educationProgramming = await request(app)
      .post("/search_answer_category")
      .set("Authorization", authHeader)
      .send({ category: "education programming", max_results: 2 });

    expect(educationProgramming.status).toBe(200);
    expect(educationProgramming.body.examples.length).toBeGreaterThan(0);

    const financialHealth = await request(app)
      .post("/search_answer_category")
      .set("Authorization", authHeader)
      .send({ category: "financial health", max_results: 2 });

    expect(financialHealth.status).toBe(200);
    expect(financialHealth.body.examples.length).toBeGreaterThan(0);
  });

  it("rejects blocked paths before download", async () => {
    const response = await request(makeApp())
      .post("/fetch_source_excerpt")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({
        path: `${allowedRoot}/2025 Grants/Audit/Audit Narrative.docx`,
        topic: "demographics"
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "blocked_path",
      message: "This path is restricted and cannot be searched or returned."
    });
  });

  it("returns the expected search result shape", async () => {
    const response = await request(makeApp())
      .post("/search_grant_language")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({
        question: "Describe the organization's financial sustainability.",
        category: "funding diversification",
        character_limit: 750,
        max_results: 1
      });

    expect(response.status).toBe(200);
    expect(response.body.query.character_limit).toBe(750);
    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0]).toMatchObject({
      source_file: expect.any(String),
      path: expect.any(String),
      excerpt: expect.any(String),
      confidence: expect.stringMatching(/^(high|medium|low)$/)
    });
  });

  it("caps excerpt length", async () => {
    const response = await request(makeApp())
      .post("/search_answer_category")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({
        category: "demographics",
        character_limit: 10_000
      });

    expect(response.status).toBe(200);
    expect(response.body.examples[0].excerpt.length).toBeLessThanOrEqual(120);
  });

  it("does not allow max_results to exceed the configured limit", async () => {
    const files = Array.from({ length: 8 }, (_, index) => ({
      path: `${allowedRoot}/2025 Grants/Copy/Demographics ${index}.docx`,
      source_file: `Demographics ${index}.docx`,
      text: grantText("demographics")
    }));

    const response = await request(makeApp(files))
      .post("/search_answer_category")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({
        category: "demographics",
        max_results: 99
      });

    expect(response.status).toBe(200);
    expect(response.body.examples.length).toBeLessThanOrEqual(3);
  });

  it("filters restricted terms case-insensitively", async () => {
    const files = [
      {
        path: `${allowedRoot}/2025 Grants/Copy/Demographics.docx`,
        source_file: "Demographics.docx",
        text: grantText("demographics")
      },
      {
        path: `${allowedRoot}/2025 Grants/Confidential/DEMOGRAPHICS confidential.docx`,
        source_file: "DEMOGRAPHICS confidential.docx",
        text: grantText("demographics")
      }
    ];

    const response = await request(makeApp(files))
      .post("/search_answer_category")
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ category: "demographics", max_results: 3 });

    expect(response.status).toBe(200);
    expect(response.body.examples).toHaveLength(1);
    expect(response.body.examples[0].path.toLowerCase()).not.toContain("confidential");
  });

  it("does not block approved words that merely contain a restricted acronym", () => {
    expect(isBlockedPath(`${allowedRoot}/2025 Grants/Program Materials/Thrive Overview.docx`)).toBe(false);
    expect(isBlockedPath(`${allowedRoot}/2025 Grants/Attachments/Program Overview.docx`)).toBe(false);
    expect(isBlockedPath(`${allowedRoot}/2025 Grants/HR/Staffing.docx`)).toBe(true);
    expect(isBlockedPath(`${allowedRoot}/2025 Grants/Funder/Audited Financials 2023.pdf`)).toBe(true);
  });
});
