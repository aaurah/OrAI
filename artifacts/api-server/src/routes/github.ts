import { Router } from "express";

const router = Router();

const GH_API = "https://api.github.com";

// ── Token helper ─────────────────────────────────────────────────────────────
// Only accept the client-provided token from the request header.
// Never fall back to the server's GITHUB_TOKEN for user-facing requests — that
// would allow any caller to use the server's own credentials.
function getToken(req: any): string {
  return (req.headers["x-github-token"] as string | undefined) ?? "";
}

async function ghFetch(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${GH_API}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

function notConnected(res: any) {
  return void res.status(401).json({
    error: "GitHub not connected",
    message: "Please connect your GitHub account in Settings → GitHub.",
  });
}

// ── Middleware to require token ───────────────────────────────────────────────
function requireToken(req: any, res: any, next: any) {
  const token = getToken(req);
  if (!token) return void notConnected(res);
  (req as any).githubToken = token;
  next();
}

// ── Profile ───────────────────────────────────────────────────────────────────
router.get("/github/user", requireToken, async (req: any, res) => {
  const r = await ghFetch("/user", req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.get("/github/user/orgs", requireToken, async (req: any, res) => {
  const r = await ghFetch("/user/orgs?per_page=100", req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.get("/github/users/:username", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/users/${req.params.username}`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// ── Repositories ──────────────────────────────────────────────────────────────
router.get("/github/repos", requireToken, async (req: any, res) => {
  const { type = "owner", sort = "updated", per_page = 50, page = 1 } = req.query;
  const r = await ghFetch(
    `/user/repos?type=${type}&sort=${sort}&per_page=${per_page}&page=${page}`,
    req.githubToken
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.get("/github/repos/starred", requireToken, async (req: any, res) => {
  const r = await ghFetch("/user/starred?per_page=50&sort=updated", req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.post("/github/repos", requireToken, async (req: any, res) => {
  const r = await ghFetch("/user/repos", req.githubToken, {
    method: "POST",
    body: JSON.stringify(req.body),
  });
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.status(201).json(r.data);
});

router.get("/github/repos/:owner/:repo", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.patch("/github/repos/:owner/:repo", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}`, req.githubToken, {
    method: "PATCH",
    body: JSON.stringify(req.body),
  });
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.delete("/github/repos/:owner/:repo", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}`, req.githubToken, {
    method: "DELETE",
  });
  if (r.status === 204) return void res.status(204).end();
  return void res.status(r.status).json(r.data);
});

// Star / Unstar
router.put("/github/user/starred/:owner/:repo", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/user/starred/${req.params.owner}/${req.params.repo}`, req.githubToken, {
    method: "PUT",
    headers: { "Content-Length": "0" } as any,
  });
  res.status(r.status).end();
});

router.delete("/github/user/starred/:owner/:repo", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/user/starred/${req.params.owner}/${req.params.repo}`, req.githubToken, {
    method: "DELETE",
  });
  res.status(r.status).end();
});

// Check if starred
router.get("/github/user/starred/:owner/:repo", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/user/starred/${req.params.owner}/${req.params.repo}`, req.githubToken);
  res.json({ starred: r.status === 204 });
});

// Fork
router.post("/github/repos/:owner/:repo/forks", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/forks`, req.githubToken, {
    method: "POST",
    body: JSON.stringify(req.body),
  });
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.status(202).json(r.data);
});

// ── Branches ──────────────────────────────────────────────────────────────────
router.get("/github/repos/:owner/:repo/branches", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/branches?per_page=100`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.post("/github/repos/:owner/:repo/git/refs", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/git/refs`, req.githubToken, {
    method: "POST",
    body: JSON.stringify(req.body),
  });
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.status(201).json(r.data);
});

router.delete("/github/repos/:owner/:repo/git/refs/*ref", requireToken, async (req: any, res) => {
  const refPath = (req.params as any).ref ?? "";
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/git/refs/${refPath}`,
    req.githubToken,
    { method: "DELETE" }
  );
  if (r.status === 204) return void res.status(204).end();
  return void res.status(r.status).json(r.data);
});

// Get latest SHA for a branch (used when creating new branch)
router.get("/github/repos/:owner/:repo/branches/:branch", requireToken, async (req: any, res) => {
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/branches/${req.params.branch}`,
    req.githubToken
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// ── Commits ───────────────────────────────────────────────────────────────────
router.get("/github/repos/:owner/:repo/commits", requireToken, async (req: any, res) => {
  const { sha = "", per_page = 30, page = 1 } = req.query;
  const qs = new URLSearchParams({ per_page: String(per_page), page: String(page) });
  if (sha) qs.set("sha", sha as string);
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/commits?${qs}`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.get("/github/repos/:owner/:repo/commits/:sha", requireToken, async (req: any, res) => {
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/commits/${req.params.sha}`,
    req.githubToken
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// ── Issues ────────────────────────────────────────────────────────────────────
router.get("/github/repos/:owner/:repo/issues", requireToken, async (req: any, res) => {
  const { state = "open", per_page = 30, page = 1, labels = "", assignee = "" } = req.query;
  const qs = new URLSearchParams({ state: String(state), per_page: String(per_page), page: String(page) });
  if (labels) qs.set("labels", labels as string);
  if (assignee) qs.set("assignee", assignee as string);
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/issues?${qs}`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  // Filter out PRs (GitHub returns PRs in issues endpoint too)
  const issues = Array.isArray(r.data) ? r.data.filter((i: any) => !i.pull_request) : r.data;
  res.json(issues);
});

router.post("/github/repos/:owner/:repo/issues", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/issues`, req.githubToken, {
    method: "POST",
    body: JSON.stringify(req.body),
  });
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.status(201).json(r.data);
});

router.patch("/github/repos/:owner/:repo/issues/:number", requireToken, async (req: any, res) => {
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/issues/${req.params.number}`,
    req.githubToken,
    { method: "PATCH", body: JSON.stringify(req.body) }
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.get("/github/repos/:owner/:repo/issues/:number/comments", requireToken, async (req: any, res) => {
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/issues/${req.params.number}/comments`,
    req.githubToken
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.post("/github/repos/:owner/:repo/issues/:number/comments", requireToken, async (req: any, res) => {
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/issues/${req.params.number}/comments`,
    req.githubToken,
    { method: "POST", body: JSON.stringify(req.body) }
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.status(201).json(r.data);
});

// Labels
router.get("/github/repos/:owner/:repo/labels", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/labels?per_page=100`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// ── Pull Requests ─────────────────────────────────────────────────────────────
router.get("/github/repos/:owner/:repo/pulls", requireToken, async (req: any, res) => {
  const { state = "open", per_page = 30, page = 1 } = req.query;
  const qs = new URLSearchParams({ state: String(state), per_page: String(per_page), page: String(page) });
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/pulls?${qs}`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.post("/github/repos/:owner/:repo/pulls", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/pulls`, req.githubToken, {
    method: "POST",
    body: JSON.stringify(req.body),
  });
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.status(201).json(r.data);
});

router.get("/github/repos/:owner/:repo/pulls/:number", requireToken, async (req: any, res) => {
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/pulls/${req.params.number}`,
    req.githubToken
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.put("/github/repos/:owner/:repo/pulls/:number/merge", requireToken, async (req: any, res) => {
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/pulls/${req.params.number}/merge`,
    req.githubToken,
    { method: "PUT", body: JSON.stringify(req.body) }
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.patch("/github/repos/:owner/:repo/pulls/:number", requireToken, async (req: any, res) => {
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/pulls/${req.params.number}`,
    req.githubToken,
    { method: "PATCH", body: JSON.stringify(req.body) }
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// PR reviews
router.get("/github/repos/:owner/:repo/pulls/:number/reviews", requireToken, async (req: any, res) => {
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/pulls/${req.params.number}/reviews`,
    req.githubToken
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// PR files changed
router.get("/github/repos/:owner/:repo/pulls/:number/files", requireToken, async (req: any, res) => {
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/pulls/${req.params.number}/files`,
    req.githubToken
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// ── Contents / File Browser ───────────────────────────────────────────────────
router.get("/github/repos/:owner/:repo/contents", requireToken, async (req: any, res) => {
  const { ref = "" } = req.query;
  const qs = ref ? `?ref=${ref}` : "";
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/contents/${qs}`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.get("/github/repos/:owner/:repo/contents/*filePath", requireToken, async (req: any, res) => {
  const filePath = (req.params as any).filePath ?? "";
  const { ref = "" } = req.query;
  const qs = ref ? `?ref=${ref}` : "";
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/contents/${filePath}${qs}`,
    req.githubToken
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// Create/update file in repo
router.put("/github/repos/:owner/:repo/contents/*filePath", requireToken, async (req: any, res) => {
  const filePath = (req.params as any).filePath ?? "";
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/contents/${filePath}`,
    req.githubToken,
    { method: "PUT", body: JSON.stringify(req.body) }
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.status(r.status === 201 ? 201 : 200).json(r.data);
});

// Delete file in repo
router.delete("/github/repos/:owner/:repo/contents/*filePath", requireToken, async (req: any, res) => {
  const filePath = (req.params as any).filePath ?? "";
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/contents/${filePath}`,
    req.githubToken,
    { method: "DELETE", body: JSON.stringify(req.body) }
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// ── Push project files → GitHub repo ─────────────────────────────────────────
// Creates or updates each file in the DB project to the target repo
router.post("/github/repos/:owner/:repo/push-project", requireToken, async (req: any, res) => {
  const { files, branch = "main", commitMessage = "Push from CloudIDE" } = req.body as {
    files: Array<{ name: string; content: string }>;
    branch?: string;
    commitMessage?: string;
  };
  if (!Array.isArray(files)) return void res.status(400).json({ error: "files array required" });

  const results: Array<{ name: string; status: string; error?: string }> = [];

  for (const file of files) {
    // Check if file already exists (to get SHA for update)
    const existing = await ghFetch(
      `/repos/${req.params.owner}/${req.params.repo}/contents/${file.name}?ref=${branch}`,
      req.githubToken
    );
    const sha = existing.ok ? existing.data?.sha : undefined;

    const payload: any = {
      message: `${commitMessage}: ${file.name}`,
      content: Buffer.from(file.content ?? "").toString("base64"),
      branch,
    };
    if (sha) payload.sha = sha;

    const r = await ghFetch(
      `/repos/${req.params.owner}/${req.params.repo}/contents/${file.name}`,
      req.githubToken,
      { method: "PUT", body: JSON.stringify(payload) }
    );
    results.push({ name: file.name, status: r.ok ? (sha ? "updated" : "created") : "error", error: r.ok ? undefined : r.data?.message });
  }

  res.json({ results });
});

// ── Releases ──────────────────────────────────────────────────────────────────
router.get("/github/repos/:owner/:repo/releases", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/releases?per_page=20`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.post("/github/repos/:owner/:repo/releases", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/releases`, req.githubToken, {
    method: "POST",
    body: JSON.stringify(req.body),
  });
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.status(201).json(r.data);
});

// ── Git Trees (recursive file listing for import) ─────────────────────────────
router.get("/github/repos/:owner/:repo/git/trees/:tree_sha", requireToken, async (req: any, res) => {
  const { recursive = "0" } = req.query;
  const qs = recursive === "1" ? "?recursive=1" : "";
  const r = await ghFetch(
    `/repos/${req.params.owner}/${req.params.repo}/git/trees/${req.params.tree_sha}${qs}`,
    req.githubToken
  );
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// ── GitHub Actions / Workflows ────────────────────────────────────────────────
router.get("/github/repos/:owner/:repo/actions/workflows", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/actions/workflows`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.get("/github/repos/:owner/:repo/actions/runs", requireToken, async (req: any, res) => {
  const r = await ghFetch(`/repos/${req.params.owner}/${req.params.repo}/actions/runs?per_page=20`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// ── Notifications ─────────────────────────────────────────────────────────────
router.get("/github/notifications", requireToken, async (req: any, res) => {
  const r = await ghFetch("/notifications?per_page=30", req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// ── Gists ─────────────────────────────────────────────────────────────────────
router.get("/github/gists", requireToken, async (req: any, res) => {
  const r = await ghFetch("/gists?per_page=30", req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.post("/github/gists", requireToken, async (req: any, res) => {
  const r = await ghFetch("/gists", req.githubToken, {
    method: "POST",
    body: JSON.stringify(req.body),
  });
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.status(201).json(r.data);
});

// ── Search ────────────────────────────────────────────────────────────────────
router.get("/github/search/repositories", requireToken, async (req: any, res) => {
  const { q, sort = "stars", order = "desc", per_page = 20 } = req.query;
  if (!q) return void res.status(400).json({ error: "q required" });
  const qs = new URLSearchParams({ q: String(q), sort: String(sort), order: String(order), per_page: String(per_page) });
  const r = await ghFetch(`/search/repositories?${qs}`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.get("/github/search/users", requireToken, async (req: any, res) => {
  const { q, per_page = 20 } = req.query;
  if (!q) return void res.status(400).json({ error: "q required" });
  const qs = new URLSearchParams({ q: String(q), per_page: String(per_page) });
  const r = await ghFetch(`/search/users?${qs}`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.get("/github/search/code", requireToken, async (req: any, res) => {
  const { q, per_page = 20 } = req.query;
  if (!q) return void res.status(400).json({ error: "q required" });
  const qs = new URLSearchParams({ q: String(q), per_page: String(per_page) });
  const r = await ghFetch(`/search/code?${qs}`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

router.get("/github/search/issues", requireToken, async (req: any, res) => {
  const { q, per_page = 20, state = "" } = req.query;
  if (!q) return void res.status(400).json({ error: "q required" });
  const fullQ = state ? `${q} state:${state}` : String(q);
  const qs = new URLSearchParams({ q: fullQ, per_page: String(per_page) });
  const r = await ghFetch(`/search/issues?${qs}`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// ── Trending (public repos, no auth required) ─────────────────────────────────
router.get("/github/trending", requireToken, async (req: any, res) => {
  const { language = "", since = "daily" } = req.query;
  const dateMap: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };
  const days = dateMap[String(since)] ?? 1;
  const date = new Date();
  date.setDate(date.getDate() - days);
  const dateStr = date.toISOString().split("T")[0];
  const q = language ? `language:${language} created:>${dateStr}` : `created:>${dateStr}`;
  const qs = new URLSearchParams({ q, sort: "stars", order: "desc", per_page: "20" });
  const r = await ghFetch(`/search/repositories?${qs}`, req.githubToken);
  if (!r.ok) return void res.status(r.status).json(r.data);
  res.json(r.data);
});

// ── Status check (no auth required) ──────────────────────────────────────────
router.get("/github/status", (req, res) => {
  const token = getToken(req);
  res.json({ connected: !!token });
});

export default router;
