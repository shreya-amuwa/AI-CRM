# Rules for AI coding agents (Codex, Claude Code and others)

Every agent working in this repository follows these rules. They exist so that several agents (and people) can work at the
same time without breaking `main`, without merge conflicts and without losing anyone's work.

## 1. Branches: never push to `main`

* **Never commit or push to `main`.** `main` changes only by merging a reviewed pull request.
* Start every task from the latest `main`, on a new branch:

  ```bash
  git fetch origin main
  git checkout -b codex/<short-task-name> origin/main      # Codex: codex/...   Claude: claude/...
  ```

* One task = one branch = one pull request. Do not reuse a branch whose pull request is already merged; start a new one from `main`.
* Push only your own branch: `git push -u origin codex/<short-task-name>`.
* Never force-push, rebase or rewrite history on a branch someone else created, and never delete other people's branches.
* Open a pull request into `main` and stop. A person reviews and merges it.

## 2. Before you push: get up to date with `main`

Other agents merge to `main` all the time. Right before pushing (and again if the pull request says "This branch has conflicts"):

```bash
git fetch origin main
git merge origin/main          # a merge commit, not a rebase
```

If there are conflicts, resolve them so that **both sides' work is kept** (see section 4), run the checks (section 6) and push again.

## 3. Database migrations (`supabase/migrations/`)

* **Never edit a migration that is already on `main`.** It may already have been run on the live database. Fix things in a new migration.
* **Name a new migration with a timestamp later than every migration on the latest `main`:** `YYYYMMDDHHMMSS_short_name.sql`.
  Check with `ls supabase/migrations | tail -3` after `git fetch origin main`. Two branches must never use the same timestamp:
  if `main` gets a later one before you merge, rename yours to a newer timestamp.
* Every migration must be **safe to run twice**: `create table if not exists`, `add column if not exists`,
  `create or replace function`, `drop ... if exists` before `create`, `insert ... on conflict do nothing / do update`.
* It must run **pasted as one script in the Supabase SQL editor**. That editor may run each statement on a different connection, so
  **do not use temporary tables** across statements. Use a `with ... as (values ...)` list inside a single statement, or a `do $$ ... $$` block.
* Follow the existing security model: RLS on, no direct table grants to `authenticated` for sensitive tables, access through
  `security definer` functions with `set search_path = ''` that check the caller (`private.*` helpers), errors as
  `raise exception 'NOT_FOUND: ...' / 'VALIDATION_ERROR: ...' / 'FORBIDDEN: ...' / 'CONFLICT: ...'`, and `revoke all ... from public, anon` +
  `grant execute ... to authenticated` after each public function.
* Never delete data or drop columns in a migration unless the task explicitly asks for it.
* In the pull request description, list every migration file that the owner must run in the Supabase SQL editor.

## 4. Avoiding merge conflicts

The files below are edited by almost every task. Conflicts there are normal: resolve them by **keeping both sides**.

| File | How to add to it |
| --- | --- |
| `shared/validation.ts`, `shared/contracts.ts` | Add your new schemas / types in **one block for your feature** with a heading comment. Do not reorder, reformat or rename existing exports. |
| `server/routes.ts`, `server/controllers/index.ts` | Add your routes / handlers next to related ones; never reorder or reformat the rest. |
| `supabase/tests/run.sh` | Add **one line** for your new SQL test file. Never remove another feature's line. |
| `supabase/tests/run-unit.sh` | Add your test name to the `for t in ...` list; keep everyone else's. Remove a name only if your task deletes that test file. |
| `supabase/tests/api_integration.test.ts` | Add your checks as **one `{ ... }` block** just before the final `console.log(... API INTEGRATION CHECKS PASSED ...)` line. After resolving a conflict, check the braces still match (`npx esbuild supabase/tests/api_integration.test.ts --bundle --platform=node --format=esm --packages=external --outfile=/dev/null`). |
| `docs/*.md` | Add a new section for your feature; do not rewrite other sections. |

General rules:

* Change only what the task needs. **No unrelated refactors, renames, reformatting or "clean-ups"** of code you were not asked to touch:
  they cause conflicts with everyone else's branches.
* Keep each pull request small and focused. Large tasks are split into several pull requests.
* Never commit `package-lock.json` changes unless you added or removed a dependency on purpose.
* Never commit `.env` files, keys, tokens, passwords or real customer data.

## 5. Code conventions

* Frontend: React + Vite + Tailwind (`src/`). The client dashboard is `src/client/*` and uses its own `client.css` (`.cd-*` classes).
* API: Hono routes in `server/routes.ts` -> controller (`server/controllers/index.ts`) -> service (`server/services/*`, validates with Zod from
  `shared/validation.ts`) -> repository (`server/repositories/*`, calls the database function). No route trusts an id or a role sent by the browser
  for authorization: the database function checks the caller.
* Validate on both sides: the same Zod schema in the form and in the service; the database function checks again.
* Keep existing financial, invoice, payment, GST and audit behaviour unchanged unless the task is about it.

## 6. Checks to run before every push

```bash
npm ci                 # once
npm run typecheck      # frontend + server
npm run build
npm run test:unit
npm run test:db        # needs a local PostgreSQL (see supabase/tests/run.sh)
npm run test:api       # needs PostgreSQL + PostgREST (see supabase/tests/run-api.sh)
```

The same checks run on GitHub (`.github/workflows/ci.yml`). **Do not push a branch that fails them**, and never skip, delete or weaken a
test to make it pass. If you remove a feature, update the tests that used it (including `supabase/tests/e2e/*`).

## 7. Commits and pull requests

* Commit messages: a short summary line, a blank line, then what changed and why.
* Pull request description: what changed, the migrations to run (if any), and the checks you ran with their results.
* If the pull request shows red checks or "This branch has conflicts", fix it on the **same branch** (section 2) instead of opening a new one.
