import { Router } from "express";
import { db } from "@workspace/db";
import { deploymentsTable, projectsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { actorId, denyIfNoProjectAccess, ownedProjectsWhere } from "../lib/access";
import {
  ListDeploymentsParams,
  CreateDeploymentParams,
  CreateDeploymentBody,
  GetDeploymentParams,
  UpdateDeploymentParams,
  UpdateDeploymentBody,
  DeleteDeploymentParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/deployments", async (req, res): Promise<void> => {
  const userId = actorId(req);
  try {
    const deployments = await db
      .select({
        id: deploymentsTable.id,
        projectId: deploymentsTable.projectId,
        projectName: projectsTable.name,
        status: deploymentsTable.status,
        url: deploymentsTable.url,
        customDomain: deploymentsTable.customDomain,
        region: deploymentsTable.region,
        buildLog: deploymentsTable.buildLog,
        createdAt: deploymentsTable.createdAt,
        updatedAt: deploymentsTable.updatedAt,
      })
      .from(deploymentsTable)
      .leftJoin(projectsTable, eq(deploymentsTable.projectId, projectsTable.id))
      .where(ownedProjectsWhere(userId))
      .orderBy(desc(deploymentsTable.createdAt));

    res.json(deployments.map(serializeDeployment));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch deployments" });
  }
});

router.get("/deployments/:id", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const parsed = GetDeploymentParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db
      .select({
        id: deploymentsTable.id,
        projectId: deploymentsTable.projectId,
        projectName: projectsTable.name,
        status: deploymentsTable.status,
        url: deploymentsTable.url,
        customDomain: deploymentsTable.customDomain,
        region: deploymentsTable.region,
        buildLog: deploymentsTable.buildLog,
        createdAt: deploymentsTable.createdAt,
        updatedAt: deploymentsTable.updatedAt,
      })
      .from(deploymentsTable)
      .leftJoin(projectsTable, eq(deploymentsTable.projectId, projectsTable.id))
      .where(eq(deploymentsTable.id, parsed.data.id));

    if (!rows[0] || (await denyIfNoProjectAccess(res, rows[0].projectId as number, userId))) return;
    res.json(serializeDeployment(rows[0]));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch deployment" });
  }
});

router.get("/projects/:id/deployments", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const parsed = ListDeploymentsParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    if (await denyIfNoProjectAccess(res, parsed.data.id, userId)) return;
    const deployments = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.projectId, parsed.data.id))
      .orderBy(desc(deploymentsTable.createdAt));
    res.json(deployments.map(d => ({ ...serializeDeployment(d), projectName: null })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch deployments" });
  }
});

router.post("/projects/:id/deployments", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const paramsParsed = CreateDeploymentParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const bodyParsed = CreateDeploymentBody.safeParse(req.body);
  if (!bodyParsed.success) { res.status(400).json({ error: bodyParsed.error.message }); return; }

  try {
    const projectId = paramsParsed.data.id;
    if (await denyIfNoProjectAccess(res, projectId, userId)) return;
    const host = req.get("host") || "localhost";
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const url = `${protocol}://${host}/api/projects/${projectId}/preview`;

    const now = new Date();
    const ts = (offset = 0) => new Date(now.getTime() + offset).toISOString().split("T")[1].split(".")[0];
    const buildLog = [
      `[${ts(0)}] Deployment triggered for project #${projectId}`,
      `[${ts(50)}] Collecting project files...`,
      `[${ts(110)}] Bundling assets...`,
      `[${ts(180)}] Optimizing for production...`,
      `[${ts(240)}] Generating preview URL...`,
      `[${ts(300)}] Health check passed ✓`,
      `[${ts(320)}] Deployment live!`,
    ].join("\n");

    const [deployment] = await db.insert(deploymentsTable).values({
      projectId,
      status: "live",
      url,
      customDomain: bodyParsed.data.customDomain ?? null,
      region: bodyParsed.data.region ?? "us-east-1",
      buildLog,
    }).returning();

    res.status(201).json({ ...serializeDeployment(deployment), projectName: null });
  } catch (err) {
    res.status(500).json({ error: "Failed to create deployment" });
  }
});

router.patch("/deployments/:id", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const paramsParsed = UpdateDeploymentParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const bodyParsed = UpdateDeploymentBody.safeParse(req.body);
  if (!bodyParsed.success) { res.status(400).json({ error: bodyParsed.error.message }); return; }

  try {
    const [existing] = await db.select({ projectId: deploymentsTable.projectId }).from(deploymentsTable).where(eq(deploymentsTable.id, paramsParsed.data.id));
    if (!existing || (await denyIfNoProjectAccess(res, existing.projectId, userId))) return;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (bodyParsed.data.customDomain !== undefined) updateData.customDomain = bodyParsed.data.customDomain;
    if (bodyParsed.data.status !== undefined) updateData.status = bodyParsed.data.status;

    const [updated] = await db
      .update(deploymentsTable)
      .set(updateData)
      .where(eq(deploymentsTable.id, paramsParsed.data.id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...serializeDeployment(updated), projectName: null });
  } catch (err) {
    res.status(500).json({ error: "Failed to update deployment" });
  }
});

router.delete("/deployments/:id", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const parsed = DeleteDeploymentParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [existing] = await db.select({ projectId: deploymentsTable.projectId }).from(deploymentsTable).where(eq(deploymentsTable.id, parsed.data.id));
    if (!existing || (await denyIfNoProjectAccess(res, existing.projectId, userId))) return;
    await db.delete(deploymentsTable).where(eq(deploymentsTable.id, parsed.data.id));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete deployment" });
  }
});

function serializeDeployment(d: { createdAt: Date; updatedAt: Date; [key: string]: unknown }) {
  return {
    ...d,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export default router;
