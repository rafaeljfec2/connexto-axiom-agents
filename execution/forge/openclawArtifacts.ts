import fsPromises from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger.js";
import type { ReviewResult } from "./openclawReview.js";

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

export async function writeReviewReport(
  workspacePath: string,
  review: ReviewResult,
): Promise<void> {
  try {
    const dir = await ensureArtifactsDir(workspacePath);
    const content = [
      `# Code Review Report`,
      ``,
      `**Generated:** ${new Date().toISOString()}`,
      `**Passed:** ${String(review.passed)}`,
      `**Critical:** ${String(review.criticalCount)}`,
      `**Warnings:** ${String(review.warningCount)}`,
    ];

    if (review.findings.length > 0) {
      content.push(``, `## Findings`, ``);

      for (const finding of review.findings) {
        const location = finding.line ? `${finding.file}:${String(finding.line)}` : finding.file;
        content.push(`- **[${finding.severity}]** \`${finding.rule}\` at \`${location}\`: ${finding.message}`);
      }
    } else {
      content.push(``, `No issues found.`);
    }

    await fsPromises.writeFile(path.join(dir, "review.md"), content.join("\n"), "utf-8");
    logger.debug("Wrote review report artifact");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Failed to write review report artifact");
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
