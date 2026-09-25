# E2E test summary

## Last run

- **Date:** 2026-09-25
- **Discovered (`--list`):** 143 tests in 7 files (api-auth 16, login 6, routing 5, session 7, tickets 70, users 22, webhook 17)
- **Result:** not run since the page-size change (default `pageSize` 20 -> 10).
- **Before that change (2026-09-25):** 143 passed, 0 failed, 28.0s (chromium).

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
- PATCH on a deleted user gets 404 `{"error":"User not found"}`.
- POST `/api/users` with a deleted user's email gets 409 "A user with this email already exists", and the email doesn't reappear in the list.

## tests/webhook.spec.ts

POST `/api/webhooks/inbound-email`. The route returns only `{"ticket":{"id":<number>}}`, so these tests check the response, not the stored row.

- No `X-Inbound-Secret` header gets 401 `{"error":"Unauthorized"}`.
- A wrong secret gets 401 `{"error":"Unauthorized"}`.
- A wrong secret of the same length (last character changed) gets 401, so the `timingSafeEqual` path is exercised, not just the length check.
- A signed-in admin (session checked valid at `/api/me`) without the secret gets 401: a session doesn't count.
- A valid email gets 201 `{"ticket":{"id":<number>}}`.
- An email without a subject gets 201.
- An email with a blank subject gets 201.
- An email with `bodyHTML` and a `messageId` gets 201.
- The same `messageId` posted twice gets 201, then 200 with the same id.
- Two concurrent posts with the same new `messageId` get one 201 and one 200, with the same id.
- Two identical posts without a `messageId` get 201 each, with distinct ids.
- 400 with the schema message for: missing senderEmail, invalid senderEmail, missing senderName, missing body (one test each).
- Malformed JSON gets a JSON 400 with no HTML and no stack frames.
- A body over 100 kB gets 413 with a JSON `{"error":...}`.

## tests/tickets.spec.ts

GET `/api/tickets` only. Other specs create tickets too and the list is paginated (10 by default, `DEFAULT_TICKET_PAGE_SIZE`), so each test narrows the list to its own tickets with `q=<unique token>`, or uses `pageSize=100` when a check covers every row. They compare relative order, never positions or counts, except where `q` makes the matching set exactly the test's tickets.

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

Filtering (`status`, `category` query params). The webhook creates only open, unclassified tickets, so each test checks that a filter (narrowed by `q` to the ticket's subject) keeps or drops the test's own ticket, and that every row of a page of 100 under that filter matches; other values may return an empty list.

- Without a session, both valid and invalid filter params get 401 `{"error":"Unauthorized"}`.
- `status=open` lists the new ticket, and every row has status `open`.
- `category=unclassified` lists the new ticket, and every row has `category` null.
- `status=resolved` and `status=closed` (one test each) exclude the new ticket, and every row has that status.
- `category=general_question`, `technical_question`, `refund_request` (one test each) exclude the new ticket, and every row has that category.
- Combined: `status=open&category=unclassified` lists the ticket with every row matching both; `open` + `refund_request` and `resolved` + `unclassified` exclude it, with every row matching both.
- `status=open&category=unclassified&sortBy=subject` with `asc` and `desc` (one test each): three tickets created B, C, A are listed A, B, C or C, B, A, and every row matches the filters.
- `status=pending`, `Open` (case-sensitive), `unclassified` (a category value) and an empty `status=` (one test each) get 400 `{"error":"status must be one of: open, resolved, closed"}`.
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
  - `users.spec.ts` keeps its own `userRow`, `openNewUserDialog`, `submitNewUser`, `openEditDialog`, `openDeleteDialog` and `postSignIn`, which only it uses.
- **`fixtures/webhook.ts`:** `inboundSecret()` reads `INBOUND_EMAIL_SECRET` from `server/.env.test` (the file `start:test` loads) with `node:util`'s `parseEnv`, so the tests and the server share one value. It reads lazily and throws a clear error if the value is missing, so other specs still load. `webhook.spec.ts` keeps its own `validEmail` (unique sender per call), `uniqueMessageId`, `postInbound`, `expectUnauthorized` and `expectCreated`.
- **`fixtures/tickets.ts`:** `createTicketViaWebhook(request, label, overrides?)` posts a unique email (subject `E2E <label> <suffix>`, unique sender, body `Please help.`) to the inbound webhook with the secret, asserts 201 and returns the ticket's `id`, `subject`, `senderName` and `senderEmail`. `overrides` sets `subject`, `senderName`, `senderEmail` or `body` exactly, for the sorting and search tests. The defaults contain no `%`, `_` or `\`. It needs no session. `tickets.spec.ts` keeps its own `getTicketPage(request, params)` (GET with sort, filter, search and paging params, asserts 200, returns `{ tickets, total }`), `listTickets(request, params)` (the same, returning only `tickets`), `expectInOrder(tickets, ids)` (the ids are listed in that relative order), `searchOverride(field, token)` (puts a token into one field) `expectAllContain(tickets, text)` (every row holds the text in subject, sender name or email), `expectRowsMatch(tickets, filters)` and `expectFilter(request, filters, id, subject, listed)` (the filter keeps or drops the ticket, and every row of a page of 100 matches), and `createTicketsWithToken(request, token, labels)` (one ticket per label, subject `<token> <label>`).
- Helpers are plain exported functions: no page objects and no `test.extend` fixtures.
- **`global-setup.ts`:** runs the test-DB guard, `prisma migrate reset --force`, the admin seed, then `seed-agent.ts`. Each run starts with two users: the admin and the agent.
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
- **Stored webhook tickets, beyond the list fields:** GET `/api/tickets` now shows subject, sender, status and category (checked in `tickets.spec.ts`), but not `body`, `bodyHTML`, `messageId` or `assignedToId`, so those can't be checked as stored. `webhook.spec.ts` still checks only responses: that a missing or blank subject is listed as `"(no subject)"`, that a dedupe adds no second row, and that a 400 creates nothing could now be checked through the list but haven't been added.
- **The `/tickets` page UI:** the table's headers, rows and order, the category label, the empty, loading and error states, and the Tickets navbar link are covered by the Vitest component tests (`client/src/pages/TicketsPage.test.tsx`, `client/src/components/Navbar.test.tsx`), not E2E. The client redirect of an unauthenticated `/tickets` visit and the navbar link navigating there are covered in `client/src/App.test.tsx`; the server side is covered by the GET `/api/tickets` 401. E2E keeps the API tests, which need the real server and database.
- **Sort order of status and category values:** the webhook creates only `open`, unclassified tickets and no endpoint changes status or category, so the enum declaration order (open < resolved < closed; general_question < technical_question < refund_request) and nulls-last for category can't be observed. Only the 200 and the newest-first tie-break are checked. Covering them needs ticket update endpoints (or classification) to exist.
- **Filtering on statuses and categories that exist:** no ticket in `helpdesk_test` is ever resolved, closed or classified (the webhook creates only open, unclassified tickets, no endpoint changes them, and the tests don't write to the DB directly). So `status=resolved|closed` and each real category are only shown to exclude open, unclassified tickets, not to include matching ones, and combined filters are never checked against a mixed set. A test-only seed of varied tickets in global setup (like `seed-agent.ts`, via Prisma) would cover this now; ticket update endpoints would make it possible through the API later.
- **Collation-sensitive subject order:** the sorting tests use subjects that differ only in a final capital letter, so they pass under any Postgres collation; mixed case, accents and punctuation aren't tested.
- **The P2002 fallback specifically:** the concurrent test fires two posts at once and checks the outcome (one 201, one 200, same id), but can't force which path answers the 200, the `findUnique` lookup or the unique-constraint catch.
- **Pagination UI and the count/page consistency under concurrent writes:** the table's paging controls are covered by Vitest, not E2E. That `total` and the page come from one `$transaction` can't be observed from a serial test.
- **Search ranking, multi-word and accent handling:** `q` is one case-insensitive substring over four fields; tokens aren't split, results aren't ranked, and accent-insensitive matching isn't tested (Postgres `ILIKE` doesn't fold accents).
- **Search on `body` rows:** the list doesn't return `body`, so the body-search test can only check which ids come back, not the matched text.
- **Not built yet:** restoring a deleted user, ticket CRUD beyond webhook creation and the list (detail, update, assignment), AI features, email, and the dashboard.

## Open questions

- **No return-to after login:** a user bounced from a deep link (e.g. `/users`) lands on `/` after signing in, not on the page they asked for. `routing.spec.ts` records this behaviour. If a return-to redirect is added, that test needs updating.
- **A deleted user's email stays reserved:** POST and PATCH still see soft-deleted users, so the email can't be reused (409), and nothing in the UI shows why. `users.spec.ts` records this.
- **Webhook storage is only partly observable:** GET `/api/tickets` exposes the list fields; the body fields need a ticket detail endpoint (planned with ticket CRUD).
- **Resolved: the ticket list is paginated** (`page`, `pageSize`, `{ tickets, total }`), and `tickets.spec.ts` now narrows each list with `q` or `pageSize=100`.
- **"Every row matches" checks cover one page:** filter and sort checks over all rows look at the first 100 tickets only, since `pageSize` is capped at 100. Enough for the test DB today; walking every page would be needed if it grows past that.
- **Subject and sender sorting follow the database collation:** the order of mixed-case or accented values depends on `helpdesk_test`'s collation, which may differ from production's. Not asserted.
- **Varied-ticket seed for E2E:** whether to add a test-only seed of tickets with every status and category to global setup, so the filter tests (and the status/category sort order) can check inclusion, not just exclusion. Not added.
- **Search is a sequential `ILIKE` scan:** the route comment says so; fine at this size, a trigram index or full-text search if the table grows. Not something a test checks.
- **App changes needed:** none to run the current suite. Every locator uses an accessible label, role or text.
