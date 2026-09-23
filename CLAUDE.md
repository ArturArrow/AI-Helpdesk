# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Early-stage, through the auth phase and starting on user management. PostgreSQL + Prisma are wired up (`server/prisma/schema.prisma`, two migrations, an idempotent admin `seed.ts`), and Better Auth provides session auth with a `role` field on users (`server/src/lib/auth.ts`, `requireAuth` / `requireAdmin` middleware). The client has routing, a protected layout, a login form built on shadcn, and an admin-gated `/users` page that lists users from `GET /api/users` and creates and edits them in a dialog (`server/src/routes/users.ts`). `UsersPage` and `UserForm` have Vitest + React Testing Library component tests (`bun run --filter client test`). Playwright runs against a separate `helpdesk_test` database, with 67 passing E2E tests covering auth (login, sessions, logout, route gating, the API guards) and editing users (`e2e/TEST_SUMMARY.md`).

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
bun run test            # component tests, single pass (vitest run)
bun run test:watch      # watch mode for writing tests (reruns on save)
```

### Writing component tests: use the `component-test-writer` agent

**Always delegate writing, extending or fixing component tests** (Vitest + React Testing Library, `client/src/**/*.test.tsx`) to the project subagent `component-test-writer` (`.claude/agents/component-test-writer.md`, via the Agent tool with `subagent_type: "component-test-writer"`). Don't write test files in the main session. The agent file holds the harness and the conventions, and nothing about them is repeated here.

- **In the prompt,** say what to cover (the component and the states or cases the user asked for) and what changed, if the tests are for new work from this session.
- **It runs the checks itself:** `vitest run`, `tsc -b` and lint. It also breaks the covered code once to prove the tests can fail, then restores it. No database is involved, so no consent is needed, and you can run `bun run --filter client test` any time.
- **It edits only** `client/src/**/*.test.tsx` and `client/src/test/`. If it reports that the app needs a change (e.g. a missing accessible name) or a new package (e.g. `@testing-library/user-event`), make it in the main session with the user's go-ahead, then send the agent back.
- **Afterwards,** relay its report, since the user doesn't see it: the files and tests added, the results and the break-it check. Then run `git diff --stat` to confirm the app files are unchanged.

### Writing E2E tests: use the `e2e-test-writer` agent

**Always delegate writing, extending or fixing Playwright tests to the project subagent `e2e-test-writer`** (`.claude/agents/e2e-test-writer.md`, via the Agent tool with `subagent_type: "e2e-test-writer"`). Don't write specs in `e2e/` directly in the main session. The agent file holds the harness details (ports, `helpdesk_test`, global setup and teardown, the root tsconfig) and the test conventions, and nothing about them is repeated here.

In the prompt, give it what it can't work out on its own:
- **What to cover:** the page or flow (e.g. "login: happy path, validation errors, wrong password") and anything the user specifically asked for.
- **What changed:** if the tests are for new work from this session, which files or routes changed.
- **Don't pass consent to run.** In practice the agent refuses consent relayed through another agent, even quoted verbatim, so it only type-checks and lists the tests. Plan on running the suite yourself afterwards (below).

**Afterwards:** the agent's report isn't shown to the user, so relay it. That means which specs were added and what each covers, the results of `tsc`, `--list` and the run (or that it didn't run), and any app change it said is needed to make something testable. The agent also rewrites `e2e/TEST_SUMMARY.md` every time it changes tests. The agent edits only `e2e/**` and, when needed, `playwright.config.ts`. It never touches `client/`, `server/` or `.env*`. If it reports that the app needs a change (e.g. a missing accessible label or endpoint), make that change in the main session with the user's go-ahead, then send the agent back to finish.

**Running the suite yourself.** Each run resets `helpdesk_test`, and Prisma refuses that reset from Claude Code without the user's explicit consent. So ask first, then run `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<their exact message>" bun run test:e2e --reporter=line`. Consent covers one run: ask again after further changes. Then update the "Last run" line in `e2e/TEST_SUMMARY.md` with the result.
- `webServer` never reuses a running server. If ports 3101/5174 are taken, the run fails with "…/api/health is already used". Usually that's the user's own `test:e2e:ui` window, so ask them to close it rather than killing the process.
- Moving files or fixing import paths under `e2e/` is fine to do directly. Writing or changing test logic still goes to the agent.

## Authentication

Better Auth (`better-auth`) with the Prisma adapter, email + password only, DB-backed sessions. Configured in `server/src/lib/auth.ts`.

**Sign-up is disabled** (`disableSignUp: true`). There is no public registration path and none should be added: the admin comes from `bun run db:seed`, and agent accounts are meant to be created by an admin (see *Creating accounts* below). A login form that offers "create an account" would have nothing to call.

**Roles.** `Role` is a Prisma enum (`admin` | `agent`, default `agent`) and a Better Auth `additionalFields` entry declared `input: false` — it is server-owned and never accepted from API input. Do not try to set `role` through a client-side sign-up/update payload; change it in the database or the seed. In server code, write role values through the generated enum (`import { Role } from "../../generated/prisma/enums"` → `Role.agent`, `Role.admin`) rather than string literals; `enums.ts` holds only the const object, so the import doesn't pull in the Prisma client. `server/src/routes/users.ts` is the reference.

It is also declared **`required: true` with `defaultValue: "agent"`**, which mirrors the non-nullable column and types `user.role` as `"admin" | "agent"` instead of widening it with `| null | undefined` (`InferDBFieldOutput` adds those for `required: false`). The combination looks risky next to `input: false` but is not: in `better-auth/dist/db/schema.mjs`, `parseInputData` assigns `defaultValue` and `continue`s at line ~95, so the `"role is required"` throw at line ~103 is unreachable for any field that has a default. A required field **without** a default would throw on every create.

Role-based authorization is enforced **on the server** by `requireAdmin` (below). The client's `AdminRoute` only hides a page and does not protect data; never rely on it in place of the server check.

**Creating accounts.** There is deliberately no committed script for agent accounts — the admin UI in the current phase is meant to replace that path. To make one ad hoc, mirror `prisma/seed.ts`: `await auth.$context` → `ctx.internalAdapter.createUser({ email, name, emailVerified: true, role: "agent" }, { method: "email-password" })` → `ctx.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: await ctx.password.hash(pw) })`. Going through `internalAdapter` matters: it hashes with Better Auth's own configured hasher, so a row written directly to the table will not authenticate. Pass credentials via environment variables rather than writing them into a file. `agent@example.com` was created this way for local testing, and `e2e/seed-agent.ts` does the same in `helpdesk_test` on every E2E run.

**Server wiring** (`server/src/index.ts`):
- `app.all("/api/auth/*splat", toNodeHandler(auth))` is mounted **before `express.json()`**. Order matters — the JSON parser would consume the request body and break every auth endpoint. Keep any new middleware that reads the body below this line. (`*splat` is Express 5 wildcard syntax.)
- **Rate limiting runs only in production**: `rateLimit: { enabled: IS_PRODUCTION }` (`NODE_ENV === "production"`), which also gates the per-account throttle below. This matches Better Auth's own default (`enabled: options.rateLimit?.enabled ?? isProduction` in `dist/context/create-context.mjs`), stated explicitly so it doesn't hinge on that default. Dev and Playwright runs sign in unthrottled. **A deploy without `NODE_ENV=production` has no brute-force protection at all.** Better Auth reads the client IP only from headers and never from the socket, and without config it trusts a single-value `X-Forwarded-For`, which a caller can forge to get a new bucket on every request. So `index.ts` overwrites the `x-auth-client-ip` header (`CLIENT_IP_HEADER`) with Express's `req.ip` on every `/api/auth` request, and `auth.ts` reads only that header. **Behind a reverse proxy, set `app.set("trust proxy", <proxy address>)`**, or every client resolves to the proxy's IP and shares one sign-in bucket (3 requests per 10s), which locks everyone out. The limiter's store is in memory: it resets on restart and isn't shared across instances; switch to `storage: "database"` (this needs a `rateLimit` model) before running more than one.
- **Per-account sign-in throttle.** The built-in limiter keys only on IP + path (`customRules` can change `window`/`max` but not the key), so rotating addresses bypasses it. `hooks.before`/`hooks.after` in `auth.ts` count 401s on `/sign-in/email` per lower-cased email and return 429 after 5 failures in 15 minutes; a successful sign-in clears the count. It's in memory and production-only, like the IP limiter. The trade-off: anyone can lock a known email out for 15 minutes, which is the price of capping guesses.
- `requireAuth` (`server/src/middleware/requireAuth.ts`) resolves the session via `auth.api.getSession` with `fromNodeHeaders(req.headers)`, replies `401 {"error":"Unauthorized"}` when absent, and otherwise populates `req.user` / `req.session`. Those are declared in `server/src/types/express.d.ts`. Use it on every protected route; `/api/me` is the reference example.
- `requireAdmin` (`server/src/middleware/requireAdmin.ts`) replies `403 {"error":"Forbidden"}` unless `req.user.role === "admin"`. It reads `req.user`, so it must run **after** `requireAuth`. `index.ts` mounts both on the whole prefix — `app.use("/api/users", requireAuth, requireAdmin)` — so any route added under `/api/users` is admin-only without its own guard. Put other admin-only endpoints under a guarded prefix the same way. The role comes from the DB-backed session lookup on every request (no cookie cache), so a demotion takes effect on the next request.
- A JSON **error handler is mounted last** in `index.ts`. Keep it below every route: without it Express's finalhandler returns `err.stack` as HTML whenever `NODE_ENV` isn't `production`, and since `express.json()` runs before the `/api/users` guard, even an unauthenticated malformed body would get one. It shows `err.message` only when http-errors marks it `expose` (4xx from body parsing); otherwise it returns a generic `500` and logs the error on the server. Route handlers can just `throw`, because Express 5 forwards rejected promises here.
- CORS runs with `origin: process.env.CLIENT_URL, credentials: true`, and `CLIENT_URL` also feeds `trustedOrigins`. Auth is cookie-based, so a cross-origin caller must send credentials.

**Client wiring.** `client/src/lib/auth-client.ts` calls `createAuthClient()` with **no `baseURL`**, so requests go to the current origin's `/api/auth` — in dev that is the Vite proxy. Keep it that way rather than hardcoding a host. `authClient.useSession()` drives `ProtectedLayout` (redirects to `/login` while unauthenticated, renders `Navbar` + `Outlet` when signed in); `authClient.signIn.email` and `authClient.signOut` handle the transitions.

`role` reaches the client typed via the `inferAdditionalFields` plugin, in its generic form — `inferAdditionalFields<typeof auth>()` over a **type-only** import of the server's `auth`:

```ts
import type { auth } from '../../../server/src/lib/auth.ts'
```

This is the one place the client reaches across the workspace boundary, and it is deliberate: additional fields stay declared once, in `server/src/lib/auth.ts`, instead of being restated in a client-side schema that can drift from it. Add a field there and the client type follows with no second edit.

It works because the import is types-only. `verbatimModuleSyntax` erases it, so no server code reaches the bundle (grep the built JS for `prisma` — zero hits), and `tsc` tolerates the out-of-`include` files because `tsconfig.app.json` sets no `rootDir`, runs `noEmit`, and has `skipLibCheck` for the generated Prisma declarations. The cost is real but small: ~12 server and generated-Prisma files join the client program, and a cold `tsc -b` runs ~1.8s. Keep the import `import type`, never a value import.

**Client route gating.** `AdminRoute` (`client/src/components/AdminRoute.tsx`) is a layout route that renders `<Outlet />` for `role === 'admin'` and otherwise redirects to `/`. Nest it inside `ProtectedLayout` — it assumes a session already exists and does not re-check. `Navbar` takes an `isAdmin` prop from `ProtectedLayout` (which already holds the session) and hides admin links for agents, so the navbar stays presentational rather than reading the session itself. If its prop list grows much further, pass `session.user` whole instead of adding a third flag.

**Environment.** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CLIENT_URL`. The last three are validated in `server/src/lib/env.ts`, which throws at import when any is missing or empty — the server (and the seed, which imports `auth`) refuses to start rather than letting Better Auth fall back to its public default secret outside production or `cors` fall back to `*`. Import them from there instead of reading `process.env` directly. The seed additionally needs `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and optionally `ADMIN_NAME` (defaults to "Admin"). `NODE_ENV` is not validated but matters: only `production` turns on sign-in rate limiting (above), and `start:test` runs with `test` from `server/.env.test`.

**Seeding** (`server/prisma/seed.ts`) is idempotent and safe against production. It validates the email shape and the password against Better Auth's own `minPasswordLength`/`maxPasswordLength`, refuses the placeholder `admin@example.com` when `NODE_ENV=production`, creates the user plus a `credential` account with a hashed password (mirroring what the disabled sign-up endpoint would do), and on re-run only ensures the `admin` role — **an existing password is never overwritten**. It also repairs a user left without a credential account by a half-failed run.

## Architecture

- **Monorepo**: root `package.json` defines `workspaces: ["client", "server", "core"]`; each workspace has its own `package.json` and `tsconfig.json`. Use `bun run --filter <client|server> <script>` (or the root `dev`/`dev:server`/`dev:client` scripts) rather than `cd`-ing in for routine runs.
- **Shared code (`core`)**: anything both client and server need at runtime lives in `core`, never duplicated per side. Zod schemas for API payloads go in `core/src/schemas/` (e.g. `createUserSchema` / `updateUserSchema` in `schemas/users.ts`, used by `UserForm` for the form and by `POST` / `PATCH /api/users` for the request body), so the form and the server enforce the same rules. The package ships TypeScript source with no build step (Vite and Bun read it directly), is depended on as `"core": "workspace:*"`, and exposes each module through its `exports` map — import `core/schemas/users`, and add an `exports` entry for every new module. Keep it free of server-only code (Prisma, Better Auth), since it ends up in the client bundle. Values that can't be read from the client, like Better Auth's password bounds, are restated as constants there and must be kept in sync by hand.
- **Server**: Express 5 + TypeScript, run directly via Bun (no build step for dev). API routes live under `/api/*`. PostgreSQL via Prisma 7 (`@prisma/adapter-pg`); the client is generated to `server/generated/prisma` and imported through the singleton in `server/src/lib/db.ts` — import `prisma` from there rather than constructing a new `PrismaClient`.
- **Client**: Vite + React 19 + TypeScript, with Tailwind v4 and shadcn/Base UI for styling (see *UI components* above). Routing is `react-router` (routes in `client/src/App.tsx`); `ProtectedLayout` gates routes on a Better Auth session and redirects to `/login`, and `AdminRoute` nests inside it to gate `/users` on the admin role. In dev, Vite proxies `/api` to `http://localhost:3001` (see `client/vite.config.ts`), so the client always calls relative `/api/...` paths rather than a hardcoded host. Server data is loaded with TanStack Query (`useQuery`, provider in `client/src/main.tsx`) over axios; `retry` is off by default.
- **Linting**: client uses `oxlint` (`client/.oxlintrc.json`); no lint config exists for the server yet.

### Target architecture (per `tech-stack.md` / `implementation-plan.md`, not yet implemented)

- Admin-facing user management: an admin creates and manages agent accounts. In progress — listing is done (`GET /api/users` returns `id, name, email, role, createdAt` via an explicit `select`; `UsersPage` renders it). Create and edit are done: `UserForm` (`client/src/components/UserForm.tsx`) is one dialog for both — no `user` prop creates via `POST /api/users`, a `user` prop edits via `PATCH /api/users/:id`, where a blank password keeps the current one and a new one is re-hashed and ends that user's sessions. Delete is not built yet. `usersRouter` is mounted on the same line as the guard (`app.use("/api/users", requireAuth, requireAdmin, usersRouter)`), so add new user routes to that router.
- Tickets have status (Open/Resolved/Closed) and category (General Question/Technical Question/Refund Request).
- AI features via the Claude API: auto-classification, ticket summaries, and suggested replies, backed by a knowledge base.
- Inbound tickets created via email webhook (SendGrid/Mailgun); outbound replies sent through the same provider, threaded to the originating ticket.
- Dashboard aggregating ticket counts/breakdowns.
- Deployment via Docker (Dockerfiles + Compose planned, not yet written). The image must set `NODE_ENV=production`, or sign-in rate limiting stays off.

Build in the phase order laid out in `implementation-plan.md` (setup → auth → user management → ticket CRUD → AI features → email → dashboard → polish/deploy) rather than jumping ahead to later phases.
