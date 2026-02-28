import fsPromises from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger.js";
import type { ReviewResult, ReviewSeverity } from "./openclawReview.js";
import type { ImplementationReportData } from "./claudeCliTypes.js";

const ARTIFACTS_DIR = ".axiom";

async function ensureArtifactsDir(workspacePath: string): Promise<string> {
  const dir = path.join(workspacePath, ARTIFACTS_DIR);
  await fsPromises.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeExecutionPlan(
  workspacePath: string,
  plan: {
    readonly task: string;
    readonly taskType: string;
    readonly expectedOutput: string;
    readonly filesChanged?: readonly string[];
  },
): Promise<void> {
  try {
    const dir = await ensureArtifactsDir(workspacePath);
    const content = [
      `# Execution Plan`,
      ``,
      `**Task Type:** ${plan.taskType}`,
      `**Generated:** ${new Date().toISOString()}`,
      ``,
      `## Task`,
      ``,
      plan.task,
      ``,
      `## Expected Output`,
      ``,
      plan.expectedOutput,
    ];

    if (plan.filesChanged && plan.filesChanged.length > 0) {
      content.push(``, `## Files Changed`, ``);
      for (const file of plan.filesChanged) {
        content.push(`- ${file}`);
      }
    }

    await fsPromises.writeFile(path.join(dir, "plan.md"), content.join("\n"), "utf-8");
    logger.debug("Wrote execution plan artifact");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to write execution plan artifact");
  }
}

function groupFindingsBySeverity(review: ReviewResult): Record<ReviewSeverity, readonly string[]> {
  const groups: Record<ReviewSeverity, string[]> = { CRITICAL: [], WARNING: [], INFO: [] };

  for (const finding of review.findings) {
    const location = finding.line ? `${finding.file}:${String(finding.line)}` : finding.file;
    groups[finding.severity].push(`- \`${finding.rule}\` at \`${location}\`: ${finding.message}`);
  }

  return groups;
}

export async function writeReviewReport(
  workspacePath: string,
  review: ReviewResult,
): Promise<void> {
  try {
    const dir = await ensureArtifactsDir(workspacePath);
    const infoCount = review.findings.filter((f) => f.severity === "INFO").length;
    const filesReviewed = new Set(review.findings.map((f) => f.file)).size;

    const content = [
      `# Code Review Report`,
      ``,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Result | ${review.passed ? "PASSED" : "FAILED"} |`,
      `| Critical | ${String(review.criticalCount)} |`,
      `| Warnings | ${String(review.warningCount)} |`,
      `| Info | ${String(infoCount)} |`,
      `| Files Reviewed | ${String(filesReviewed)} |`,
      `| Generated | ${new Date().toISOString()} |`,
    ];

    if (review.findings.length === 0) {
      content.push(``, `No issues found.`);
    } else {
      const groups = groupFindingsBySeverity(review);

      for (const severity of ["CRITICAL", "WARNING", "INFO"] as const) {
        if (groups[severity].length > 0) {
          content.push(``, `## ${severity}`, ``);
          content.push(...groups[severity]);
        }
      }
    }

    await fsPromises.writeFile(path.join(dir, "review.md"), content.join("\n"), "utf-8");
    logger.debug("Wrote review report artifact");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to write review report artifact");
  }
}

export async function writeImplementationReport(
  workspacePath: string,
  data: ImplementationReportData,
): Promise<void> {
  try {
    const dir = await ensureArtifactsDir(workspacePath);

    const content = [
      `# Implementation Report`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| Status | ${data.status} |`,
      `| Task Type | ${data.taskType} |`,
      `| Model | ${data.model} |`,
      `| Tokens Used | ${String(data.totalTokensUsed)} |`,
      `| Cost (USD) | $${data.totalCostUsd.toFixed(4)} |`,
      `| Duration | ${String(Math.round(data.durationMs / 1000))}s |`,
      `| Files Changed | ${String(data.filesChanged.length)} |`,
      `| Correction Cycles | ${String(data.correctionCycles)} |`,
      `| Generated | ${new Date().toISOString()} |`,
      ``,
      `## Validation Results`,
      ``,
      `| Step | Result |`,
      `|------|--------|`,
      `| Install | ${data.validations.install} |`,
      `| Lint | ${data.validations.lint} |`,
      `| Build | ${data.validations.build} |`,
      `| Tests | ${data.validations.tests} |`,
    ];

    if (data.filesChanged.length > 0) {
      content.push(``, `## Files Changed`, ``);
      for (const file of data.filesChanged) {
        content.push(`- ${file}`);
      }
    }

    await fsPromises.writeFile(path.join(dir, "implementation.md"), content.join("\n"), "utf-8");
    logger.debug("Wrote implementation report artifact");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to write implementation report artifact");
  }
}

export async function writeChangesManifest(
  workspacePath: string,
  changedFiles: readonly string[],
): Promise<void> {
  try {
    const dir = await ensureArtifactsDir(workspacePath);
    const manifest = {
      generatedAt: new Date().toISOString(),
      filesChanged: changedFiles,
      totalFiles: changedFiles.length,
    };

    await fsPromises.writeFile(
      path.join(dir, "changes.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );
    logger.debug({ totalFiles: changedFiles.length }, "Wrote changes manifest artifact");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to write changes manifest artifact");
  }
}
