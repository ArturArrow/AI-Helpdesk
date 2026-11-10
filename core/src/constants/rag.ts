// Restated from rag/app/routes.py (MAX_DOCUMENT_BYTES) and rag/app/chunking.py
// (ALLOWED_EXTENSIONS); keep them in sync by hand. The rag service enforces them; the server's
// upload limit and the client's checks only answer sooner.
export const MAX_RAG_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const RAG_DOCUMENT_EXTENSIONS: readonly string[] = [".pdf", ".txt"];

// A document in the knowledge base, as GET /api/rag/documents lists it.
export interface RagDocument {
  id: string;
  filename: string;
  size: number;
  chunkCount: number;
  createdAt: string;
  // Whether the original file is stored, for downloading. False for documents added before it was.
  hasFile: boolean;
}
