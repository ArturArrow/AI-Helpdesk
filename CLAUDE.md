# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Early-stage, through the auth phase. PostgreSQL + Prisma are wired up (`server/prisma/schema.prisma`, two migrations, an idempotent admin `seed.ts`), and Better Auth provides session auth with a `role` field on users (`server/src/lib/auth.ts`, `requireAuth` middleware). The client has routing, a protected layout, and a login form built on shadcn.

Not yet built: ticket CRUD, AI integration, email in/out, and the dashboard. See `project-scope.md`, `tech-stack.md`, and `implementation-plan.md` for the intended design and build order before adding features, since the target architecture below is still ahead of the current state.

## Documentation lookup

Use the **context7** MCP tools (`mcp__context7__resolve-library-id`, `mcp__context7__query-docs`) to fetch current documentation before writing code against a library or framework in this stack (React, Express, Prisma, Vite, Tailwind, Anthropic SDK, etc.), rather than relying on training data — resolve the library id first, then query docs for the specific API/config in question.

## React version

Always target the latest stable React release (currently React 19.3 with `@types/react` 19.3). When adding or upgrading client dependencies, install the latest `react`, `react-dom`, and `@types/react*` rather than pinning older majors. Write code against the current APIs, not legacy patterns:

- Never use APIs or types marked `@deprecated` in the installed `@types/react` (e.g. use `SubmitEvent` / `ChangeEvent` / `InputEvent` instead of `FormEvent`). If the editor flags a deprecation, check the JSDoc in `client/node_modules/@types/react/index.d.ts` for the replacement.
- Check context7 docs for the current React version before relying on remembered APIs.

## UI components (shadcn)

The client uses **shadcn** on top of Tailwind v4, initialized with `--preset nova` → style `base-nova`. Components are built on **Base UI** (`@base-ui/react`); there is no `@radix-ui/*` dependency. Most shadcn examples online are Radix-era and will not match — resolve the Base UI variant via context7 before pasting a snippet.

- Add components with `bunx shadcn@latest add <name>` (config in `client/components.json`).
- Imports use the `@/` alias → `client/src`. It is declared in `client/vite.config.ts` (via `import.meta.dirname`, since the package is ESM and `__dirname` is undefined there) and in `paths` in both tsconfigs. **Do not add `baseUrl`** — this repo is on TypeScript 6, where it is deprecated and fails the build with TS5101; `paths` alone resolves relative to the tsconfig. shadcn's own docs still tell you to add it.
- `cn` is re-exported from the `cn` package in `src/lib/utils.ts`, not hand-written over clsx + tailwind-merge.
- Use theme tokens (`bg-muted`, `text-destructive`, `bg-card`) rather than hardcoded palette colors (`bg-gray-50`, `bg-blue-600`), so pages follow the theme's dark mode. `ProtectedLayout.tsx` and `Navbar.tsx` still use hardcoded grays and are due for conversion.

**Keep `client/src/components/ui/` to components with a live importer.** Deleting unused ones is not just tidiness: Tailwind v4 scans source files, so an unimported component still emits its CSS. Removing `field.tsx` + `separator.tsx` cut the CSS bundle from 38.46 kB to 31.16 kB. Re-adding is one CLI call.

### Form conventions

Forms use react-hook-form + zod (`zodResolver`) with **`register()`**, not `Controller`. Base UI's `Input` renders a real `<input>`, forwards the ref, and supports uncontrolled mode, so `register` works — shadcn's docs recommend `Controller` for consistency with genuinely controlled components (Select, Checkbox), but it is not required for text inputs.

Markup is plain: a `div` wrapper with spacing classes, `Label` + `htmlFor`, `Input` with `aria-invalid`, and `<p role="alert" className="text-sm text-destructive">` for the message. The `Field`/`FieldGroup`/`FieldError` family is deliberately not used — it is presentational only (`Field` is a `div` with `role="group"` and a few utility classes) and was removed. Prefer the plainest construct that works; add a wrapper only when it carries real behavior. See `client/src/pages/LoginPage.tsx` for the reference shape.

## Commands

This is a Bun workspace monorepo (`client`, `server`) using `bun.lock`.

```bash
bun run dev            # run server + client concurrently
bun run dev:server     # server only (bun --watch src/index.ts, port 3001)
bun run dev:client     # client only (vite dev server)
```

Client (`cd client`):
```bash
bun run build           # tsc -b && vite build
bun run lint            # oxlint
bun run preview          # preview production build
```

Server (`cd server`):
```bash
bun run start           # bun run src/index.ts (no watch)
bun run db:migrate      # prisma migrate dev (development only)
bun run db:seed         # create/repair the admin from ADMIN_EMAIL / ADMIN_PASSWORD
```

New database (production) — needs `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` in the environment:
```bash
bun run --filter server db:deploy   # prisma migrate deploy
bun run --filter server db:seed     # idempotent; never overwrites an existing admin password
```

There are no test scripts configured in either workspace yet.

## Authentication

Better Auth (`better-auth`) with the Prisma adapter, email + password only, DB-backed sessions. Configured in `server/src/lib/auth.ts`.

**Sign-up is disabled** (`disableSignUp: true`). There is no public registration path and none should be added: the admin comes from `bun run db:seed`, and agent accounts are meant to be created by an admin. A login form that offers "create an account" would have nothing to call.

**Roles.** `Role` is a Prisma enum (`admin` | `agent`, default `agent`) and a Better Auth `additionalFields` entry declared with `input: false` — it is server-owned and never accepted from API input. Do not try to set `role` through a client-side sign-up/update payload; change it in the database or the seed. Role-based *authorization* is not built yet: `requireAuth` only proves a valid session, so an admin-only route still needs its own check.

**Server wiring** (`server/src/index.ts`):
- `app.all("/api/auth/*splat", toNodeHandler(auth))` is mounted **before `express.json()`**. Order matters — the JSON parser would consume the request body and break every auth endpoint. Keep any new middleware that reads the body below this line. (`*splat` is Express 5 wildcard syntax.)
- `requireAuth` (`server/src/middleware/requireAuth.ts`) resolves the session via `auth.api.getSession` with `fromNodeHeaders(req.headers)`, replies `401 {"error":"Unauthorized"}` when absent, and otherwise populates `req.user` / `req.session`. Those are declared in `server/src/types/express.d.ts`. Use it on every protected route; `/api/me` is the reference example.
- CORS runs with `origin: process.env.CLIENT_URL, credentials: true`, and `CLIENT_URL` also feeds `trustedOrigins`. Auth is cookie-based, so a cross-origin caller must send credentials.

**Client wiring.** `client/src/lib/auth-client.ts` calls `createAuthClient()` with **no `baseURL`**, so requests go to the current origin's `/api/auth` — in dev that is the Vite proxy. Keep it that way rather than hardcoding a host. `authClient.useSession()` drives `ProtectedLayout` (redirects to `/login` while unauthenticated, renders `Navbar` + `Outlet` when signed in); `authClient.signIn.email` and `authClient.signOut` handle the transitions.

**Environment.** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CLIENT_URL`; the seed additionally needs `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and optionally `ADMIN_NAME` (defaults to "Admin").

**Seeding** (`server/prisma/seed.ts`) is idempotent and safe against production. It validates the email shape and the password against Better Auth's own `minPasswordLength`/`maxPasswordLength`, refuses the placeholder `admin@example.com` when `NODE_ENV=production`, creates the user plus a `credential` account with a hashed password (mirroring what the disabled sign-up endpoint would do), and on re-run only ensures the `admin` role — **an existing password is never overwritten**. It also repairs a user left without a credential account by a half-failed run.

## Architecture

- **Monorepo**: root `package.json` defines `workspaces: ["client", "server"]`; each workspace has its own `package.json` and `tsconfig.json`. Use `bun run --filter <client|server> <script>` (or the root `dev`/`dev:server`/`dev:client` scripts) rather than `cd`-ing in for routine runs.
- **Server**: Express 5 + TypeScript, run directly via Bun (no build step for dev). API routes live under `/api/*`. PostgreSQL via Prisma 7 (`@prisma/adapter-pg`); the client is generated to `server/generated/prisma` and imported through the singleton in `server/src/lib/db.ts` — import `prisma` from there rather than constructing a new `PrismaClient`.
- **Client**: Vite + React 19 + TypeScript, with Tailwind v4 and shadcn/Base UI for styling (see *UI components* above). Routing is `react-router`; `ProtectedLayout` gates routes on a Better Auth session and redirects to `/login`. In dev, Vite proxies `/api` to `http://localhost:3001` (see `client/vite.config.ts`), so the client always calls relative `/api/...` paths rather than a hardcoded host.
- **Linting**: client uses `oxlint` (`client/.oxlintrc.json`); no lint config exists for the server yet.

### Target architecture (per `tech-stack.md` / `implementation-plan.md`, not yet implemented)

- Admin-facing user management: an admin creates and manages agent accounts (auth itself is done — see *Authentication* — but there is no admin UI or role-gated endpoint yet).
- Tickets have status (Open/Resolved/Closed) and category (General Question/Technical Question/Refund Request).
- AI features via the Claude API: auto-classification, ticket summaries, and suggested replies, backed by a knowledge base.
- Inbound tickets created via email webhook (SendGrid/Mailgun); outbound replies sent through the same provider, threaded to the originating ticket.
- Dashboard aggregating ticket counts/breakdowns.
- Deployment via Docker (Dockerfiles + Compose planned, not yet written).

Build in the phase order laid out in `implementation-plan.md` (setup → auth → user management → ticket CRUD → AI features → email → dashboard → polish/deploy) rather than jumping ahead to later phases.
