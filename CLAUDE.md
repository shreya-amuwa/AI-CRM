# Notes for Claude Code sessions

## Security (read first in any security-related session)

* Start from `docs/security/FINDINGS.md` (open items, owners, rollout notes) and `docs/security/THREAT_MODEL.md`.
  Update FINDINGS.md in the same change as any security fix.
* The database is the security boundary: the browser can call PostgREST directly with its own JWT. Every table needs
  RLS; every user-callable `SECURITY DEFINER` function must check the caller and `set search_path = ''`.
  `supabase/tests/security_invariants_test.sql` enforces this.
* Never put secrets, integration URLs whose path is a credential, or API keys in `src/`, `VITE_*` or `vite.config.ts`.
* File uploads: DB row first, presigned target for that row, server inspection + `StorageRepository.attest`, downloads
  only after a database authorization function.
* Before pushing: `npm run typecheck`, `npm run test:security` (or `test:db`), `npm run test:api`,
  `npm run security:semgrep`. Migrations are rerunnable and applied by hand in the Supabase SQL editor; note the
  deploy order (API first or migration first) in the migration header.
