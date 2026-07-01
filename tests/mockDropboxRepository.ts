import type {
  DownloadedText,
  FileCandidate,
  SourceRepository,
  SourceSearchInput,
  SourceSearchResult
} from "../src/types/search";

export type MockDropboxFile = {
  source_file?: string;
  path: string;
  text: string;
  server_modified?: string | null;
};

export class MockDropboxRepository implements SourceRepository {
  constructor(private readonly files: MockDropboxFile[]) {}

  async searchFiles(input: SourceSearchInput): Promise<SourceSearchResult> {
    const terms = input.terms.map((term) => term.toLowerCase());
    const files: FileCandidate[] = this.files
      .filter((file) => {
        if (terms.length === 0) {
          return true;
        }

        const haystack = `${file.path} ${file.source_file ?? ""} ${file.text}`.toLowerCase();
        return terms.some((term) => haystack.includes(term));
      })
      .slice(0, input.maxCandidates)
      .map((file) => ({
        source_file: file.source_file ?? file.path.split("/").pop() ?? "source.docx",
        path: file.path,
        server_modified: file.server_modified ?? null,
        size: file.text.length
      }));

    return {
      files,
      restrictedSkipped: 0
    };
  }

  async downloadText(path: string): Promise<DownloadedText> {
    const file = this.files.find((candidate) => candidate.path.toLowerCase() === path.toLowerCase());
    if (!file) {
      throw new Error("Mock Dropbox file not found.");
    }

    return {
      source_file: file.source_file ?? file.path.split("/").pop() ?? "source.docx",
      path: file.path,
      text: file.text
    };
  }
}
