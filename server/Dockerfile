# The web service: the API plus the built client, which it serves from the same origin.
# Built from the repository root (the workspaces share core/ and bun.lock).
FROM oven/bun:1.4.2

WORKDIR /app

# Manifests first, so the install layer is reused until a dependency changes. Every workspace's
# manifest is needed for --frozen-lockfile, the mailer's included.
COPY package.json bun.lock ./
COPY client/package.json client/
COPY core/package.json core/
COPY mailer/package.json mailer/
COPY server/package.json server/
RUN bun install --frozen-lockfile

COPY core core
COPY server server
COPY client client

# Vite reads these at build time; Railway passes service variables to a build as build args.
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENVIRONMENT

# The Prisma client first: the client's tsc reads the server's auth types, which import it.
RUN bun run --filter server db:generate && bun run --filter client build

# Turns on sign-in rate limiting and the static client (see server/src/index.ts).
ENV NODE_ENV=production

WORKDIR /app/server
CMD ["bun", "run", "src/index.ts"]
