import { logger } from "../../config/logger.js";
import { getAllowedWritePaths } from "../../shared/policies/project-allowed-paths.js";
import { discoverProjectStructure } from "../discovery/fileDiscovery.js";
import type { FileContext, ProjectStructure } from "../discovery/fileDiscovery.js";
import {
  buildPlanningPreview,
  loadContextFiles,
  getPreExistingErrors,
  computeFileHashes,
  checkFileHashDrift,
} from "./forgeContextLoader.js";
import { verifyAndCorrectLoop } from "./forgeCorrectionLoop.js";
import { callLlmWithAudit } from "./forgeLlmClient.js";
import { parseCodeOutput, parsePlanningOutput, buildFallbackPlan } from "./forgeOutputParser.js";
import {
  buildPlanningSystemPrompt,
  buildPlanningUserPrompt,
  buildExecutionSystemPrompt,
  buildExecutionUserPrompt,
} from "./forgePrompts.js";
import { readProjectConfig, formatAliasesForPrompt } from "../discovery/projectConfigReader.js";
import type { ProjectConfig } from "../discovery/projectConfigReader.js";
import type {
  ForgeAgentContext,
  ForgeAgentResult,
  ForgePlan,
  PlanningResult,
  EditResult,
} from "./forgeTypes.js";

export type {
  ForgeAgentContext,
  ForgeAgentResult,
  ForgeCodeOutput,
  ForgePlan,
} from "./forgeTypes.js";
export type { LlmCallResult } from "./forgeLlmClient.js";
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

  const projectConfig = await readProjectConfig(workspacePath);

  let previewFiles: readonly FileContext[] = [];
  if (ctx.enablePlanningPreview) {
    previewFiles = await buildPlanningPreview(ctx, structure);
  }

  logger.info(
    {
      projectId,
      totalFiles: structure.totalFiles,
      previewFiles: previewFiles.length,
      aliases: projectConfig.importAliases.size,
      task: delegation.task.slice(0, 80),
    },
    "FORGE agent loop starting - Phase 1: Planning",
  );

  const planResult = await executePlanningPhase(ctx, fileTree, allowedDirs, previewFiles);
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

  const validatedPlan = validatePlanAgainstWorkspace(planResult.plan, structure);

  logger.info(
    {
      projectId,
      filesToRead: validatedPlan.filesToRead.length,
      filesToModify: validatedPlan.filesToModify.length,
      approach: validatedPlan.approach.slice(0, 100),
    },
    "FORGE agent loop - Phase 1 complete, loading context",
  );

  if (validatedPlan.filesToModify.length === 0 && validatedPlan.filesToCreate.length === 0) {
    return {
      success: false,
      parsed: null,
      totalTokensUsed,
      phasesCompleted,
      error: "Planning phase failed: all planned files_to_modify do not exist in the workspace",
    };
  }

  const contextFiles = await loadContextFiles(ctx, validatedPlan, structure);

  let preExistingErrors = "";
  if (ctx.enablePreLintCheck) {
    preExistingErrors = await getPreExistingErrors(
      validatedPlan.filesToModify,
      workspacePath,
    );
  }

  const fileHashes = ctx.enableAtomicEdits
    ? await computeFileHashes(validatedPlan.filesToModify, workspacePath)
    : new Map<string, string>();

  logger.info(
    { projectId, contextFiles: contextFiles.length, hasPreExistingErrors: preExistingErrors.length > 0 },
    "FORGE agent loop - Phase 2: Execution",
  );

  const editResult = await executeEditPhase(
    ctx, validatedPlan, contextFiles, fileTree, allowedDirs, projectConfig, preExistingErrors,
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

  if (editResult.parsed.files.length === 0) {
    logger.info(
      { projectId, description: editResult.parsed.description.slice(0, 80) },
      "FORGE agent loop - no files to modify (task already done or no changes needed)",
    );
    return { success: true, parsed: editResult.parsed, totalTokensUsed, phasesCompleted };
  }

  if (fileHashes.size > 0) {
    await checkFileHashDrift(validatedPlan.filesToModify, workspacePath, fileHashes);
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
    ctx, editResult.parsed, validatedPlan, fileTree, allowedDirs, totalTokensUsed,
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
  previewFiles: readonly FileContext[] = [],
): Promise<PlanningResult> {
  const systemPrompt = buildPlanningSystemPrompt(ctx.project.language, ctx.project.framework);
  const userPrompt = buildPlanningUserPrompt(ctx.delegation, fileTree, allowedDirs, previewFiles);

  const result = await callLlmWithAudit(ctx, systemPrompt, userPrompt, "planning");
  if (!result) return { plan: null, tokensUsed: 0 };

  const plan = parsePlanningOutput(result.text);

  if (!plan) {
    logger.warn({ projectId: ctx.projectId }, "Planning phase returned invalid JSON, using fallback plan");
    return { plan: buildFallbackPlan(ctx.delegation), tokensUsed: result.tokensUsed };
  }

  return { plan, tokensUsed: result.tokensUsed };
}

async function executeEditPhase(
  ctx: ForgeAgentContext,
  plan: ForgePlan,
  contextFiles: readonly FileContext[],
  fileTree: string,
  allowedDirs: readonly string[],
  projectConfig: ProjectConfig,
  preExistingErrors: string = "",
): Promise<EditResult> {
  const aliasInfo = formatAliasesForPrompt(projectConfig);

  const systemPrompt = buildExecutionSystemPrompt(ctx.project.language, ctx.project.framework, allowedDirs);
  const userPrompt = buildExecutionUserPrompt(
    ctx.delegation, plan, contextFiles, fileTree, allowedDirs, aliasInfo, preExistingErrors,
  );

  const result = await callLlmWithAudit(ctx, systemPrompt, userPrompt, "execution");
  if (!result) return { parsed: null, tokensUsed: 0 };

  const parsed = parseCodeOutput(result.text);
  return { parsed, tokensUsed: result.tokensUsed };
}

function validatePlanAgainstWorkspace(plan: ForgePlan, structure: ProjectStructure): ForgePlan {
  const knownPaths = new Set(structure.files.map((f) => f.relativePath));

  const validModify = plan.filesToModify.filter((p) => {
    if (knownPaths.has(p)) return true;

    const similar = findSimilarPaths(p, knownPaths);
    logger.warn(
      { planned: p, suggestions: similar.slice(0, 3) },
      "Planned file_to_modify does not exist in workspace",
    );
    return false;
  });

  const validRead = plan.filesToRead.filter((p) => {
    if (knownPaths.has(p)) return true;

    logger.debug({ planned: p }, "Planned file_to_read does not exist in workspace, skipping");
    return false;
  });

  return { ...plan, filesToModify: validModify, filesToRead: validRead };
}

function findSimilarPaths(target: string, knownPaths: ReadonlySet<string>): readonly string[] {
  const targetName = target.split("/").pop() ?? target;
  const targetNameNoExt = targetName.replace(/\.[^.]+$/, "");

  const matches: string[] = [];

  for (const known of knownPaths) {
    const knownName = known.split("/").pop() ?? known;
    const knownNameNoExt = knownName.replace(/\.[^.]+$/, "");

    if (knownNameNoExt === targetNameNoExt || knownName.includes(targetNameNoExt)) {
      matches.push(known);
    }
  }

  return matches;
}
