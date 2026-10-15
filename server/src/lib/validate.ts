import type { Request, Response } from "express";

type Schema<T> = {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: { message: string }[] } };
};

// Parses the body, or replies 400 with the first issue and returns undefined.
export function validate<T>(schema: Schema<T>, req: Request, res: Response) {
  return parseOr400(schema, req.body, res);
}

// Same as validate, for the query string.
export function validateQuery<T>(schema: Schema<T>, req: Request, res: Response) {
  return parseOr400(schema, req.query, res);
}

// Same as validate, for route params.
export function validateParams<T>(schema: Schema<T>, req: Request, res: Response) {
  return parseOr400(schema, req.params, res);
}

function parseOr400<T>(schema: Schema<T>, data: unknown, res: Response) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]!.message });
    return;
  }
  return parsed.data;
}
