import { logger } from "../../config/logger.js";
import { getAllowedWritePaths } from "../../shared/policies/project-allowed-paths.js";
import { discoverProjectStructure } from "../discovery/fileDiscovery.js";
import type { FileContext, ProjectStructure } from "../discovery/fileDiscovery.js";
import { extractKeywordsFromMultipleSources } from "../discovery/keywordExtraction.js";
import { buildRepositoryIndex, formatIndexForPrompt } from "../discovery/repositoryIndexer.js";
import {
  buildPlanningPreview,
  loadContextFiles,
  getPreExistingErrors,
  computeFileHashes,
  checkFileHashDrift,
} from "./forgeContextLoader.js";
import { verifyAndCorrectLoop } from "./forgeCorrectionLoop.js";
import { checkBaselineBuild } from "./forgeWorkspaceOps.js";
import { callLlmWithAudit } from "./forgeLlmClient.js";
import { parseCodeOutput, parsePlanningOutput, buildFallbackPlan } from "./forgeOutputParser.js";
import {
  buildPlanningSystemPrompt,
  buildPlanningUserPrompt,
  buildReplanningUserPrompt,
  buildExecutionSystemPrompt,
  buildExecutionUserPrompt,
} from "./forgePrompts.js";
import { readProjectConfig, formatAliasesForPrompt } from "../discovery/projectConfigReader.js";
import type { ProjectConfig } from "../discovery/projectConfigReader.js";
import { loadBudgetConfig } from "../../config/budget.js";
import type {
  ForgeAgentContext,
  ForgeAgentResult,
  ForgePlan,
  PlanningResult,
  EditResult,
  ReplanContext,
  NexusResearchContext,
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

  const [projectConfig, repoIndex] = await Promise.all([
    readProjectConfig(workspacePath),
    ctx.enableRepositoryIndex
      ? buildRepositoryIndex(workspacePath, structure)
      : Promise.resolve(null),
  ]);

  let previewFiles: readonly FileContext[] = [];
  if (ctx.enablePlanningPreview) {
    previewFiles = await buildPlanningPreview(ctx, structure, repoIndex);
  }

  const indexPromptSection = repoIndex
    ? formatIndexForPrompt(repoIndex)
    : "";

  logger.info(
    {
      projectId,
      totalFiles: structure.totalFiles,
      indexedFiles: repoIndex?.indexedFiles ?? 0,
      previewFiles: previewFiles.length,
      aliases: projectConfig.importAliases.size,
      task: delegation.task.slice(0, 80),
    },
    "FORGE agent loop starting - Phase 1: Planning",
  );

  const planResult = await executePlanningPhase(ctx, fileTree, allowedDirs, previewFiles, indexPromptSection);
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

  const hadPlannedFiles = planResult.plan.filesToModify.length > 0 || planResult.plan.filesToCreate.length > 0;
  const allFilesRemoved = validatedPlan.filesToModify.length === 0 && validatedPlan.filesToCreate.length === 0;

  if (hadPlannedFiles && allFilesRemoved) {
    return {
      success: false,
      parsed: null,
      totalTokensUsed,
      phasesCompleted,
      error: "Planning phase failed: all planned files_to_modify do not exist in the workspace",
    };
  }

  const taskKeywords = buildEnrichedKeywords(ctx);

  let baselineBuildFailed = false;
  if (ctx.runBuild) {
    baselineBuildFailed = await checkBaselineBuild(workspacePath, ctx.buildTimeout);
  }

  const replanFlowCtx: ReplanFlowContext = { ctx, structure, fileTree, allowedDirs, projectConfig, indexPromptSection, baselineBuildFailed };

  const emptyPlanForImplTask = isImplementationLikeTask(delegation.task)
    && validatedPlan.filesToModify.length === 0
    && validatedPlan.filesToCreate.length === 0;

  if (emptyPlanForImplTask) {
    logger.warn(
      { projectId, task: delegation.task.slice(0, 80), approach: validatedPlan.approach.slice(0, 100) },
      "FORGE agent loop - Plan has 0 files_to_modify for implementation task, forcing replan",
    );

    const emptyPlanReplanResult = await handleEmptyPlanReplan(replanFlowCtx, validatedPlan, totalTokensUsed);
    if (emptyPlanReplanResult) return emptyPlanReplanResult;

    return {
      success: false,
      parsed: null,
      totalTokensUsed,
      phasesCompleted: 1,
      error: "Planning failed: plan has no files to modify for an implementation task, and re-planning did not help",
    };
  }

  const coherenceCheck = await validatePlanCoherence(validatedPlan, workspacePath, taskKeywords);

  if (!coherenceCheck.isCoherent) {
    const earlyReplanResult = await handleIncoherentPlan(replanFlowCtx, validatedPlan, coherenceCheck, totalTokensUsed);
    if (earlyReplanResult) return earlyReplanResult;

    return {
      success: false,
      parsed: null,
      totalTokensUsed,
      phasesCompleted: 1,
      error: "Planning failed: initial plan was incoherent and re-planning did not produce a viable alternative",
    };
  }

  const executionResult = await executeAndVerifyPlan(
    ctx, validatedPlan, structure, replanFlowCtx, totalTokensUsed,
  );

  return executionResult;
}

async function executeAndVerifyPlan(
  ctx: ForgeAgentContext,
  plan: ForgePlan,
  structure: ProjectStructure,
  replanFlowCtx: ReplanFlowContext,
  baseTokensUsed: number,
): Promise<ForgeAgentResult> {
  const { projectId, workspacePath } = ctx;
  const { fileTree, allowedDirs, projectConfig } = replanFlowCtx;

  const contextFiles = await loadContextFiles(ctx, plan, structure);

  let preExistingErrors = "";
  if (ctx.enablePreLintCheck) {
    preExistingErrors = await getPreExistingErrors(plan.filesToModify, workspacePath);
  }

  const fileHashes = ctx.enableAtomicEdits
    ? await computeFileHashes(plan.filesToModify, workspacePath)
    : new Map<string, string>();

  logger.info(
    { projectId, contextFiles: contextFiles.length, hasPreExistingErrors: preExistingErrors.length > 0 },
    "FORGE agent loop - Phase 2: Execution",
  );

  const editResult = await executeEditPhase(
    ctx, plan, contextFiles, fileTree, allowedDirs, projectConfig, preExistingErrors,
  );
  let totalTokensUsed = baseTokensUsed + editResult.tokensUsed;

  if (!editResult.parsed) {
    return {
      success: false,
      parsed: null,
      totalTokensUsed,
      phasesCompleted: 2,
      error: "Execution phase failed: LLM returned invalid code output",
    };
  }

  if (editResult.parsed.files.length === 0) {
    const planHadFiles = plan.filesToModify.length > 0 || plan.filesToCreate.length > 0;

    if (planHadFiles) {
      logger.warn(
        { projectId, plannedModify: plan.filesToModify, plannedCreate: plan.filesToCreate, description: editResult.parsed.description.slice(0, 80) },
        "FORGE agent loop - execution returned 0 files despite plan having files to modify (suspicious)",
      );
      return {
        success: false,
        parsed: editResult.parsed,
        totalTokensUsed,
        phasesCompleted: 2,
        error: "Execution phase returned no edits despite plan specifying files to modify",
      };
    }

    logger.info(
      { projectId, description: editResult.parsed.description.slice(0, 80) },
      "FORGE agent loop - no files to modify (task already done or no changes needed)",
    );
    return { success: true, parsed: editResult.parsed, totalTokensUsed, phasesCompleted: 2 };
  }

  if (fileHashes.size > 0) {
    await checkFileHashDrift(plan.filesToModify, workspacePath, fileHashes);
  }

  logger.info(
    {
      projectId,
      filesCount: editResult.parsed.files.length,
      description: editResult.parsed.description.slice(0, 80),
      baselineBuildFailed: replanFlowCtx.baselineBuildFailed,
    },
    "FORGE agent loop - Phase 3: Apply & Verify",
  );

  const correctionResult = await verifyAndCorrectLoop(
    ctx, editResult.parsed, plan, fileTree, allowedDirs, totalTokensUsed, replanFlowCtx.baselineBuildFailed,
  );

  if (correctionResult.success) {
    return {
      success: true,
      parsed: correctionResult.finalParsed,
      totalTokensUsed: correctionResult.totalTokensUsed,
      phasesCompleted: 2 + correctionResult.correctionRoundsUsed,
      lintOutput: correctionResult.lintOutput,
    };
  }

  if (correctionResult.shouldReplan && correctionResult.replanContext) {
    const postReplanResult = await handlePostCorrectionReplan(replanFlowCtx, correctionResult);
    if (postReplanResult) return postReplanResult;
  }

  return {
    success: false,
    parsed: correctionResult.finalParsed,
    totalTokensUsed: correctionResult.totalTokensUsed,
    phasesCompleted: 2 + correctionResult.correctionRoundsUsed,
    error: correctionResult.error,
    lintOutput: correctionResult.lintOutput,
  };
}

interface ReplanFlowContext {
  readonly ctx: ForgeAgentContext;
  readonly structure: ProjectStructure;
  readonly fileTree: string;
  readonly allowedDirs: readonly string[];
  readonly projectConfig: ProjectConfig;
  readonly indexPromptSection: string;
  readonly baselineBuildFailed: boolean;
}

async function executeReplanFlow(
  flowCtx: ReplanFlowContext,
  replanContext: ReplanContext,
  baseTokensUsed: number,
): Promise<ForgeAgentResult | null> {
  const { ctx, structure, fileTree, allowedDirs, projectConfig, indexPromptSection } = flowCtx;

  const replanResult = await executeReplanningPhase(ctx, fileTree, allowedDirs, replanContext, indexPromptSection);
  const tokensAfterReplan = baseTokensUsed + replanResult.tokensUsed;

  if (!replanResult.plan) return null;

  const revalidated = validatePlanAgainstWorkspace(replanResult.plan, structure);
  const hasNewFiles = revalidated.filesToModify.length > 0 || revalidated.filesToCreate.length > 0;

  if (!hasNewFiles) return null;

  logger.info(
    { projectId: ctx.projectId, newFilesToModify: revalidated.filesToModify },
    "FORGE agent loop - Re-plan produced valid alternative, continuing with new plan",
  );

  const replanContextFiles = await loadContextFiles(ctx, revalidated, structure);

  const replanEditResult = await executeEditPhase(
    ctx, revalidated, replanContextFiles, fileTree, allowedDirs, projectConfig, "",
  );
  const tokensAfterEdit = tokensAfterReplan + replanEditResult.tokensUsed;

  if (replanEditResult.parsed?.files.length === 0) {
    return { success: true, parsed: replanEditResult.parsed, totalTokensUsed: tokensAfterEdit, phasesCompleted: 3 };
  }

  if (!replanEditResult.parsed || replanEditResult.parsed.files.length === 0) return null;

  const replanCorrectionResult = await verifyAndCorrectLoop(
    ctx, replanEditResult.parsed, revalidated, fileTree, allowedDirs, tokensAfterEdit, flowCtx.baselineBuildFailed,
  );

  return {
    success: replanCorrectionResult.success,
    parsed: replanCorrectionResult.finalParsed,
    totalTokensUsed: replanCorrectionResult.totalTokensUsed,
    phasesCompleted: 4 + replanCorrectionResult.correctionRoundsUsed,
    error: replanCorrectionResult.error,
    lintOutput: replanCorrectionResult.lintOutput,
  };
}

async function handleIncoherentPlan(
  flowCtx: ReplanFlowContext,
  validatedPlan: ForgePlan,
  coherenceCheck: CoherenceValidation,
  baseTokensUsed: number,
): Promise<ForgeAgentResult | null> {
  logger.info(
    { projectId: flowCtx.ctx.projectId, suspiciousFiles: coherenceCheck.suspiciousFiles },
    "FORGE agent loop - Plan incoherent, attempting immediate re-plan",
  );

  const earlyReplanContext: ReplanContext = {
    failedPlan: validatedPlan,
    failedFiles: coherenceCheck.suspiciousFiles,
    failureReason: "Plan coherence check failed: none of the planned files contain keywords related to the task",
    fileSnippets: [],
  };

  return executeReplanFlow(flowCtx, earlyReplanContext, baseTokensUsed);
}

async function handlePostCorrectionReplan(
  flowCtx: ReplanFlowContext,
  correctionResult: import("./forgeTypes.js").CorrectionResult,
): Promise<ForgeAgentResult | null> {
  if (!correctionResult.replanContext) return null;

  const budgetConfig = loadBudgetConfig();
  const tokenBudgetRemaining = budgetConfig.perTaskTokenLimit - correctionResult.totalTokensUsed;
  const minTokensForReplan = budgetConfig.perTaskTokenLimit * 0.3;

  if (tokenBudgetRemaining < minTokensForReplan) {
    logger.warn(
      { projectId: flowCtx.ctx.projectId, tokensUsed: correctionResult.totalTokensUsed, tokensRemaining: tokenBudgetRemaining },
      "FORGE agent loop - Insufficient token budget for re-planning",
    );
    return null;
  }

  logger.info(
    {
      projectId: flowCtx.ctx.projectId,
      failedFiles: correctionResult.replanContext.failedFiles,
      tokensUsed: correctionResult.totalTokensUsed,
      tokensRemaining: tokenBudgetRemaining,
    },
    "FORGE agent loop - Initiating re-planning after correction failure",
  );

  const result = await executeReplanFlow(flowCtx, correctionResult.replanContext, correctionResult.totalTokensUsed);

  if (!result) {
    logger.warn(
      { projectId: flowCtx.ctx.projectId },
      "FORGE agent loop - Re-planning did not produce a viable alternative plan",
    );
  }

  return result;
}

const IMPLEMENTATION_VERBS: ReadonlySet<string> = new Set([
  "aplicar", "apply", "implementar", "implement",
  "criar", "create", "adicionar", "add",
  "alterar", "change", "modificar", "modify",
  "override", "substituir", "replace", "trocar",
]);

function isImplementationLikeTask(task: string): boolean {
  const normalized = task.toLowerCase();
  for (const verb of IMPLEMENTATION_VERBS) {
    if (normalized.includes(verb)) return true;
  }
  return false;
}

async function handleEmptyPlanReplan(
  flowCtx: ReplanFlowContext,
  emptyPlan: ForgePlan,
  baseTokensUsed: number,
): Promise<ForgeAgentResult | null> {
  const replanContext: ReplanContext = {
    failedPlan: emptyPlan,
    failedFiles: [],
    failureReason: "O plano anterior nao escolheu nenhum arquivo para modificar, "
      + "mas a tarefa exige mudancas de codigo. "
      + "Voce DEVE escolher arquivos em files_to_modify. "
      + "Use o indice de exports e a arvore de arquivos para identificar "
      + "o arquivo correto que contem o codigo relacionado a tarefa.",
    fileSnippets: [],
  };

  return executeReplanFlow(flowCtx, replanContext, baseTokensUsed);
}

function buildEnrichedKeywords(ctx: ForgeAgentContext): readonly string[] {
  const sources: string[] = [ctx.delegation.task];

  if (ctx.delegation.expected_output) {
    sources.push(ctx.delegation.expected_output);
  }

  if (ctx.goalContext?.title) {
    sources.push(ctx.goalContext.title);
  }
  if (ctx.goalContext?.description) {
    sources.push(ctx.goalContext.description);
  }

  if (ctx.nexusResearch) {
    for (const research of ctx.nexusResearch) {
      sources.push(research.question);
      if (research.recommendation) {
        sources.push(research.recommendation);
      }
    }
  }

  return extractKeywordsFromMultipleSources(sources);
}

function formatGoalSection(ctx: ForgeAgentContext): string {
  if (!ctx.goalContext) return "";
  const desc = ctx.goalContext.description ? ` — ${ctx.goalContext.description}` : "";
  return `Goal: ${ctx.goalContext.title}${desc}\n`;
}

const NEXUS_CONTEXT_MAX_CHARS = 800;

function buildNexusContextSection(
  nexusResearch: readonly NexusResearchContext[] | undefined,
): string {
  if (!nexusResearch || nexusResearch.length === 0) return "";

  const lines = [
    "CONTEXTO DE PESQUISA NEXUS (resultados de pesquisa previa sobre o goal):",
  ];

  for (const research of nexusResearch) {
    lines.push(`- Pergunta: ${research.question}`);
    if (research.recommendation) {
      lines.push(`- Recomendacao: ${research.recommendation}`);
    }
  }

  lines.push(
    "",
    "Use as informacoes do NEXUS acima para entender EXATAMENTE o que a tarefa pede.",
    "Os caminhos e arquivos mencionados pelo NEXUS sao pistas importantes.",
    "",
  );

  const section = lines.join("\n");
  return section.length > NEXUS_CONTEXT_MAX_CHARS
    ? `${section.slice(0, NEXUS_CONTEXT_MAX_CHARS)}...\n`
    : section;
}

async function executePlanningPhase(
  ctx: ForgeAgentContext,
  fileTree: string,
  allowedDirs: readonly string[],
  previewFiles: readonly FileContext[] = [],
  indexPromptSection: string = "",
): Promise<PlanningResult> {
  const systemPrompt = buildPlanningSystemPrompt(ctx.project.language, ctx.project.framework);
  const nexusSection = buildNexusContextSection(ctx.nexusResearch);
  const goalSection = formatGoalSection(ctx);
  const userPrompt = buildPlanningUserPrompt(ctx.delegation, fileTree, allowedDirs, previewFiles, indexPromptSection, nexusSection, goalSection);

  const result = await callLlmWithAudit(ctx, systemPrompt, userPrompt, "planning");
  if (!result) return { plan: null, tokensUsed: 0 };

  const plan = parsePlanningOutput(result.text);

  if (!plan) {
    logger.warn({ projectId: ctx.projectId }, "Planning phase returned invalid JSON, using fallback plan");
    return { plan: buildFallbackPlan(ctx.delegation), tokensUsed: result.tokensUsed };
  }

  return { plan, tokensUsed: result.tokensUsed };
}

async function executeReplanningPhase(
  ctx: ForgeAgentContext,
  fileTree: string,
  allowedDirs: readonly string[],
  replanContext: ReplanContext,
  indexPromptSection: string = "",
): Promise<PlanningResult> {
  const systemPrompt = buildPlanningSystemPrompt(ctx.project.language, ctx.project.framework);
  const userPrompt = buildReplanningUserPrompt(
    ctx.delegation,
    fileTree,
    allowedDirs,
    replanContext.failedPlan,
    replanContext.failureReason,
    replanContext.fileSnippets,
    indexPromptSection,
  );

  const result = await callLlmWithAudit(ctx, systemPrompt, userPrompt, "replanning");
  if (!result) return { plan: null, tokensUsed: 0 };

  const plan = parsePlanningOutput(result.text);

  if (!plan) {
    logger.warn({ projectId: ctx.projectId }, "Re-planning phase returned invalid JSON");
    return { plan: null, tokensUsed: result.tokensUsed };
  }

  const hasSameFiles = plan.filesToModify.some((f) =>
    replanContext.failedFiles.includes(f),
  );

  if (hasSameFiles) {
    logger.warn(
      { projectId: ctx.projectId, overlappingFiles: plan.filesToModify.filter((f) => replanContext.failedFiles.includes(f)) },
      "Re-plan chose same files that already failed, rejecting",
    );
    return { plan: null, tokensUsed: result.tokensUsed };
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
  const nexusSection = buildNexusContextSection(ctx.nexusResearch);
  const goalSection = formatGoalSection(ctx);

  const systemPrompt = buildExecutionSystemPrompt(ctx.project.language, ctx.project.framework, allowedDirs);
  const userPrompt = buildExecutionUserPrompt({
    delegation: ctx.delegation, plan, contextFiles, fileTree, allowedDirs,
    aliasInfo, preExistingErrors, nexusContextSection: nexusSection, goalSection,
  });

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

const COHERENCE_MAX_LINES = 600;

export interface CoherenceValidation {
  readonly isCoherent: boolean;
  readonly suspiciousFiles: readonly string[];
}

const STYLE_FILE_EXTENSIONS: ReadonlySet<string> = new Set([".css", ".scss", ".less"]);
const STYLE_TASK_KEYWORDS: ReadonlySet<string> = new Set([
  "theme", "dark", "light", "color", "style", "css", "token",
  "override", "vermelho", "red", "brand", "palette", "tema",
]);

function isStyleFileForStyleTask(filePath: string, lowerKeywords: readonly string[]): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (!STYLE_FILE_EXTENSIONS.has(ext)) return false;
  return lowerKeywords.some((kw) => STYLE_TASK_KEYWORDS.has(kw));
}

function fileMatchesKeywords(
  filePath: string,
  content: string,
  lowerKeywords: readonly string[],
): boolean {
  const contentToCheck = content.split("\n").slice(0, COHERENCE_MAX_LINES).join("\n").toLowerCase();
  if (lowerKeywords.some((kw) => contentToCheck.includes(kw))) return true;

  const pathLower = filePath.toLowerCase();
  if (lowerKeywords.some((kw) => pathLower.includes(kw))) return true;

  return isStyleFileForStyleTask(filePath, lowerKeywords);
}

export async function validatePlanCoherence(
  plan: ForgePlan,
  workspacePath: string,
  taskKeywords: readonly string[],
): Promise<CoherenceValidation> {
  if (plan.filesToModify.length === 0 || taskKeywords.length === 0) {
    return { isCoherent: true, suspiciousFiles: [] };
  }

  const lowerKeywords = taskKeywords.map((k) => k.toLowerCase());
  const suspiciousFiles: string[] = [];
  let anyFileHasKeyword = false;

  const readResults = await Promise.allSettled(
    plan.filesToModify.map(async (filePath) => {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const content = await readFile(join(workspacePath, filePath), "utf-8");
      return { filePath, content };
    }),
  );

  for (const result of readResults) {
    if (result.status !== "fulfilled") continue;

    const { filePath, content } = result.value;

    if (fileMatchesKeywords(filePath, content, lowerKeywords)) {
      anyFileHasKeyword = true;
    } else {
      suspiciousFiles.push(filePath);
    }
  }

  const isCoherent = anyFileHasKeyword || suspiciousFiles.length < plan.filesToModify.length;

  if (!isCoherent) {
    logger.warn(
      { suspiciousFiles, keywords: lowerKeywords },
      "Plan coherence check failed: no planned file contains task keywords",
    );
  }

  return { isCoherent, suspiciousFiles };
}
