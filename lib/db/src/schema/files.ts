import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const filesTable = pgTable("files", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  content: text("content"),
  type: text("type").notNull().default("file"),
  language: text("language"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertFileSchema = createInsertSchema(filesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFile = z.infer<typeof insertFileSchema>;
export type File = typeof filesTable.$inferSelect;
