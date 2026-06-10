# Cloud IDE

A web-based cloud IDE with a full GitHub integration, AI coding assistant, project management, deployments, and DNS management — running as a pnpm monorepo.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/cloud-ide run dev` — run the frontend (port 21471)
- `pnpm run typecheck` — full typecheck across all packages (must be 0 errors)
- `pnpm run build` — typecheck + build all packages (production build)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `OPENAI_API_KEY` — for AI chat

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (named wildcards: `*name` not `*`)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle), Vite 7 (frontend)
- Auth: Clerk (optional, via `CLERK_SECRET_KEY`)
- Logging: pino (structured JSON, pretty-printed in dev)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/api-zod/` — generated Zod validators from the spec
- `lib/api-client-react/` — generated React Query hooks from the spec
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/logger.ts` — pino logger (use in all routes, never `console.*`)
- `artifacts/cloud-ide/src/pages/` — main frontend pages (ide.tsx, github.tsx, etc.)
- `lib/db/src/schema.ts` — Drizzle ORM schema (source of truth for DB)

## Architecture decisions

- **Express 5 wildcards**: path-to-regexp v8 requires named wildcards (`*name`), not bare `*`. Wildcard params may come back as `string[]` — always handle with `Array.isArray()` or `join("/")`.
- **API-first**: all endpoints are defined in `openapi.yaml` first, then codegen produces Zod validators + React Query hooks. Never hand-write validators or hooks.
- **Pino logging**: all server-side logging uses `import { logger } from "../lib/logger"`. No `console.log/warn/error` in route handlers.
- **`return void res.json()`**: Express 5 handlers typed as `async (req, res) => void` — always use `return void res.status(X).json(Y)` for early returns to avoid TS7030.
- **vite.config.ts PORT**: `PORT` and `BASE_PATH` env vars are optional with defaults (`5173`/`5174`, `/`) so `pnpm run build` works without env vars set.
- **XSS escaping**: any user-controlled string interpolated into HTML must go through the `htmlEsc()` helper in `ai.ts`. README snippets are HTML-escaped (`&`, `<`, `>`) before embedding.
- **qs override**: `"pnpm".overrides.qs = ">=6.15.2"` in root `package.json` to fix CVE-2026-8723.

## Product

- **Dashboard** — project stats, recent projects, activity feed
- **Projects** — create/edit/delete projects; live preview of HTML/CSS/JS apps
- **IDE** — Monaco editor, file tree, AI coding assistant with file create/edit/delete actions and image attachment
- **GitHub** — full GitHub integration: repos, branches, commits, PRs, issues, gists, releases, search, push project to repo
- **Deployments** — deploy projects, manage custom domains with DNS record editor and domain verification wizard
- **Settings** — GitHub token management, AI config

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After editing `openapi.yaml`, always run `pnpm --filter @workspace/api-spec run codegen` before typechecking
- After schema changes, run `pnpm --filter @workspace/db run push` to apply to dev DB
- `pnpm run build` requires no PORT/BASE_PATH env vars (uses defaults); dev workflows set them via workflow config
- The two active workflows are **API Server** (port 8080) and **Start application** (port 21471). The `artifacts/*` named workflows are unused stubs.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
