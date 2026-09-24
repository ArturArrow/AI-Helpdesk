# E2E test summary

## Last run

- **Date:** 2026-09-24
- **Discovered (`--list`):** 85 tests in 5 files
- **Result:** 85 passed, 0 failed, 41.9s (chromium, 1 worker), after adding the create-user tests (New user dialog, full UI lifecycle, POST `/api/users`).
- **Previous result, from before this change:** 82 passed, 0 failed, 37.4s (chromium, 1 worker).

## tests/login.spec.ts

- The admin signs in through the UI, lands on `/`, and sees the navbar (Helpdesk, the Users link, their name, Sign out).
- The agent signs in through the UI, lands on `/`, and sees the navbar without the Users link.
- An upper-cased email signs in (Better Auth lower-cases the lookup).
- While the sign-in request is held, the button reads "Signing in…" and is disabled.
- An empty form shows both field errors and sets `aria-invalid="true"` on both fields. No sign-in request is sent.
- Malformed emails (`not-an-email`, `missing-domain@`, `@example.com`, `a b@example.com`) show only the email error. No request is sent.
- A valid email with an empty password shows only the password error. No request is sent.
- Field errors clear as each field is corrected, then sign-in succeeds.
- A wrong password shows "Invalid email or password". The user stays on `/login` and no navbar appears.
- An unknown email shows the same error as a wrong password.
- An upper-cased email with a wrong password is still rejected.
- The password is case-sensitive.
- After a failed attempt, retrying with the right password signs in.
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

- Unauthenticated visits to `/`, `/users`, `/users/some-id`, `/tickets/42?tab=replies` and `/does-not-exist` redirect to `/login` (5 tests).
- After being bounced from `/users`, signing in lands on `/` (the app has no return-to).
- A signed-in admin visiting `/login` is sent to `/`. The same test runs for the agent.
- A signed-in user on an unknown route is sent to `/`.
- The admin clicks the Users link and reaches `/users`.
- The admin opens `/users` directly.
- The agent has no Users link and is redirected from `/users` to `/`.
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
- The admin on `/users` sees a table with the column headers Name, Email, Role, Created and Actions (screen-reader only), and one row each for the admin and the agent, with name, email, role, a date and an `Edit <name>` button. The agent row has a `Delete <name>` button and the admin row doesn't. No alert is shown.
- When `/api/users` is intercepted with a 500, the page shows the alert "Couldn't load users: Request failed (500)" and no table.
- New user dialog: opens from "New user" with the "Create an agent account." hint. Name, an upper-cased email and a password submit with 201, the dialog closes, and the row shows the name, lower-cased email, role `agent` and a date, also after a reload. The new user signs in through the API and `/api/me` returns 200 with their name, email and role `agent`.
- Full lifecycle through the UI: create in the New user dialog, see the row, rename and change the email in the Edit dialog, delete in the Delete dialog. After a reload neither email is listed, the agent's row remains, and the created id is gone from GET `/api/users`.
- Admin POST `/api/users` returns 201 with exactly `id`, `name`, `email`, `role`, `createdAt`, the name trimmed, the email lower-cased and role `agent`. GET `/api/users` then lists the same user.
- Edit dialog: opens from `Edit <name>` titled "Edit user", with the blank-password hint, the row's name and email, and an empty password.
- Edit dialog: changing name and (upper-cased) email closes the dialog, the row shows the new name and lower-cased email, the old email is gone, and both hold after a reload.
- Edit dialog: saving with a blank password keeps the old password working, and the user's existing session still gets 200 from `/api/me`.
- Edit dialog: a new password ends the user's existing session (`/api/me` 401), the old password gets 401 and the new one signs in.
- Edit dialog: a 2-character name, `not-an-email` and a 5-character password show the three field errors with `aria-invalid="true"`. The dialog stays open, no PATCH is sent, and the row is unchanged after a reload.
- Edit dialog: changing the email to the agent's gets a 409 and shows "A user with this email already exists" under the email field. The dialog stays open and nothing changes.
- Admin PATCH `/api/users/:id` returns 200 with exactly `id`, `name`, `email`, `role`, `createdAt`, the name trimmed and the email lower-cased.
- Admin PATCH with a short name, an invalid email or a short password gets 400 with the schema message, and the user is unchanged.
- Admin PATCH on an unknown id gets 404 `{"error":"User not found"}`.
- PATCH as the agent gets 403 and unauthenticated gets 401. The user is unchanged and still signs in with the original password.
- Delete dialog: opens from `Delete <name>` titled "Delete user", with "Delete <name> (<email>)? They will be signed out and won't be able to sign in.", enabled Cancel and Delete buttons, and no alert.
- Delete dialog: the admin row has an `Edit` button but no `Delete…` button.
- Delete dialog: Delete gets a 204, the dialog closes, the row is gone (the agent's stays), and it stays gone after a reload.
- Delete dialog: Cancel closes the dialog, sends no DELETE, and the row is still there after a reload.
- Delete dialog: if the user is deleted elsewhere while the dialog is open, Delete shows the server's "User not found" alert and the dialog stays open.
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
  - `users.spec.ts` keeps its own `userRow`, `openNewUserDialog`, `submitNewUser`, `openEditDialog`, `openDeleteDialog`, `trackRequests` and `postSignIn`, which only it uses.
- Helpers are plain exported functions: no page objects and no `test.extend` fixtures. `login.spec.ts` keeps its own `trackSignInRequests`, which only the validation tests use.
- **`global-setup.ts`:** runs the test-DB guard, `prisma migrate reset --force`, the admin seed, then `seed-agent.ts`. Each run starts with two users: the admin and the agent.
- **`seed-agent.ts`:** creates the agent through Better Auth's `internalAdapter`, like `prisma/seed.ts` creates the admin. It reads the credentials from `E2E_AGENT_*` environment variables and skips if the agent already exists.
- **`global-teardown.ts`:** only logs. It leaves `helpdesk_test` intact for debugging.
- Specs import helpers as `../fixtures/auth.js` (`global-setup.ts` as `./fixtures/auth.js`), because the root tsconfig rejects `.ts` import extensions (TS5097).
- There is no `setup` project with a saved `storageState`: the logout tests revoke sessions, so each test signs in for itself.

## Not covered

- **Rate limiting and the per-account sign-in throttle:** production-only and off under `NODE_ENV=test`. Testing them needs a separate `webServer` with `NODE_ENV=production`.
- **Origin/CSRF checks:** Better Auth sets `skipOriginCheck` to `true` when `isTest()`, which also skips CSRF. Testing them needs a server configured to keep those checks on.
- **A role demotion taking effect on the next request:** needs a direct DB role change; PATCH `/api/users/:id` doesn't change roles.
- **The loading skeleton and "No users yet." states on `/users`:** not tested. The empty state can't happen with the seeded users, and holding the request only to see the loading skeleton adds little.
- **Create-user error paths:** the New user dialog's field errors, the 409 on a taken email, the "Creating…" pending state, and POST `/api/users` 400s are not tested; only happy paths were requested. The guard (401/403) and the 409 for a deleted user's email are covered.
- **Editing a user's role:** PATCH accepts only name, email and password, so there is nothing to test.
- **Deleting an admin through the UI:** admin rows have no delete button, so it's covered only at the API (403).
- **The "Deleting…" pending state:** not tested; it would need holding the DELETE request.
- **Not built yet:** restoring a deleted user, ticket CRUD, AI features, email, and the dashboard.

## Open questions

- **No return-to after login:** a user bounced from a deep link (e.g. `/users`) lands on `/` after signing in, not on the page they asked for. `routing.spec.ts` records this behaviour. If a return-to redirect is added, that test needs updating.
- **A deleted user's email stays reserved:** POST and PATCH still see soft-deleted users, so the email can't be reused (409), and nothing in the UI shows why. `users.spec.ts` records this.
- **App changes needed:** none. Every locator uses an accessible label, role or text.
