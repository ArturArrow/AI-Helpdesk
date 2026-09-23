import { z } from "zod";

// Better Auth's default password bounds (auth.ts doesn't override them). The users route
// hashes through internalAdapter, which skips Better Auth's own length check, so this is it.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export const createUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
