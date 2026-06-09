import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { deploymentsTable } from "./deployments";

export const dnsRecordsTable = pgTable("dns_records", {
  id: serial("id").primaryKey(),
  deploymentId: integer("deployment_id").notNull().references(() => deploymentsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  value: text("value").notNull(),
  ttl: integer("ttl").notNull().default(3600),
  priority: integer("priority"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDnsRecordSchema = createInsertSchema(dnsRecordsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDnsRecord = z.infer<typeof insertDnsRecordSchema>;
export type DnsRecord = typeof dnsRecordsTable.$inferSelect;
