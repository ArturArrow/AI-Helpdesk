import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { testEnv } from "./testEnv";

// The service's address is replaced before rag.ts loads, and fetch is stubbed, so no test reaches
// a rag service.
mock.module("./env", () => testEnv);

const { RagServiceError, addRagDocument, deleteRagDocument, listRagDocuments } = await import("./rag");

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
