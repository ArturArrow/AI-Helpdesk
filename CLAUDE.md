# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Early-stage scaffold. `server/src/index.ts` is currently just an Express app with a `/api/health` endpoint; `client/src/App.tsx` is the default Vite/React template modified to poll that endpoint. No database, ORM, auth, or AI integration code exists yet — see `project-scope.md`, `tech-stack.md`, and `implementation-plan.md` for the intended design and build order before adding features, since the architecture below is the target, not the current state.

## Documentation lookup

Use the **context7** MCP tools (`mcp__context7__resolve-library-id`, `mcp__context7__query-docs`) to fetch current documentation before writing code against a library or framework in this stack (React, Express, Prisma, Vite, Tailwind, Anthropic SDK, etc.), rather than relying on training data — resolve the library id first, then query docs for the specific API/config in question.

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
```

There are no test scripts configured in either workspace yet.

## Architecture

- **Monorepo**: root `package.json` defines `workspaces: ["client", "server"]`; each workspace has its own `package.json` and `tsconfig.json`. Use `bun run --filter <client|server> <script>` (or the root `dev`/`dev:server`/`dev:client` scripts) rather than `cd`-ing in for routine runs.
- **Server**: Node/Express + TypeScript, run directly via Bun (no build step for dev). API routes are expected under `/api/*`.
- **Client**: Vite + React 19 + TypeScript. In dev, Vite proxies `/api` to `http://localhost:3001` (see `client/vite.config.ts`), so the client always calls relative `/api/...` paths rather than a hardcoded host.
- **Linting**: client uses `oxlint` (`client/.oxlintrc.json`); no lint config exists for the server yet.

### Target architecture (per `tech-stack.md` / `implementation-plan.md`, not yet implemented)

- PostgreSQL via Prisma as the ORM.
- Session-based authentication (DB-backed sessions), with two roles: **Admin** (seeded, manages agents) and **Agent** (manages tickets).
- Tickets have status (Open/Resolved/Closed) and category (General Question/Technical Question/Refund Request).
- AI features via the Claude API: auto-classification, ticket summaries, and suggested replies, backed by a knowledge base.
- Inbound tickets created via email webhook (SendGrid/Mailgun); outbound replies sent through the same provider, threaded to the originating ticket.
- Dashboard aggregating ticket counts/breakdowns.
- Deployment via Docker (Dockerfiles + Compose planned, not yet written).

Build in the phase order laid out in `implementation-plan.md` (setup → auth → user management → ticket CRUD → AI features → email → dashboard → polish/deploy) rather than jumping ahead to later phases.
