-- AlterEnum
ALTER TYPE "ReplySender" ADD VALUE 'ai';

-- AlterEnum
-- BEFORE 'open' keeps the declaration order of schema.prisma, which is the order tickets sort in.
ALTER TYPE "TicketStatus" ADD VALUE 'new' BEFORE 'open';
ALTER TYPE "TicketStatus" ADD VALUE 'processing' BEFORE 'open';
