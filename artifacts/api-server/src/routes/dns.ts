import { Router } from "express";
import { db } from "@workspace/db";
import { dnsRecordsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListDnsRecordsParams,
  CreateDnsRecordParams,
  CreateDnsRecordBody,
  UpdateDnsRecordParams,
  UpdateDnsRecordBody,
  DeleteDnsRecordParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/deployments/:id/dns", async (req, res) => {
  const parsed = ListDnsRecordsParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });
  try {
    const records = await db.select().from(dnsRecordsTable).where(eq(dnsRecordsTable.deploymentId, parsed.data.id));
    res.json(records.map(serializeDns));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch DNS records" });
  }
});

router.post("/deployments/:id/dns", async (req, res) => {
  const paramsParsed = CreateDnsRecordParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) return res.status(400).json({ error: "Invalid id" });
  const bodyParsed = CreateDnsRecordBody.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.message });
  try {
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

router.patch("/deployments/:id/dns/:recordId", async (req, res) => {
  const paramsParsed = UpdateDnsRecordParams.safeParse({ id: Number(req.params.id), recordId: Number(req.params.recordId) });
  if (!paramsParsed.success) return res.status(400).json({ error: "Invalid params" });
  const bodyParsed = UpdateDnsRecordBody.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.message });
  try {
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
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(serializeDns(updated));
  } catch (err) {
    res.status(500).json({ error: "Failed to update DNS record" });
  }
});

router.delete("/deployments/:id/dns/:recordId", async (req, res) => {
  const parsed = DeleteDnsRecordParams.safeParse({ id: Number(req.params.id), recordId: Number(req.params.recordId) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid params" });
  try {
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

export default router;
