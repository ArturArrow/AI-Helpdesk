# RAG evaluation

Questions for `bun run --filter server eval:rag` (`server/scripts/evalRag.ts`), which runs each one
through the real search and auto-resolve model and scores the result.

`cases.json`, one entry per question:

- `subject`, `body`: the ticket.
- `language`: `pl` or `en`, the language the reply must be in.
- `document`, `marker`: the file that answers it and a phrase from the chunk that does, for the
  retrieval rank. `null` for a question no document answers.
- `expect`: `resolve`, `escalate`, or `either` when both are defensible.
- `facts`: regular expressions a resolved reply must match (`(?i)` at the start for case-insensitive).

`documents/` holds the test documents the questions are written against, besides the support FAQ
(`rag/knowledge-base/`, added by `bun run seed:rag`). `--with-fixtures` adds the missing ones for the
run and deletes them afterwards.
