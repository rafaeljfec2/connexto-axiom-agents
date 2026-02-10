import { loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import { runKairos } from "../orchestration/runKairos.js";
import { loadAllManifests } from "../projects/manifestLoader.js";
import { ensureCurrentBudget } from "../state/budgets.js";
import { openDatabase } from "../state/db.js";
import { syncProjectsFromManifests, getActiveProject } from "../state/projects.js";

logger.info("connexto-axiom initializing...");

const db = openDatabase();
try {
  const budgetConfig = loadBudgetConfig();
  ensureCurrentBudget(db, budgetConfig.monthlyTokenLimit);
  logger.info(
    { monthlyLimit: budgetConfig.monthlyTokenLimit, maxTasksPerDay: budgetConfig.maxTasksPerDay },
    "Budget initialized",
  );

  const manifests = loadAllManifests();
  syncProjectsFromManifests(db, manifests);

  const activeProject = getActiveProject(db);
  const projectId = activeProject?.project_id ?? "connexto-digital-signer";
  logger.info({ projectId, source: activeProject ? "manifest" : "fallback" }, "Active project resolved");

  await runKairos(db, projectId);
} finally {
  db.close();
}
