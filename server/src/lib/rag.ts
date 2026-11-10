import type { RagDocument } from "core/constants/rag";
import { RAG_SECRET, RAG_URL } from "./env";

// Answers from the rag service that the caller can fix: an unreadable or unsupported file, a name
// already in use, a file too large, an unknown document. Passed on with the service's message.
const PASSED_ON_STATUSES = [400, 404, 409, 413];

// Indexing embeds every chunk of the file, which takes a while for a long PDF.
const UPLOAD_TIMEOUT_MS = 120_000;
const TIMEOUT_MS = 10_000;

// Carries a status and expose, so the error handler in index.ts answers with them.
export class RagServiceError extends Error {
  readonly expose = true;
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${RAG_URL}${path}`, {
      ...init,
      headers: { ...init.headers, "X-Rag-Secret": RAG_SECRET! },
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (error) {
    console.error("rag service unreachable:", error);
    throw new RagServiceError(502, "The document service is unavailable");
  }
  if (res.ok) return res;

  // FastAPI puts its message in detail; a body that isn't JSON leaves it undefined.
  const detail = await res.json().then(
    (body) => (body as { detail?: unknown } | null)?.detail,
    () => undefined,
  );
  if (PASSED_ON_STATUSES.includes(res.status) && typeof detail === "string") {
    throw new RagServiceError(res.status, detail);
  }
  // A wrong RAG_SECRET (401) or a failure in the service: nothing the caller can fix.
  console.error(`rag service answered ${res.status}:`, detail);
  throw new RagServiceError(502, "The document service failed");
}

export async function listRagDocuments(): Promise<RagDocument[]> {
  const res = await call("/documents");
  return ((await res.json()) as { documents: RagDocument[] }).documents;
}

export async function addRagDocument(file: { filename: string; contentType: string; data: Uint8Array }): Promise<RagDocument> {
  const form = new FormData();
  form.append("file", new Blob([file.data], { type: file.contentType }), file.filename);
  const res = await call("/documents", { method: "POST", body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
  return (await res.json()) as RagDocument;
}

export async function deleteRagDocument(id: string): Promise<void> {
  await call(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
}
