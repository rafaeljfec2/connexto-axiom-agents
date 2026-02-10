import crypto from "node:crypto";
import { openDatabase } from "../state/db.js";

const db = openDatabase();

try {
  const id = crypto.randomUUID();

  db.prepare(
    "INSERT INTO goals (id, title, description, status, priority) VALUES (?, ?, ?, ?, ?)",
  ).run(id, "Launch MVP", "Deliver the minimum viable product for connexto-axiom", "active", 10);

  console.log(`[seed] Goal inserted: ${id}`);
  console.log("[seed] Title: Launch MVP");
  console.log("[seed] Status: active | Priority: 10");

  const count = db.prepare("SELECT COUNT(*) as total FROM goals WHERE status = 'active'").get() as {
    total: number;
  };
  console.log(`[seed] Total active goals: ${count.total}`);
} finally {
  db.close();
}
