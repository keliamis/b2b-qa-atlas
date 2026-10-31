# QA Atlas 0.7.6 — login HTTP 500 / PostgreSQL SQLSTATE 42702

**Root cause:** `ON CONFLICT(key) DO UPDATE SET count=count+1` makes `count` ambiguous in PostgreSQL: both the existing `login_attempts` row and `EXCLUDED` have this column.

**Fix:** qualify the existing row: `count=login_attempts.count+1` in all three rate-limit operations: login, registration, and password recovery. This expression also works in SQLite. No database schema migration or data deletion is required.

**Files changed:** `backend/src/auth.mjs`, `backend/src/recovery.mjs`, `package.json`, `tests/login-counter-pg.test.mjs`, this release note.

**Checks:** 9 focused Node.js tests passed (including counter increment and sign-in on SQLite, and static validation of the three PostgreSQL queries). JavaScript syntax validated. Live PostgreSQL/Docker integration was not run in this environment.

**Upgrade:** back up your current project data, replace project files from the ZIP while retaining your existing `.env` and Docker volumes, then run `docker compose up -d --build backend` (or `docker compose up -d --build` for the full stack). Retry login. If a different SQLSTATE error appears, inspect `docker compose logs --since=2m backend`.

**Do not execute:** `docker compose down -v`.
