import { Router } from "express";
import { db } from "@workspace/db";
import { deploymentsTable, dnsRecordsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { actorId, denyIfNoProjectAccess } from "../lib/access";
import {
  ListDnsRecordsParams,
  CreateDnsRecordParams,
  CreateDnsRecordBody,
  UpdateDnsRecordParams,
  UpdateDnsRecordBody,
  DeleteDnsRecordParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/deployments/:id/dns", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const parsed = ListDnsRecordsParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    if (await denyIfNoDeploymentAccess(res, parsed.data.id, userId)) return;
    const records = await db.select().from(dnsRecordsTable).where(eq(dnsRecordsTable.deploymentId, parsed.data.id));
    res.json(records.map(serializeDns));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch DNS records" });
  }
});

router.post("/deployments/:id/dns", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const paramsParsed = CreateDnsRecordParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const bodyParsed = CreateDnsRecordBody.safeParse(req.body);
  if (!bodyParsed.success) { res.status(400).json({ error: bodyParsed.error.message }); return; }
  try {
    if (await denyIfNoDeploymentAccess(res, paramsParsed.data.id, userId)) return;
    const [record] = await db.insert(dnsRecordsTable).values({
      deploymentId: paramsParsed.data.id,
      type: bodyParsed.data.type,
      name: bodyParsed.data.name,
      value: bodyParsed.data.value,
      ttl: bodyParsed.data.ttl,
      priority: bodyParsed.data.priority ?? null,
    }).returning();
    res.status(201).json(serializeDns(record));
  } catch (err) {
    res.status(500).json({ error: "Failed to create DNS record" });
  }
});

router.patch("/deployments/:id/dns/:recordId", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const paramsParsed = UpdateDnsRecordParams.safeParse({ id: Number(req.params.id), recordId: Number(req.params.recordId) });
  if (!paramsParsed.success) { res.status(400).json({ error: "Invalid params" }); return; }
  const bodyParsed = UpdateDnsRecordBody.safeParse(req.body);
  if (!bodyParsed.success) { res.status(400).json({ error: bodyParsed.error.message }); return; }
  try {
    if (await denyIfNoDeploymentAccess(res, paramsParsed.data.id, userId)) return;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (bodyParsed.data.type !== undefined) updateData.type = bodyParsed.data.type;
    if (bodyParsed.data.name !== undefined) updateData.name = bodyParsed.data.name;
    if (bodyParsed.data.value !== undefined) updateData.value = bodyParsed.data.value;
    if (bodyParsed.data.ttl !== undefined) updateData.ttl = bodyParsed.data.ttl;
    if (bodyParsed.data.priority !== undefined) updateData.priority = bodyParsed.data.priority;

    const [updated] = await db
      .update(dnsRecordsTable)
      .set(updateData)
      .where(and(eq(dnsRecordsTable.id, paramsParsed.data.recordId), eq(dnsRecordsTable.deploymentId, paramsParsed.data.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(serializeDns(updated));
  } catch (err) {
    res.status(500).json({ error: "Failed to update DNS record" });
  }
});

router.delete("/deployments/:id/dns/:recordId", async (req, res): Promise<void> => {
  const userId = actorId(req);
  const parsed = DeleteDnsRecordParams.safeParse({ id: Number(req.params.id), recordId: Number(req.params.recordId) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid params" }); return; }
  try {
    if (await denyIfNoDeploymentAccess(res, parsed.data.id, userId)) return;
    await db.delete(dnsRecordsTable).where(
      and(eq(dnsRecordsTable.id, parsed.data.recordId), eq(dnsRecordsTable.deploymentId, parsed.data.id))
    );
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete DNS record" });
  }
});

function serializeDns(r: typeof dnsRecordsTable.$inferSelect) {
  return {
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function denyIfNoDeploymentAccess(res: Parameters<typeof denyIfNoProjectAccess>[0], deploymentId: number, userId: string): Promise<boolean> {
  const [deployment] = await db
    .select({ projectId: deploymentsTable.projectId })
    .from(deploymentsTable)
    .where(eq(deploymentsTable.id, deploymentId));

  if (!deployment) {
    res.status(404).json({ error: "Deployment not found" });
    return true;
  }

  return denyIfNoProjectAccess(res, deployment.projectId, userId);
}

export default router;
