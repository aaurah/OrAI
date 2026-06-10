---
name: OpenAPI codegen flow
description: How to add fields to the API contract and propagate them to types and hooks
---

## Rule
The source of truth is `lib/api-spec/openapi.yaml`. After any change:
1. Edit the schema in openapi.yaml
2. Run `pnpm --filter @workspace/api-spec run codegen`
3. This regenerates both Zod validators (`lib/api-zod/`) and React Query hooks (`lib/api-client-react/`)
4. Then run `pnpm run typecheck` to verify

**Why:** Hand-editing generated files is overwritten next codegen run. Generated hooks require `queryKey` in `UseQueryOptions` (TanStack v5) — pass `queryKey: []` as a placeholder when the hook provides its own key internally.

**How to apply:** Adding a new request/response field? Edit openapi.yaml first, codegen second, then fix consuming code. Never add fields only to the Zod schema — they won't appear in the hook types.
