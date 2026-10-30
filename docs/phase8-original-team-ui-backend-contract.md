# Phase 8: source-authoritative Team / Settings integration contract

**Source of truth:** pinned `apps/hisabiq-web/src/settings/TeamSettings.tsx`, `EmployeeDirectory.tsx`, `TenantSettingsPage.tsx` and associated `settings/ui` components. Do not create new tables, cards, filters, forms, or dialogs to imitate them.

## Verified API / original UI differences

| Original HisabIQ UI behavior | Current BanijjIQ backend | Required action |
|---|---|---|
| Employee list: search by name, email, role; status and role filters; joined-date range; 10/25/50 pagination; column control; access detail | `GET /api/users` returns id/name/mobile/single role/status/createdAt; no email or joinedDate | Use **original EmployeeDirectory** for display; add email and independently sourced joined date to backend before allowing their edits/filters to imply they are populated. No replacement table. |
| Add employee: name, email, joined date, assigned roles, active flag; draft save | `POST /api/users` requires name, **mobile**, **password**, one role | Backend must support secure invite/onboarding or account activation matching the original workflow. Never synthesize a phone/password or skip original form inputs. |
| Edit employee: one or more assigned roles | `PUT /api/users/:id` accepts name/mobile/one role; deactivation is separate `PUT /api/users/:id/status` | Implement persisted role-assignment bridge, tenant RBAC and protected-admin checks before enabling original multi-role editor. |
| Role editor: `permissionCatalogue`, impact review, explicit confirmation, section save, delete unused | `/api/roles` uses module/view/add/edit/delete/backdate matrix and immediate persistence | Define explicit lossless permission mapping, support original draft/commit and protected role operations on backend; no default-all, no implicit privilege widening. |
| Original access UI permissions `user.account.*` / `user.role.*` | Backend permissions `users.*` / `roles.*` | Map only verified actions, do not infer grants from generic view or misrepresent active permissions. |
| Original TenantSettingsProvider uses browser demo fixtures / localStorage | Backend authoritative Cloudflare D1 | Never import a sample team as live. Read-only GET is a safe first integration slice; prevent all simulated writes until backend parity is tested. |
| Password reset | Backend `POST /api/users/:id/reset-password`; original Team Settings has **no reset-password dialog** | **Do not add new reset UI.** Backend endpoint can remain protected/covered by tests; a new frontend action needs explicit user approval. |

## Implementation order

1. Keep the exact source components and visual design pinned. Add failing source-parity Playwright tests for the real route; inspect results.
2. Add backend migration + authenticated APIs for missing **email, joined date and invitation/onboarding** semantics, with negative, duplicate, role and security tests. Verify against real migrated SQLite / isolated Worker D1.
3. Implement tested **multi-role assignment and effective RBAC** without privilege escalation, last-admin removal or session leakage. A role change revokes relevant sessions.
4. Implement **permission mapping, change-impact, draft save and deletes** compatible with the original Team UI. Preserve D1 atomicity and audit records; no unsupported silent field truncation.
5. Connect source `TeamSettings`/`EmployeeDirectory` and original `TenantSettingsPage` actions to these APIs through data adapters. **Do not replace markup**. Only remove demo data after real responses are available; fail closed on 401/403/5xx.
6. Verify source-equivalent 390/1440 screenshots, keyboard/accessibility behavior, authenticated end-to-end CRUD, DB persistence and rollback. Exact-head CI **and independent security review** precede merge.

## Open PR handling

- #85: delegated RBAC security, no independent review. Keep hold.
- #103: administrator role creation implemented with a separately authored live Team page; do not merge until source alignment and write semantics are reconciled.
- #112: separately authored employee edit/status UI; keep draft and realign to the original Team flow.
- #115: separately authored password-reset action not present in original Team UI. Keep draft; **cancel frontend addition pending explicit approval**, retain server-side security tests as an independent backend change if appropriate.

No remote D1 migration, hosted deployment or production release follows from this document.
