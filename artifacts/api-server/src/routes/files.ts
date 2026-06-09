import { Router } from "express";
import { db } from "@workspace/db";
import { filesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListFilesParams,
  CreateFileParams,
  CreateFileBody,
  GetFileParams,
  UpdateFileParams,
  UpdateFileBody,
  DeleteFileParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/projects/:id/files", async (req, res) => {
  const parsed = ListFilesParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });
  try {
    const files = await db.select().from(filesTable).where(eq(filesTable.projectId, parsed.data.id));
    res.json(files.map(serializeFile));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

router.post("/projects/:id/files", async (req, res) => {
  const paramsParsed = CreateFileParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) return res.status(400).json({ error: "Invalid id" });
  const bodyParsed = CreateFileBody.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.message });
  try {
    const [file] = await db.insert(filesTable).values({
      projectId: paramsParsed.data.id,
      name: bodyParsed.data.name,
      path: bodyParsed.data.path,
      content: bodyParsed.data.content ?? "",
      type: bodyParsed.data.type,
      language: detectLanguage(bodyParsed.data.name),
    }).returning();
    res.status(201).json(serializeFile(file));
  } catch (err) {
    res.status(500).json({ error: "Failed to create file" });
  }
});

router.get("/projects/:id/files/:fileId", async (req, res) => {
  const parsed = GetFileParams.safeParse({ id: Number(req.params.id), fileId: Number(req.params.fileId) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid params" });
  try {
    const [file] = await db.select().from(filesTable).where(
      and(eq(filesTable.id, parsed.data.fileId), eq(filesTable.projectId, parsed.data.id))
    );
    if (!file) return res.status(404).json({ error: "Not found" });
    res.json(serializeFile(file));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch file" });
  }
});

router.patch("/projects/:id/files/:fileId", async (req, res) => {
  const paramsParsed = UpdateFileParams.safeParse({ id: Number(req.params.id), fileId: Number(req.params.fileId) });
  if (!paramsParsed.success) return res.status(400).json({ error: "Invalid params" });
  const bodyParsed = UpdateFileBody.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.message });
  try {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (bodyParsed.data.content !== undefined) updateData.content = bodyParsed.data.content;
    if (bodyParsed.data.name !== undefined) updateData.name = bodyParsed.data.name;

    const [updated] = await db
      .update(filesTable)
      .set(updateData)
      .where(and(eq(filesTable.id, paramsParsed.data.fileId), eq(filesTable.projectId, paramsParsed.data.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(serializeFile(updated));
  } catch (err) {
    res.status(500).json({ error: "Failed to update file" });
  }
});

router.delete("/projects/:id/files/:fileId", async (req, res) => {
  const parsed = DeleteFileParams.safeParse({ id: Number(req.params.id), fileId: Number(req.params.fileId) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid params" });
  try {
    await db.delete(filesTable).where(
      and(eq(filesTable.id, parsed.data.fileId), eq(filesTable.projectId, parsed.data.id))
    );
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete file" });
  }
});

function serializeFile(f: typeof filesTable.$inferSelect) {
  return {
    ...f,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    py: "python", rs: "rust", go: "go", html: "html", css: "css",
    json: "json", md: "markdown", yaml: "yaml", yml: "yaml", sh: "bash",
    c: "c", cpp: "cpp", java: "java", rb: "ruby", php: "php",
  };
  return map[ext ?? ""] ?? "plaintext";
}

export default router;
