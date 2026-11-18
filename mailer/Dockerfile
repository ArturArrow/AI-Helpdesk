# The mailer: polls IMAP for inbound email and sends replies over SMTP.
# Built from the repository root (the workspaces share core/ and bun.lock).
FROM oven/bun:1.4.2

WORKDIR /app

COPY package.json bun.lock ./
COPY client/package.json client/
COPY core/package.json core/
COPY mailer/package.json mailer/
COPY server/package.json server/
RUN bun install --frozen-lockfile

COPY core core
COPY mailer mailer

ENV NODE_ENV=production

WORKDIR /app/mailer
CMD ["bun", "run", "src/index.ts"]
