import { afterEach, describe, expect, it, vi } from "vitest";
import { DropboxRepository } from "../src/services/dropboxRepository";
import { createConfig, DEFAULT_DROPBOX_ALLOWED_ROOTS, type AppConfig } from "../src/utils/config";

const allowedRoot = "/4 - Development/Test Current Grant Library";

function makeConfig(): AppConfig {
  return createConfig({
    NODE_ENV: "test",
    PORT: "3000",
    GHF_ACTION_API_KEY: "test-api-key",
    DROPBOX_APP_KEY: "client",
    DROPBOX_APP_SECRET: "secret",
    DROPBOX_REFRESH_TOKEN: "refresh",
    DROPBOX_PATH_ROOT_NAMESPACE_ID: "",
    DROPBOX_ALLOWED_SEARCH_FOLDERS: "",
    DROPBOX_ALLOWED_ROOTS: DEFAULT_DROPBOX_ALLOWED_ROOTS.join("|"),
    DROPBOX_ALLOWED_ROOT: "",
    MAX_RESULTS_DEFAULT: "5",
    MAX_RESULTS_LIMIT: "10",
    MAX_EXCERPT_CHARS: "2000",
    REQUEST_TIMEOUT_MS: "5000",
    LOG_LEVEL: "silent"
  });
}

function fileEntry(name: string): Record<string, unknown> {
  return {
    ".tag": "file",
    name,
    path_display: `${allowedRoot}/${name}`,
    path_lower: `${allowedRoot.toLowerCase()}/${name.toLowerCase()}`,
    server_modified: "2026-08-01T00:00:00Z",
    size: 1000
  };
}

function stubDropbox(entries: Record<string, unknown>[], fileText = "Sample grant text.") {
  return vi.fn(async (url: Parameters<typeof fetch>[0]) => {
    const target = String(url);
    if (target.endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 });
    }
    if (target.endsWith("/files/list_folder") || target.endsWith("/files/list_folder/continue")) {
      return new Response(JSON.stringify({ entries, has_more: false }), { status: 200 });
    }
    if (target.endsWith("/files/search_v2")) {
      return new Response(JSON.stringify({ matches: [] }), { status: 200 });
    }
    if (target.endsWith("/files/download")) {
      return new Response(fileText, { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("small-corpus candidate enumeration", () => {
  it("returns every approved file without calling keyword search", async () => {
    const entries = Array.from({ length: 8 }, (_, i) => fileEntry(`Document ${i + 1}.docx`));
    const fetchMock = stubDropbox(entries);
    vi.stubGlobal("fetch", fetchMock);

    const repository = new DropboxRepository(makeConfig());
    const result = await repository.searchFiles({ terms: ["programs"], maxCandidates: 30 });

    expect(result.files.length).toBe(8);
    const searchCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/files/search_v2"));
    expect(searchCalls.length).toBe(0);
  });

  it("is deterministic across differently-phrased queries", async () => {
    const entries = Array.from({ length: 10 }, (_, i) => fileEntry(`Source ${i + 1}.docx`));
    vi.stubGlobal("fetch", stubDropbox(entries));

    const repository = new DropboxRepository(makeConfig());
    const first = await repository.searchFiles({ terms: ["mission", "history"], maxCandidates: 30 });
    const second = await repository.searchFiles({ terms: ["counties", "served", "geography"], maxCandidates: 30 });

    expect(first.files.map((f) => f.path)).toEqual(second.files.map((f) => f.path));
  });

  it("falls back to keyword search when the corpus is large", async () => {
    const entries = Array.from({ length: 45 }, (_, i) => fileEntry(`Bulk ${i + 1}.docx`));
    const fetchMock = stubDropbox(entries);
    vi.stubGlobal("fetch", fetchMock);

    const repository = new DropboxRepository(makeConfig());
    await repository.searchFiles({ terms: ["programs"], maxCandidates: 30 });

    const searchCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/files/search_v2"));
    expect(searchCalls.length).toBeGreaterThan(0);
  });
});

describe("download cache", () => {
  it("downloads a file once within the TTL", async () => {
    const fetchMock = stubDropbox([fileEntry("Cached.txt")], "Cached file body.");
    vi.stubGlobal("fetch", fetchMock);

    const repository = new DropboxRepository(makeConfig());
    const path = `${allowedRoot}/Cached.txt`;
    const first = await repository.downloadText(path);
    const second = await repository.downloadText(path);

    expect(first.text).toBe(second.text);
    const downloadCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/files/download"));
    expect(downloadCalls.length).toBe(1);
  });
});
