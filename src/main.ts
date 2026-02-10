import { openDatabase } from "../state/db.js";
import { runKairos } from "../orchestration/runKairos.js";

console.log(`[${new Date().toISOString()}] connexto-axiom initializing...`);

const db = openDatabase();
try {
  runKairos(db);
} finally {
  db.close();
}
