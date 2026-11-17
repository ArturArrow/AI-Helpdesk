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
    // The underlying failure, shown in Sentry under the 502 the error handler reports.
    options?: ErrorOptions,
  ) {
    super(message, options);
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
    throw new RagServiceError(502, "The document service is unavailable", { cause: error });
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
  throw new RagServiceError(502, "The document service failed", {
    cause: new Error(`rag service answered ${res.status}: ${String(detail)}`),
  });
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

// The original file. The service sends the name percent-encoded in X-Filename.
export async function downloadRagDocument(id: string): Promise<{ filename: string; data: Buffer }> {
  const res = await call(`/documents/${encodeURIComponent(id)}/file`);
  return {
    filename: decodeURIComponent(res.headers.get("X-Filename") ?? "document"),
    data: Buffer.from(await res.arrayBuffer()),
  };
}

export async function deleteRagDocument(id: string): Promise<void> {
  await call(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// How auto-resolve searches the knowledge base. With text-embedding-3-small, scores of questions the
// knowledge base answers and of ones it doesn't overlap (about 0.27-0.59 against 0.20-0.37 on the
// support FAQ), so the floor only drops clearly unrelated tickets; the model decides the rest.
// 8 excerpts, not 5: a Polish question about an English document ranked its answer 6th or 7th,
// behind Polish chunks on other topics, and the ticket was escalated for want of it.
export const KNOWLEDGE_EXCERPTS = 8;
export const MIN_KNOWLEDGE_SCORE = 0.25;
// The rag service's limit on a query.
const MAX_QUERY_LENGTH = 8000;

interface SearchResult {
  text: string;
  filename: string;
  page: number | null;
  score: number;
}

// The parts of the knowledge base closest to the query, best first, as one text for the prompt.
// Without file names, which the model could otherwise quote to the customer. Null when nothing
// scores above the floor.
export async function searchKnowledge(query: string): Promise<string | null> {
  const res = await call("/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: query.slice(0, MAX_QUERY_LENGTH), k: KNOWLEDGE_EXCERPTS }),
  });
  const { chunks } = (await res.json()) as { chunks: SearchResult[] };
  const excerpts = chunks.filter((chunk) => chunk.score >= MIN_KNOWLEDGE_SCORE).map((chunk) => chunk.text);
  return excerpts.length > 0 ? excerpts.join("\n\n---\n\n") : null;
}
