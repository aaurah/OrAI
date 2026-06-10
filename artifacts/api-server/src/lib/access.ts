import type { Request, Response } from "express";
import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";

export function actorId(req: Request): string {
  if (!req.currentUserId) {
    throw new Error("Missing authenticated user context");
  }
  return req.currentUserId;
}

export function accessibleProjectWhere(projectId: number, userId: string): SQL {
  // ownerId is nullable to avoid orphaning projects created before ownership was added.
  // New projects are always owned. Null-owner projects are only reachable after login.
  return and(
    eq(projectsTable.id, projectId),
    or(eq(projectsTable.ownerId, userId), isNull(projectsTable.ownerId)),
  )!;
}

export function ownedProjectsWhere(userId: string): SQL {
  return or(eq(projectsTable.ownerId, userId), isNull(projectsTable.ownerId))!;
}

export async function ensureProjectAccess(projectId: number, userId: string): Promise<boolean> {
  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(accessibleProjectWhere(projectId, userId));

  return Boolean(project);
}

export async function denyIfNoProjectAccess(
  res: Response,
  projectId: number,
  userId: string,
): Promise<boolean> {
  const allowed = await ensureProjectAccess(projectId, userId);
  if (!allowed) {
    res.status(404).json({ error: "Project not found" });
    return true;
  }
  return false;
}
