# Implementation Plan

## Phase 1: Project Setup

- [x] Initialize monorepo structure (`/client`, `/server`)
- [x] Set up Express server with TypeScript
- [x] Set up React app with TypeScript
- [x] Set up PostgreSQL database
- [x] Shared `core` workspace for zod schemas used by client and server

## Phase 2: Authentication

- [x] Create login page
- [x] Implement login API endpoint
- [x] Implement session-based authentication middleware
- [x] Implement logout API endpoint
- [x] Add route protection on the frontend (redirect to login if unauthenticated)

## Phase 3: User Management

- [x] Create user management page (admin only) — `/users`, gated by `AdminRoute`
- [x] Implement create agent API endpoint — `POST /api/users`
- [x] Implement list users API endpoint — `GET /api/users`
- [x] Implement edit user API endpoint — `PATCH /api/users/:id`
- [x] Implement delete user API endpoint — soft delete via `deletedAt`, ends sessions
- [x] Add role-based access control (admin vs agent) — `requireAdmin` on server, `AdminRoute` on client
- [x] Component tests (Vitest + RTL)
- [x] E2E tests (Playwright) for auth and user management

## Phase 4: Ticket CRUD

- [x] `Ticket` model (`schema.prisma`: status/category enums, `assignedToId`) — added with the inbound webhook below
- [ ] Implement create ticket API endpoint
- [x] Implement list tickets API endpoint (with filtering by status and category, sorting) — `GET /api/tickets?status=&category=&sortBy=&sortOrder=`
- [x] Implement get ticket API endpoint — `GET /api/tickets/:id` (body, assignee name; no `bodyHTML`)
- [x] Implement update ticket API endpoint (change status, assign agent) — `PATCH /api/tickets/:id` with any of `assignedToId`, `status`, `category`; selects on the detail page
- [x] Create ticket list page with filtering and sorting — `/tickets`, TanStack Table with server-side sorting, status/category filters in the URL
- [x] Create ticket detail page — `/tickets/:id`, opened from the subject in the list; assignee, status and category can be changed there
- [x] Reply thread on the ticket detail page — `Reply` model (`sender`: agent/customer), `GET`/`POST /api/tickets/:id/replies`; replies are stored, not emailed yet

## Phase 5: AI Features

- [ ] Set up Claude API integration
- [ ] Implement auto-classification endpoint (categorize incoming tickets)
- [ ] Implement AI summary endpoint (generate ticket summary)
- [ ] Implement AI suggested reply endpoint
- [ ] Build knowledge base structure and seed with initial content
- [ ] Integrate AI features into ticket detail page UI

## Phase 6: Email Integration

- [ ] Set up email provider (SendGrid/Mailgun)
- [x] Implement inbound email webhook to create tickets — `POST /api/webhooks/inbound-email`, provider-neutral JSON behind `X-Inbound-Secret`; no provider adapter yet
- [ ] Implement outbound email sending when an agent replies (replies are already stored via `POST /api/tickets/:id/replies`)
- [ ] Handle email threading (replies linked to existing tickets) — store them as `Reply` with `sender: customer`

## Phase 7: Dashboard

- [ ] Create dashboard page with ticket overview stats (open, resolved, closed counts)
- [ ] Add tickets by category breakdown
- [ ] Add recent tickets list
- [ ] Add quick filters to navigate to filtered ticket list

## Phase 8: Polish & Deployment

- [ ] Add input validation and error handling across all endpoints
- [ ] Add loading states and error states on the frontend
- [ ] Write Dockerfile for server and client
- [ ] Set up Docker Compose for local development
- [ ] Write deployment configuration