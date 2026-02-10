import type BetterSqlite3 from "better-sqlite3";
import {
  getAgentSummary,
  getTaskTypeAggregates,
  getFrequentFiles,
  getExecutionHistory,
  type TaskTypeAggregate,
  type RecentExecution,
} from "../state/executionHistory.js";

const DEFAULT_DAYS = 7;
const DEFAULT_MAX_CHARS = 500;
const MAX_TASK_DISPLAY = 60;
const MAX_RECENT_EXECUTIONS = 5;
const MAX_PROBLEMATIC_TASKS = 3;
const MAX_FREQUENT_FILES = 3;
const PROBLEMATIC_FAILURE_THRESHOLD = 2;

export function buildHistoricalContext(
  db: BetterSqlite3.Database,
  agentId: string,
  days: number = DEFAULT_DAYS,
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  const summary = getAgentSummary(db, agentId, days);

  if (summary.totalExecutions === 0) {
    return "";
  }

  const aggregates = getTaskTypeAggregates(db, agentId, days);
  const frequentFiles = getFrequentFiles(db, days, MAX_FREQUENT_FILES);
  const recentExecutions = getExecutionHistory(db, agentId, days, MAX_RECENT_EXECUTIONS);

  const lines: string[] = [
    "HISTORICO:",
    formatSummaryLine(agentId, summary.successRate, summary.totalExecutions, days),
  ];

  appendProblematicTasks(lines, aggregates);
  appendFrequentFiles(lines, frequentFiles);
  appendRecentExecutions(lines, recentExecutions);

  return truncateBlock(lines.join("\n"), maxChars);
}

function formatSummaryLine(
  agentId: string,
  successRate: number,
  totalExecutions: number,
  days: number,
): string {
  return `- ${agentId.toUpperCase()}: ${Math.round(successRate)}% sucesso (${totalExecutions} exec, ${days}d)`;
}

function appendProblematicTasks(
  lines: string[],
  aggregates: readonly TaskTypeAggregate[],
): void {
  const problematic = aggregates
    .filter((a) => a.failureCount >= PROBLEMATIC_FAILURE_THRESHOLD)
    .slice(0, MAX_PROBLEMATIC_TASKS);

  if (problematic.length === 0) return;

  const taskDescriptions = problematic.map((t) => {
    const errorHint =
      t.recurrentErrors.length > 0 ? `: ${t.recurrentErrors[0]}` : "";
    return `${truncateTask(t.taskType)} (${t.failureCount} falhas${errorHint})`;
  });

  lines.push(`- Tasks problematicas: ${taskDescriptions.join("; ")}`);
}

function appendFrequentFiles(
  lines: string[],
  frequentFiles: readonly string[],
): void {
  if (frequentFiles.length === 0) return;

  const shortFiles = frequentFiles.map(extractFileName);
  lines.push(`- Arquivos frequentes: ${shortFiles.join(", ")}`);
}

function appendRecentExecutions(
  lines: string[],
  executions: readonly RecentExecution[],
): void {
  if (executions.length === 0) return;

  lines.push("- Ultimas execucoes:");
  for (const exec of executions) {
    const tag = exec.status === "success" ? "SUCCESS" : "FAILURE";
    const errorSuffix = exec.error ? ` (${exec.error})` : "";
    const taskName = truncateTask(exec.task);
    lines.push(`  - ${taskName} -> ${tag}${errorSuffix}`);
  }
}

function truncateTask(task: string): string {
  if (task.length <= MAX_TASK_DISPLAY) return task;
  return `${task.slice(0, MAX_TASK_DISPLAY - 3)}...`;
}

function extractFileName(filePath: string): string {
  const parts = filePath.split("/");
  return parts.at(-1) ?? filePath;
}

function truncateBlock(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const lines = text.split("\n");
  let result = "";

  for (const line of lines) {
    const candidate = result.length === 0 ? line : `${result}\n${line}`;
    if (candidate.length > maxChars) break;
    result = candidate;
  }

  return result;
}
