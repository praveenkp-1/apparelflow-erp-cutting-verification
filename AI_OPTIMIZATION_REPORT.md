# AI Optimization Report

**Project:** ApparelFlow Cutting Operations & Gatekeeper Verification Terminal
**Author:** Kp (KP Solutions)

I used AI heavily during development of this project, primarily for scaffolding, implementation, testing, debugging, and UI development. I did not treat generated code as automatically correct. I ran the application, inspected the implementation, tested the server behaviour, and refactored areas where the generated approach was incorrect or insufficient.

The central engineering principle I maintained throughout the project was:

> **The browser is never a security boundary.**

Client-side controls improve usability, but authorization, validation, state transitions, and the sewing-queue gate are enforced by the server and, where appropriate, the database.

---

## 1. Tools & Prompting

### AI tool used

**Claude (Anthropic)** was the primary AI tool used during development. No other AI coding tools were used.

I provided Claude with the ApparelFlow assessment requirements and used it as an implementation and review assistant rather than treating its generated output as production-ready code.

| Task                   | How AI was used                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture           | Helped structure the application into domain rules, service-layer business logic, API routes, database access, and UI components.                            |
| Database/schema design | Drafted the relational schema, relationships, constraints, seed data, and audit-log structure.                                                               |
| Business logic         | Assisted with the component multiplier engine, GREEN/YELLOW/RED traffic-light rules, wastage calculation, and state transitions.                             |
| API implementation     | Generated initial route handlers and service-layer implementations for authentication, orders, verification, rejection, resubmission, and sewing operations. |
| Test generation        | Generated the initial automated test coverage and additional defensive/edge-case tests.                                                                      |
| Styling                | Assisted with global CSS and UI component styling, including the assessment's contrast requirements.                                                         |
| Debugging              | Helped interpret server errors and cURL results during end-to-end testing.                                                                                   |

### Prompting approach

I supplied the assessment requirements to Claude and asked it to implement the complete Cutting Operations & Gatekeeper Verification Terminal.

I then independently checked the generated implementation against the specification and tested the application rather than assuming that passing unit tests meant the system was correct.

The main verification steps included:

* Running the automated Vitest suite.
* Inspecting server-side service functions.
* Testing API behaviour.
* Testing invalid input.
* Testing role restrictions.
* Testing RED/shortage approval blocking.
* Checking the sewing-queue filtering.
* Checking persistence and deployment behaviour.
* Reviewing database constraints and audit protections.

Although Claude proposed implementation approaches, I made the final engineering decisions regarding the security model and verified that the implementation matched the assessment requirements.

---

## 2. Flawed / Broken AI Code

AI-generated code was not accepted blindly. During development I identified problems that only became visible when the application was executed outside the isolated unit-test environment.

### Flaw 1: Production cookie configuration broke authentication over HTTP

The initial AI-generated authentication configuration used a production-mode check similar to:

```ts
secure: process.env.NODE_ENV === 'production'
```

The problem was that the application could be started using a production build with:

```text
next start
```

while still being accessed through plain:

```text
http://localhost
```

The browser/client then treated the session cookie as HTTPS-only. Login could return successfully, but subsequent authenticated requests did not contain the cookie and therefore returned `401 Unauthorized`.

This was particularly important because the failure was environment-dependent. The authentication logic itself appeared correct, and service-layer unit tests did not exercise the browser's cookie behaviour.

### How I found it

I performed an HTTP-level smoke test using cURL against the running production server. The login request succeeded, but subsequent authenticated requests returned `401`.

### Human fix

The cookie configuration was changed to use deployment/environment configuration rather than simply assuming that every production build is served over HTTPS:

```ts
secure:
  process.env.VERCEL === '1' ||
  process.env.COOKIE_SECURE === 'true'
```

This allows local HTTP development while enabling secure cookies in the deployed environment.

---

### Flaw 2: File-backed embedded database failed on a fresh checkout

The initial AI-generated database setup attempted to open the file-backed PGlite database under:

```text
./.data/pg
```

without guaranteeing that the parent `.data` directory existed.

This meant that a fresh checkout could fail when the application attempted to initialize the database. The application could therefore fail before an evaluator could even log in.

### How I found it

I tested the application from a clean environment rather than relying only on the in-memory test database. The server produced a filesystem/database initialization error because the expected `.data` directory had not been created.

### Human fix

The database initialization was hardened so the directory is created before opening the file-backed database:

```ts
mkdirSync('./.data', { recursive: true });
```

This makes the local file-backed database initialization deterministic on a fresh checkout.

---

### Flaw 3: Unit tests initially gave incomplete confidence

Another important lesson was that passing service-layer tests did not automatically prove that the deployed HTTP application was correct.

The unit/integration tests create an in-memory database:

```ts
createDb({ memory: true })
```

and call service functions directly.

That is excellent for testing domain rules, but it does not exercise every part of the real HTTP path, including:

* session-cookie behaviour,
* browser/client cookie handling,
* production database initialization,
* actual HTTP request/response handling,
* deployment environment configuration.

This is how the authentication and fresh-database problems could exist even while the core tests passed.

### Human action

I therefore treated the automated tests as one layer of verification rather than the entire verification process. I also performed application-level HTTP testing and inspected the server behaviour in the deployed/runtime environment.

---

### AI-generated failure modes I specifically guarded against

I also reviewed the implementation for common weaknesses that are particularly dangerous in AI-generated business applications.

#### Client-trusted verification status

The server does not trust a GREEN/YELLOW/RED value supplied by the browser.

At approval time, the service reads the stored expected and actual quantities and recomputes the flag:

```ts
flagFor(i.actual_qty, i.expected_qty)
```

Therefore a client cannot simply submit a forged `GREEN` status to bypass a shortage.

#### Loose numeric coercion

The application does not use loose conversion such as:

```ts
Number("")
Number("50")
```

to decide whether a value is valid.

The server requires actual integer values and rejects invalid values such as:

* negative numbers,
* decimals,
* numeric strings,
* null values,
* invalid/empty payloads.

The automated defensive tests explicitly verify these cases.

#### Concurrent approval decisions

A simple read-then-write implementation could allow two requests to attempt to decide the same order concurrently.

The implementation therefore locks the order with:

```sql
SELECT ...
FROM cutting_orders
...
FOR UPDATE
```

and checks that the order is still:

```text
PENDING_VERIFICATION
```

inside the transaction.

This prevents an already-decided order from being decided again.

---

## 3. Human Refactoring & Engineering Decisions

After reviewing the generated implementation, I made the following architectural and security decisions.

### 3.1 Centralized business rules

Business rules are concentrated in the service layer rather than duplicated across API routes.

The service layer is responsible for:

* role authorization,
* input validation,
* order creation,
* component counting,
* approval,
* rejection,
* resubmission,
* sewing-queue access,
* sewing state transitions.

API routes primarily handle HTTP input/output and delegate business decisions to the service layer.

This gives the security-critical rules one central location to review.

### 3.2 Server-side verification of every component

Approval does not trust the browser's traffic-light state.

The server checks that:

1. Every required component has been counted.
2. No component has a RED/shortage result.
3. The order is still in `PENDING_VERIFICATION`.
4. The authenticated user has the verifier role.

Only then can the order transition to `VERIFIED`.

### 3.3 Strict server-side validation

The UI provides immediate validation feedback, but the server independently validates every important value.

For example, order quantities must be positive whole numbers, while component actual quantities must be non-negative whole numbers.

The tests explicitly verify rejection of:

```text
-1
1.5
"3"
null
```

and invalid/empty order payloads.

This prevents the frontend from becoming the only validation layer.

### 3.4 Database constraints

Important invariants are also represented in the database schema.

Examples include:

* valid user roles,
* positive production quantities,
* positive fabric usage,
* valid order states,
* valid verification states,
* unique order/component relationships,
* valid verification decisions,
* mandatory rejection notes.

This provides another defensive layer if application code is accidentally changed later.

### 3.5 Environment-aware authentication

The authentication implementation uses an HTTP-only session cookie and does not expose the JWT to browser JavaScript.

The JWT identifies the user, but the application re-reads the user's identity and role from the database for each authenticated request.

Therefore the server does not permanently trust an old role embedded in a token.

### 3.6 Database transaction and row locking

Security-sensitive state transitions run inside database transactions.

For approval/rejection, the order is locked and its current state is checked before the decision is written.

This prevents duplicate or conflicting decisions when multiple requests target the same order.

### 3.7 Accessibility and contrast

The assessment explicitly identifies low-contrast form controls as a zero-tolerance defect.

I therefore reviewed the form controls and styling to ensure that text remains readable against the input background in normal and focused states.

---

## 4. Defensive Architecture

### State machine

The application implements the following controlled production flow:

```text
PENDING_VERIFICATION
        |
        | approve
        | all components counted
        | no RED components
        v
     VERIFIED
        |
        | start sewing
        v
SEWING_IN_PROGRESS
```

A rejected order follows:

```text
PENDING_VERIFICATION
        |
        | reject + mandatory reason
        v
     REJECTED
        |
        | supervisor resubmits
        v
PENDING_VERIFICATION
```

There is no generic endpoint that allows a client to submit an arbitrary status.

Every state transition checks the existing state before changing it.

For example:

* A second approval attempt returns `409`.
* A second rejection attempt returns `409`.
* Starting sewing on an unverified order is rejected.
* Only a rejected order can be resubmitted.

---

### Layered server/database guards

| Rule                                               | Enforcement                                      |
| -------------------------------------------------- | ------------------------------------------------ |
| Wrong role cannot approve/reject/count             | Service-layer RBAC returns `403`                 |
| Only supervisor can create orders                  | Server-side role check                           |
| Sewing supervisor cannot access cutting-order list | Server-side role check                           |
| RED component blocks approval                      | Server recomputes flags and returns `422`        |
| Uncounted component blocks approval                | Server returns `422`                             |
| Rejection requires a reason                        | Server validation plus database CHECK constraint |
| Sewing queue only contains verified orders         | SQL hard-codes `WHERE o.status = 'VERIFIED'`     |
| Sewing cannot start an unverified order            | Transactional status check                       |
| Verifier identity                                  | Taken from authenticated server-side user        |
| Verification timestamp                             | Generated by the database                        |
| Audit records cannot be updated/deleted            | Database trigger                                 |
| Duplicate decisions                                | Row lock plus state check inside transaction     |
| Invalid numeric input                              | Server-side strict validation                    |
| Client cannot choose verification status           | Server recomputes status from stored quantities  |

---

## Automated Test Coverage

The final test suite contains **13 tests**.

### Domain tests

* Component multiplier calculation.
* GREEN/YELLOW/RED traffic-light rules.
* Fabric wastage calculation.

### Required assessment tests

* GREEN order can be approved.
* YELLOW/excess order can still be approved.
* RED/shortage order is blocked with `422`.
* Uncounted components are blocked with `422`.
* Rejection without a reason is rejected.
* Non-verifier roles receive `403`.
* Only the appropriate roles can access order/queue operations.
* Unapproved orders never appear in the sewing queue.

### Defensive tests

* Negative, decimal, string and null quantities are rejected.
* Orders cannot be decided twice.
* Verification audit records cannot be modified or deleted.
* Sewing can only start from a `VERIFIED` order.

These tests provide automated coverage for the core gatekeeper and RBAC requirements rather than testing only the UI.

---

## 5. Known Limitations

This project was built for the practical assessment and is not intended to claim that every production-security feature of a commercial ERP has been implemented.

Known limitations include:

* Rate limiting and account lockout are not implemented.
* Demo users share the known evaluation password by design.
* A production deployment would require proper individual credentials, password rotation, monitoring, and operational security controls.
* The database trigger protects the audit table against application/database-session UPDATE and DELETE operations, but a database administrator with sufficient privileges can ultimately modify the database schema itself.
* The application implements the requested checkpoint rather than the complete 23-module ApparelFlow ERP.

These limitations do not remove the server-side gatekeeper implemented for the assessment; they identify areas that would require additional engineering in a larger production deployment.

---

## Conclusion

AI significantly accelerated development of the ApparelFlow checkpoint, but the final implementation was not accepted solely because AI generated it.

The important engineering work was reviewing the generated code, running it in realistic environments, identifying failures that unit tests did not expose, and enforcing the critical business rules on the server and database.

The final design therefore treats AI as an engineering assistant rather than a security authority.

The most important principle throughout the project remained:

> **The browser is never a security boundary.**
