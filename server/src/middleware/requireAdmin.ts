import type { NextFunction, Request, Response } from "express";
import { Role } from "../../generated/prisma/enums";

// Mount after requireAuth, which populates req.user. The role comes from the session
// lookup on each request (no cookie cache), so a demotion takes effect immediately.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== Role.admin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
}
