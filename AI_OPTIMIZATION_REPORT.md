# AI Optimization Report

> DRAFT: edit every section in your own words and keep only what is true for you.

## 1. Tools & Prompting
Claude was used for scaffolding, schema design, service-layer structure, test generation and UI styling. (Add: how you prompted, what you changed.)

## 2. Flawed / Broken AI Code
1. **Secure cookie flag broke auth over HTTP.** Generated code set `secure: NODE_ENV === 'production'`. A production build served over plain HTTP silently dropped the session cookie, so every call returned 401. Found with cURL; now `secure` is tied to HTTPS hosts (`VERCEL`) / an explicit env flag.
2. **Embedded DB crashed on a fresh clone.** The file-backed Postgres path assumed `./.data` existed, so the first login returned 500. Found in the server log; the directory is now created before the DB opens.
3. (Add your own finds: e.g. contrast defects, client-side-only validation, numeric coercion like `Number("")`.)

## 3. Human Refactoring
- Moved all rules out of route handlers into one service layer so there is a single place to audit.
- Recompute traffic-light flags on the server from stored counts instead of trusting a client-sent status.
- Strict numeric guards that accept only real JSON integers (no `"50"`, `1.5`, `-1`).
- Added DB-level defences: CHECK constraints, row locks, an append-only audit trigger.

## 4. Defensive Architecture
Role check → input validation → transaction with `SELECT … FOR UPDATE` → state check → write. Role is re-read from the DB per request. The sewing query hard-codes `status = 'VERIFIED'`. Verifier identity and timestamp are server-derived.
