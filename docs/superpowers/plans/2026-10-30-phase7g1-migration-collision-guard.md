# Phase 7G1 Migration Sequence Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Fail closed before SQLite or Cloudflare D1 applies Phase7 migrations sharing a numeric prefix.

**Architecture:** One dependency-free Node CLI checks filenames in `migrations/`; node:test creates synthetic duplicate/valid directories to test the command's exit status and diagnostics. Existing scripts and GitHub Actions invoke the same CLI.

**Tech Stack:** Node.js 22+, node:test, existing npm and GitHub Actions; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-phase7g1-migration-collision-guard.md`

## Global Constraints
- No migration file renames, database writes, UI changes, or production deployments.
- Reject duplicate numeric prefixes; accept intentional numeric gaps.
- Test-first RED must fail for intended missing diagnostic; GREEN must verify shell nonzero on collision.
- Do not merge without complete exact-head CI and reviewer approval.

## Review Focus
- Two different filenames share the same digits: reject both and list both.
- Same version with leading-zero variations: reject.
- Version gaps in legacy migration history: allow.
- A routine `.sql` file without numeric prefix: the runner ignores it; the guard should not claim it ran.
- Running the command with a nonexistent directory: fail loudly, not silently succeed.

---

### Task 1: Filename preflight
**Files:** `tests/phase7g-migration-sequence.test.mjs`, `scripts/check-migration-sequence.mjs`
- [ ] Write CLI process tests with duplicate, unique-gapped and actual-repo inputs.
- [ ] Observe RED: duplicate-specific diagnostics are missing.
- [ ] Implement minimal filename checking.
- [ ] Verify GREEN, direct CLI check, exit statuses.
- [ ] Commit test-first and implementation separately.

### Task 2: Integrate guard into existing commands
**Files:** `package.json`, `.github/workflows/hisabiq-react-build.yml`
- [ ] Execute the guard via a dedicated test command before CI's backend setup.
- [ ] Prepend preflight to existing local/remote migration scripts.
- [ ] Run backend build and affected Phase4/5 accounting tests.
- [ ] Commit and open DRAFT PR, then verify exact-head CI.
