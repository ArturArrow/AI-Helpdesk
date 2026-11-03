-- The "AI" system agent (AI_AGENT_ID in src/lib/aiAgent.ts). Every new ticket is assigned to it
-- while the AI tries to answer it from the knowledge base. It has no account row, so no password:
-- it can never sign in. It's hidden from the Users page and the assignee picker.
INSERT INTO "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
VALUES ('ai-agent', 'AI', 'ai@helpdesk.local', true, 'agent', now(), now())
ON CONFLICT DO NOTHING;

-- Backfill: replies the AI already wrote, and the unassigned finished tickets it resolved.
UPDATE "reply" SET "authorId" = 'ai-agent' WHERE "sender" = 'ai' AND "authorId" IS NULL;

UPDATE "ticket" SET "assignedToId" = 'ai-agent'
WHERE "assignedToId" IS NULL
  AND "status" IN ('resolved', 'closed')
  AND EXISTS (SELECT 1 FROM "reply" WHERE "reply"."ticketId" = "ticket"."id" AND "reply"."sender" = 'ai');
