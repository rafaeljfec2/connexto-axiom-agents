import { logger } from "../config/logger.js";
import { openDatabase } from "../state/db.js";
import { runKairos } from "../orchestration/runKairos.js";

logger.info("connexto-axiom initializing...");

const db = openDatabase();
try {
  runKairos(db);
} finally {
  db.close();
}
