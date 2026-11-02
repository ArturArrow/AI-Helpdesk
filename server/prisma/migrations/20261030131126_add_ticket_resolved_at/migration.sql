-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- Backfill: existing finished tickets never recorded when they were resolved, so their last
-- update is the closest approximation.
UPDATE "ticket" SET "resolvedAt" = "updatedAt" WHERE "status" IN ('resolved', 'closed');
