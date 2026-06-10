import app from "./app";
import { logger } from "./lib/logger";
import { db, pool } from "@workspace/db";
import { deploymentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Apply tiny backwards-compatible schema hardening needed for ownership checks.
// Existing projects are left with a null owner_id and remain visible only to
// authenticated users until they are claimed/updated by later product flows.
await pool.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id text").catch((err: unknown) =>
  logger.warn({ err }, "Failed to ensure projects.owner_id exists"),
);

// Clean up any deployments left in "building" state from a previous server run
db.update(deploymentsTable)
  .set({ status: "live", updatedAt: new Date() })
  .where(eq(deploymentsTable.status, "building"))
  .catch((err: unknown) => logger.warn({ err }, "Failed to cleanup stale building deployments"));

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
