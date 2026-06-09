---
name: Express 5 wildcard routes
description: path-to-regexp v8 wildcard syntax rules — required for all wildcard routes in Express 5
---

In Express 5 with path-to-regexp v8 (router@2.2.0):
- `*` alone → PathError "Missing parameter name"
- `:param(*)` → PathError "Unexpected ("
- **Use `*name`** for named wildcards → access via `req.params.name`

**Why:** path-to-regexp v8 removed anonymous wildcards. All wildcards must be named.

**How to apply:** Any Express route that needs to match remaining path segments:
```typescript
// ✅ Correct
router.get('/files/*filePath', handler); // req.params.filePath
router.delete('/refs/*ref', handler);    // req.params.ref

// ❌ Wrong (will crash on startup)
router.get('/files/*', handler);
router.get('/files/:path(*)', handler);
```
