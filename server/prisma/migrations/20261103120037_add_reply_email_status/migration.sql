-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('pending', 'sent', 'failed');

-- AlterTable
ALTER TABLE "reply" ADD COLUMN     "emailStatus" "EmailStatus",
ADD COLUMN     "sentAt" TIMESTAMP(3);
