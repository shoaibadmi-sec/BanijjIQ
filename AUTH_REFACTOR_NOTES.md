# Auth + RBAC Refactor

This refactor preserves the existing SherERP API and authentication behavior while moving authentication and RBAC infrastructure out of `server/core/handler.ts`.

## Extracted

- `server/modules/auth/types.ts` — auth/RBAC types
- `server/modules/auth/http.ts` — auth response helpers
- `server/modules/auth/service.ts` — setup, PBKDF2 password hashing, login, sessions, current-user lookup, logout
- `server/modules/auth/permissions.ts` — permission normalization, role permissions, module permission enforcement, delete windows
- `server/modules/auth/routes.ts` — public setup/auth route dispatch

## Preserved behavior

- `/api/setup/status`
- `/api/setup/admin`
- `/api/auth/login`
- `/api/auth/me`
- `/api/auth/logout`
- PBKDF2-SHA256, 100,000 iterations, 16-byte salt, 256-bit output
- bearer-token sessions and session timeout setting
- admin bypass semantics
- role permission JSON format
- delete/backdate permission windows
- existing `/api/users` and `/api/roles` CRUD behavior
- Node + SQLite and Cloudflare + D1 shared business logic

## Also retained

The Node response conversion fix in `server/app.ts` is included so local Hono responses do not hit `ERR_STREAM_WRITE_AFTER_END`.

No frontend file under `src/` was changed.
