import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import { getAllowedWritePaths } from "../shared/policies/project-allowed-paths.js";
import { logAudit, hashContent } from "../state/auditLog.js";
import { incrementUsedTokens } from "../state/budgets.js";
import { recordTokenUsage } from "../state/tokenUsage.js";
import {
  discoverProjectStructure,
  findRelevantFiles,
  readFileContents,
} from "./fileDiscovery.js";
import type { FileContext } from "./fileDiscovery.js";
import { parseCodeOutput, parsePlanningOutput, buildFallbackPlan } from "./forgeOutputParser.js";
import {
  buildPlanningSystemPrompt,
  buildPlanningUserPrompt,
  buildExecutionSystemPrompt,
  buildExecutionUserPrompt,
  buildCorrectionUserPrompt,
} from "./forgePrompts.js";
import type {
  ForgeAgentContext,
  ForgeAgentResult,
  ForgeCodeOutput,
  ForgePlan,
  PlanningResult,
  EditResult,
  CorrectionResult,
  CorrectionRoundResult,
} from "./forgeTypes.js";
import { loadForgeAgentConfig, CHARS_PER_TOKEN_ESTIMATE } from "./forgeTypes.js";
import {
  applyEditsToWorkspace,
  restoreWorkspaceFiles,
  runLintCheck,
  readModifiedFilesState,
} from "./forgeWorkspaceOps.js";
import { callOpenClaw } from "./openclawClient.js";
import type { TokenUsageInfo } from "./openclawClient.js";

export type {
  ForgeAgentContext,
  ForgeAgentResult,
  ForgeCodeOutput,
  ForgePlan,
} from "./forgeTypes.js";
export { loadForgeAgentConfig } from "./forgeTypes.js";
export { parsePlanningOutput, parseCodeOutput } from "./forgeOutputParser.js";
export { readModifiedFilesState } from "./forgeWorkspaceOps.js";

export async function runForgeAgentLoop(
  ctx: ForgeAgentContext,
): Promise<ForgeAgentResult> {
  const { delegation, projectId, workspacePath, project } = ctx;
  let totalTokensUsed = 0;
  let phasesCompleted = 0;

  const stack = { language: project.language, framework: project.framework };
  const allowedDirs = getAllowedWritePaths(stack);

  const structure = await discoverProjectStructure(workspacePath);
  const fileTree = structure.tree;

  logger.info(
    { projectId, totalFiles: structure.totalFiles, task: delegation.task.slice(0, 80) },
    "FORGE agent loop starting - Phase 1: Planning",
  );

  const planResult = await executePlanningPhase(ctx, fileTree, allowedDirs);
  totalTokensUsed += planResult.tokensUsed;
  phasesCompleted = 1;

  if (!planResult.plan) {
    return {
      success: false,
      parsed: null,
      totalTokensUsed,
      phasesCompleted,
      error: "Planning phase failed: LLM returned invalid plan",
    };
  }

  logger.info(
    {
      projectId,
      filesToRead: planResult.plan.filesToRead.length,
      filesToModify: planResult.plan.filesToModify.length,
      approach: planResult.plan.approach.slice(0, 100),
    },
    "FORGE agent loop - Phase 1 complete, loading context",
  );

  const contextFiles = await loadContextFiles(ctx, planResult.plan);

  logger.info(
    { projectId, contextFiles: contextFiles.length },
    "FORGE agent loop - Phase 2: Execution",
  );

  const editResult = await executeEditPhase(
    ctx,
    planResult.plan,
    contextFiles,
    fileTree,
    allowedDirs,
  );
  totalTokensUsed += editResult.tokensUsed;
  phasesCompleted = 2;

  if (!editResult.parsed) {
    return {
      success: false,
      parsed: null,
      totalTokensUsed,
      phasesCompleted,
      error: "Execution phase failed: LLM returned invalid code output",
    };
  }

  logger.info(
    {
      projectId,
      filesCount: editResult.parsed.files.length,
      description: editResult.parsed.description.slice(0, 80),
    },
    "FORGE agent loop - Phase 3: Apply & Verify",
  );

  const correctionResult = await verifyAndCorrectLoop(
    ctx,
    editResult.parsed,
    planResult.plan,
    fileTree,
    allowedDirs,
    totalTokensUsed,
  );

  return {
    success: correctionResult.success,
    parsed: correctionResult.finalParsed,
    totalTokensUsed: correctionResult.totalTokensUsed,
    phasesCompleted: 2 + correctionResult.correctionRoundsUsed,
    error: correctionResult.error,
    lintOutput: correctionResult.lintOutput,
  };
}

async function executePlanningPhase(
  ctx: ForgeAgentContext,
  fileTree: string,
  allowedDirs: readonly string[],
): Promise<PlanningResult> {
  const { db, delegation, projectId, project } = ctx;
  const systemPrompt = buildPlanningSystemPrompt(project.language, project.framework);
  const userPrompt = buildPlanningUserPrompt(delegation, fileTree, allowedDirs);

  const response = await callOpenClaw({
    agentId: "forge",
    prompt: userPrompt,
    systemPrompt,
  });

  if (response.status === "failed") {
    return { plan: null, tokensUsed: 0 };
  }

  const usage = resolveUsage(response.usage, response.text, userPrompt);
  recordForgeUsage(db, delegation.goal_id, usage);

  logAudit(db, {
    agent: "forge",
    action: `planning: ${delegation.task.slice(0, 80)}`,
    inputHash: hashContent(userPrompt),
    outputHash: hashContent(response.text),
    sanitizerWarnings: [],
    runtime: "openclaw",
  });

  const plan = parsePlanningOutput(response.text);

  if (!plan) {
    logger.warn({ projectId }, "Planning phase returned invalid JSON, using fallback plan");
    return {
      plan: buildFallbackPlan(delegation),
      tokensUsed: usage.totalTokens,
    };
  }

  return { plan, tokensUsed: usage.totalTokens };
}

async function loadContextFiles(
  ctx: ForgeAgentContext,
  plan: ForgePlan,
): Promise<readonly FileContext[]> {
  const { workspacePath, delegation } = ctx;
  const config = loadForgeAgentConfig();

  const llmRequestedFiles = [
    ...plan.filesToRead,
    ...plan.filesToModify,
  ];
  const uniqueRequested = [...new Set(llmRequestedFiles)];

  const llmFiles = await readFileContents(
    workspacePath,
    uniqueRequested,
    config.contextMaxChars,
  );

  const llmFilePaths = new Set(llmFiles.map((f) => f.path));
  const remainingChars = config.contextMaxChars - llmFiles.reduce(
    (sum, f) => sum + f.content.length, 0,
  );

  let discoveredFiles: readonly FileContext[] = [];
  if (remainingChars > 2000) {
    const allDiscovered = await findRelevantFiles(workspacePath, delegation.task);
    discoveredFiles = allDiscovered.filter((f) => !llmFilePaths.has(f.path));

    let usedChars = 0;
    const filtered: FileContext[] = [];
    for (const file of discoveredFiles) {
      if (usedChars + file.content.length > remainingChars) break;
      filtered.push(file);
      usedChars += file.content.length;
    }
    discoveredFiles = filtered;
  }

  const merged = [...llmFiles, ...discoveredFiles];

  logger.info(
    {
      llmRequested: uniqueRequested.length,
      llmLoaded: llmFiles.length,
      discoveryAdded: discoveredFiles.length,
      totalContext: merged.length,
      totalChars: merged.reduce((s, f) => s + f.content.length, 0),
    },
    "Context files loaded (LLM-guided + auto-discovery)",
  );

  return merged;
}

async function executeEditPhase(
  ctx: ForgeAgentContext,
  plan: ForgePlan,
  contextFiles: readonly FileContext[],
  fileTree: string,
  allowedDirs: readonly string[],
): Promise<EditResult> {
  const { db, delegation, project } = ctx;

  const systemPrompt = buildExecutionSystemPrompt(
    project.language,
    project.framework,
    allowedDirs,
  );
  const userPrompt = buildExecutionUserPrompt(
    delegation,
    plan,
    contextFiles,
    fileTree,
    allowedDirs,
  );

  const response = await callOpenClaw({
    agentId: "forge",
    prompt: userPrompt,
    systemPrompt,
  });

  if (response.status === "failed") {
    return { parsed: null, tokensUsed: 0 };
  }

  const usage = resolveUsage(response.usage, response.text, userPrompt);
  recordForgeUsage(db, delegation.goal_id, usage);

  logAudit(db, {
    agent: "forge",
    action: `execution: ${delegation.task.slice(0, 80)}`,
    inputHash: hashContent(userPrompt),
    outputHash: hashContent(response.text),
    sanitizerWarnings: [],
    runtime: "openclaw",
  });

  const parsed = parseCodeOutput(response.text);
  return { parsed, tokensUsed: usage.totalTokens };
}

async function verifyAndCorrectLoop(
  ctx: ForgeAgentContext,
  initialParsed: ForgeCodeOutput,
  plan: ForgePlan,
  fileTree: string,
  allowedDirs: readonly string[],
  previousTokens: number,
): Promise<CorrectionResult> {
  const { projectId, workspacePath, maxCorrectionRounds } = ctx;
  let currentParsed = initialParsed;
  let totalTokensUsed = previousTokens;
  let roundsUsed = 0;

  for (let round = 0; round <= maxCorrectionRounds; round++) {
    roundsUsed = round;

    const applyResult = await applyEditsToWorkspace(
      currentParsed.files,
      workspacePath,
    );

    if (!applyResult.success) {
      logger.warn(
        { projectId, round, error: applyResult.error },
        "Edit application failed",
      );

      if (round >= maxCorrectionRounds) {
        return {
          success: false,
          finalParsed: currentParsed,
          totalTokensUsed,
          correctionRoundsUsed: roundsUsed,
          error: `Edit application failed: ${applyResult.error}`,
        };
      }

      const currentState = await readModifiedFilesState(
        currentParsed.files.map((f) => f.path),
        workspacePath,
      );

      const correctionOutput = await executeCorrectionRound(
        ctx,
        plan,
        `Edit application error: ${applyResult.error}`,
        currentState,
        fileTree,
        allowedDirs,
      );

      totalTokensUsed += correctionOutput.tokensUsed;

      if (!correctionOutput.parsed) {
        return {
          success: false,
          finalParsed: currentParsed,
          totalTokensUsed,
          correctionRoundsUsed: roundsUsed,
          error: "Correction round returned invalid output",
        };
      }

      await restoreWorkspaceFiles(currentParsed.files, workspacePath);
      currentParsed = correctionOutput.parsed;
      continue;
    }

    const lintResult = await runLintCheck(
      currentParsed.files.map((f) => f.path),
      workspacePath,
    );

    if (lintResult.success) {
      logger.info(
        { projectId, round, filesCount: currentParsed.files.length },
        "FORGE agent loop - lint passed, edits verified",
      );

      return {
        success: true,
        finalParsed: currentParsed,
        totalTokensUsed,
        correctionRoundsUsed: roundsUsed,
        lintOutput: lintResult.output,
      };
    }

    logger.warn(
      { projectId, round, lintPreview: lintResult.output.slice(0, 200) },
      "Lint failed, attempting correction",
    );

    if (round >= maxCorrectionRounds) {
      return {
        success: false,
        finalParsed: currentParsed,
        totalTokensUsed,
        correctionRoundsUsed: roundsUsed,
        lintOutput: lintResult.output,
        error: `Lint validation failed after ${round + 1} attempts`,
      };
    }

    const currentState = await readModifiedFilesState(
      currentParsed.files.map((f) => f.path),
      workspacePath,
    );

    const correctionOutput = await executeCorrectionRound(
      ctx,
      plan,
      lintResult.output,
      currentState,
      fileTree,
      allowedDirs,
    );

    totalTokensUsed += correctionOutput.tokensUsed;

    if (!correctionOutput.parsed) {
      return {
        success: false,
        finalParsed: currentParsed,
        totalTokensUsed,
        correctionRoundsUsed: roundsUsed,
        lintOutput: lintResult.output,
        error: "Correction round returned invalid output",
      };
    }

    currentParsed = correctionOutput.parsed;
  }

  return {
    success: false,
    finalParsed: currentParsed,
    totalTokensUsed,
    correctionRoundsUsed: roundsUsed,
    error: "Max correction rounds exhausted",
  };
}

async function executeCorrectionRound(
  ctx: ForgeAgentContext,
  plan: ForgePlan,
  errorOutput: string,
  currentFilesState: readonly { readonly path: string; readonly content: string }[],
  fileTree: string,
  allowedDirs: readonly string[],
): Promise<CorrectionRoundResult> {
  const { db, delegation, project } = ctx;

  const systemPrompt = buildExecutionSystemPrompt(
    project.language,
    project.framework,
    allowedDirs,
  );
  const userPrompt = buildCorrectionUserPrompt(
    delegation,
    plan,
    errorOutput,
    currentFilesState,
    fileTree,
    allowedDirs,
  );

  const response = await callOpenClaw({
    agentId: "forge",
    prompt: userPrompt,
    systemPrompt,
  });

  if (response.status === "failed") {
    return { parsed: null, tokensUsed: 0 };
  }

  const usage = resolveUsage(response.usage, response.text, userPrompt);
  recordForgeUsage(db, delegation.goal_id, usage);

  logAudit(db, {
    agent: "forge",
    action: `correction: ${delegation.task.slice(0, 80)}`,
    inputHash: hashContent(userPrompt),
    outputHash: hashContent(response.text),
    sanitizerWarnings: [],
    runtime: "openclaw",
  });

  const parsed = parseCodeOutput(response.text);
  return { parsed, tokensUsed: usage.totalTokens };
}

function resolveUsage(
  usage: TokenUsageInfo | undefined,
  responseText: string,
  prompt: string,
): TokenUsageInfo {
  if (usage) return usage;

  logger.warn("OpenClaw did not return token usage, using estimate");
  const inputTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN_ESTIMATE);
  const outputTokens = Math.ceil(responseText.length / CHARS_PER_TOKEN_ESTIMATE);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function recordForgeUsage(
  db: BetterSqlite3.Database,
  goalId: string,
  usage: TokenUsageInfo,
): void {
  const budgetConfig = loadBudgetConfig();

  recordTokenUsage(db, {
    agentId: "forge",
    taskId: goalId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  });

  const now = new Date();
  const period = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  incrementUsedTokens(db, period, usage.totalTokens);

  logger.info(
    {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      perTaskLimit: budgetConfig.perTaskTokenLimit,
    },
    "FORGE agent loop token usage recorded",
  );
}
