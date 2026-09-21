# E2E test summary

## Last run

- **Date:** 2026-09-21
- **Discovered (`--list`):** 56 tests in 5 files
- **Result:** not run since the user list tests were added (`users.spec.ts`, updated `/api/users` guard).
- **Previous result (before this change):** 52 passed, 0 failed, 22.5s (chromium, 1 worker).

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
- The `/api/users` guard, for GET `/api/users`, GET `/api/users/:id`, POST `/api/users` and DELETE `/api/users/:id` (4 tests): 401 unauthenticated and 403 for the agent on all four. The admin gets 200 on GET `/api/users` and 404 on the other three (they pass the guard, but no such routes exist).
- POST `/api/auth/sign-up/email` returns 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`, and the credentials can't sign in afterwards.
- A sign-up with `role: "admin"` in the payload is refused and creates no account.
- An agent's `{role:"admin"}` to `/api/auth/update-user` gets 400 "role is not allowed to be set", and `/api/me` still says agent.
- A `role` sent together with `name` is refused as a whole.
- A malformed JSON body to `/api/users` gets a JSON 400 with no HTML and no stack frames. One test each unauthenticated and as admin.

## tests/users.spec.ts

- Admin GET `/api/users` returns 200 with a `users` array that holds the seeded admin (role `admin`) and agent (role `agent`). Every user has exactly `id`, `name`, `email`, `role`, `createdAt`, and `createdAt` parses as a date.
- `/api/users` is ordered by `createdAt` ascending.
- The admin on `/users` sees a table with the column headers Name, Email, Role, Created and one row each for the admin and the agent, with name, email, role and a date. No alert is shown.
- When `/api/users` is intercepted with a 500, the page shows the alert "Couldn't load users: Request failed (500)" and no table.

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
  - Helpers are plain exported functions: no page objects and no `test.extend` fixtures. `login.spec.ts` keeps its own `trackSignInRequests`, which only the validation tests use.
- **`global-setup.ts`:** runs the test-DB guard, `prisma migrate reset --force`, the admin seed, then `seed-agent.ts`. Each run starts with two users: the admin and the agent.
- **`seed-agent.ts`:** creates the agent through Better Auth's `internalAdapter`, like `prisma/seed.ts` creates the admin. It reads the credentials from `E2E_AGENT_*` environment variables and skips if the agent already exists.
- **`global-teardown.ts`:** only logs. It leaves `helpdesk_test` intact for debugging.
- Specs import helpers as `../fixtures/auth.js` (`global-setup.ts` as `./fixtures/auth.js`), because the root tsconfig rejects `.ts` import extensions (TS5097).
- There is no `setup` project with a saved `storageState`: the logout tests revoke sessions, so each test signs in for itself.

## Not covered

- **Rate limiting and the per-account sign-in throttle:** production-only and off under `NODE_ENV=test`. Testing them needs a separate `webServer` with `NODE_ENV=production`.
- **Origin/CSRF checks:** Better Auth sets `skipOriginCheck` to `true` when `isTest()`, which also skips CSRF. Testing them needs a server configured to keep those checks on.
- **A role demotion taking effect on the next request:** needs a direct DB role change, and there is no endpoint for it yet.
- **The "Loading…" and "No users yet." states on `/users`:** not tested. The empty state can't happen with the seeded users, and holding the request only to see "Loading…" adds little.
- **Not built yet:** the rest of admin user management (creating, editing and deleting users; only the list exists), ticket CRUD, AI features, email, and the dashboard.

## Open questions

- **No return-to after login:** a user bounced from a deep link (e.g. `/users`) lands on `/` after signing in, not on the page they asked for. `routing.spec.ts` records this behaviour. If a return-to redirect is added, that test needs updating.
- **App changes needed:** none. Every locator uses an accessible label, role or text.
