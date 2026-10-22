// Fails at import, so the server refuses to start instead of silently falling back
// (Better Auth to a public default secret outside production, cors to "*").
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Set it in the environment (see server/.env.example).`);
  }
  return value;
}

export const BETTER_AUTH_SECRET = required("BETTER_AUTH_SECRET");
export const BETTER_AUTH_URL = required("BETTER_AUTH_URL");
export const CLIENT_URL = required("CLIENT_URL");
// Shared secret the mail pipeline sends in X-Inbound-Secret (see middleware/requireWebhookSecret.ts).
export const INBOUND_EMAIL_SECRET = required("INBOUND_EMAIL_SECRET");
// Gemini key for the AI features (lib/ai.ts). Optional: without it they answer 503.
export const GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
