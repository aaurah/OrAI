---
name: Vite config PORT guard
description: PORT and BASE_PATH must have fallback defaults in vite.config.ts so pnpm run build works without env vars
---

## Rule
Never throw unconditionally when PORT or BASE_PATH are missing in vite.config.ts. Use defaults:

```ts
const port = process.env.PORT ? Number(process.env.PORT) : 5173;
if (process.env.PORT && (Number.isNaN(port) || port <= 0)) throw new Error(...);
const basePath = process.env.BASE_PATH ?? "/";
```

**Why:** `pnpm run build` runs vite build without the workflow env vars set. A hard throw makes the entire workspace build fail. The PORT is only used for `server.port` / `preview.port` — irrelevant at build time.

**How to apply:** Both `artifacts/cloud-ide/vite.config.ts` and `artifacts/mockup-sandbox/vite.config.ts` use this pattern. Apply the same to any new vite app added to the workspace.
