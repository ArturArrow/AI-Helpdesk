import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { INBOUND_EMAIL_SECRET } from "../lib/env";

const expected = Buffer.from(INBOUND_EMAIL_SECRET);

// Webhook callers are mail pipelines, not users, so they authenticate with a shared secret
// instead of a session. timingSafeEqual throws on unequal lengths, hence the length check.
export function requireWebhookSecret(req: Request, res: Response, next: NextFunction) {
  const given = Buffer.from(req.get("x-inbound-secret") ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
