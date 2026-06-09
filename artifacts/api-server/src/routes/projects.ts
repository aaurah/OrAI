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

    const starterContent = getStarterContent(parsed.data.language);
    if (starterContent) {
      await db.insert(filesTable).values({
        projectId: project.id,
        name: starterContent.name,
        path: `/${starterContent.name}`,
        content: starterContent.content,
        type: "file",
        language: parsed.data.language,
      });
    }

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
      res
        .status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>No Preview</title>
<style>
body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#0d1117;color:#8b949e;}
.box{text-align:center;padding:40px;}
h2{color:#f0f6fc;margin-bottom:8px;}
p{margin:4px 0;font-size:14px;}
.hint{margin-top:16px;background:#161b22;border:1px solid #30363d;border-radius:8px;
padding:12px 20px;font-size:13px;color:#58a6ff;}
</style></head><body><div class="box">
<h2>No Preview Available</h2>
<p>Your project doesn't have an <code>index.html</code> yet.</p>
<p class="hint">💡 Ask the AI to create a project, or add an index.html file.</p>
</div></body></html>`);
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

function getStarterContent(language: string): { name: string; content: string } | null {
  const starters: Record<string, { name: string; content: string }> = {
    javascript: { name: "index.js", content: `// Welcome to your new JavaScript project!\nconsole.log("Hello, world!");\n` },
    typescript: { name: "index.ts", content: `// Welcome to your new TypeScript project!\nconst greeting: string = "Hello, world!";\nconsole.log(greeting);\n` },
    python: { name: "main.py", content: `# Welcome to your new Python project!\nprint("Hello, world!")\n` },
    html: { name: "index.html", content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>My Project</title>\n</head>\n<body>\n  <h1>Hello, world!</h1>\n</body>\n</html>\n` },
    rust: { name: "main.rs", content: `fn main() {\n    println!("Hello, world!");\n}\n` },
    go: { name: "main.go", content: `package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, world!")\n}\n` },
  };
  return starters[language] ?? { name: "README.md", content: `# My Project\n\nWelcome to your new project!\n` };
}

export default router;
