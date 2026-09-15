import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth";
import { prisma } from "./lib/db";
import { requireAuth } from "./middleware/requireAuth";

const app = express();
const port = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));

// Must be mounted before express.json(), which would consume the request body.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  } catch (error) {
    console.error("Database health check failed:", error);
    res.status(503).json({ status: "error" });
  }
});

app.listen(port, async () => {
  console.log(`Server listening on http://localhost:${port}`);

  try {
    await prisma.$connect();
    console.log("Connected to the helpdesk database");
  } catch (error) {
    console.error("Failed to connect to the database:", error);
  }
});
