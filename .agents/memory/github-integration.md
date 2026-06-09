---
name: GitHub Integration Architecture
description: How the GitHub integration works — auth, routes, and frontend
---

**Auth:** Personal Access Token stored in localStorage as `github_token`, sent as `x-github-token` header. Backend also checks `GITHUB_TOKEN` env var as fallback.

**Backend:** `artifacts/api-server/src/routes/github.ts` — 40+ routes proxying GitHub REST API v3. All routes protected by `requireToken` middleware.

**Frontend:** `artifacts/cloud-ide/src/pages/github.tsx` — Single page with tabs: Overview, Repos, Files, Branches, Commits, Issues, PRs, Releases, Actions, Gists, Search, Notifications.

**Why PAT over OAuth:** Replit GitHub connector OAuth flow requires proposeIntegration which exits the agent loop. PAT approach is simpler, works immediately, and gives user full control over scopes.

**Token scope needed:** `repo`, `read:user`, `notifications`, `gist`
