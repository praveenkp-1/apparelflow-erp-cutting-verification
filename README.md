# ApparelFlow: Cutting Operations & Gatekeeper Verification Terminal

Full-stack implementation of the Webtezza Software Engineering Intern practical challenge.

**Stack:** Next.js 15 (App Router) · PostgreSQL / PGlite · JWT Sessions · Vitest

## Live Demo

**Deployed application:** `<YOUR_LIVE_URL>`

The application is deployed and available for end-to-end evaluation.

---

## Demo Credentials

All demo accounts use the password:

```text
Demo@1234
```

| Role               | Email                         |
| ------------------ | ----------------------------- |
| Cutting Supervisor | `supervisor@apparelflow.demo` |
| Cutting Verifier   | `verifier@apparelflow.demo`   |
| Sewing Supervisor  | `sewing@apparelflow.demo`     |

The header provides a one-click role switcher after signing in so evaluators can quickly test each persona.

---

## Quick Start

```bash
npm install
npm run dev
npm test
```

The development server uses an embedded PGlite database when `DATABASE_URL` is not configured. Local database data persists under:

```text
./.data
```

The automated test suite uses an in-memory database.

**Test suite:** 13 automated tests.

---

## Deployment

The application supports deployment using Vercel with a hosted PostgreSQL provider such as Neon or Supabase.

Set the following environment variables:

```text
DATABASE_URL=<PostgreSQL connection string>
JWT_SECRET=<strong random secret>
```

For example, a strong JWT secret can be generated with:

```bash
openssl rand -hex 32
```

Database tables and seed data are created automatically when the application initializes the database.

### Production database requirement

Without `DATABASE_URL`, the application uses a local file-backed database.

This is suitable for local development but **must not be used as the production persistence layer on Vercel**.

For production deployment, configure `DATABASE_URL` to a persistent PostgreSQL database.

---

## Architecture

The application is organized into domain, service, API, authentication, database, and UI layers.

```text
app/
├── api/                  # Thin HTTP API routes
└── page.tsx              # Role-aware application UI

lib/
├── domain.ts             # Pure business/domain rules
├── service.ts            # Business rules and state transitions
├── api.ts                # Authentication/error handling wrapper
├── auth.ts               # Authentication and JWT sessions
├── db.ts                 # Database connection
└── schema.ts             # Database schema and initialization
```

### Domain layer

`lib/domain.ts` contains deterministic rules including:

* Component multiplier calculations
* GREEN / YELLOW / RED traffic-light logic
* Fabric wastage calculation
* Strict numeric validation

### Service layer

`lib/service.ts` contains the application's business rules and state transitions.

Security-sensitive operations:

1. Check the user's role.
2. Validate the input.
3. Lock the relevant order row with `FOR UPDATE`.
4. Verify the current state.
5. Apply the business rule.
6. Commit the state transition and audit information transactionally.

### API layer

`lib/api.ts` provides common API handling, including authentication checks and mapping application errors to HTTP status codes.

API routes under `app/api/` remain intentionally thin and delegate business decisions to the service layer.

### Authentication

`lib/auth.ts` implements:

* bcrypt password verification
* HS256 JWT sessions
* HTTP-only session cookies
* Server-side user lookup
* Role retrieval from the database on authenticated requests

The browser does not directly control the user's authorization role.

---

## Production State Machine

The cutting and sewing workflow follows a controlled state machine:

```text
                 ┌───────────────┐
                 │    REJECTED   │
                 └───────┬───────┘
                         │ resubmit
                         ▼
┌───────────────────────────────┐
│    PENDING_VERIFICATION      │
└───────────────┬───────────────┘
                │
        approve │ all components
                │ GREEN/YELLOW
                ▼
       ┌─────────────────┐
       │     VERIFIED    │
       └────────┬────────┘
                │ start sewing
                ▼
       ┌──────────────────────┐
       │ SEWING_IN_PROGRESS   │
       └──────────────────────┘

PENDING_VERIFICATION
        │
        │ reject + mandatory reason
        ▼
    REJECTED
```

There is no generic client-controlled status update endpoint.

---

## Security Guarantees

| Rule                                  | Enforcement                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Wrong role                            | `403` enforced in the service layer, not only in the UI                                    |
| RED / uncounted component on approval | `422`; flags are recomputed from stored counts on the server                               |
| Reject without reason                 | `400`, backed by a database `CHECK` constraint                                             |
| Sewing queue isolation                | SQL uses `WHERE o.status = 'VERIFIED'`; unapproved orders cannot enter the queue           |
| Verifier identity / timestamp         | Derived from authenticated server context and database-generated timestamp                 |
| Audit trail                           | `verification_logs` is protected by a database trigger against `UPDATE` / `DELETE`         |
| Duplicate decisions                   | `409`; order must still be `PENDING_VERIFICATION` and is row-locked                        |
| Invalid numeric input                 | Server-side validation rejects negative, decimal, string, null, and invalid payload values |
| Sewing transition                     | Only `VERIFIED` orders can enter `SEWING_IN_PROGRESS`                                      |

The browser UI therefore acts as a usability layer rather than the security boundary.

---

## Production Recipes

The database is seeded with production recipes required for end-to-end evaluation, including:

### Casual Blouse

```text
Code: REC-BL01
Category: Blouse
Standard fabric: 1.8 yards / garment
Wastage cap: 5%
```

Components include Front Body Panel, Back Body Panel, Sleeves, Collar & Stand, and Sleeve Cuffs.

### Crop Top

```text
Code: REC-CT02
Category: Crop Top
Standard fabric: 1.1 yards / garment
Wastage cap: 8%
```

Components include Front Chest Panel, Back Support Panel, Neck Binding Strip, Hem Elastic Casing, and Side Strap Accents.

---

## API

### Authentication

```text
POST /api/auth/login
```

### Recipes

```text
GET /api/recipes
```

### Cutting Orders

```text
GET  /api/orders
POST /api/orders
```

### Verification Counts

```text
PUT /api/orders/:id/counts
```

### Verification Decisions

```text
POST /api/orders/:id/approve
POST /api/orders/:id/reject
POST /api/orders/:id/resubmit
```

### Sewing Queue

```text
GET /api/sewing/queue
POST /api/sewing/:id/start
```

All security-sensitive operations are enforced server-side.

---

## Database Schema

The application uses the following relational entities:

```text
users
recipes
recipe_components
cutting_orders
verification_items
verification_logs
```

### Main relationships

```text
recipes
   │
   ├── recipe_components
   │
   └── cutting_orders
          │
          └── verification_items
                    │
                    └── recipe_components

users
   │
   ├── cutting_orders
   │
   └── verification_logs
```

`verification_logs` stores the verifier decision, verifier identity, timestamp, wastage percentage, rejection information, and a JSONB snapshot of component expected/actual/variance information.

The complete schema is defined in:

```text
lib/schema.ts
```

---

## Automated Testing

Run:

```bash
npm test
```

The test suite contains **13 tests** covering the core business rules and defensive behaviour.

Coverage includes:

* Component multiplier calculation
* GREEN / YELLOW / RED evaluation
* Wastage calculation
* GREEN approval
* YELLOW approval
* RED approval blocking
* Uncounted component blocking
* Mandatory rejection reasons
* Server-side RBAC
* Sewing queue isolation
* Defensive numeric validation
* Duplicate decision protection
* Immutable audit logs
* VERIFIED-only sewing transitions

The tests use an in-memory database so they can run independently of the deployed database.

---

## AI-Assisted Development

AI was used extensively during development, primarily through Claude (Anthropic).

AI assistance included:

* Architecture scaffolding
* Database/schema design
* Business-logic implementation
* API implementation
* Test generation
* UI styling
* Debugging

Generated code was manually reviewed and tested. Several issues were discovered during runtime testing and corrected, including authentication cookie
