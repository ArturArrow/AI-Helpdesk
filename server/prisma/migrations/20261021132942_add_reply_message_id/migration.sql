-- AlterTable
ALTER TABLE "reply" ADD COLUMN     "messageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "reply_messageId_key" ON "reply"("messageId");
