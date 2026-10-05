# ApparelFlow: Cutting Operations & Gatekeeper Verification Terminal

Full-stack implementation of the Webtezza challenge. Next.js 15 (App Router) + Postgres + JWT sessions + Vitest.

## Demo credentials (password for all: `Demo@1234`)
| Role | Email |
|---|---|
| Cutting Supervisor | supervisor@apparelflow.demo |
| Cutting Verifier | verifier@apparelflow.demo |
| Sewing Supervisor | sewing@apparelflow.demo |

The header has a one-click role switcher once signed in.

## Run locally (no setup)
```bash
npm install
npm run dev      # embedded Postgres (PGlite) persists to ./.data
npm test         # 13 tests, in-memory Postgres
```
## Deploy (Vercel + Neon/Supabase)
Set `DATABASE_URL` (Postgres connection string) and `JWT_SECRET` (`openssl rand -hex 32`). Tables and seed data are created automatically on first request.
> Without `DATABASE_URL` the app uses a local file DB, which does **not** persist on Vercel. Always set it in production.

## Architecture
- `lib/domain.ts`: pure rules (multiplier, traffic light, wastage formula, strict numeric guards).
- `lib/service.ts`: every business rule and state transition. Each function checks role first (403), then validates input (400), then locks the order row (`FOR UPDATE`) inside a transaction.
- `lib/api.ts`: route wrapper: 401 if no session, maps errors to status codes.
- `lib/auth.ts`: bcrypt login, HS256 JWT in an httpOnly cookie. Role is re-read from the DB on each request.
- `app/api/*`: thin routes. `app/page.tsx`: role-aware UI.

State machine: `PENDING_VERIFICATION → VERIFIED → SEWING_IN_PROGRESS`, or `PENDING_VERIFICATION → REJECTED → (resubmit) → PENDING_VERIFICATION`.

## Security guarantees
| Rule | Enforcement |
|---|---|
| Wrong role | 403 in the service layer, not the UI |
| RED / uncounted component on approve | 422; flags are recomputed from stored counts on the server |
| Reject without reason | 400, and a DB CHECK constraint backs it up |
| Sewing queue | `WHERE o.status = 'VERIFIED'` hard-coded in SQL; query params ignored |
| Verifier ID / timestamp | from the session and the DB clock, never the request body |
| Audit trail | `verification_logs` is append-only via a DB trigger (UPDATE/DELETE raise) |
| Double decisions | 409 (order must be `PENDING_VERIFICATION`, row-locked) |

## API
`POST /api/auth/login` · `GET /api/recipes` · `GET|POST /api/orders` · `PUT /api/orders/:id/counts` · `POST /api/orders/:id/approve|reject|resubmit` · `GET /api/sewing/queue` · `POST /api/sewing/:id/start`

## Schema
`users`, `recipes`, `recipe_components`, `cutting_orders`, `verification_items`, `verification_logs` (see `lib/schema.ts`). `verification_logs` also stores a `variances` JSONB snapshot of per-component expected/actual/variance.
