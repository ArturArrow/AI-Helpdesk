# Tech Stack

Versions reflect the installed dependencies as of 2026-09-17. Sections marked **Planned** are chosen but not yet built.

## Runtime & tooling

- Bun 1.4 as runtime, package manager, and workspace manager (`bun.lock`, workspaces `client` + `server`)
- TypeScript 6 across both workspaces
- `concurrently` for the root `dev` script (server + client together)
- oxlint on the client; no lint config for the server yet

## Frontend

- React 19 with TypeScript
- Vite 8 as dev server and bundler; proxies `/api` → `http://localhost:3001` in dev
- React Router 8
- Tailwind CSS 4 via `@tailwindcss/vite` (no `tailwind.config.js`; theme lives in `client/src/index.css`)
- shadcn 4 for UI components, built on **Base UI** (`@base-ui/react`), not Radix — preset `base-nova`, neutral base color, CSS variables
- lucide-react for icons, Geist as the UI font (`@fontsource-variable/geist`)
- react-hook-form 7 + zod 4 (`@hookform/resolvers`) for form state and validation

## Backend

- Express 5 with TypeScript, run directly by Bun (no build step for dev)
- REST endpoints under `/api/*`
- `cors` with credentials enabled for the cookie-based session

## Database

- PostgreSQL

## ORM

- Prisma 7 with the `@prisma/adapter-pg` driver adapter (`pg` 8)
- Client generated to `server/generated/prisma`, accessed through a singleton in `server/src/lib/db.ts`
- Schema-first with migrations (`prisma migrate dev` / `deploy`) and an idempotent admin seed

## Authentication

- Better Auth 1.7 with the Prisma adapter — email + password, database-backed sessions
- Public sign-up disabled; the admin is seeded and agent accounts are created by an admin
- Two roles (`admin`, `agent`) as a Prisma enum, server-owned and not settable from client input
- `better-auth/react` on the client, talking to the same origin's `/api/auth`

## AI — Planned

- Claude API (Anthropic) for ticket classification, summaries, and suggested replies

## Email — Planned

- SendGrid or Mailgun for outbound replies and inbound webhooks

## Testing

- Playwright (`@playwright/test`, Chromium) for end-to-end tests, configured at the repo root; no tests written yet
- Runs against a separate `helpdesk_test` PostgreSQL database, reset and seeded on every run

## Deployment — Planned

- Docker + cloud provider (AWS, Railway, Fly.io, etc.)
