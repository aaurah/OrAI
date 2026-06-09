import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, filesTable, deploymentsTable } from "@workspace/db";
import { eq, desc, count, and, asc } from "drizzle-orm";
import {
  CreateProjectBody,
  UpdateProjectBody,
  UpdateProjectParams,
  GetProjectParams,
  DeleteProjectParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/projects/stats", async (_req, res) => {
  try {
    const [totalProjects] = await db.select({ count: count() }).from(projectsTable);
    const [activeProjects] = await db
      .select({ count: count() })
      .from(projectsTable)
      .where(eq(projectsTable.status, "active"));
    const [totalDeployments] = await db.select({ count: count() }).from(deploymentsTable);
    const [liveDeployments] = await db
      .select({ count: count() })
      .from(deploymentsTable)
      .where(eq(deploymentsTable.status, "live"));

    res.json({
      totalProjects: totalProjects.count,
      activeProjects: activeProjects.count,
      totalDeployments: totalDeployments.count,
      liveDeployments: liveDeployments.count,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.get("/projects/recent", async (_req, res) => {
  try {
    const projects = await db
      .select()
      .from(projectsTable)
      .orderBy(desc(projectsTable.updatedAt))
      .limit(6);
    res.json(projects.map(serializeProject));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch recent projects" });
  }
});

router.get("/projects", async (_req, res) => {
  try {
    const projects = await db.select().from(projectsTable).orderBy(desc(projectsTable.updatedAt));
    res.json(projects.map(serializeProject));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

router.post("/projects", async (req, res) => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    const [project] = await db.insert(projectsTable).values({
      name: parsed.data.name,
      description: parsed.data.description,
      language: parsed.data.language,
      template: parsed.data.template,
      isPublic: parsed.data.isPublic ?? false,
      status: "active",
    }).returning();

    res.status(201).json(serializeProject(project));
  } catch (err) {
    res.status(500).json({ error: "Failed to create project" });
  }
});

router.get("/projects/:id", async (req, res) => {
  const parsed = GetProjectParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });
  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, parsed.data.id));
    if (!project) return res.status(404).json({ error: "Not found" });
    res.json(serializeProject(project));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

router.patch("/projects/:id", async (req, res) => {
  const paramsParsed = UpdateProjectParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) return res.status(400).json({ error: "Invalid id" });
  const bodyParsed = UpdateProjectBody.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.message });
  try {
    const [updated] = await db
      .update(projectsTable)
      .set({ ...bodyParsed.data, updatedAt: new Date() })
      .where(eq(projectsTable.id, paramsParsed.data.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(serializeProject(updated));
  } catch (err) {
    res.status(500).json({ error: "Failed to update project" });
  }
});

router.delete("/projects/:id", async (req, res) => {
  const parsed = DeleteProjectParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });
  try {
    await db.delete(projectsTable).where(eq(projectsTable.id, parsed.data.id));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete project" });
  }
});

// ── Preview: serve project files from DB ──────────────────────────────────

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  ts: "text/typescript; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  md: "text/markdown; charset=utf-8",
};

router.get("/projects/:id/preview", async (req, res) => {
  try {
    const projectId = Number(req.params.id);

    const allFiles = await db
      .select()
      .from(filesTable)
      .where(eq(filesTable.projectId, projectId))
      .orderBy(desc(filesTable.id));

    // Dedup by name — keep newest
    const fileMap = new Map<string, typeof allFiles[0]>();
    for (const f of allFiles) {
      if (!fileMap.has(f.name)) fileMap.set(f.name, f);
    }

    const indexFile = fileMap.get("index.html");
    if (!indexFile?.content) {
      // Build a rich project overview for non-HTML projects
      const files = Array.from(fileMap.values());
      const fileNames = files.map(f => f.name);

      // Detect tech stack from file extensions / names
      const hasTS  = fileNames.some(n => n.endsWith(".ts") || n.endsWith(".tsx"));
      const hasTSX = fileNames.some(n => n.endsWith(".tsx"));
      const hasJS  = fileNames.some(n => n.endsWith(".js") || n.endsWith(".jsx"));
      const hasPy  = fileNames.some(n => n.endsWith(".py"));
      const hasRust = fileNames.some(n => n.endsWith(".rs"));
      const hasGo  = fileNames.some(n => n.endsWith(".go"));
      const hasPkg = fileMap.has("package.json");
      const hasWorkspace = fileNames.some(n => n.includes("pnpm-workspace") || n.includes("package.json"));
      const hasVite = fileNames.some(n => n.includes("vite.config"));
      const hasReact = hasTSX || fileNames.some(n => n.endsWith(".jsx"));
      const hasDrizzle = fileNames.some(n => n.includes("drizzle"));
      const hasExpress = fileNames.some(n => n.includes("express") || (fileMap.get(n)?.content ?? "").includes("express"));
      const hasReadme = fileMap.has("README.md") || fileMap.has("readme.md");

      // Determine primary language label
      let lang = "Code";
      let langColor = "#6366f1";
      let langIcon = "📄";
      if (hasTS && hasReact) { lang = "TypeScript + React"; langColor = "#3178c6"; langIcon = "⚛️"; }
      else if (hasTS) { lang = "TypeScript"; langColor = "#3178c6"; langIcon = "🔷"; }
      else if (hasPy) { lang = "Python"; langColor = "#3572A5"; langIcon = "🐍"; }
      else if (hasRust) { lang = "Rust"; langColor = "#dea584"; langIcon = "🦀"; }
      else if (hasGo) { lang = "Go"; langColor = "#00ADD8"; langIcon = "🐹"; }
      else if (hasJS) { lang = "JavaScript"; langColor = "#f1e05a"; langIcon = "🟨"; }

      // Collect badges
      const badges: string[] = [lang];
      if (hasPkg && hasWorkspace) badges.push("pnpm monorepo");
      if (hasVite) badges.push("Vite");
      if (hasDrizzle) badges.push("Drizzle ORM");
      if (hasExpress) badges.push("Express");

      // Try to parse package.json
      let pkgJson: any = null;
      const pkgFile = fileMap.get("package.json");
      if (pkgFile?.content) {
        try { pkgJson = JSON.parse(pkgFile.content); } catch {}
      }

      // README content (first 800 chars)
      const readmeFile = fileMap.get("README.md") ?? fileMap.get("readme.md");
      const readmeSnippet = readmeFile?.content
        ? readmeFile.content.slice(0, 800).replace(/</g, "&lt;").replace(/>/g, "&gt;")
        : null;

      // Build file tree rows (up to 30 files)
      const sortedFiles = files
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 30);

      const fileRows = sortedFiles.map(f => {
        const ext = f.name.split(".").pop() ?? "";
        const extColors: Record<string, string> = {
          ts: "#3178c6", tsx: "#3178c6", js: "#f1e05a", jsx: "#f1e05a",
          py: "#3572A5", rs: "#dea584", go: "#00ADD8", css: "#563d7c",
          html: "#e34c26", json: "#6b7280", md: "#94a3b8", toml: "#9c4221",
          sql: "#e88c3a",
        };
        const color = extColors[ext] ?? "#6b7280";
        const isDeep = f.name.includes("/");
        const indent = isDeep ? "  " : "";
        return `<div class="file-row">
          <span class="file-dot" style="background:${color}"></span>
          <span class="file-name" style="${isDeep ? "color:#8b949e;font-size:11px" : ""}">${indent}${f.name}</span>
          ${f.content ? `<span class="file-size">${Math.ceil(f.content.length / 1024)}KB</span>` : ""}
        </div>`;
      }).join("");

      const projectName = pkgJson?.name ?? `Project #${projectId}`;
      const description = pkgJson?.description ?? "Imported project";

      res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${projectName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh;padding:32px 16px}
.container{max-width:680px;margin:0 auto}
.header{margin-bottom:28px}
.project-name{font-size:1.6rem;font-weight:700;color:#f0f6fc;margin-bottom:6px}
.description{color:#8b949e;font-size:14px;margin-bottom:14px}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;background:#161b22;border:1px solid #30363d;color:#e6edf3}
.badge.primary{background:${langColor}22;border-color:${langColor}55;color:${langColor}}
.section{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px;margin-bottom:16px}
.section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8b949e;margin-bottom:12px}
.file-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #21262d;font-size:13px;font-family:"JetBrains Mono",Menlo,monospace}
.file-row:last-child{border-bottom:none}
.file-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.file-name{flex:1;color:#c9d1d9}
.file-size{color:#484f58;font-size:11px}
.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.meta-item{padding:10px 14px;background:#0d1117;border-radius:8px;border:1px solid #21262d}
.meta-label{font-size:10px;color:#6e7681;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.meta-value{font-size:13px;font-family:"JetBrains Mono",Menlo,monospace;color:#e6edf3}
.readme{font-size:13px;color:#8b949e;white-space:pre-wrap;line-height:1.7;max-height:200px;overflow:hidden;position:relative}
.readme::after{content:"";position:absolute;bottom:0;left:0;right:0;height:40px;background:linear-gradient(transparent,#161b22)}
.tip{background:#0d419d22;border:1px solid #1f6feb55;border-radius:10px;padding:14px 16px;font-size:13px;color:#58a6ff;margin-top:4px}
.tip strong{color:#79c0ff}
.scripts{display:flex;flex-direction:column;gap:6px}
.script-row{display:flex;align-items:center;gap:8px;font-size:12px;font-family:"JetBrains Mono",Menlo,monospace}
.script-name{color:#79c0ff;min-width:80px}
.script-cmd{color:#8b949e;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="project-name">${langIcon} ${projectName}</div>
    <div class="description">${description}</div>
    <div class="badges">
      <span class="badge primary">${lang}</span>
      ${badges.slice(1).map(b => `<span class="badge">${b}</span>`).join("")}
      <span class="badge">${files.length} files</span>
    </div>
  </div>

  ${pkgJson && Object.keys(pkgJson.scripts ?? {}).length > 0 ? `
  <div class="section">
    <div class="section-title">Scripts (package.json)</div>
    <div class="scripts">
      ${Object.entries(pkgJson.scripts ?? {}).slice(0, 6).map(([k, v]) =>
        `<div class="script-row"><span class="script-name">${k}</span><span class="script-cmd">${String(v)}</span></div>`
      ).join("")}
    </div>
  </div>` : ""}

  ${pkgJson ? `
  <div class="section">
    <div class="section-title">Package Info</div>
    <div class="meta-grid">
      ${pkgJson.version ? `<div class="meta-item"><div class="meta-label">Version</div><div class="meta-value">${pkgJson.version}</div></div>` : ""}
      ${pkgJson.license ? `<div class="meta-item"><div class="meta-label">License</div><div class="meta-value">${pkgJson.license}</div></div>` : ""}
      ${pkgJson.engines?.node ? `<div class="meta-item"><div class="meta-label">Node</div><div class="meta-value">${pkgJson.engines.node}</div></div>` : ""}
      ${Object.keys(pkgJson.dependencies ?? {}).length ? `<div class="meta-item"><div class="meta-label">Dependencies</div><div class="meta-value">${Object.keys(pkgJson.dependencies).length}</div></div>` : ""}
    </div>
  </div>` : ""}

  ${readmeSnippet ? `
  <div class="section">
    <div class="section-title">README</div>
    <div class="readme">${readmeSnippet}</div>
  </div>` : ""}

  <div class="section">
    <div class="section-title">Files (${files.length}${files.length > 30 ? "+" : ""})</div>
    ${fileRows}
  </div>

  <div class="tip">
    <strong>💡 This is a ${lang} project.</strong> Use the <strong>AI Agent</strong> tab to explore the code — ask things like <em>"explain the project structure"</em>, <em>"what does server.ts do?"</em>, or <em>"add a new API route"</em>.
  </div>
</div>
</body>
</html>`);
      return;
    }

    // Inline referenced CSS and JS so the preview works without separate requests
    let html = indexFile.content;

    // Inline <link rel="stylesheet" href="...">
    html = html.replace(/<link([^>]+)>/gi, (match, attrs) => {
      if (!/rel=["']stylesheet["']/i.test(attrs)) return match;
      const hrefMatch = /href=["']([^"']+)["']/i.exec(attrs);
      if (!hrefMatch) return match;
      const fname = hrefMatch[1].split("/").pop() ?? hrefMatch[1];
      const file = fileMap.get(fname);
      if (file?.content) return `<style>${file.content}</style>`;
      return match;
    });

    // Inline <script src="..."></script>
    html = html.replace(/<script([^>]*)><\/script>/gi, (match, attrs) => {
      const srcMatch = /src=["']([^"']+)["']/i.exec(attrs);
      if (!srcMatch) return match;
      const fname = srcMatch[1].split("/").pop() ?? srcMatch[1];
      const file = fileMap.get(fname);
      if (file?.content) return `<script>${file.content}</script>`;
      return match;
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.send(html);
  } catch {
    res.status(500).send("Preview error");
  }
});

router.get("/projects/:id/preview/*filename", async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const filename = req.params.filename as string;
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";

    const [file] = await db
      .select()
      .from(filesTable)
      .where(and(eq(filesTable.projectId, projectId), eq(filesTable.name, filename)))
      .orderBy(desc(filesTable.id));

    if (!file) {
      res.status(404).send(`/* ${filename} not found */`);
      return;
    }

    res.setHeader("Content-Type", MIME[ext] ?? "text/plain; charset=utf-8");
    res.send(file.content || "");
  } catch {
    res.status(500).send("Error serving file");
  }
});

function serializeProject(p: typeof projectsTable.$inferSelect) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}


export default router;
