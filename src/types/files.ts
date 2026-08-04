export type DropboxUploadTarget = "current_grant_library" | "current_grants_submitted";

export type DropboxFileOperationResult = {
  name: string;
  path: string;
  id?: string | null;
  rev?: string | null;
  size?: number | null;
};

export interface DropboxFileManager {
  uploadFile(input: {
    target: DropboxUploadTarget;
    fileName: string;
    content: Buffer;
  }): Promise<DropboxFileOperationResult>;
  moveToArchive(sourcePath: string): Promise<DropboxFileOperationResult & { from_path: string }>;
}
