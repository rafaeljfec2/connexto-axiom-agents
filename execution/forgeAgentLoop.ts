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
  expandContextWithImports,
  globSearch,
  extractKeywords,
} from "./fileDiscovery.js";
import type { FileContext, ProjectStructure } from "./fileDiscovery.js";
import { parseCodeOutput, parsePlanningOutput, buildFallbackPlan } from "./forgeOutputParser.js";
import {
  buildPlanningSystemPrompt,
  buildPlanningUserPrompt,
  buildExecutionSystemPrompt,
  buildExecutionUserPrompt,
  buildCorrectionUserPrompt,
} from "./forgePrompts.js";
import { getFrameworkDiscoveryRules, getContextualPatternsForTask } from "./frameworkRules.js";
import { readProjectConfig, formatAliasesForPrompt } from "./projectConfigReader.js";
import type { ProjectConfig } from "./projectConfigReader.js";
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
import type { ValidationConfig } from "./forgeWorkspaceOps.js";
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

const MIN_REMAINING_CHARS_FOR_EXPANSION = 2000;
const PREVIEW_MAX_FILES = 3;
const PREVIEW_MAX_CHARS = 4000;
const PREVIEW_MIN_AVAILABLE = 200;
const PRE_EXISTING_ERRORS_MAX_CHARS = 1500;
const ESCALATION_LINES = 80;

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

  logger.info(
    {
      projectId,
      filesToRead: planResult.plan.filesToRead.length,
      filesToModify: planResult.plan.filesToModify.length,
      approach: planResult.plan.approach.slice(0, 100),
    },
    "FORGE agent loop - Phase 1 complete, loading context",
  );

  const contextFiles = await loadContextFiles(ctx, planResult.plan, structure);

  let preExistingErrors = "";
  if (ctx.enablePreLintCheck) {
    preExistingErrors = await getPreExistingErrors(
      planResult.plan.filesToModify,
      workspacePath,
    );
  }

  logger.info(
    { projectId, contextFiles: contextFiles.length, hasPreExistingErrors: preExistingErrors.length > 0 },
    "FORGE agent loop - Phase 2: Execution",
  );

  const editResult = await executeEditPhase(
    ctx,
    planResult.plan,
    contextFiles,
    fileTree,
    allowedDirs,
    projectConfig,
    preExistingErrors,
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
    return {
      success: true,
      parsed: editResult.parsed,
      totalTokensUsed,
      phasesCompleted,
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

async function buildPlanningPreview(
  ctx: ForgeAgentContext,
  _structure: ProjectStructure,
): Promise<readonly FileContext[]> {
  const preview = await findRelevantFiles(
    ctx.workspacePath,
    ctx.delegation.task,
    PREVIEW_MAX_FILES,
  );

  let usedChars = 0;
  const limited: FileContext[] = [];
  for (const file of preview) {
    const available = PREVIEW_MAX_CHARS - usedChars;
    if (available <= PREVIEW_MIN_AVAILABLE) break;

    const trimmed = file.content.length > available
      ? file.content.slice(0, available) + "\n// ... truncated ..."
      : file.content;

    limited.push({ path: file.path, content: trimmed, score: file.score });
    usedChars += trimmed.length;
  }

  return limited;
}

async function getPreExistingErrors(
  filePaths: readonly string[],
  workspacePath: string,
): Promise<string> {
  const lintableFiles = filePaths.filter(
    (f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx"),
  );
  if (lintableFiles.length === 0) return "";

  try {
    const { execFile: execFileFn } = await import("node:child_process");
    const { promisify: promisifyFn } = await import("node:util");
    const execFileAsync = promisifyFn(execFileFn);

    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["tsc", "--noEmit"],
      { cwd: workspacePath, timeout: 30_000 },
    );

    const output = `${stdout}${stderr}`.trim();
    if (output.length === 0) return "";

    const relevantErrors = filterErrorsForFiles(output, lintableFiles);
    if (relevantErrors.length === 0) return "";

    logger.debug(
      { errorCount: relevantErrors.length },
      "Pre-existing TypeScript errors detected",
    );

    return relevantErrors.join("\n").slice(0, PRE_EXISTING_ERRORS_MAX_CHARS);
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };
    const raw = `${execError.stdout ?? ""}${execError.stderr ?? ""}`.trim();
    if (raw.length === 0) return "";

    const relevantErrors = filterErrorsForFiles(raw, lintableFiles);
    return relevantErrors.join("\n").slice(0, PRE_EXISTING_ERRORS_MAX_CHARS);
  }
}

function filterErrorsForFiles(output: string, filePaths: readonly string[]): readonly string[] {
  const lines = output.split("\n");
  return lines.filter((line) =>
    filePaths.some((fp) => line.includes(fp)),
  );
}

interface LlmCallResult {
  readonly text: string;
  readonly tokensUsed: number;
}

async function callLlmWithAudit(
  ctx: ForgeAgentContext,
  systemPrompt: string,
  userPrompt: string,
  actionLabel: string,
): Promise<LlmCallResult | null> {
  const response = await callOpenClaw({
    agentId: "forge",
    prompt: userPrompt,
    systemPrompt,
  });

  if (response.status === "failed") return null;

  const usage = resolveUsage(response.usage, response.text, userPrompt);
  recordForgeUsage(ctx.db, ctx.delegation.goal_id, usage);

  logAudit(ctx.db, {
    agent: "forge",
    action: `${actionLabel}: ${ctx.delegation.task.slice(0, 80)}`,
    inputHash: hashContent(userPrompt),
    outputHash: hashContent(response.text),
    sanitizerWarnings: [],
    runtime: "openclaw",
  });

  return { text: response.text, tokensUsed: usage.totalTokens };
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

async function loadContextFiles(
  ctx: ForgeAgentContext,
  plan: ForgePlan,
  structure: ProjectStructure,
): Promise<readonly FileContext[]> {
  const { workspacePath, delegation } = ctx;
  const config = loadForgeAgentConfig();

  const requestedFiles = await buildRequestedFileList(ctx, plan);
  const uniqueRequested = [...new Set(requestedFiles)];

  const llmFiles = await readFileContents(workspacePath, uniqueRequested, config.contextMaxChars);
  const allFilePaths = new Set(structure.files.map((f) => f.relativePath));
  const loadedPaths = new Set(llmFiles.map((f) => f.path));
  let totalCharsUsed = llmFiles.reduce((sum, f) => sum + f.content.length, 0);

  const importExpandedFiles = await tryExpandImports(ctx, llmFiles, allFilePaths, config.contextMaxChars - totalCharsUsed);
  totalCharsUsed += importExpandedFiles.reduce((s, f) => s + f.content.length, 0);
  for (const f of importExpandedFiles) loadedPaths.add(f.path);

  const discoveredFiles = await discoverRemainingFiles(
    workspacePath, delegation.task, config.maxContextFiles, loadedPaths, config.contextMaxChars - totalCharsUsed,
  );

  const merged = [...llmFiles, ...importExpandedFiles, ...discoveredFiles];

  logger.info(
    {
      llmRequested: uniqueRequested.length,
      llmLoaded: llmFiles.length,
      importExpanded: importExpandedFiles.length,
      discoveryAdded: discoveredFiles.length,
      totalContext: merged.length,
      totalChars: merged.reduce((s, f) => s + f.content.length, 0),
    },
    "Context files loaded (LLM-guided + imports + discovery)",
  );

  return merged;
}

async function buildRequestedFileList(
  ctx: ForgeAgentContext,
  plan: ForgePlan,
): Promise<readonly string[]> {
  const files = [...plan.filesToRead, ...plan.filesToModify];

  if (!ctx.enableFrameworkRules) return files;

  const keywords = extractKeywords(ctx.delegation.task);
  const rules = getFrameworkDiscoveryRules(ctx.project.framework);
  const contextualPatterns = getContextualPatternsForTask(rules, keywords);

  if (contextualPatterns.length === 0) return files;

  const frameworkFiles = await globSearch(ctx.workspacePath, contextualPatterns);
  for (const fp of frameworkFiles) {
    if (!files.includes(fp)) files.push(fp);
  }

  return files;
}

async function tryExpandImports(
  ctx: ForgeAgentContext,
  llmFiles: readonly FileContext[],
  allFilePaths: ReadonlySet<string>,
  remainingChars: number,
): Promise<readonly FileContext[]> {
  if (!ctx.enableImportExpansion || remainingChars <= MIN_REMAINING_CHARS_FOR_EXPANSION) return [];

  return expandContextWithImports(ctx.workspacePath, llmFiles, allFilePaths, remainingChars);
}

async function discoverRemainingFiles(
  workspacePath: string,
  task: string,
  maxFiles: number,
  loadedPaths: ReadonlySet<string>,
  remainingChars: number,
): Promise<readonly FileContext[]> {
  if (remainingChars <= MIN_REMAINING_CHARS_FOR_EXPANSION) return [];

  const allDiscovered = await findRelevantFiles(workspacePath, task, maxFiles);
  const unloaded = allDiscovered.filter((f) => !loadedPaths.has(f.path));

  let usedChars = 0;
  const filtered: FileContext[] = [];
  for (const file of unloaded) {
    if (usedChars + file.content.length > remainingChars) break;
    filtered.push(file);
    usedChars += file.content.length;
  }

  return filtered;
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

interface CorrectionLoopState {
  currentParsed: ForgeCodeOutput;
  totalTokensUsed: number;
  roundsUsed: number;
  lastFailedFile: string;
  consecutiveSearchFailures: number;
}

async function verifyAndCorrectLoop(
  ctx: ForgeAgentContext,
  initialParsed: ForgeCodeOutput,
  plan: ForgePlan,
  fileTree: string,
  allowedDirs: readonly string[],
  previousTokens: number,
): Promise<CorrectionResult> {
  const { maxCorrectionRounds } = ctx;
  const state: CorrectionLoopState = {
    currentParsed: initialParsed,
    totalTokensUsed: previousTokens,
    roundsUsed: 0,
    lastFailedFile: "",
    consecutiveSearchFailures: 0,
  };

  for (let round = 0; round <= maxCorrectionRounds; round++) {
    state.roundsUsed = round;

    const applyResult = await applyEditsToWorkspace(
      state.currentParsed.files,
      ctx.workspacePath,
    );

    if (!applyResult.success) {
      const result = await handleApplyFailure(ctx, state, plan, applyResult, round, fileTree, allowedDirs);
      if (result) return result;
      continue;
    }

    state.lastFailedFile = "";
    state.consecutiveSearchFailures = 0;

    const result = await handleApplySuccess(ctx, state, plan, round, fileTree, allowedDirs);
    if (result) return result;
  }

  return buildFailureResult(state, "Max correction rounds exhausted");
}

async function handleApplyFailure(
  ctx: ForgeAgentContext,
  state: CorrectionLoopState,
  plan: ForgePlan,
  applyResult: { readonly success: boolean; readonly error?: string },
  round: number,
  fileTree: string,
  allowedDirs: readonly string[],
): Promise<CorrectionResult | null> {
  const failedFile = extractFailedFilePath(applyResult.error ?? "");
  if (failedFile === state.lastFailedFile) {
    state.consecutiveSearchFailures++;
  } else {
    state.consecutiveSearchFailures = 1;
    state.lastFailedFile = failedFile;
  }

  logger.warn(
    { projectId: ctx.projectId, round, consecutiveSearchFailures: state.consecutiveSearchFailures, failedFile },
    "Edit application failed",
  );

  if (round >= ctx.maxCorrectionRounds || state.consecutiveSearchFailures >= 3) {
    const reason = state.consecutiveSearchFailures >= 3
      ? `Search string repeatedly not found in ${failedFile} (${state.consecutiveSearchFailures} times)`
      : `Edit application failed: ${applyResult.error}`;
    return buildFailureResult(state, reason);
  }

  const currentFileState = await readModifiedFilesState(
    state.currentParsed.files.map((f) => f.path),
    ctx.workspacePath,
  );

  const escalation = state.consecutiveSearchFailures >= 2
    ? buildSearchFailureEscalation(failedFile, currentFileState)
    : "";

  const correctionOutput = await executeCorrectionRound(
    ctx,
    plan,
    `Edit application error: ${applyResult.error}\n${escalation}`,
    currentFileState,
    fileTree,
    allowedDirs,
  );

  state.totalTokensUsed += correctionOutput.tokensUsed;

  if (!correctionOutput.parsed) {
    return buildFailureResult(state, "Correction round returned invalid output");
  }

  await restoreWorkspaceFiles(state.currentParsed.files, ctx.workspacePath);
  state.currentParsed = correctionOutput.parsed;
  return null;
}

async function handleApplySuccess(
  ctx: ForgeAgentContext,
  state: CorrectionLoopState,
  plan: ForgePlan,
  round: number,
  fileTree: string,
  allowedDirs: readonly string[],
): Promise<CorrectionResult | null> {
  const validationCfg: ValidationConfig = {
    runBuild: ctx.runBuild,
    buildTimeout: ctx.buildTimeout,
  };

  const lintResult = await runLintCheck(
    state.currentParsed.files.map((f) => f.path),
    ctx.workspacePath,
    validationCfg,
  );

  if (lintResult.success) {
    logger.info(
      { projectId: ctx.projectId, round, filesCount: state.currentParsed.files.length },
      "FORGE agent loop - lint/build passed, edits verified",
    );
    return {
      success: true,
      finalParsed: state.currentParsed,
      totalTokensUsed: state.totalTokensUsed,
      correctionRoundsUsed: state.roundsUsed,
      lintOutput: lintResult.output,
    };
  }

  logger.warn(
    { projectId: ctx.projectId, round, lintPreview: lintResult.output.slice(0, 200) },
    "Validation failed, attempting correction",
  );

  if (round >= ctx.maxCorrectionRounds) {
    return {
      ...buildFailureResult(state, `Validation failed after ${round + 1} attempts`),
      lintOutput: lintResult.output,
    };
  }

  const currentFileState = await readModifiedFilesState(
    state.currentParsed.files.map((f) => f.path),
    ctx.workspacePath,
  );

  const correctionOutput = await executeCorrectionRound(
    ctx,
    plan,
    lintResult.output,
    currentFileState,
    fileTree,
    allowedDirs,
  );

  state.totalTokensUsed += correctionOutput.tokensUsed;

  if (!correctionOutput.parsed) {
    return {
      ...buildFailureResult(state, "Correction round returned invalid output"),
      lintOutput: lintResult.output,
    };
  }

  state.currentParsed = correctionOutput.parsed;
  return null;
}

function buildFailureResult(state: CorrectionLoopState, error: string): CorrectionResult {
  return {
    success: false,
    finalParsed: state.currentParsed,
    totalTokensUsed: state.totalTokensUsed,
    correctionRoundsUsed: state.roundsUsed,
    error,
  };
}

function extractFailedFilePath(error: string): string {
  const match = /not found in ([^:]+):/.exec(error);
  return match ? match[1] : "";
}

function buildSearchFailureEscalation(
  failedFile: string,
  currentState: readonly { readonly path: string; readonly content: string }[],
): string {
  const file = currentState.find((f) => f.path === failedFile);
  if (!file) return "";

  const first80Lines = file.content.split("\n").slice(0, ESCALATION_LINES).join("\n");

  return [
    "",
    "=== ALERTA: ERRO REPETIDO ===",
    `O arquivo ${failedFile} ja falhou na busca de search strings MULTIPLAS VEZES.`,
    "Voce esta gerando search strings que NAO existem neste arquivo.",
    "PARE de inventar conteudo. Aqui estao as primeiras 80 linhas REAIS do arquivo:",
    "",
    first80Lines,
    "",
    "INSTRUCOES OBRIGATORIAS:",
    "- Copie EXATAMENTE linhas do conteudo acima para o campo 'search'.",
    "- Se este arquivo NAO precisa ser alterado para a tarefa, REMOVA-O da lista de files.",
    "- Considere se voce esta editando o ARQUIVO CORRETO para esta tarefa.",
    "=== FIM DO ALERTA ===",
  ].join("\n");
}

async function executeCorrectionRound(
  ctx: ForgeAgentContext,
  plan: ForgePlan,
  errorOutput: string,
  currentFilesState: readonly { readonly path: string; readonly content: string }[],
  fileTree: string,
  allowedDirs: readonly string[],
): Promise<CorrectionRoundResult> {
  const systemPrompt = buildExecutionSystemPrompt(ctx.project.language, ctx.project.framework, allowedDirs);
  const userPrompt = buildCorrectionUserPrompt(
    ctx.delegation, plan, errorOutput, currentFilesState, fileTree, allowedDirs,
  );

  const result = await callLlmWithAudit(ctx, systemPrompt, userPrompt, "correction");
  if (!result) return { parsed: null, tokensUsed: 0 };

  const parsed = parseCodeOutput(result.text);
  return { parsed, tokensUsed: result.tokensUsed };
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
