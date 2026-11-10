import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { testEnv } from "./testEnv";

// The service's address is replaced before rag.ts loads, and fetch is stubbed, so no test reaches
// a rag service.
mock.module("./env", () => testEnv);

const {
  KNOWLEDGE_EXCERPTS,
  MIN_KNOWLEDGE_SCORE,
  RagServiceError,
  addRagDocument,
  deleteRagDocument,
  listRagDocuments,
  searchKnowledge,
} = await import("./rag");

const document = {
  id: "8f8a3c1e-2b1d-4c3e-9f00-3a1b2c3d4e5f",
  filename: "zwroty.pdf",
  size: 3,
  chunkCount: 1,
  createdAt: "2026-11-10T10:00:00+00:00",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
  fetchSpy = spyOn(globalThis, "fetch");
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  mock.restore();
});

function sent() {
  const [url, init] = fetchSpy.mock.calls[0]!;
  return { url: String(url), init: init!, headers: new Headers(init!.headers) };
}

describe("listRagDocuments", () => {
  it("asks the service with the secret and returns its documents", async () => {
    fetchSpy.mockResolvedValue(json(200, { documents: [document] }));

    expect(await listRagDocuments()).toEqual([document]);
    const { url, headers } = sent();
    expect(url).toBe("http://rag.test/documents");
    expect(headers.get("X-Rag-Secret")).toBe("rag-secret");
  });
});

describe("addRagDocument", () => {
  it("posts the file as multipart, keeping its name", async () => {
    fetchSpy.mockResolvedValue(json(201, document));

    const result = await addRagDocument({
      filename: "zwroty.pdf",
      contentType: "application/pdf",
      data: new Uint8Array([1, 2, 3]),
    });

    expect(result).toEqual(document);
    const { url, init, headers } = sent();
    expect(url).toBe("http://rag.test/documents");
    expect(init.method).toBe("POST");
    expect(headers.get("X-Rag-Secret")).toBe("rag-secret");
    const file = (init.body as FormData).get("file") as File;
    expect(file.name).toBe("zwroty.pdf");
    expect(file.type).toBe("application/pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("deleteRagDocument", () => {
  it("deletes by id", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));

    await deleteRagDocument(document.id);

    const { url, init } = sent();
    expect(url).toBe(`http://rag.test/documents/${document.id}`);
    expect(init.method).toBe("DELETE");
  });
});

describe("searchKnowledge", () => {
  const chunk = (text: string, score: number) => ({ text, filename: "faq.txt", page: null, score });

  it("asks for the closest excerpts with the secret", async () => {
    fetchSpy.mockResolvedValue(json(200, { chunks: [] }));

    await searchKnowledge("Refund\n\nI want my money back");

    const { url, init, headers } = sent();
    expect(url).toBe("http://rag.test/search");
    expect(init.method).toBe("POST");
    expect(headers.get("X-Rag-Secret")).toBe("rag-secret");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ query: "Refund\n\nI want my money back", k: KNOWLEDGE_EXCERPTS });
  });

  it("cuts a long query to the service's limit", async () => {
    fetchSpy.mockResolvedValue(json(200, { chunks: [] }));

    await searchKnowledge("a".repeat(9000));

    expect(JSON.parse(sent().init.body as string).query).toHaveLength(8000);
  });

  it("joins the excerpts at or above the floor, best first, without file names", async () => {
    fetchSpy.mockResolvedValue(
      json(200, {
        chunks: [
          chunk("Refunds within 30 days.", 0.5),
          chunk("Refunds take 5-10 days.", MIN_KNOWLEDGE_SCORE),
          chunk("Videos stream online.", MIN_KNOWLEDGE_SCORE - 0.01),
        ],
      }),
    );

    expect(await searchKnowledge("refund")).toBe("Refunds within 30 days.\n\n---\n\nRefunds take 5-10 days.");
  });

  it("is null when nothing reaches the floor", async () => {
    fetchSpy.mockResolvedValue(json(200, { chunks: [chunk("Videos stream online.", 0.1)] }));

    expect(await searchKnowledge("mentoring")).toBeNull();
  });

  it("is null for an empty knowledge base", async () => {
    fetchSpy.mockResolvedValue(json(200, { chunks: [] }));

    expect(await searchKnowledge("refund")).toBeNull();
  });

  it("throws when the service fails, so the job is retried", async () => {
    fetchSpy.mockResolvedValue(json(502, { detail: "The embeddings couldn't be created." }));

    await expect(searchKnowledge("refund")).rejects.toMatchObject({ status: 502 });
  });
});

describe("errors", () => {
  it.each([400, 404, 409, 413])("passes a %i on with the service's message", async (status) => {
    fetchSpy.mockResolvedValue(json(status, { detail: "A document with this name already exists." }));

    const error = await listRagDocuments().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RagServiceError);
    expect(error).toMatchObject({ status, expose: true, message: "A document with this name already exists." });
  });

  it.each([401, 422, 500, 502])("answers a %i as 502, without the service's message", async (status) => {
    fetchSpy.mockResolvedValue(json(status, { detail: "internal detail" }));

    await expect(listRagDocuments()).rejects.toMatchObject({ status: 502, message: "The document service failed" });
  });

  it("answers a body that isn't JSON as 502", async () => {
    fetchSpy.mockResolvedValue(new Response("Bad Gateway", { status: 400 }));

    await expect(listRagDocuments()).rejects.toMatchObject({ status: 502 });
  });

  it("answers an unreachable service as 502", async () => {
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));

    await expect(listRagDocuments()).rejects.toMatchObject({
      status: 502,
      message: "The document service is unavailable",
    });
  });
});
