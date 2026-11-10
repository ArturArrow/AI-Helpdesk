import { type NextFunction, type Request, type Response, Router } from "express";
import multer from "multer";
import { MAX_RAG_DOCUMENT_BYTES } from "core/constants/rag";
import { ragDocumentParamsSchema } from "core/schemas/rag";
import { isRagConfigured } from "../lib/env";
import { addRagDocument, deleteRagDocument, listRagDocuments } from "../lib/rag";
import { validateParams } from "../lib/validate";

// The knowledge base's documents, kept by the rag service (rag/). Mounted behind requireAuth and
// requireAdmin in index.ts, so the browser never talks to the service directly.
export const ragRouter = Router();

ragRouter.use((_req, res, next) => {
  if (isRagConfigured) return next();
  res.status(503).json({ error: "The document service isn't configured" });
});

// defParamCharset: multer reads filenames as latin1 by default, which garbles non-ASCII ones.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RAG_DOCUMENT_BYTES, files: 1 },
  defParamCharset: "utf8",
}).single("file");

// Upload errors have no status, so the error handler would answer them with a 500.
function uploadDocument(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (error: unknown) => {
    if (!error) return next();
    const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
    res.status(tooLarge ? 413 : 400).json({ error: error instanceof Error ? error.message : "Invalid upload" });
  });
}

ragRouter.get("/documents", async (_req, res) => {
  res.json({ documents: await listRagDocuments() });
});

// The service answers once the file is split and embedded, so this can take a while.
ragRouter.post("/documents", uploadDocument, async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Choose a file to upload" });
    return;
  }
  const document = await addRagDocument({
    filename: req.file.originalname,
    contentType: req.file.mimetype,
    data: req.file.buffer,
  });
  res.status(201).json({ document });
});

ragRouter.delete("/documents/:id", async (req, res) => {
  const params = validateParams(ragDocumentParamsSchema, req, res);
  if (!params) return;
  await deleteRagDocument(params.id);
  res.status(204).end();
});
