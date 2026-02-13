import { logger } from "../../config/logger.js";
import {
  extractTypeNamesFromErrors,
  formatErrorsForPrompt,
} from "./forgeErrorParser.js";
import type { StructuredError } from "./forgeErrorParser.js";
import { callLlmWithAudit } from "./forgeLlmClient.js";
import { parseCodeOutput } from "./forgeOutputParser.js";
import {
  buildExecutionSystemPrompt,
  buildCorrectionUserPrompt,
} from "./forgePrompts.js";
import type { CorrectionAttempt } from "./forgePrompts.js";
import { findSymbolDefinitions } from "../discovery/ripgrepSearch.js";
import type {
  ForgeAgentContext,
  ForgeCodeOutput,
  ForgePlan,
  CorrectionResult,
  CorrectionRoundResult,
  ReplanContext,
} from "./forgeTypes.js";
import {
  applyEditsToWorkspace,
  restoreWorkspaceFiles,
  runLintCheck,
  readModifiedFilesState,
} from "./forgeWorkspaceOps.js";
import type { ApplyResult, ValidationConfig, ValidationResult } from "./forgeWorkspaceOps.js";

const ESCALATION_LINES = 80;
const TYPE_DEFINITION_MAX_CHARS = 1500;
const ESCALATION_SNIPPET_MAX_CHARS = 2000;
const CONSECUTIVE_VALIDATION_FAILURES_FOR_ESCALATION = 2;

interface CorrectionLoopState {
  currentParsed: ForgeCodeOutput;
  totalTokensUsed: number;
  roundsUsed: number;
  lastFailedFile: string;
  consecutiveSearchFailures: number;
  consecutiveValidationFailures: number;
  attempts: CorrectionAttempt[];
  baselineBuildFailed: boolean;
}

export async function verifyAndCorrectLoop(
  ctx: ForgeAgentContext,
  initialParsed: ForgeCodeOutput,
  plan: ForgePlan,
  fileTree: string,
  allowedDirs: readonly string[],
  previousTokens: number,
  baselineBuildFailed: boolean = false,
): Promise<CorrectionResult> {
  const { maxCorrectionRounds } = ctx;

  const state: CorrectionLoopState = {
    currentParsed: initialParsed,
    totalTokensUsed: previousTokens,
    roundsUsed: 0,
    lastFailedFile: "",
    consecutiveSearchFailures: 0,
    consecutiveValidationFailures: 0,
    attempts: [],
    baselineBuildFailed,
  };

  for (let round = 0; round <= maxCorrectionRounds; round++) {
    state.roundsUsed = round;

    const applyResult = await applyEditsToWorkspace(
      state.currentParsed.files,
      ctx.workspacePath,
      ctx.enableAtomicEdits,
    );

    if (!applyResult.success) {
      state.consecutiveValidationFailures = 0;
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
  applyResult: ApplyResult,
  round: number,
  fileTree: string,
  allowedDirs: readonly string[],
): Promise<CorrectionResult | null> {
  const failedFile = applyResult.failedFile ?? extractFailedFilePath(applyResult.error ?? "");
  if (failedFile === state.lastFailedFile) {
    state.consecutiveSearchFailures++;
  } else {
    state.consecutiveSearchFailures = 1;
    state.lastFailedFile = failedFile;
  }

  state.attempts.push({
    round,
    errorType: "apply",
    errorSummary: `Search failed in ${failedFile}: ${(applyResult.error ?? "").slice(0, 100)}`,
  });

  logger.warn(
    { projectId: ctx.projectId, round, consecutiveSearchFailures: state.consecutiveSearchFailures, failedFile },
    "Edit application failed",
  );

  if (round >= ctx.maxCorrectionRounds || state.consecutiveSearchFailures >= 2) {
    const reason = state.consecutiveSearchFailures >= 2
      ? `Search string repeatedly not found in ${failedFile} (${state.consecutiveSearchFailures} times)`
      : `Edit application failed: ${applyResult.error}`;

    const currentFileState = await readModifiedFilesState(
      [failedFile].filter(Boolean),
      ctx.workspacePath,
    );
    const fileSnippets = currentFileState.map((f) => ({
      path: f.path,
      snippet: f.content.split("\n").slice(0, 40).join("\n"),
    }));

    return buildFailureResult(state, reason, {
      shouldReplan: state.consecutiveSearchFailures >= 2,
      replanContext: {
        failedPlan: plan,
        failedFiles: [failedFile].filter(Boolean),
        failureReason: reason,
        fileSnippets,
      },
    });
  }

  await restoreWorkspaceFiles(state.currentParsed.files, ctx.workspacePath);

  const currentFileState = await readModifiedFilesState(
    state.currentParsed.files.map((f) => f.path),
    ctx.workspacePath,
  );

  const escalation = state.consecutiveSearchFailures >= 2
    ? buildSearchFailureEscalation(failedFile, currentFileState)
    : "";

  const correctionOutput = await executeCorrectionRound(ctx, {
    plan,
    errorOutput: `Edit application error: ${applyResult.error}\n${escalation}`,
    currentFilesState: currentFileState,
    fileTree,
    allowedDirs,
    appliedFiles: [...applyResult.appliedFiles],
    failedFile: applyResult.failedFile,
    failedEditIndex: applyResult.failedEditIndex,
    attempts: state.attempts,
    isWorkspaceRestored: true,
  });

  state.totalTokensUsed += correctionOutput.tokensUsed;

  if (!correctionOutput.parsed) {
    return buildFailureResult(state, "Correction round returned invalid output");
  }

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
    enableAutoFix: ctx.enableAutoFix,
    enableStructuredErrors: ctx.enableStructuredErrors,
    enableTestExecution: ctx.enableTestExecution,
    testTimeout: ctx.testTimeout,
    baselineBuildFailed: state.baselineBuildFailed,
  };

  const touchedFiles = state.currentParsed.files.map((f) => f.path);

  const lintResult: ValidationResult = await runLintCheck(
    touchedFiles,
    ctx.workspacePath,
    validationCfg,
  );

  if (lintResult.success) {
    return handleValidationSuccess(ctx, state, round, touchedFiles, lintResult);
  }

  return handleValidationFailure(ctx, state, plan, {
    round, fileTree, allowedDirs, touchedFiles, lintResult,
  });
}

interface ValidationFailureContext {
  readonly round: number;
  readonly fileTree: string;
  readonly allowedDirs: readonly string[];
  readonly touchedFiles: readonly string[];
  readonly lintResult: ValidationResult;
}

function handleValidationSuccess(
  ctx: ForgeAgentContext,
  state: CorrectionLoopState,
  round: number,
  touchedFiles: readonly string[],
  lintResult: ValidationResult,
): CorrectionResult {
  state.consecutiveValidationFailures = 0;
  logger.info(
    { projectId: ctx.projectId, round, filesCount: touchedFiles.length },
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

async function handleValidationFailure(
  ctx: ForgeAgentContext,
  state: CorrectionLoopState,
  plan: ForgePlan,
  vCtx: ValidationFailureContext,
): Promise<CorrectionResult | null> {
  const { round, fileTree, allowedDirs, touchedFiles, lintResult } = vCtx;
  state.consecutiveValidationFailures++;

  const errorType: "validation" | "test" = lintResult.testResult && !lintResult.testResult.success
    ? "test"
    : "validation";

  state.attempts.push({
    round,
    errorType,
    errorSummary: summarizeValidationErrors(lintResult),
  });

  const hasZeroStructuredErrors = lintResult.errorCount === 0 && lintResult.warningCount === 0;
  logger.warn(
    {
      projectId: ctx.projectId,
      round,
      errorCount: lintResult.errorCount,
      warningCount: lintResult.warningCount,
      consecutiveValFail: state.consecutiveValidationFailures,
      ...(hasZeroStructuredErrors ? { rawOutput: lintResult.output.slice(0, 500) } : {}),
    },
    hasZeroStructuredErrors
      ? "Validation failed with 0 parsed errors (build output below)"
      : "Validation failed, attempting correction",
  );

  if (round >= ctx.maxCorrectionRounds) {
    return {
      ...buildFailureResult(state, `Validation failed after ${round + 1} attempts`),
      lintOutput: lintResult.output,
    };
  }

  const currentFileState = await readModifiedFilesState(touchedFiles, ctx.workspacePath);

  let typeDefinitions = "";
  if (ctx.enableStructuredErrors && lintResult.errors.length > 0) {
    typeDefinitions = await enrichErrorContext(lintResult.errors, ctx.workspacePath);
  }

  let escalationSnippets = "";
  if (state.consecutiveValidationFailures >= CONSECUTIVE_VALIDATION_FAILURES_FOR_ESCALATION) {
    escalationSnippets = buildValidationEscalation(lintResult.errors, currentFileState);
  }

  let formattedErrors = ctx.enableStructuredErrors
    ? formatErrorsForPrompt(lintResult.errors, touchedFiles, 2000)
    : lintResult.output;

  if (formattedErrors.length === 0 && !lintResult.success) {
    logger.debug("Structured errors empty but validation failed, falling back to raw output");
    formattedErrors = lintResult.output.slice(0, 2000);
  }

  await restoreWorkspaceFiles(state.currentParsed.files, ctx.workspacePath);

  const correctionOutput = await executeCorrectionRound(ctx, {
    plan,
    errorOutput: formattedErrors,
    currentFilesState: currentFileState,
    fileTree,
    allowedDirs,
    appliedFiles: touchedFiles,
    attempts: state.attempts,
    typeDefinitions,
    escalationSnippets,
    isWorkspaceRestored: true,
  });

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

function summarizeValidationErrors(result: ValidationResult): string {
  if (result.errorCount === 0 && result.testResult && !result.testResult.success) {
    return `Tests failed: ${result.testResult.failedTests.slice(0, 3).join(", ")}`;
  }

  if (result.errorCount === 0 && !result.success && result.output.includes("[build FAIL]")) {
    const buildLine = result.output
      .split("\n")
      .find((l) => l.includes("[build FAIL]") || l.toLowerCase().includes("error"));
    const preview = buildLine ? buildLine.slice(0, 120) : "unknown build error";
    return `Build failed (0 lint errors): ${preview}`;
  }

  return `${result.errorCount} errors, ${result.warningCount} warnings`;
}

async function enrichErrorContext(
  errors: readonly StructuredError[],
  workspacePath: string,
): Promise<string> {
  const typeNames = extractTypeNamesFromErrors(errors);
  if (typeNames.length === 0) return "";

  const definitions: string[] = [];
  let totalChars = 0;

  for (const typeName of typeNames.slice(0, 5)) {
    try {
      const results = await findSymbolDefinitions(workspacePath, typeName);
      for (const result of results.slice(0, 2)) {
        const matchPreview = result.matchLines.slice(0, 3).join("\n");
        const snippet = `[${result.path}] ${matchPreview}`;
        if (totalChars + snippet.length > TYPE_DEFINITION_MAX_CHARS) break;
        definitions.push(snippet);
        totalChars += snippet.length + 1;
      }
    } catch {
      // ripgrep may not be available
    }
    if (totalChars > TYPE_DEFINITION_MAX_CHARS) break;
  }

  return definitions.length > 0 ? definitions.join("\n") : "";
}

function isFileRelevantToErrors(filePath: string, errorFiles: ReadonlySet<string>): boolean {
  for (const ef of errorFiles) {
    if (ef.endsWith(filePath) || filePath.endsWith(ef)) return true;
  }
  return false;
}

function buildValidationEscalation(
  errors: readonly StructuredError[],
  currentState: readonly { readonly path: string; readonly content: string }[],
): string {
  const errorFiles = new Set(errors.map((e) => e.file));
  const snippets: string[] = [];
  let totalChars = 0;

  for (const state of currentState) {
    if (!isFileRelevantToErrors(state.path, errorFiles)) continue;

    const lines = state.content.split("\n").slice(0, ESCALATION_LINES);
    const snippet = `--- ${state.path} (first ${ESCALATION_LINES} lines) ---\n${lines.join("\n")}\n--- end ---`;

    if (totalChars + snippet.length > ESCALATION_SNIPPET_MAX_CHARS) break;
    snippets.push(snippet);
    totalChars += snippet.length;
  }

  return snippets.join("\n");
}

interface FailureResultOptions {
  readonly shouldReplan?: boolean;
  readonly replanContext?: ReplanContext;
  readonly lintOutput?: string;
}

function buildFailureResult(
  state: CorrectionLoopState,
  error: string,
  options: FailureResultOptions = {},
): CorrectionResult {
  return {
    success: false,
    finalParsed: state.currentParsed,
    totalTokensUsed: state.totalTokensUsed,
    correctionRoundsUsed: state.roundsUsed,
    error,
    shouldReplan: options.shouldReplan,
    replanContext: options.replanContext,
    lintOutput: options.lintOutput,
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

type CorrectionRoundParams = Omit<import("./forgePrompts.js").CorrectionPromptContext, "delegation">;

async function executeCorrectionRound(
  ctx: ForgeAgentContext,
  params: CorrectionRoundParams,
): Promise<CorrectionRoundResult> {
  const systemPrompt = buildExecutionSystemPrompt(ctx.project.language, ctx.project.framework, params.allowedDirs);
  const userPrompt = buildCorrectionUserPrompt({ ...params, delegation: ctx.delegation });

  const result = await callLlmWithAudit(ctx, systemPrompt, userPrompt, "correction");
  if (!result) return { parsed: null, tokensUsed: 0 };

  const parsed = parseCodeOutput(result.text);
  return { parsed, tokensUsed: result.tokensUsed };
}
