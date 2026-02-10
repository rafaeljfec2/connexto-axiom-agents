import crypto from "node:crypto";
import { logger } from "../config/logger.js";
import { openDatabase } from "../state/db.js";

const db = openDatabase();

try {
  const id = crypto.randomUUID();

  db.prepare(
    "INSERT INTO goals (id, title, description, status, priority) VALUES (?, ?, ?, ?, ?)",
  ).run(id, "Launch MVP", "Deliver the minimum viable product for connexto-axiom", "active", 10);

  logger.info({ id, title: "Launch MVP", status: "active", priority: 10 }, "Goal inserted");

  const count = db.prepare("SELECT COUNT(*) as total FROM goals WHERE status = 'active'").get() as {
    total: number;
  };
  logger.info({ total: count.total }, "Total active goals");
} finally {
  db.close();
}
