import { Router } from "express";
import { db } from "@workspace/db";
import { filesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { actorId, denyIfNoProjectAccess } from "../lib/access";
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

router.get("/projects/:id/files", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const parsed = ListFilesParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    if (await denyIfNoProjectAccess(res, parsed.data.id, userId)) return;
    const files = await db.select().from(filesTable).where(eq(filesTable.projectId, parsed.data.id));
    // Deduplicate by name — keep the highest-id (newest) file for each name
    const seen = new Map<string, typeof files[0]>();
    for (const f of files) {
      const existing = seen.get(f.name);
      if (!existing || f.id > existing.id) seen.set(f.name, f);
    }
    res.json([...seen.values()].map(serializeFile));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

// Removes duplicate file names, keeping the newest (highest id) per name
router.post("/projects/:id/files/dedup", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const parsed = ListFilesParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    if (await denyIfNoProjectAccess(res, parsed.data.id, userId)) return;
    const files = await db.select().from(filesTable).where(eq(filesTable.projectId, parsed.data.id));
    const toDelete: number[] = [];
    const seen = new Map<string, number>();
    for (const f of files) {
      const existing = seen.get(f.name);
      if (existing === undefined) {
        seen.set(f.name, f.id);
      } else if (f.id > existing) {
        toDelete.push(existing);
        seen.set(f.name, f.id);
      } else {
        toDelete.push(f.id);
      }
    }
    if (toDelete.length > 0) {
      await db.delete(filesTable).where(inArray(filesTable.id, toDelete));
    }
    res.json({ deleted: toDelete.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to dedup files" });
  }
});

router.post("/projects/:id/files", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const paramsParsed = CreateFileParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const bodyParsed = CreateFileBody.safeParse(req.body);
  if (!bodyParsed.success) { res.status(400).json({ error: bodyParsed.error.message }); return; }
  try {
    if (await denyIfNoProjectAccess(res, paramsParsed.data.id, userId)) return;
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

router.get("/projects/:id/files/:fileId", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const parsed = GetFileParams.safeParse({ id: Number(req.params.id), fileId: Number(req.params.fileId) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid params" }); return; }
  try {
    if (await denyIfNoProjectAccess(res, parsed.data.id, userId)) return;
    const [file] = await db.select().from(filesTable).where(
      and(eq(filesTable.id, parsed.data.fileId), eq(filesTable.projectId, parsed.data.id))
    );
    if (!file) { res.status(404).json({ error: "Not found" }); return; }
    res.json(serializeFile(file));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch file" });
  }
});

router.patch("/projects/:id/files/:fileId", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const paramsParsed = UpdateFileParams.safeParse({ id: Number(req.params.id), fileId: Number(req.params.fileId) });
  if (!paramsParsed.success) { res.status(400).json({ error: "Invalid params" }); return; }
  const bodyParsed = UpdateFileBody.safeParse(req.body);
  if (!bodyParsed.success) { res.status(400).json({ error: bodyParsed.error.message }); return; }
  try {
    if (await denyIfNoProjectAccess(res, paramsParsed.data.id, userId)) return;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (bodyParsed.data.content !== undefined) updateData.content = bodyParsed.data.content;
    if (bodyParsed.data.name !== undefined) updateData.name = bodyParsed.data.name;

    const [updated] = await db
      .update(filesTable)
      .set(updateData)
      .where(and(eq(filesTable.id, paramsParsed.data.fileId), eq(filesTable.projectId, paramsParsed.data.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(serializeFile(updated));
  } catch (err) {
    res.status(500).json({ error: "Failed to update file" });
  }
});

router.delete("/projects/:id/files/:fileId", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const parsed = DeleteFileParams.safeParse({ id: Number(req.params.id), fileId: Number(req.params.fileId) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid params" }); return; }
  try {
    if (await denyIfNoProjectAccess(res, parsed.data.id, userId)) return;
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
