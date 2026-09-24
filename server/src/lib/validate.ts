import type { Request, Response } from "express";

type Schema<T> = {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: { message: string }[] } };
};

// Parses the body, or replies 400 with the first issue and returns undefined.
export function validate<T>(schema: Schema<T>, req: Request, res: Response) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]!.message });
    return;
  }
  return parsed.data;
}
