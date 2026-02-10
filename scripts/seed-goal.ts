import crypto from "node:crypto";
import { logger } from "../config/logger.js";
import { openDatabase } from "../state/db.js";

const args = process.argv.slice(2);

const projectFlagIndex = args.indexOf("--project");
const projectId = projectFlagIndex !== -1 && projectFlagIndex + 1 < args.length
  ? args[projectFlagIndex + 1]
  : "connexto-digital-signer";

const firstPositional = args.find(
  (arg, idx) => !arg.startsWith("--") && (projectFlagIndex === -1 || idx !== projectFlagIndex + 1),
);
const title = firstPositional ?? "Launch MVP";

const db = openDatabase();

try {
  const id = crypto.randomUUID();

  db.prepare(
    "INSERT INTO goals (id, title, description, status, priority, project_id) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, title, `Goal for project ${projectId}: ${title}`, "active", 10, projectId);

  logger.info({ id, title, projectId, status: "active", priority: 10 }, "Goal inserted");

  const count = db.prepare("SELECT COUNT(*) as total FROM goals WHERE status = 'active'").get() as {
    total: number;
  };
  logger.info({ total: count.total }, "Total active goals");
} finally {
  db.close();
}
