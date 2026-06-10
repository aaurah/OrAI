---
name: Express 5 TS7030 fix
description: How to fix "not all code paths return a value" in Express 5 async route handlers
---

## Rule
All early returns in Express 5 async route handlers must use `return void res.status(X).json(Y)` — never `return res.status(X).json(Y)`.

**Why:** Express 5 handler type is `async (req, res) => void`. `res.status().json()` returns `Response`, so `return res.status().json()` makes some branches return `Response` while others return `undefined` — TS7030 fires. `return void expr` always evaluates to `undefined`, making all branches consistent.

**How to apply:** Any time you write `return res.status(...)...` inside an async route handler, prefix with `void`: `return void res.status(...).json(...)`. Same applies to `return res.json(...)`, `return res.send(...)`, and `return notConnected(res)`.

**Bulk fix:** `sed -i 's/return res\.status(/return void res.status(/g' <file>` plus a separate pass for `return res.json(` and `return res.send(`.
