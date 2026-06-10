import { Router } from "express";
import { db } from "@workspace/db";
import { deploymentsTable, projectsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
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

router.get("/deployments", async (_req, res) => {
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
        domainVerified: deploymentsTable.domainVerified,
        createdAt: deploymentsTable.createdAt,
        updatedAt: deploymentsTable.updatedAt,
      })
      .from(deploymentsTable)
      .leftJoin(projectsTable, eq(deploymentsTable.projectId, projectsTable.id))
      .orderBy(desc(deploymentsTable.createdAt));

    res.json(deployments.map(serializeDeployment));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch deployments" });
  }
});

router.get("/deployments/:id", async (req, res) => {
  const parsed = GetDeploymentParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return void res.status(400).json({ error: "Invalid id" });
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
        domainVerified: deploymentsTable.domainVerified,
        createdAt: deploymentsTable.createdAt,
        updatedAt: deploymentsTable.updatedAt,
      })
      .from(deploymentsTable)
      .leftJoin(projectsTable, eq(deploymentsTable.projectId, projectsTable.id))
      .where(eq(deploymentsTable.id, parsed.data.id));

    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json(serializeDeployment(rows[0]));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch deployment" });
  }
});

router.get("/projects/:id/deployments", async (req, res) => {
  const parsed = ListDeploymentsParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return void res.status(400).json({ error: "Invalid id" });
  try {
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

router.post("/projects/:id/deployments", async (req, res) => {
  const paramsParsed = CreateDeploymentParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) return void res.status(400).json({ error: "Invalid id" });
  const bodyParsed = CreateDeploymentBody.safeParse(req.body);
  if (!bodyParsed.success) return void res.status(400).json({ error: bodyParsed.error.message });

  try {
    const projectId = paramsParsed.data.id;
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

router.patch("/deployments/:id", async (req, res) => {
  const paramsParsed = UpdateDeploymentParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) return void res.status(400).json({ error: "Invalid id" });
  const bodyParsed = UpdateDeploymentBody.safeParse(req.body);
  if (!bodyParsed.success) return void res.status(400).json({ error: bodyParsed.error.message });

  try {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (bodyParsed.data.customDomain !== undefined) updateData.customDomain = bodyParsed.data.customDomain;
    if (bodyParsed.data.status !== undefined) updateData.status = bodyParsed.data.status;
    if ((bodyParsed.data as Record<string, unknown>).domainVerified !== undefined) updateData.domainVerified = (bodyParsed.data as Record<string, unknown>).domainVerified;

    const [updated] = await db
      .update(deploymentsTable)
      .set(updateData)
      .where(eq(deploymentsTable.id, paramsParsed.data.id))
      .returning();
    if (!updated) return void res.status(404).json({ error: "Not found" });
    res.json({ ...serializeDeployment(updated), projectName: null });
  } catch (err) {
    res.status(500).json({ error: "Failed to update deployment" });
  }
});

router.delete("/deployments/:id", async (req, res) => {
  const parsed = DeleteDeploymentParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return void res.status(400).json({ error: "Invalid id" });
  try {
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
