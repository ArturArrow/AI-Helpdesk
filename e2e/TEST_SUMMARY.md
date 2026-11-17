# E2E test summary

## Last run

- **Date:** 2026-11-17
- **Discovered (`--list`):** 474 tests in 10 files.
- **Result:** 474 passed, 0 failed (2.1m), after adding Sentry error reporting (no test changes; Sentry stays off in E2E).

## tests/login.spec.ts

- The admin signs in through the UI, lands on `/`, and sees the navbar (Helpdesk, the Users link, their name, Sign out).
- An upper-cased email signs in (Better Auth lower-cases the lookup).
- A wrong password shows "Invalid email or password". The user stays on `/login` and no navbar appears.
- An upper-cased email with a wrong password is still rejected.
- The password is case-sensitive.
- A failed attempt leaves no session: `/api/me` returns 401 and `/` redirects to `/login`.

## tests/session.spec.ts

- The session survives a reload.
- A UI sign-in is shared with a new page in the same context.
- A fresh browser context is unauthenticated, both in the UI and at `/api/me`.
- Sign out redirects to `/login`. Afterwards `/` and `/users` redirect to `/login` and `/api/me` returns 401.
- After sign-out, the back button doesn't show protected content.
- Sign-out revokes the session on the server: replaying the pre-logout cookie gets 401 from `/api/me`.
- Signing out one session leaves another session of the same user valid.

## tests/routing.spec.ts

- An unauthenticated visit to `/` redirects to `/login`, which shows Sign in and no navbar.
- After being bounced from `/users`, signing in lands on `/` (the app has no return-to).
- The admin clicks the Users link and reaches `/users`.
- The agent (real session role) has no Users link and is redirected from `/users` to `/`.
- The agent gets 403 `{"error":"Forbidden"}` from `/api/users`: the server refuses too, not just the page.

## tests/api-auth.spec.ts

- `/api/me` returns 401 `{"error":"Unauthorized"}` without a session.
- `/api/me` returns 401 with a forged session cookie.
- `/api/me` returns 200 with email, name and role, and no password field. One test each for admin and agent.
- A wrong password and an unknown email get the same 401 and the same message.
- The `/api/users` guard, for GET `/api/users`, GET `/api/users/:id`, POST `/api/users`, PATCH `/api/users/:id` and DELETE `/api/users/:id` (5 tests): 401 unauthenticated and 403 for the agent on all five. The admin passes the guard: 200 on GET `/api/users`, 400 on POST (the body has no password), 404 on PATCH and DELETE (unknown id), and 404 on the unrouted GET by id.
- POST `/api/auth/sign-up/email` returns 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`, and the credentials can't sign in afterwards.
- A sign-up with `role: "admin"` in the payload is refused and creates no account.
- An agent's `{role:"admin"}` to `/api/auth/update-user` gets 400 "role is not allowed to be set", and `/api/me` still says agent.
- A `role` sent together with `name` is refused as a whole.
- A malformed JSON body to `/api/users` gets a JSON 400 with no HTML and no stack frames. One test each unauthenticated and as admin.

## tests/users.spec.ts

- Admin GET `/api/users` returns 200 with a `users` array that holds the seeded admin (role `admin`) and agent (role `agent`). Every user has exactly `id`, `name`, `email`, `role`, `createdAt`, and `createdAt` parses as a date.
- `/api/users` is ordered by `createdAt` ascending.
- The AI system agent (`ai-agent`, from a migration) is not in GET `/api/users`, by id or by email.
- Admin PATCH `/api/users/ai-agent` gets 404 `{"error":"User not found"}`, and a ticket held by the AI still shows `assignedTo: { id: "ai-agent", name: "AI" }`.
- Admin DELETE `/api/users/ai-agent` gets 404 `{"error":"User not found"}`, and a ticket held by the AI stays assigned to it (a real delete would unassign it).
- Signing in as `ai@helpdesk.local` (any password) gets 401 with the same message as a wrong password, and no session: it has no credential account.
- New user dialog: opens from "New user" with the "Create an agent account." hint. Name, an upper-cased email and a password submit with 201, the dialog closes, and the row shows the name, lower-cased email, role `agent` and a date, also after a reload. The new user signs in through the API and `/api/me` returns 200 with their name, email and role `agent`.
- Full lifecycle through the UI: create in the New user dialog, see the row, rename and change the email in the Edit dialog, delete in the Delete dialog. After a reload neither email is listed, the agent's row remains, and the created id is gone from GET `/api/users`.
- Admin POST `/api/users` returns 201 with exactly `id`, `name`, `email`, `role`, `createdAt`, the name trimmed, the email lower-cased and role `agent`. GET `/api/users` then lists the same user.
- Edit dialog: saving with a blank password keeps the old password working, and the user's existing session still gets 200 from `/api/me`.
- Edit dialog: a new password ends the user's existing session (`/api/me` 401), the old password gets 401 and the new one signs in.
- Admin PATCH `/api/users/:id` returns 200 with exactly `id`, `name`, `email`, `role`, `createdAt`, the name trimmed and the email lower-cased.
- Admin PATCH with a short name, an invalid email or a short password gets 400 with the schema message, and the user is unchanged.
- Admin PATCH on an unknown id gets 404 `{"error":"User not found"}`.
- Admin PATCH changing a user's email to the agent's gets 409 `{"error":"A user with this email already exists"}`. GET `/api/users` still lists the user with the original name and email, and the agent unchanged.
- PATCH as the agent gets 403 and unauthenticated gets 401. The user is unchanged and still signs in with the original password.
- A deleted user's existing session gets 401 `{"error":"Unauthorized"}` from `/api/me`.
- A deleted user signing in through the API with the correct password gets 401 with the same message as a wrong password, and no session.
- A deleted user signing in through the UI with the correct password sees "Invalid email or password" and stays on `/login` with no navbar.
- Admin DELETE `/api/users/:id` gets 204 with an empty body. The user is gone from GET `/api/users`; the seeded admin and agent remain.
- Admin DELETE on their own (the seeded admin's) id gets 403 `{"error":"Admins cannot be deleted"}`. The session stays valid, the admin is still listed and still signs in.
- Admin DELETE on an unknown id gets 404 `{"error":"User not found"}`.
- Deleting the same user twice gets 404 `{"error":"User not found"}` the second time.
- DELETE as the agent gets 403 and unauthenticated gets 401. The user is still listed and still signs in.
- Deleting an agent unassigns all their tickets: an open one and one set to `resolved` (both assigned through PATCH) return `assignedTo: null` from GET `/api/tickets/:id` after the 204, the resolved one keeps status `resolved`, and a ticket assigned to another agent keeps that agent.
- Deleting an agent who holds no tickets gets 204 with an empty body, and the user is gone from GET `/api/users`.
- PATCH on a deleted user gets 404 `{"error":"User not found"}`.
- POST `/api/users` with a deleted user's email gets 409 "A user with this email already exists", and the email doesn't reappear in the list.

## tests/webhook.spec.ts

POST `/api/webhooks/inbound-email`. The route returns `{"ticket":{"id":<number>}}`, plus `"reply":{"id":<number>}` for an email that threads onto a ticket. Most ticket-creating tests check the response only; the length-limit tests read the stored row back through GET `/api/tickets` and `/api/tickets/:id`, and the threading tests read the stored replies and status through GET `/api/tickets/:id/replies` and `/api/tickets/:id` (signed in as the admin).

- No `X-Inbound-Secret` header gets 401 `{"error":"Unauthorized"}`.
- A wrong secret gets 401 `{"error":"Unauthorized"}`.
- A wrong secret of the same length (last character changed) gets 401, so the `timingSafeEqual` path is exercised, not just the length check.
- A signed-in admin (session checked valid at `/api/me`) without the secret gets 401: a session doesn't count.
- A valid email gets 201 `{"ticket":{"id":<number>}}`.
- An email without a subject gets 201.
- An email with a blank subject gets 201.
- Without `OPENAI_API_KEY` (as in E2E), a new ticket is `open` with `assignedTo: null` in GET `/api/tickets/:id`.
- An email with `bodyHTML` and a `messageId` gets 201.
- The same `messageId` posted twice gets 201, then 200 with the same id.
- Two concurrent posts with the same new `messageId` get one 201 and one 200, with the same id.
- Two identical posts without a `messageId` get 201 each, with distinct ids.
- Threading: `inReplyTo` set to a ticket's `messageId` gets 201 `{ ticket: { id: <that ticket> }, reply: { id } }`; no ticket matches the reply's unique token in the list search, and the ticket's replies are exactly one `customer` reply with the sent `body` and `bodyHTML`, `emailStatus`, `sentAt` and `author` null, and `attachments: []`.
- Threading: a ticket's `messageId` only in `references` (after an unknown id, no `inReplyTo`) threads the reply onto that ticket, with no new ticket.
- Threading: `inReplyTo` set to an earlier customer reply's `messageId` threads onto the same ticket; the thread holds both replies in order and no new ticket exists.
- Threading: the same reply posted twice gets 201, then 200 with the same ticket and reply ids, and the ticket has one reply.
- Threading: a ticket PATCHed to `resolved` is `open` again after a customer reply.
- Threading: a `resolved` ticket held by the AI (status, `resolvedAt` and `assignedToId: ai-agent` written to the DB) is `open` with `assignedTo: null` after a customer reply.
- Threading: a ticket PATCHed to `resolved` and assigned to an admin-created agent is `open` after a customer reply and keeps that agent.
- Threading: an open ticket stays `open` after a customer reply.
- Threading: an unknown `inReplyTo` gets 201 `{ ticket }` with a new id, and neither ticket has replies.
- 400 with the schema message for: missing senderEmail, invalid senderEmail, missing senderName, missing body, `references` not an array (one test each).
- Malformed JSON gets a JSON 400 with no HTML and no stack frames.
- A 255-character (valid-shaped) `senderEmail` gets 400 `{"error":"senderEmail is too long"}`, and no ticket with the test's subject is listed.
- A 254-character valid `senderEmail` (64-char local part, domain labels of 63/63/57 + `.com`) gets 201 and the detail returns it in full.
- A 999-character `senderName` gets 400 `{"error":"senderName is too long"}`, and no ticket is listed.
- A 998-character `senderName` gets 201 and the detail returns it in full.
- A 999-character `messageId` gets 400 `{"error":"messageId is too long"}`, and no ticket is listed.
- A 998-character `messageId` gets 201, and reposting it gets 200 with the same id (shows it was stored, since no response exposes `messageId`).
- A 50,001-character `body` gets 400 `{"error":"body is too long"}`, and no ticket is listed.
- A 50,000-character `body` gets 201 and the detail returns it in full.
- A 100,001-character `bodyHTML` gets 400 `{"error":"bodyHTML is too long"}`, and no ticket is listed.
- A 100,000-character `bodyHTML` gets 201.
- A 999-character `inReplyTo` gets 400 `{"error":"inReplyTo is too long"}`, and no ticket is listed.
- A 998-character `inReplyTo` (an unknown id) gets 201 `{ ticket }`, a new ticket.
- A `references` entry of 999 characters (after a short one) gets 400 `{"error":"references entry is too long"}`, and no ticket is listed.
- A `references` entry of 998 characters (unknown ids) gets 201 `{ ticket }`, a new ticket.
- 101 `references` entries get 400 `{"error":"references has too many entries"}`, and no ticket is listed.
- 100 `references` entries (unknown ids) get 201 `{ ticket }`, a new ticket.
- A request over 100 kB (50,000-char `body` + 100,000-char `bodyHTML`) gets 201, so the webhook's own `express.json` limit applies instead of the global 100 kB one.
- A request over 1 MB (a 1.5 MiB random attachment) gets 201, and the file downloads byte for byte.
- A request over 35 MiB (36 MiB of valid base64 in one attachment) gets 413 with a JSON `{"error":...}`, and no ticket is listed. The schema would answer 400, so only the parser's limit can give this.

Storing attachments (read back through GET `/api/tickets/:id` and `/api/tickets/:id/replies`):

- Two files on a new ticket are listed in the order sent, as exactly `id`, `filename`, `contentType`, `size`, `contentId`, `tooLarge`, with no `data` key.
- A ticket sent without attachments lists `[]`.
- A threaded reply's file is listed on the reply (exact fields, no `data`) and not in the ticket's list, which holds only the ticket's own file.
- A file without `content` is stored with `tooLarge: true` and the `size` as reported.
- A stored file's `size` comes from its bytes, not the `size` reported.
- A redelivered ticket (same `messageId`) gets 200 and its list is unchanged.
- A redelivered reply gets 200, the reply still has one file and the ticket's list stays `[]`.

Emails without text:

- An attachment-only email (empty `body`) gets 201 with the body `(no text)` and the file listed.
- A blank body with only a listed (`tooLarge`) file gets 201 with `(no text)`.
- An HTML-only email (whitespace `body`) gets 201 with `(no text)` and the HTML kept.
- An attachment-only threaded reply is stored with `(no text)` and the file.
- An empty body, a whitespace body, and an empty body with `attachments: []`, all without HTML (one test each), get 400 `{"error":"body is required"}`, and no ticket is listed.
- A missing `body` key gets the same 400 even with attachments.

Cleaning attachment fields (one test each, 201 and read back):

- `filename`: NUL stripped (not a 500), line breaks and other control characters stripped, only control characters becomes `attachment`, over 255 characters cut to 255.
- `contentType`: invalid, containing NUL and missing become `application/octet-stream`; `IMAGE/PNG` is stored lower-cased.
- `contentId`: invalid, containing NUL and non-string are dropped (`null`); a valid one is stored trimmed.

NUL in text fields (`inboundEmailSchema` strips it before `trim` and the length checks):

- `senderName`, `subject`, `body` and `bodyHTML` with a NUL inside (one test each) get 201, and GET `/api/tickets/:id` returns all four without it.
- A `messageId` with a NUL gets 201, then 200 with the same id for the same id without the NUL and again with it. No response returns `messageId`, so this is what shows it was stored clean.
- An unknown `inReplyTo` and an unknown `references` entry with a NUL (one test each) get 201 `{ ticket }`, a new ticket.
- A reply whose `inReplyTo` is the ticket's `messageId` with a NUL threads onto that ticket: no ticket matches its token, and the thread holds exactly that reply.
- A `body` of only NUL gets 400 `{"error":"body is required"}` and a `senderName` of only NUL gets 400 `{"error":"senderName is required"}` (one test each), and no ticket is listed.
- A 998-character `subject` plus a NUL (999 sent) gets 201, and the detail returns the 998 characters.

Attachment limits (each 400 also checks that no ticket is listed):

- 21 stored files get 400 `attachments has too many files`; 20 get 201; 20 stored plus 5 listed get 201 with all 25 listed.
- 101 entries get 400 `attachments has too many entries`; 100 listed entries get 201.
- A file of 10 MiB + 1 byte gets 400 `attachment is too large`; exactly 10 MiB gets 201.
- Three files totalling 25 MiB + 1 byte, each within the file limit and under the JSON limit, get 400 `attachments are too large`; exactly 25 MiB gets 201 with the sizes listed.
- 400 with the schema message (one test each): invalid base64, `attachments` not an array, a missing `filename`, a missing `size`, a fractional `size`.

## tests/tickets.spec.ts

GET `/api/tickets`, GET `/api/tickets/:id`, GET `/api/tickets/assignees`, PATCH `/api/tickets/:id` and POST `/api/tickets/:id/summary`, at the API only (the page UI is in Vitest). Other specs create tickets too and the list is paginated (10 by default, `DEFAULT_TICKET_PAGE_SIZE`), so each test narrows the list to its own tickets with `q=<unique token>`, or uses `pageSize=100` when a check covers every row. They compare relative order, never positions or counts, except where `q` makes the matching set exactly the test's tickets.

- GET `/api/tickets` without a session gets 401 `{"error":"Unauthorized"}`.
- The agent gets 200 and the list holds a ticket just created through the webhook.
- The admin gets the same 200 and listing.
- A webhook ticket sent with `bodyHTML`, a `messageId` and a mixed-case email is listed with exactly `id`, `subject`, `senderName`, `senderEmail` (lower-cased), `status` `open`, `category` null and a parseable `createdAt`. The response has exactly `tickets` and a numeric `total`, and every ticket on a page of 100 has exactly those seven keys (no `body`, `bodyHTML` or `messageId`).
- Three tickets created in sequence are listed newest first, and a full page's `createdAt` values are descending.

Sorting (`sortBy`, `sortOrder` query params):

- Without a session, both valid and invalid sort params get 401 `{"error":"Unauthorized"}` (auth runs before validation).
- `sortBy=senderEmail` (a listed but unsortable column) gets 400 `{"error":"sortBy must be one of: subject, senderName, status, category, createdAt"}`.
- `sortOrder=sideways` gets 400 `{"error":"sortOrder must be asc or desc"}`.
- `sortBy=subject&sortOrder=asc`: three tickets created as B, C, A are listed A, B, C.
- `sortBy=subject&sortOrder=desc`: the same setup is listed C, B, A.
- `sortBy=senderName` with no `sortOrder` lists sender names descending (the default), and with `asc` ascending.
- Two tickets with the same subject are listed newest first under `sortBy=subject` in both directions (the `createdAt desc` tie-break).
- `sortBy=createdAt&sortOrder=asc` lists three tickets oldest first, and a full page's `createdAt` values are ascending.
- `sortBy=category` in both directions returns 200, the test's three (unclassified, `category` null) tickets are newest first.
- `sortBy=status` in both directions returns 200.

Filtering (`status`, `category` query params). The webhook creates only open, unclassified tickets, so each test here checks that a filter (narrowed by `q` to the ticket's subject) keeps or drops the test's own ticket, and that every row of a page of 100 under that filter matches; other values may return an empty list. That a changed ticket is listed under its new status and category is checked in the PATCH section below.

- Without a session, both valid and invalid filter params get 401 `{"error":"Unauthorized"}`.
- `status=open` lists the new ticket, and every row has status `open`.
- `category=unclassified` lists the new ticket, and every row has `category` null.
- `status=resolved` and `status=closed` (one test each) exclude the new ticket, and every row has that status.
- `category=general_question`, `technical_question`, `refund_request` (one test each) exclude the new ticket, and every row has that category.
- Combined: `status=open&category=unclassified` lists the ticket with every row matching both; `open` + `refund_request` and `resolved` + `unclassified` exclude it, with every row matching both.
- `status=open&category=unclassified&sortBy=subject` with `asc` and `desc` (one test each): three tickets created B, C, A are listed A, B, C or C, B, A, and every row matches the filters.
- `status=pending`, `Open` (case-sensitive), `unclassified` (a category value), an empty `status=`, `new` and `processing` (the AI pipeline's statuses) (one test each) get 400 `{"error":"status must be one of: open, resolved, closed"}`.
- `category=billing`, `Refund_Request`, `open` (a status value) and an empty `category=` (one test each) get 400 `{"error":"category must be one of: general_question, technical_question, refund_request, unclassified"}`.
- A repeated `status=open&status=closed` gets 400 with the status message (Express parses it as an array).
- An invalid category together with a valid sort gets 400 with the category message.

Search (`q` query param). Each test searches for a token unique to it, so the matching set is exactly its own tickets.

- Without a session, a valid `q`, a 201-character `q` and a repeated `q` all get 401 `{"error":"Unauthorized"}`.
- A token only in the `subject`, `senderName`, `senderEmail` or `body` (one test each) returns exactly that ticket and not a control ticket without it. For all but `body` (not in the list response), every row holds the token in a listed field.
- An upper-cased and a lower-cased form of a mixed-case subject token both find the ticket.
- Leading and trailing spaces around the token are trimmed.
- `q=%20%20` and an empty `q=` return the same ids, in the same order, and the same `total` as no `q` (all with `pageSize=100`).
- `q` + `status=open` + `sortBy=subject` with `asc` and `desc` (one test each): three tickets created B, C, A come back as exactly A, B, C or C, B, A; a control ticket is excluded; the same query with `status=resolved` returns `[]`.
- A subject token `50%_off-<suffix>` is found by that exact text, and a decoy `50ABoff-<suffix>` (which the unescaped wildcards would match) is not.
- `q=%` and `q=_` (one test each) include a ticket with that character in its subject and exclude a new ticket without it.
- A token with a backslash (`back\slash-<suffix>`) matches literally, and a decoy `backslash-<suffix>` (it would match if the backslash weren't escaped, since `\s` in LIKE means a plain `s`) is not.
- A 201-character `q` gets 400 `{"error":"q is too long"}`; exactly 200 characters gets 200.
- A repeated `q=a&q=b` gets 400 `{"error":"q must be a single string"}`.

Pagination (`page`, `pageSize` query params). Each test narrows with its own `q` token, so `total` is exact.

- Without a session, valid and invalid paging params get 401 `{"error":"Unauthorized"}`.
- Five tickets with `pageSize=2`: pages 1, 2 and 3 hold 2, 2 and 1 tickets, each with `total: 5`; the pages don't overlap and, joined in order, equal the unpaginated list, which is newest first.
- With `sortBy=subject&sortOrder=asc&pageSize=2`, five tickets created D, B, E, A, C come back as pages [A, B], [C, D], [E], matching the unpaginated sorted list.
- `page=4&pageSize=2` past the end returns `{"tickets":[],"total":5}`.
- `total` follows the filters: 1 for the token, 0 (with `tickets: []`) for a `q` matching nothing and for the token with `status=resolved`.
- Without `pageSize`, a page holds `min(total, 10)` tickets (exactly 10 when the DB has more), the same ids as `pageSize=10`, and `pageSize=100` reports the same `total`.
- 400 `{"error":"page must be a positive integer"}` for `page=0`, `-1`, `abc`, `1.5`, an empty `page=` and a repeated `page=1&page=2`; 400 `{"error":"page is too large"}` for `page=1000001`; 400 `{"error":"pageSize must be an integer from 1 to 100"}` for `pageSize=0`, `101`, `abc` and a repeated `pageSize` (one test each).
- `pageSize=100` gets 200 with at most 100 tickets, and `page=1000000` gets 200 with `tickets: []` and a numeric `total`.

Detail (GET `/api/tickets/:id`):

- Without a session, both an existing id and `abc` get 401 `{"error":"Unauthorized"}` (auth runs before validation and lookup).
- The agent and the admin (one test each) get 200 with the ticket just created through the webhook.
- `abc`, `0`, `-1`, `1.5` and `2147483648` (above int4) get 400 `{"error":"id must be a positive integer"}` (one test each).
- `2147483647` (the int4 maximum, valid but nonexistent) gets 404 `{"error":"Ticket not found"}`.
- A webhook ticket sent with `bodyHTML` and a `messageId` comes back as exactly `{ ticket }` with `id`, `subject`, `senderName`, `senderEmail`, `status` `open`, `category` null, parseable `createdAt` and `updatedAt`, `body`, `bodyHTML` equal to the HTML sent, `assignedTo` null and `attachments: []`; no `messageId` or `assignedToId`.
- `bodyHTML` with attributes, an `onclick` handler and a `<script>` comes back byte-for-byte as sent (the server doesn't sanitize).
- A ticket created without `bodyHTML` has the detail keys with `bodyHTML: null`.
- A ticket assigned (through PATCH) to an admin-created agent returns `assignedTo: { id, name }` of that agent, read by the seeded agent, with no `assignedToId`.
- A ticket assigned to the AI system agent in the DB returns the detail keys with `assignedTo: { id: "ai-agent", name: "AI" }`.

Assignees (GET `/api/tickets/assignees`). Other specs create and delete agents, so these check membership and relative order, never the full list.

- Without a session gets 401 `{"error":"Unauthorized"}`.
- The agent and the admin (one test each) get 200 with exactly `{ agents }`; the seeded agent is listed as `{ id, name: "Agent" }`, and every entry has exactly `id` and `name`.
- The admin's id (from `/api/me`) is not listed.
- The AI system agent is not listed, by id or by name.
- A soft-deleted agent is not listed; an active one created alongside it is.
- Three agents created B, C, A are listed A, B, C (name ascending).

Assignment (PATCH `/api/tickets/:id` with `{ assignedToId }`):

- Without a session, both an existing id and `abc` get 401 `{"error":"Unauthorized"}`, and the ticket stays unassigned.
- The agent and the admin (one test each) assign a ticket to an active agent: 200 with exactly `{ ticket }` in the detail shape (the GET's ticket with `assignedTo: { id, name }` of the agent, `bodyHTML: null` since the ticket was created without one, no `assignedToId`), `updatedAt` later than before, and a following GET returns the same ticket.
- The agent and the admin (one test each) unassign with `null`: 200 with the detail keys and `assignedTo: null`, also on a following GET.
- Reassigning to a second agent replaces the first in `assignedTo`.
- A status PATCH on a ticket created with `bodyHTML` returns the detail keys with that HTML unchanged.
- `2147483647` (valid but nonexistent) gets 404 `{"error":"Ticket not found"}`.
- `abc` gets 400 `{"error":"id must be a positive integer"}`.
- An unknown user id, the admin's id, a soft-deleted agent's id and `ai-agent` (one test each) get 400 `{"error":"assignedToId must be an active agent"}`, and the ticket stays unassigned.
- A status-only PATCH on a ticket held by the AI gets 200 and keeps `assignedTo` the AI (the assignee check only runs on a given `assignedToId`).
- A ticket held by the AI can be reassigned to an admin-created agent, and another one unassigned with `null`.
- A body with no `assignedToId` (`{}`) gets 400 `{"error":"Provide at least one of assignedToId, status, category"}`, not the assignedToId message.

Status and category (PATCH `/api/tickets/:id` with `status` and/or `category`). Each successful step asserts the response is exactly the previous ticket with only the requested change and a later `updatedAt`, and that a following GET returns the same ticket.

- A status change without a session gets 401 `{"error":"Unauthorized"}`, and the ticket stays `open`.
- The agent and the admin (one test each) change status open → resolved → closed → open.
- The agent and the admin (one test each) set the category of an unclassified ticket to `general_question`, then `refund_request`, then back to `null`.
- Starting from an assigned, resolved, `technical_question` ticket, single-field PATCHes in turn (status → closed, category → refund_request, reassign, unassign) each leave the other fields untouched.
- One PATCH with `assignedToId`, `status` and `category` applies all three.
- 400, with the ticket unchanged afterwards (one test each): `{}` and a body with only an unknown field (`subject`) get `"Provide at least one of assignedToId, status, category"`; status `"pending"`, `"Open"`, `null`, `1`, `"new"` and `"processing"`, and a valid category with status `"pending"`, get `"status must be one of: open, resolved, closed"`; category `"billing"`, `"unclassified"`, `""` and `1`, and a valid status with category `"billing"`, get `"category must be one of: general_question, technical_question, refund_request, or null"`; an empty, blank or numeric `assignedToId`, alone or with a valid status, gets `"assignedToId must be a user id or null"`.
- A valid status and category with the admin's id as `assignedToId` get 400 `"assignedToId must be an active agent"`, and neither status nor category changes.
- GET `/api/tickets` filters follow the changes: after `status: resolved` the ticket is listed under `status=resolved` and not `status=open`; after `category: refund_request` it is listed under `category=refund_request` and `resolved` + `refund_request`, not under `unclassified`. Every row of each filtered page of 100 matches.

Tickets the AI is still handling (`new`, `processing`). The test server has no `OPENAI_API_KEY`, so the webhook creates `open` tickets and each test sets the status directly in the DB (`setTicketStatusInDb`):

- `new` and `processing` (one test each): of two tickets sharing a `q` token, the one set to that status is left out: `q=<token>` returns only the open one with `total: 1`, `q=<its own subject>` returns `{ tickets: [], total: 0 }`, `q=<token>&status=open` returns only the open one, and it isn't on the default page of 100, where every row is `open`, `resolved` or `closed`.
- `new` and `processing` (one test each): GET `/api/tickets/:id` still returns 200 with the detail keys and that `status`.
- The default list's `total` drops by exactly one when an open ticket is set to `processing`.

Summary (POST `/api/tickets/:id/summary`, no body; the test server has no `OPENAI_API_KEY`, so a request for an existing ticket ends at 503 and OpenAI is never called):

- Without a session, both an existing id and `abc` get 401 `{"error":"Unauthorized"}`.
- The agent and the admin (one test each) get 503 `{"error":"AI isn't configured"}` for an existing ticket.
- A ticket with one posted reply: after a summary call (503) GET returns the same ticket and the same one-reply thread.
- Ids `abc`, `0`, `-1`, `1.5` and `2147483648` get 400 `{"error":"id must be a positive integer"}` (one test each).
- `2147483647` (valid but nonexistent) gets 404 `{"error":"Ticket not found"}`, not 503 (lookup before the AI check).

Download (GET `/api/tickets/:id/attachments/:attachmentId`). What the detail lists is checked in `webhook.spec.ts`.

- Without a session, an existing file and `abc`/`abc` get 401 `{"error":"Unauthorized"}`.
- The agent and the admin (one test each) download a file of every byte value, byte for byte.
- An empty file gets 200 with an empty body, not 404.
- A customer reply's file downloads through its ticket.
- A plain filename is in `Content-Disposition: attachment; filename=...` as it is.
- A non-ASCII filename is listed as sent, and `Content-Disposition` has it percent-encoded in `filename*=UTF-8''...`.
- `.html`, `.svg` and `.txt` files (one test each) keep their `contentType` in the list, download as `application/octet-stream` with the bytes intact, and have `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` and `Cache-Control: private`.
- `image/png`, `jpeg`, `gif` and `webp` (one test each) keep their type, with the same headers.
- A PATCH response lists the ticket's files.
- 404 `{"error":"Attachment not found"}` for an unknown attachment id, an unknown ticket id with a real attachment id, another ticket's attachment (which still downloads through its own ticket) and a `tooLarge` file.
- Ticket id and attachment id of `abc`, `0`, `-1`, `1.5` and `2147483648` (one test each) get 400 with `id must be a positive integer` and `attachmentId must be a positive integer`.

## tests/replies.spec.ts

GET and POST `/api/tickets/:id/replies` (as JSON and as a multipart form with files) and POST `/api/tickets/:id/replies/polish`, at the API only (the thread and reply form are covered by component tests). Each test creates its own ticket through the webhook, so a thread holds exactly the replies the test posted.

Without a session:

- GET gets 401 `{"error":"Unauthorized"}` for an existing id and for `abc` (auth runs before validation).
- POST gets 401 for an existing id and for `abc`, and the ticket's thread stays `[]`.

POST:

- The agent and the admin (one test each) reply with a padded body: 201 with exactly `{ reply }`, keys `id`, `body`, `bodyHTML`, `sender`, `emailStatus`, `sentAt`, `createdAt`, `author`, `attachments`; the body trimmed, `sender` `agent`, `emailStatus` and `sentAt` null, `author` exactly `{ id, name }` of the signed-in user (id from `/api/me`), a numeric id and a parseable `createdAt`. A following GET returns exactly that reply.
- A body with `sender: "customer"` and the admin's id as `authorId`, posted by the agent, is stored with `sender` `agent` and the agent as author.
- `attachments` sent in a JSON POST body are ignored (zod strips them): the 201 reply and the listed reply have `attachments: []`.
- An agent reply has the key `bodyHTML` with value `null` in the 201, and the GET list returns it with `bodyHTML: null` too.
- Without a mailer (`server/.env.test` sets no `MAILER_URL`/`MAILER_SECRET`), a posted reply has `emailStatus: null` and `sentAt: null` in the 201 and in the GET list.
- `emailStatus: "sent"`, a `sentAt` and a `messageId` sent in the POST body are ignored (zod strips them): the 201 reply has exactly the reply keys, `emailStatus` and `sentAt` null, and GET returns the same reply.
- A `bodyHTML` sent in the POST body is ignored (zod strips it): the 201 reply and the listed reply have `bodyHTML: null`.
- A body of exactly 10,000 characters gets 201 and is stored whole.
- 400, with nothing stored (one test each): an empty, whitespace-only, missing, numeric or null body gets `"Reply can't be empty"`; a 10,001-character body gets `"Reply is too long"`.
- Ids `abc`, `0`, `-1`, `1.5` and `2147483648` get 400 `{"error":"id must be a positive integer"}` (one test each).
- An invalid id with an empty body gets the id error (params are validated before the body).
- `2147483647` (valid but nonexistent) gets 404 `{"error":"Ticket not found"}`.

POST with files (`multipart/form-data`; the size, count, field and malformed-body messages are multer's and busboy's, asserted exactly with a JSON `Content-Type`; "nothing stored" means the thread and the ticket's own attachment list are both `[]`):

- Three files sent out of name order: the 201 lists them in that order as exactly `id`, `filename`, `contentType`, `size`, `contentId` null, `tooLarge` false, with no `data` key, on a reply with `emailStatus` null and the signed-in author. GET returns the same reply, and each file downloads byte for byte, one of them all 256 byte values.
- The ticket's own attachment list holds only its email's file, not the reply's.
- `faktura-żółć.pdf` is listed exactly in the 201 and in GET, and `Content-Disposition` has it in `filename*=UTF-8''...`.
- A multipart reply with no files gets 201 with `attachments: []`.
- A JSON reply on a ticket that already has a multipart one gets 201 with `attachments: []`, and both are listed in order.
- A file of exactly 10 MiB gets 201; 10 MiB + 1 byte gets 413 `File too large`, nothing stored.
- Files of exactly 18 MiB in total (10 + 8) get 201; 18 MiB + 1 byte, each file within its limit, gets 413 `Attachments are too large`, nothing stored.
- 10 files get 201, listed in the order sent; 11 get 400 `Too many files`, nothing stored.
- A file in another field gets 400 `Unexpected file field`, alone and after a valid file in `attachments` (one test each), nothing stored.
- Malformed multipart gets a JSON 400, not 500, nothing stored (one test each): no closing boundary, a file cut off midway and non-multipart content get `Unexpected end of form`; a 20,000-character part header gets `Malformed part header`; a `Content-Type` without a boundary gets `Multipart: Boundary not found`.
- An empty body, a whitespace-only body and no `body` field, each with a file (one test each), get 400 `"Reply can't be empty"`, nothing stored.
- Without a session, a multipart POST gets 401 for an existing id and for `abc`, nothing stored.
- `2147483647` with a file gets 404 `{"error":"Ticket not found"}`, and the attachment ids of uploads just before and after it are consecutive, so no row was inserted.
- A reply's `.html` file is listed as `text/html` and downloads as `application/octet-stream`, with `Content-Disposition: attachment`, `nosniff` and the bytes intact.
- `sender: "customer"` and the admin's id as `authorId` in the form, posted by the agent with a file: stored with `sender` `agent` and the agent as author.

GET:

- A ticket with no replies returns `{ replies: [] }`.
- Replies posted by the agent, the admin, then the agent are returned in that order (oldest first), each equal to its POST response, with ascending `createdAt`.
- Replies posted to two tickets are returned only on their own ticket; a third ticket returns `[]`.
- An `ai` reply written to the DB after an agent reply is returned second, as exactly `{ id, body, bodyHTML: null, sender: "ai", emailStatus: null, sentAt: null, createdAt, author: { id: "ai-agent", name: "AI" }, attachments: [] }` (the pipeline authors AI replies as the AI system agent).
- The agent and the admin (one test each) read a reply written by the other.
- A reply posted by a fresh agent (created by the admin, signed in in its own request context), who is then soft-deleted: GET by the admin and by the seeded agent still returns the reply unchanged, with `author` exactly the deleted agent's `{ id, name }`.
- Ids `abc`, `0`, `-1`, `1.5` and `2147483648` get 400 with the id message (one test each).
- `2147483647` gets 404 `{"error":"Ticket not found"}`.

POST `/polish` (the test server has no `OPENAI_API_KEY`, so a valid request ends at 503 and OpenAI is never called; the ticket lookup is `loadTicketContext`, shared with POST `/summary`):

- Without a session: 401 `{"error":"Unauthorized"}` for an existing id and for `abc`, and the thread stays `[]`.
- The agent and the admin (one test each) get 503 `{"error":"AI isn't configured"}` for a valid request on an existing ticket, and the thread stays `[]`.
- A ticket with one posted reply: after a polish call (503) GET returns exactly that reply.
- A body of exactly 10,000 characters passes validation (503, not 400).
- 400, with nothing stored (one test each): an empty, whitespace-only or missing body gets `"Reply can't be empty"`; a 10,001-character body gets `"Reply is too long"`.
- Ids `abc`, `0`, `-1`, `1.5` and `2147483648` get 400 with the id message (one test each).
- An invalid id with an empty body gets the id error (params first).
- `2147483647` with an empty body gets the body error (body validated before the ticket lookup).
- `2147483647` with a valid body gets 404 `{"error":"Ticket not found"}`, not 503 (lookup before the AI check).

## tests/ticket-stats.spec.ts

GET `/api/tickets/stats` (`{ total, open, resolvedByAi, averageResolutionMs, ticketsPerDay }`, optional `?period=7d|30d|90d|all` and `?tz=<IANA zone>`, default UTC) and the `resolvedAt` column behind the average. Periods are calendar days in `tz`, today included. The stats cover every ticket, so every test except the auth and validation ones first empties the ticket table (`deleteAllTicketsInDb`) and asserts exact numbers. `resolvedAt` isn't in any response, so it's observed through `averageResolutionMs`; known durations come from writing `createdAt`/`resolvedAt` in the DB. The day-based tests run inside `onStableDays`, which repeats the test's setup and requests if the date changed in any zone while they ran, so midnight can't make the test's "today" differ from the server's; past tickets sit at noon UTC or at fixed instants, never relative to the current time of day.

- 401 `{"error":"Unauthorized"}` without a session.
- 200 with exactly the five keys, numbers (average number or null), and `ticketsPerDay` entries of `{ date: YYYY-MM-DD, count }`. One test each for agent and admin.
- `period` of `week`, `7`, `7D`, `1d`, `365d`, `ALL` or empty (7 tests): 400 `{"error":"period must be one of: 7d, 30d, 90d, all"}`.
- A repeated `?period=7d&period=30d` gets the same 400.
- An invalid period without a session gets 401, not 400.
- Tickets created now (open), 3 days ago (resolved 1 h, `ai` reply), 20 days (closed 3 h), 60 days (open), 60 days (resolved 5 h, `ai`) and 200 days (closed 7 h, `ai`): 7d → total 2, resolvedByAi 1, average 1 h; 30d → 3, 1, 2 h; 90d → 5, 2, 3 h; all → 6, 3, 4 h; open is 2 for every period; no parameter equals `all`.
- A lone open ticket created 60 days ago: open 1 for every period, total 0 for 7d and 30d, 1 for 90d and all.
- A period goes by `createdAt`: a ticket created 10 days ago and resolved (with an `ai` reply) yesterday is left out of 7d and counted in 30d with an average of 9 days.
- No tickets: `{ total: 0, open: 0, resolvedByAi: 0, averageResolutionMs: null, ticketsPerDay: [] }`.
- Eight tickets (open, open with an `ai` reply, resolved with two `ai` replies, closed with an `ai` reply, resolved, closed, `new`, `processing`): total 8, open 2, resolvedByAi 2 (the open ticket's `ai` reply doesn't count; two `ai` replies count once).
- A webhook ticket counts in total and open at once.
- `tz` of `Mars/Base`, `not a zone`, empty, or a 65-character string (4 tests): 400 `{"error":"tz must be a time zone"}`.
- A repeated `?tz=UTC&tz=Europe/Warsaw` gets the same 400.
- An invalid tz without a session gets 401, not 400.
- `UTC`, `Europe/Warsaw`, `America/Los_Angeles`, `Asia/Kathmandu` (+5:45) and lower-case `europe/warsaw` each get 200 with `7d` and `all`.
- A ticket at 23:30 UTC two days ago: 7d counts it on its UTC day with no tz and with `tz=UTC`, and on the next day with `Europe/Warsaw` and `Asia/Tokyo`; total 1 in all of them.
- The period starts at midnight in tz: in `Asia/Tokyo` a ticket at 00:30 six days ago is in 7d (first day, count 1, 7 days) and one at 23:30 the day before is not (total 1); in UTC both fall on one day, so UTC 7d has 2 or 0, worked out from the current UTC date.
- `tz=+09:00` (accepted by `Intl.DateTimeFormat`) either gets the 400 or buckets like `Asia/Tokyo` (a 23:30 UTC ticket on the next day). See *Open questions*: expected to fail today.
- No tickets: `all` has `[]` with no tz and with `Asia/Tokyo`; `7d` has 7 zero days ending today, in UTC and in Tokyo.
- 7d, 30d and 90d list exactly 7, 30 and 90 consecutive dates ending today, with today's webhook ticket counted on today (3 tests: default UTC, `Pacific/Kiritimati`, `Pacific/Pago_Pago`, the last two always on different dates).
- Tickets today (open), yesterday (`new` and `processing`), 4 days ago (`closed`) and 8 days ago (`resolved`), at noon UTC: 7d is exactly `[0, 0, 1, 0, 0, 2, 1]` on the right dates with total 4; 30d counts the 8-day ticket and sums to total 5.
- Tickets today, 1, 3, 20, 60 days ago and the earliest at 23:30 UTC 200 days ago: the days sum to total for 7d (3), 30d (4), 90d (5) and all (6); `all` runs from the earliest ticket's UTC day through today, and with `Asia/Tokyo` from the next day (its Tokyo day) through today in Tokyo, the first day counting 1.
- Average is null when nothing finished has a `resolvedAt`: open, `new`, `processing`, a resolved ticket with null `resolvedAt` and an open ticket with a stale `resolvedAt` are all ignored.
- Average is exact over known values: a resolved ticket (1 h) and a closed one (3 h) give 7,200,000; an open ticket is ignored.
- PATCH open → resolved and open → closed (2 tests): the average falls between the request's start and end minus `createdAt` (1 s slack).
- PATCH resolved → closed → resolved keeps the original `resolvedAt` (set to a known 60 s after the first PATCH; stays 60,000).
- PATCH without a status change (same status again, category only, assignee only) keeps `resolvedAt`.
- PATCH resolved → open clears it (average null, open 1); resolving again stamps a new time, not the old one.
- PATCH closed → open clears it.
- A webhook customer reply (`inReplyTo` the ticket's `messageId`) to an AI-resolved ticket gets 201 and leaves `{ total: 1, open: 1, resolvedByAi: 0, averageResolutionMs: null }`.

## tests/rag.spec.ts

The `/api/rag` guards at the API level. `server/.env.test` sets neither `RAG_URL` nor `RAG_SECRET`, so a request past `requireAuth` and `requireAdmin` gets the router's 503, which shows it got through both guards. For each of GET `/api/rag/documents`, POST `/api/rag/documents` (multipart, a small `.txt` as `file`), GET `/api/rag/documents/:id/file` and DELETE `/api/rag/documents/:id` (both with a well-formed UUID):

- 401 `{"error":"Unauthorized"}` without a session.
- 403 `{"error":"Forbidden"}` for the agent.
- 503 `{"error":"The document service isn't configured"}` for the admin.

## Harness helpers

- **`fixtures/auth.ts`:**
  - `ADMIN` credentials, matching `ADMIN_*` in `server/.env.test`.
  - `AGENT` credentials (`agent@example.com` / `test-agent-password`).
  - `ORIGIN`.
  - `signInViaApi(request, user)` signs in through the API and asserts 200. Called with `page.request`, the cookie goes into the browser context. It's the default setup step when the test isn't about the login UI.
  - `submitLoginForm(page, email, password)` fills and submits the login form on the current page and asserts nothing. It takes raw strings so tests can submit invalid or wrong input.
  - `signInViaUi(page, user)` goes to `/login`, submits the form, and waits for `/`.
  - `signOutViaUi(page)` clicks Sign out and waits for `/login`.
  - `expectRedirectToLogin(page, path)` visits `path` and asserts the app lands on `/login`.
- **`fixtures/users.ts`:**
  - `uniqueSuffix()` returns a timestamp plus a random tag, for names and emails that don't collide across tests or re-runs.
  - `createUserViaApi(request, label)` creates an agent through POST `/api/users` (the request must be signed in as the admin), asserts 201 and returns its credentials and `id`. Tests that mutate or delete users create their own, so the seeded admin and agent never change.
  - `deleteUserViaApi(request, id)` soft-deletes a user through DELETE `/api/users/:id` (signed in as the admin) and asserts 204.
  - `AI_AGENT` (`{ id: "ai-agent", name: "AI", email: "ai@helpdesk.local" }`), the system user the `20261103120000_add_ai_agent` migration inserts.
  - `users.spec.ts` keeps its own `userRow`, `openNewUserDialog`, `submitNewUser`, `openEditDialog`, `openDeleteDialog` and `postSignIn`, which only it uses.
- **`fixtures/webhook.ts`:** `inboundSecret()` reads `INBOUND_EMAIL_SECRET` from `server/.env.test` (the file `start:test` loads) with `node:util`'s `parseEnv`, so the tests and the server share one value. It reads lazily and throws a clear error if the value is missing, so other specs still load. `webhook.spec.ts` keeps its own `validEmail` (unique sender per call), `uniqueMessageId`, `postInbound`, `expectUnauthorized`, `expectCreated`, `emailOfLength(n)` (a valid, unique address of exactly n characters), `expectNoTicketMatching(request, marker)` (signs in as the admin, GET `/api/tickets?q=` returns `{ tickets: [], total: 0 }`; used by both the length-limit and the threading tests) and `expectTooLong(res, error)`, and for threading `createThreadTicket` (a ticket with a known `messageId`), `replyEmail` (an answer with a unique token in subject and sender, `bodyHTML` and its own `messageId`), `expectReplyCreated`, `listReplies`, `getTicket` and `ticketStatus`, and for attachments `textFile`, `fileOfSize(bytes)`, `listedOnlyFile(size?)` (no `content`), `listAttachments`, `storedAttachment(request, file)` (posts one file, returns it as listed) and `expectRejected(request, attachments, error)` (the 400 and no ticket listed), and `withNul(text)` (puts a NUL after the second character).
- **`fixtures/tickets.ts`:** `createTicketViaWebhook(request, label, overrides?)` posts a unique email (subject `E2E <label> <suffix>`, unique sender, body `Please help.`) to the inbound webhook with the secret, asserts 201 and returns the ticket's `id`, `subject`, `senderName` and `senderEmail`. `overrides` sets `subject`, `senderName`, `senderEmail`, `body`, `bodyHTML`, `messageId` or `attachments` exactly, for the sorting, search, `bodyHTML`, threading and attachment tests; without a `bodyHTML` override none is sent, so the ticket's `bodyHTML` is null. The defaults contain no `%`, `_` or `\`. It needs no session. `fileAttachment(filename, contentType, bytes)` builds a file in the webhook's shape (base64 `content`, `size` from the bytes); `InboundAttachment` and `ListedAttachment` type what goes in and comes out. `updateTicketViaApi(request, ticketId, data)` sends any of `assignedToId`, `status`, `category` (type `TicketUpdate`; `null` unassigns or unclassifies) through PATCH `/api/tickets/:id`, asserts 200 and returns the ticket; the request must be signed in. `setTicketStatusInDb(ticketId, status)` and `addAiReplyInDb(ticketId, body)` write what only the AI pipeline produces (a `new`/`processing` status, a `sender: ai` reply authored by `ai-agent`) straight to `helpdesk_test`, through `e2e/write-ticket.ts`. `setTicketInDb(ticketId, { status?, createdAt?, resolvedAt?, assignedToId? })` writes any of those (`null` clears `resolvedAt` or `assignedToId`) the same way, for known resolution times and tickets held by the AI (which PATCH refuses); it bypasses the API's `resolvedAt` rules and assignee check. `deleteAllTicketsInDb()` deletes every ticket (replies cascade), only for the global stats tests. `ticket-stats.spec.ts` keeps its own `getStats(request, { period?, tz? })` (asserts 200, returns the whole response), `getCounts(request, period?)` (the same without `ticketsPerDay`; no query string without a period), `averageOf(request)`, `expectStampedBetween`, date helpers (`dateIn(tz)`, `addDays`, `datesFrom`, `atLocal(date, time, tz)`, `noonUtc`, `countOn`, `sumOf`) and `onStableDays(zones, fetch)` (reruns the setup and requests if a zone's date changed meanwhile). `tickets.spec.ts` keeps its own `getTicket(request, id)` (GET `/api/tickets/:id`, asserts 200, returns the ticket), `expectUpdated(request, before, data, changes)` (PATCH, then the response equals `before` plus `changes` with a later `updatedAt`, and a GET matches), `currentUserId(request)` (the signed-in user's id from `/api/me`), `listAssignees(request)` (GET `/api/tickets/assignees`, asserts 200 and exactly `{ agents }`), `getTicketPage(request, params)` (GET with sort, filter, search and paging params, asserts 200, returns `{ tickets, total }`), `listTickets(request, params)` (the same, returning only `tickets`), `expectInOrder(tickets, ids)` (the ids are listed in that relative order), `searchOverride(field, token)` (puts a token into one field) `expectAllContain(tickets, text)` (every row holds the text in subject, sender name or email), `expectRowsMatch(tickets, filters)` and `expectFilter(request, filters, id, subject, listed)` (the filter keeps or drops the ticket, and every row of a page of 100 matches), `createTicketsWithToken(request, token, labels)` (one ticket per label, subject `<token> <label>`), and inside the download describe `downloadPath`, `createTicketWithFile`, `download` and `expectSafeHeaders`.
- `replies.spec.ts` keeps its own `currentUserId(request)`, `listReplies(request, ticketId)` (GET, asserts 200 and exactly `{ replies }`) and `postReply(request, ticketId, body)` (POST, asserts 201 and exactly `{ reply }`), and for files `replyForm(fields, files?, fileField?)` (builds the `FormData`), `fileOfSize(filename, size)`, `filesNamed(count)`, `listedFile(filename, contentType, size)` (the expected listing), `sendForm` (POST, returns the response), `postForm` (POST, asserts 201 and exactly `{ reply }`), `download`, `ticketAttachments`, `expectJsonError(res, status, error)` and `expectNothingStored(request, ticketId)`, which only it uses.
- Helpers are plain exported functions: no page objects and no `test.extend` fixtures.
- **`global-setup.ts`:** runs the test-DB guard, `prisma migrate reset --force`, the admin seed, then `seed-agent.ts`. Each run starts with two users who can sign in, the admin and the agent, plus the AI system agent (`ai-agent`) inserted by a migration, which has no credential account.
- **`write-ticket.ts`:** run by the DB helpers in `fixtures/tickets.ts` with `execSync` from `server/` with only `.env.test` loaded (like the global-setup steps). It refuses any database not ending in `_test`, then, through the server's Prisma client (imported by a non-literal path), deletes all tickets (`E2E_DELETE_ALL_TICKETS`) and/or, for `E2E_TICKET_ID`, sets `status`, `createdAt`, `resolvedAt`, `assignedToId` (`E2E_TICKET_STATUS`, `E2E_TICKET_CREATED_AT`, `E2E_TICKET_RESOLVED_AT` (ISO or `null`), `E2E_TICKET_ASSIGNED_TO_ID` (a user id or `null`)) and/or adds an `ai` reply authored by `ai-agent` (`E2E_AI_REPLY_BODY`).
- **`seed-agent.ts`:** creates the agent through Better Auth's `internalAdapter`, like `prisma/seed.ts` creates the admin. It reads the credentials from `E2E_AGENT_*` environment variables and skips if the agent already exists.
- **`global-teardown.ts`:** only logs. It leaves `helpdesk_test` intact for debugging.
- Specs import helpers as `../fixtures/auth.js` (`global-setup.ts` as `./fixtures/auth.js`), because the root tsconfig rejects `.ts` import extensions (TS5097).
- There is no `setup` project with a saved `storageState`: the logout tests revoke sessions, so each test signs in for itself.

## Not covered

- **Pure dialog and table UI on `/users`:** the table's headers, cells and per-role Edit/Delete buttons, the load-error alert, the Edit dialog's pre-fill, its field errors and 409 message, and the Delete dialog's text, Cancel, admin-row absence and failed-delete alert are covered by the Vitest component tests (`UsersPage.test.tsx`, `UserForm.test.tsx`, `DeleteUserDialog.test.tsx`), not E2E. E2E keeps the flows that need the real server: create, the full lifecycle, the password changes, deleted users, and the API.
- **Client-only login and routing logic:** login form validation (empty form, malformed emails, empty password, errors clearing), the "Signing in…" pending state, retry after a failed attempt, navbar link visibility per role, and client-side route redirects (other unauthenticated paths, a signed-in user on `/login` or an unknown route) are covered by the Vitest component tests (`LoginPage.test.tsx`, `Navbar.test.tsx`, `App.test.tsx`), not E2E. The unknown-email case is covered at the API by `api-auth.spec.ts`.
- **Rate limiting and the per-account sign-in throttle:** production-only and off under `NODE_ENV=test`. Testing them needs a separate `webServer` with `NODE_ENV=production`.
- **Origin/CSRF checks:** Better Auth sets `skipOriginCheck` to `true` when `isTest()`, which also skips CSRF. Testing them needs a server configured to keep those checks on.
- **A role demotion taking effect on the next request:** needs a direct DB role change; PATCH `/api/users/:id` doesn't change roles.
- **The loading skeleton and "No users yet." states on `/users`:** not tested. The empty state can't happen with the seeded users, and holding the request only to see the loading skeleton adds little.
- **Create-user error paths:** the New user dialog's field errors, the 409 on a taken email, the "Creating…" pending state, and POST `/api/users` 400s are not tested; only happy paths were requested. The guard (401/403) and the 409 for a deleted user's email are covered.
- **Editing a user's role:** PATCH accepts only name, email and password, so there is nothing to test.
- **Deleting an admin through the UI:** admin rows have no delete button, so it's covered only at the API (403).
- **The "Deleting…" pending state:** not tested; it would need holding the DELETE request.
- **Stored webhook tickets, beyond the returned fields:** GET `/api/tickets/:id` returns `body` and `bodyHTML` (checked in `tickets.spec.ts`), but never `messageId`, so that can't be checked as stored. That a missing or blank subject is listed as `"(no subject)"` and that a dedupe adds no second row aren't checked; that a 400 stores nothing is checked only for the length-limit cases.
- **Subject length limit (998):** 998 characters plus a NUL gets 201, but no webhook test covers 999 real characters → 400 `"subject is too long"`.
- **Length limits measured after trim:** a value padded with whitespace past the limit isn't tested (nor that `bodyHTML`, which isn't trimmed, counts its whitespace).
- **The `/tickets` page UI:** the table's headers, rows and order, the category label, the empty, loading and error states, and the Tickets navbar link are covered by the Vitest component tests (`client/src/pages/TicketsPage.test.tsx`, `client/src/components/Navbar.test.tsx`), not E2E. The client redirect of an unauthenticated `/tickets` visit and the navbar link navigating there are covered in `client/src/App.test.tsx`; the server side is covered by the GET `/api/tickets` 401. E2E keeps the API tests, which need the real server and database.
- **Sort order of status and category values:** the sorting tests predate PATCH status/category and still check only the 200 and the newest-first tie-break. The enum declaration order (open < resolved < closed; general_question < technical_question < refund_request) and nulls-last for category could now be tested by setting values through PATCH; not added since it wasn't requested.
- **Filtering on every status and category:** one test shows a ticket PATCHed to `resolved` / `refund_request` is listed under those filters. `closed`, `general_question` and `technical_question` are still only shown to exclude open, unclassified tickets.
- **Collation-sensitive subject order:** the sorting tests use subjects that differ only in a final capital letter, so they pass under any Postgres collation; mixed case, accents and punctuation aren't tested.
- **The P2002 fallback specifically:** the concurrent test fires two posts at once and checks the outcome (one 201, one 200, same id), but can't force which path answers the 200, the `findUnique` lookup or the unique-constraint catch.
- **Pagination UI and the count/page consistency under concurrent writes:** the table's paging controls are covered by Vitest, not E2E. That `total` and the page come from one `$transaction` can't be observed from a serial test.
- **Search ranking, multi-word and accent handling:** `q` is one case-insensitive substring over four fields; tokens aren't split, results aren't ranked, and accent-insensitive matching isn't tested (Postgres `ILIKE` doesn't fold accents).
- **Search on `body` rows:** the list doesn't return `body`, so the body-search test can only check which ids come back, not the matched text.
- **The assignment UI on the detail page:** covered by component tests, not E2E.
- **Concurrent assignment:** two PATCHes racing on one ticket (last write wins) can't be observed from a serial test.
- **The replies UI on the detail page** (`ReplyThread`, `ReplyForm`): covered by component tests, not E2E.
- **The replies `id asc` tie-break:** two replies with the same `createdAt` can't be forced from a serial test. Customer replies (`author: null`, non-null `bodyHTML`) are now created through the webhook and checked in `webhook.spec.ts`.
- **Threading edge cases not requested:** a ticket set to `closed` (only `resolved` is tested; the route reopens any non-open status), a threaded reply without a `messageId` (stored, but can't be deduped), concurrent redelivery of a reply (the P2002 path), and a reply whose `inReplyTo` and `references` point at different tickets (the route takes the first `findFirst` match) aren't tested.
- **Emailing replies through the mailer:** with `MAILER_URL` and `MAILER_SECRET` set, POST stores a reply as `emailStatus: "pending"` and a pg-boss job sends it (`sent` with `sentAt`, or `failed`). `server/.env.test` sets neither, so E2E only sees the unconfigured path (`null`/`null`); the send job belongs in server unit tests (`sendReplyEmail.test.ts`). Testing it end to end would need a stub mailer and a separate `webServer` with those variables.
- **Cascade delete of replies with their ticket:** there is no endpoint that deletes tickets.
- **A body padded with whitespace past 10,000 characters:** whether the length limit applies to the trimmed text isn't tested.
- **The polish and summary success paths:** a 200 `{ body }` or `{ summary }` from OpenAI needs `OPENAI_API_KEY` on the test server and a real (or stubbed) model call; deliberately not tested. What `loadTicketContext` passes to the model (latest 20 replies, oldest first, plain-text bodies) isn't observable through the API either; that belongs in server unit tests. The polish UI in `ReplyForm` and the summary UI (`TicketSummary`) belong in component tests.
- **The auto-resolve pipeline itself:** the webhook creating `new` tickets, the pg-boss job moving them through `processing` to `resolved` (with an `ai` reply) or `open`, needs `OPENAI_API_KEY` and a model call; E2E runs without the key, so the webhook tests still expect `open`. The pipeline's logic belongs in server unit tests. The E2E tests only cover how the API treats those states once written. That includes the AI system agent: the webhook assigning new tickets to `ai-agent`, and `openForAgent` unassigning it when the AI escalates or fails, need the key, so those belong in server unit tests; E2E writes the AI assignment to the DB and checks the listing, PATCH, detail and webhook-reopen rules around it.
- **The migration's backfill:** `20261103120000_add_ai_agent` also sets `authorId` on old `ai` replies and assigns old AI-resolved tickets to `ai-agent`; it runs on an empty database in E2E, so it's untested.
- **`resolvedAt` from AI auto-resolve:** the worker stamping it when it resolves a ticket needs `OPENAI_API_KEY`; belongs in server unit tests. The stats tests write the AI's result (status + `ai` reply) directly.
- **The dashboard UI:** covered by component tests, not E2E, including its period picker.
- **Exact period boundaries:** a ticket exactly at the period's first midnight isn't tested; the tz test places tickets 30 minutes either side of it in `Asia/Tokyo`.
- **Days across a DST change:** no test places tickets on the day a zone changes its clocks (23- or 25-hour days); the zones used for bucketing (`Asia/Tokyo`, Warsaw for a 23:30 UTC ticket that lands on the next day at either offset) make the assertions hold either way.
- **NUL cases not requested:** a threaded reply's `body` or `bodyHTML` with a NUL, a `references` entry with a NUL that matches a ticket, a blank `body` with a `bodyHTML` of only NUL, a `messageId`, `inReplyTo` or `references` entry of only NUL, and NUL in `senderEmail` (not stripped; the schema's email check should refuse it with a 400).
- **Attachments in the UI:** `AttachmentList`, inline `cid:` images and `emailHtml.ts` belong in component tests, not E2E.
- **The mailer's side of attachments:** which files it sends, and which it leaves out as too large, is in `mailer/src/inbound.test.ts`.
- **Emailing a reply's files:** `sendReplyEmail` and the mailer's `/send` need a mailer, which E2E runs without; they're in `sendReplyEmail.test.ts` and `mailer/src/outbound.test.ts`.
- **Cleaning a reply's filename and type:** `attachmentFilenameSchema` and `attachmentContentTypeSchema` are covered through the webhook in `webhook.spec.ts`; not repeated for multipart, and not requested.
- **The order of the upload checks against the other errors:** a bad ticket id, or a missing ticket, combined with an over-limit upload (the upload checks answer first) isn't tested.
- **Filenames passed to the AI jobs:** the webhook adds them to the queued job only with `OPENAI_API_KEY`, so that needs server unit tests.
- **Concurrent redelivery with attachments:** only sequential redelivery is tested; the P2002 path can't be forced from a serial test.
- **Attachments going with their ticket:** the cascade is only exercised by the stats tests' table wipe, which checks nothing about attachments, and there is no endpoint that deletes tickets.
- **The rag proxy itself:** listing, uploading, downloading (`GET /api/rag/documents/:id/file`: the file, its `Content-Disposition`/`nosniff`/`CSP: sandbox` headers, a missing document) and deleting documents, upload errors (400/413), and the id validation on DELETE and the file download need a running rag service, or at least `RAG_URL`/`RAG_SECRET` on the test server; E2E runs without them, and the router's 503 answers before any of that. The proxy logic is in `server/src/lib/rag.test.ts`. Testing it end to end would need a stub rag service and a separate `webServer` with those variables.
- **Not built yet:** an inbound email provider adapter, restoring a deleted user, ticket creation through the API and updates to content (subject, body; PATCH ignores unknown fields), AI features other than reply polishing, ticket summaries, classification and auto-resolving, and email.

## Open questions

- **No return-to after login:** a user bounced from a deep link (e.g. `/users`) lands on `/` after signing in, not on the page they asked for. `routing.spec.ts` records this behaviour. If a return-to redirect is added, that test needs updating.
- **A deleted user's email stays reserved:** POST and PATCH still see soft-deleted users, so the email can't be reused (409), and nothing in the UI shows why. `users.spec.ts` records this.
- **The detail returns the sender's raw HTML:** GET and PATCH `/api/tickets/:id` now include `bodyHTML` unsanitized (a `<script>` and `onclick` come back as sent), so the client must sanitize before rendering. `tickets.spec.ts` records this; sanitizing on the client is a component-test concern. `messageId` is still not exposed, so it stays unchecked as stored.
- **Resolved: assignment goes through the API.** The DB-writing `e2e/assign-ticket.ts` and `assignTicketInDb` were removed; the `assignedTo` detail tests now assign with PATCH `/api/tickets/:id`.
- **Resolved: deleting an agent unassigns their tickets** (DELETE `/api/users/:id`, same transaction as `deletedAt`); `users.spec.ts` covers it. The detail test that showed a deleted assignee was removed, since that state can no longer be produced through the API.
- **A deleted assignee would still show on a ticket assigned before that rule:** GET `/api/tickets/:id` still skips the `deletedAt` filter for `assignedTo` (per the route comment), for rows left over from before the unassign. Not tested: reaching that state needs a direct DB write.
- **An `assignedToId` pointing at no user returns `assignedTo: null`:** the column has no foreign key, so a dangling id is indistinguishable from unassigned. Not tested.
- **Resolved: the ticket list is paginated** (`page`, `pageSize`, `{ tickets, total }`), and `tickets.spec.ts` now narrows each list with `q` or `pageSize=100`.
- **"Every row matches" checks cover one page:** filter and sort checks over all rows look at the first 100 tickets only, since `pageSize` is capped at 100. Enough for the test DB today; walking every page would be needed if it grows past that.
- **Subject and sender sorting follow the database collation:** the order of mixed-case or accented values depends on `helpdesk_test`'s collation, which may differ from production's. Not asserted.
- **Resolved: no varied-ticket seed needed.** PATCH now sets status and category, so tests can make the tickets they need through the API; one filter test does.
- **Unknown PATCH fields are dropped silently:** zod strips them, so `{ subject: "x" }` alone gets the empty-body 400 (`tickets.spec.ts` records this), while `{ status, subject }` would get 200 with the subject ignored (not tested). A `.strict()` schema would reject them instead, if wanted.
- **Search is a sequential `ILIKE` scan:** the route comment says so; fine at this size, a trigram index or full-text search if the table grows. Not something a test checks.
- **A soft-deleted agent stays shown as a reply's author:** GET `/api/tickets/:id/replies` doesn't filter `deletedAt` on `author`, the same display-only rule as `assignedTo`. `replies.spec.ts` records this.
- **A reply's `bodyHTML` is raw sender HTML:** customer replies from the webhook store it unsanitized, like the ticket's, and GET replies returns it as sent (`webhook.spec.ts` records this). `ReplyThread` renders it only through `DOMPurify.sanitize`, covered in `ReplyThread.test.tsx`.
- **Threading doesn't check the sender:** any email naming a known Message-ID becomes a customer reply on that ticket, whoever sent it (the route comment allows for CC'd senders), and the reply stores no sender address. Not asserted either way.
- **Replies are stored only in E2E:** without a mailer configured, POST answers 201 with `emailStatus` and `sentAt` null and nothing is sent or queued. The tests record that; they also depend on `MAILER_URL`/`MAILER_SECRET` being absent from the shell `webServer` inherits, like the `OPENAI_API_KEY` caveat below.
- **Resolved: the webhook parser runs after the secret check.** `index.ts` mounts `requireWebhookSecret, express.json({ limit: "35mb" }), webhookRouter` together, so an unauthenticated caller gets 401 before any body is read. Not tested that the body is unread.
- **The polish and summary 503 tests depend on the key being absent:** `webServer` inherits the shell's environment, so a `OPENAI_API_KEY` exported in the shell (or added to `server/.env.test`) would turn them into real OpenAI calls and fail them.
- **PATCH on a `new`/`processing` ticket:** the schema refuses setting those statuses, but nothing stops an agent from PATCHing a ticket the AI is still processing (e.g. to `open`, reachable through the detail link), which could race with the job. Not tested either way.
- **Direct DB writes are back:** `write-ticket.ts` writes states the API can't produce in E2E. If a test endpoint or a stubbed model ever lets the pipeline run, these tests should switch to it.
- **The stats tests empty the ticket table:** `ticket-stats.spec.ts` deletes every ticket before each counting test, so after a run `helpdesk_test` holds only tickets from that spec onward. Other specs find their own rows by unique values and don't notice. The alternative would be a stats endpoint scoped by some filter, which the app doesn't have.
- **An offset `tz` like `+09:00` is likely bucketed backwards:** the schema accepts anything `Intl.DateTimeFormat` does, and Bun accepts `+09:00`, but Postgres reads that string in `AT TIME ZONE` as a POSIX zone, where positive offsets are west of Greenwich (UTC-9). `ticket-stats.spec.ts` asserts either a 400 or Tokyo's buckets, so it should fail until the schema rejects offsets (e.g. require a `/` or `UTC`, or compare against `Intl.supportedValuesOf('timeZone')`) or the route converts them. Not confirmed by a run.
- **`open` ignores the period:** `?period=7d` still counts open tickets of any age, so the dashboard mixes a period-limited total with an all-time open count. `ticket-stats.spec.ts` records this as specified.
- **`resolvedByAi` counts a ticket an agent finished after an AI reply:** any resolved/closed ticket with an `ai` reply counts, even if the AI escalated and an agent resolved it later (only possible if the AI replied without resolving, which the pipeline doesn't do today). Not tested either way.
- **Tickets resolved before the migration have no `resolvedAt`:** they're left out of the average (tested: a resolved ticket with null `resolvedAt` is ignored), so the average reflects only tickets finished since the column existed.
- **Every `ai` reply now has the AI as author:** the pipeline sets `authorId: ai-agent` and the migration backfills old ones, so `author` is no longer null for `sender: ai`; `replies.spec.ts` records this. Code telling an AI reply apart by a null author would break, but the project rule is to use `sender` anyway.
- **A threaded reply unassigns the AI even from an open ticket:** the webhook's `updateMany` on `assignedToId: ai-agent` runs whatever the status. Only the resolved case is tested.
- **The attachment limits are MiB, not MB:** `MAX_ATTACHMENT_BYTES` is 10 × 1024 × 1024, and body-parser reads `35mb` as 35 × 1024 × 1024. The boundary tests use those exact values.
- **A missing `body` key is still a 400 with attachments:** only a blank `body` is accepted. `webhook.spec.ts` records this; the mailer sends the key blank.
- **`(no text)` is stored in `body`:** so `?q=no text` finds attachment-only tickets, and an agent sees that text where the email had none. Not tested.
- **Resolved: text fields are cleaned of NUL.** `inboundEmailSchema` strips it from `senderName`, `subject`, `body`, `bodyHTML`, `messageId`, `inReplyTo` and each `references` entry; `webhook.spec.ts` covers it. Not confirmed by a run yet.
- **The large-request tests are the slowest in the suite:** the 10 MiB, 25 MiB and 35 MiB tests send their payloads through the Vite proxy and use `test.slow()`. The 413 relies on body-parser reading off the whole request before answering (`dump` in `lib/read.js`). Not confirmed by a run.
- **A reply's upload errors are the libraries' English text:** `uploadAttachments` passes on multer's and busboy's messages (`File too large`, `Unexpected file field`, `Unexpected end of form`), so `replies.spec.ts` would fail on a reworded message after a multer upgrade, and an agent could see that text. Mapping them to our own messages would make the tests and the wording stable. The status, JSON shape and messages were checked against multer 2.5.0 under Bun and through a Vite proxy in a throwaway server with no database, not in a suite run.
- **The 18 MiB total is checked after the upload is in memory:** multer buffers up to 10 files of 10 MiB, so any signed-in user can make one request hold 100 MiB before the 413. Not tested.
- **`Attachment`'s schema comment still says "customer's email":** agents' files use the same model now. Nothing a test sees.
- **The rag 503 tests depend on the variables being absent:** like the `OPENAI_API_KEY` caveat, a `RAG_URL` and `RAG_SECRET` exported in the shell `webServer` inherits (or added to `server/.env.test`) would turn the admin tests into calls to the rag service.
- **The 503 answers before the id is checked:** an admin DELETE with a malformed id gets 503, not 400, while the service is unconfigured. Not tested; the tests use a valid UUID.
- **App changes needed:** likely one, for the `tz=+09:00` stats test (see the offset-`tz` entry above). Every locator uses an accessible label, role or text.
