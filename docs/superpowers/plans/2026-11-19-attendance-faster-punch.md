# Faster Punch In / Punch Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Punch In / Punch Out in about 1–3 s instead of 8–20 s, with imprecise punches (over 100 m) marked "low precision".

**Architecture:** Browser-only change in `src/lib/attendance.ts` (capture timing) and `src/components/attendance/AttendancePage.tsx`
(display, no duplicate reload). The server limit (1000 m) and the database stay as they are.

**Tech Stack:** React, browser Geolocation API, Playwright browser test.

**Spec:** `docs/superpowers/specs/2026-11-19-attendance-faster-punch-design.md`

## Global Constraints
- Branch `claude/attendance-faster-punch` from `origin/main`; one PR; no migration.
- Values: target `100` m, settle `3000` ms after the first reading, overall timeout `10000` ms, `enableHighAccuracy: true`, `maximumAge: 0`.
- Mark text: `low precision` (lower case), shown when `accuracy > 100`.
- Success text: `Punched in at <time> (location within <n> m).`, with ` · low precision` before the `)` when over 100 m.

## Review Focus
1. A device that never answers: refused with the existing TIMEOUT help after about 10 s, nothing recorded.
2. A first reading of 5 km (network/IP): still refused by the 1000 m limit, never marked and saved.
3. A first reading of 350 m then a 40 m one within 3 s: the 40 m one is saved, not marked.
4. A punch on a device whose clock is wrong: unchanged (server time).
5. Double click during the shorter wait: still one punch (existing request id).

---

### Task 1: Faster capture, low-precision mark, no duplicate reload

**Files:**
- Modify: `src/lib/attendance.ts` (`captureLocation` defaults; new `export const PRECISE_M = 100` and `export const isLowPrecision = (accuracy: number | null | undefined) => accuracy != null && accuracy > PRECISE_M`)
- Modify: `src/components/attendance/AttendancePage.tsx` (location line at :49, detail at :224, success text at :86, drop the `load()` at :87)
- Test: `supabase/tests/ui_attendance.test.mjs`, `docs/ATTENDANCE_PUNCH.md`, `docs-site/content/hr/attendance-monitoring.md`

- [ ] **Step 1: Write the failing browser checks** (Playwright geolocation emulation, the existing harness):
  `a 12 m reading: punched within 2 seconds of the click` (measure click → success notice);
  `a 350 m reading: saved within 5 seconds, the notice and the card say "low precision"`;
  `a 5 km reading: still refused` (existing check kept);
  `HR's register marks a punch over 100 m "low precision"` (the stub register gets one punch with accuracy 350).
- [ ] **Step 2: Run** `node supabase/tests/ui_attendance.test.mjs` — Expected: FAIL (timing / missing mark).
- [ ] **Step 3: Implement** the defaults, `PRECISE_M`, `isLowPrecision`, the mark in the location line and detail, the success text, and remove the immediate `load()` after a punch (keep `resolvePlaces().then(load)`).
- [ ] **Step 4: Run** the browser test, `npm run typecheck`, `bash supabase/tests/run-unit.sh`, `npm run build`, `npm run docs:check` — Expected: all pass.
- [ ] **Step 5: Docs** — `ATTENDANCE_PUNCH.md`: the new timing, the mark, "strict 100 m: set max_location_accuracy_m to 100"; HR page: what "low precision" means. Commit, merge `origin/main`, push, open the PR (no migration).
