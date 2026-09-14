import cors from "cors";
import express from "express";
import { prisma } from "./lib/prisma";

const app = express();
const port = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

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
