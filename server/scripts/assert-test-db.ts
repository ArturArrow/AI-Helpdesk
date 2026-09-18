// Runs before `prisma migrate reset --force` in start:test. prisma.config.ts falls back to
// .env when DATABASE_URL is unset, so without this a missing .env.test would wipe the dev DB.
const url = process.env.DATABASE_URL;
const database = url ? new URL(url).pathname.slice(1) : "";

if (!database.endsWith("_test")) {
  console.error(`Refusing to reset "${database || "(unset)"}": DATABASE_URL must point at a *_test database.`);
  process.exit(1);
}
