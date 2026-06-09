import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, filesTable, deploymentsTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
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
