import type BetterSqlite3 from "better-sqlite3";
import { loadBudgetConfig } from "../config/budget.js";
import { logger } from "../config/logger.js";
import { sendTelegramMessage } from "../interfaces/telegram.js";
import type { KairosDelegation } from "../orchestration/types.js";
import { getAllowedWritePaths } from "../shared/policies/project-allowed-paths.js";
import { logAudit, hashContent } from "../state/auditLog.js";
import { incrementUsedTokens } from "../state/budgets.js";
import { saveCodeChange, updateCodeChangeStatus } from "../state/codeChanges.js";
import { getProjectById } from "../state/projects.js";
import { recordTokenUsage } from "../state/tokenUsage.js";
import { discoverProjectStructure, findRelevantFiles } from "./fileDiscovery.js";
import { callOpenClaw } from "./openclawClient.js";
import type { TokenUsageInfo } from "./openclawClient.js";
import { applyProjectCodeChange, validateAndCalculateRisk } from "./projectCodeApplier.js";
import type { FileChange } from "./projectSecurity.js";
import {
  ensureBaseClone,
  ensureBaseDependencies,
  createTaskWorkspace,
  cleanupTaskWorkspace,
} from "./projectWorkspace.js";
import type { ExecutionResult } from "./types.js";

const MAX_FILES_PER_CHANGE = 5;
const CHARS_PER_TOKEN_ESTIMATE = 4;

function buildProjectSystemPrompt(
  language: string,
  framework: string,
  allowedDirs: readonly string[],
): string {
  return [
    "Voce e o FORGE, agente de codificacao do sistema connexto-axiom.",
    `Voce esta trabalhando no codigo REAL de um projeto ${language}/${framework}.`,
    "NAO use tools. O contexto necessario esta no prompt (arvore de arquivos + conteudo).",
    "Gere APENAS JSON valido. Nenhum texto, nenhum markdown, nenhuma explicacao fora do JSON.",
    "O codigo deve ser funcional, limpo e seguir os padroes do projeto.",
    `Diretorios permitidos para escrita: ${allowedDirs.join(", ")}`,
    "Paths devem ser relativos a raiz do projeto.",
    "Use imports relativos consistentes com o projeto existente.",
    "",
    "REGRA CRITICA: O campo 'content' de cada arquivo DEVE conter o arquivo COMPLETO, do primeiro ao ultimo caractere.",
    "NUNCA gere apenas um trecho ou fragmento. O 'content' substitui o arquivo inteiro.",
    "Se o arquivo original tem 100 linhas e voce muda 1 linha, o 'content' deve ter as 100 linhas (99 iguais + 1 modificada).",
    "Se voce gerar apenas o trecho modificado, o codigo vai quebrar porque o resto do arquivo sera perdido.",
    "",
    "Formato de saida OBRIGATORIO (JSON puro, sem fences):",
    "{",
    '  "description": "Descricao curta da mudanca (max 200 chars)",',
    '  "risk": <numero 1-5>,',
    '  "rollback": "Instrucao de rollback simples",',
    '  "files": [',
    "    {",
    '      "path": "caminho/relativo/arquivo.ts",',
    '      "action": "create" | "modify",',
    '      "content": "ARQUIVO COMPLETO com a mudanca aplicada"',
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

interface ForgeProjectCodeOutput {
  readonly description: string;
  readonly risk: number;
  readonly rollback: string;
  readonly files: readonly FileChange[];
}

export async function executeProjectCode(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
  projectId: string,
): Promise<ExecutionResult> {
  const { task, goal_id } = delegation;
  const startTime = performance.now();

  try {
    const project = getProjectById(db, projectId);
    if (!project) {
      return buildResult(task, "failed", "", `Project not found: ${projectId}`, 0);
    }

    logger.info(
      { projectId, repoSource: project.repo_source, task: task.slice(0, 80) },
      "Starting project code execution",
    );

    await ensureBaseClone(projectId, project.repo_source);
    await ensureBaseDependencies(projectId);
    const workspacePath = await createTaskWorkspace(projectId, goal_id);

    try {
      const result = await executeInWorkspace(
        db,
        delegation,
        projectId,
        workspacePath,
        project,
        startTime,
      );
      return result;
    } finally {
      if (process.env.FORGE_KEEP_WORKSPACE === "true") {
        logger.info(
          { projectId, goalId: goal_id, workspacePath },
          "Keeping workspace for inspection (FORGE_KEEP_WORKSPACE=true)",
        );
      } else {
        await cleanupTaskWorkspace(projectId, goal_id);
      }
    }
  } catch (error) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, task, projectId }, "Project code execution failed");

    logAudit(db, {
      agent: "forge",
      action: task,
      inputHash: hashContent(task),
      outputHash: null,
      sanitizerWarnings: [`project_code_execution_error: ${message}`],
      runtime: "openclaw",
    });

    return buildResult(task, "failed", "", message, executionTimeMs);
  }
}

async function executeInWorkspace(
  db: BetterSqlite3.Database,
  delegation: KairosDelegation,
  projectId: string,
  workspacePath: string,
  project: { readonly language: string; readonly framework: string },
  startTime: number,
): Promise<ExecutionResult> {
  const { task, goal_id, expected_output } = delegation;
  const stack = { language: project.language, framework: project.framework };
  const allowedDirs = getAllowedWritePaths(stack);

  const structure = await discoverProjectStructure(workspacePath);
  const relevantFiles = await findRelevantFiles(workspacePath, task);

  const prompt = buildProjectCodePrompt(
    task,
    expected_output,
    goal_id,
    structure.tree,
    relevantFiles,
    allowedDirs,
  );
  const systemPrompt = buildProjectSystemPrompt(project.language, project.framework, allowedDirs);

  const response = await callOpenClaw({
    agentId: "forge",
    prompt,
    systemPrompt,
  });

  if (response.status === "failed") {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(task, "failed", "", "OpenClaw returned status: failed", executionTimeMs);
  }

  const usage = resolveUsage(response.usage, response.text, prompt);
  recordUsage(db, goal_id, usage);

  const parsed = parseCodeOutput(response.text);
  if (!parsed) {
    const executionTimeMs = Math.round(performance.now() - startTime);

    logAudit(db, {
      agent: "forge",
      action: task,
      inputHash: hashContent(prompt),
      outputHash: hashContent(response.text),
      sanitizerWarnings: ["invalid_project_code_output_json"],
      runtime: "openclaw",
    });

    return buildResult(
      task,
      "failed",
      "",
      "LLM returned invalid JSON for project code change",
      executionTimeMs,
      usage.totalTokens,
    );
  }

  if (parsed.files.length > MAX_FILES_PER_CHANGE) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(
      task,
      "failed",
      "",
      `Too many files: ${String(parsed.files.length)} (max ${String(MAX_FILES_PER_CHANGE)})`,
      executionTimeMs,
      usage.totalTokens,
    );
  }

  const riskResult = validateAndCalculateRisk(parsed.files, workspacePath);
  if (!riskResult.valid) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    return buildResult(
      task,
      "failed",
      "",
      `Path validation failed: ${riskResult.errors.join("; ")}`,
      executionTimeMs,
      usage.totalTokens,
    );
  }

  const effectiveRisk = Math.max(riskResult.risk, parsed.risk);
  const filePaths = parsed.files.map((f) => f.path);
  const pendingFilesJson = JSON.stringify(
    parsed.files.map((f) => ({ path: f.path, action: f.action, content: f.content })),
  );

  const changeId = saveCodeChange(db, {
    taskId: goal_id,
    description: parsed.description,
    filesChanged: filePaths,
    risk: effectiveRisk,
    pendingFiles: pendingFilesJson,
    projectId,
  });

  logAudit(db, {
    agent: "forge",
    action: task,
    inputHash: hashContent(prompt),
    outputHash: hashContent(JSON.stringify(parsed)),
    sanitizerWarnings: [],
    runtime: "openclaw",
  });

  if (effectiveRisk >= 3) {
    updateCodeChangeStatus(db, changeId, { status: "pending_approval" });

    const approvalMessage = formatApprovalRequest(changeId, parsed, effectiveRisk, projectId);
    await sendTelegramMessage(approvalMessage);

    const executionTimeMs = Math.round(performance.now() - startTime);
    logger.info(
      { changeId, risk: effectiveRisk, projectId },
      "Project code change requires approval",
    );

    return buildResult(
      task,
      "success",
      `Aguardando aprovacao (risk=${String(effectiveRisk)}, project=${projectId}). Change ID: ${changeId.slice(0, 8)}`,
      undefined,
      executionTimeMs,
      usage.totalTokens,
    );
  }

  const applyResult = await applyProjectCodeChange(db, changeId, parsed.files, workspacePath);

  if (applyResult.success) {
    const executionTimeMs = Math.round(performance.now() - startTime);
    logger.info({ changeId, files: filePaths, projectId }, "Project code change applied");

    return buildResult(
      task,
      "success",
      `[${projectId}] Mudanca aplicada: ${parsed.description}. Files: ${filePaths.join(", ")}`,
      undefined,
      executionTimeMs,
      usage.totalTokens,
    );
  }

  const executionTimeMs = Math.round(performance.now() - startTime);
  updateCodeChangeStatus(db, changeId, {
    status: "failed",
    testOutput: applyResult.lintOutput,
    error: applyResult.error ?? "Lint validation failed in project workspace",
  });

  return buildResult(
    task,
    "failed",
    "",
    `Project code change failed: ${applyResult.error ?? "unknown"}`,
    executionTimeMs,
    usage.totalTokens,
  );
}

function buildProjectCodePrompt(
  task: string,
  expectedOutput: string,
  goalId: string,
  fileTree: string,
  relevantFiles: readonly { readonly path: string; readonly content: string }[],
  allowedDirs: readonly string[],
): string {
  const contextBlocks = relevantFiles.map((f) => `--- ${f.path} ---\n${f.content}\n--- end ---`);

  const contextSection =
    contextBlocks.length > 0
      ? ["", "CODIGO REAL DO PROJETO:", ...contextBlocks, ""].join("\n")
      : "";

  return [
    `Tarefa: ${task}`,
    `Resultado esperado: ${expectedOutput}`,
    `Goal ID: ${goalId}`,
    `Data: ${new Date().toISOString()}`,
    "",
    "ESTRUTURA DO PROJETO:",
    fileTree.slice(0, 3000),
    "",
    `Diretorios permitidos: ${allowedDirs.join(", ")}`,
    contextSection,
    "IMPORTANTE: Responda APENAS com JSON puro, sem markdown, sem explicacoes.",
    "Baseie suas mudancas no codigo REAL mostrado acima.",
    "O campo 'content' DEVE conter o arquivo COMPLETO (todas as linhas), nao apenas o trecho modificado.",
    "Copie o arquivo original e aplique a mudanca nele. O content substitui o arquivo inteiro.",
    "Gere o JSON com as mudancas de codigo necessarias.",
  ].join("\n");
}

function parseCodeOutput(text: string): ForgeProjectCodeOutput | null {
  try {
    const jsonMatch = /\{[\s\S]*\}/.exec(text);
    if (!jsonMatch) {
      logger.error("No JSON object found in project code LLM output");
      return null;
    }

    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    return validateParsedOutput(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Failed to parse project code LLM output");
    return null;
  }
}

function validateParsedOutput(raw: Record<string, unknown>): ForgeProjectCodeOutput | null {
  if (typeof raw.description !== "string" || raw.description.length === 0) {
    logger.error("Missing or invalid description in project code output");
    return null;
  }

  if (typeof raw.risk !== "number" || raw.risk < 1 || raw.risk > 5) {
    logger.error({ risk: raw.risk }, "Invalid risk value in project code output");
    return null;
  }

  if (!Array.isArray(raw.files) || raw.files.length === 0) {
    logger.error("Missing or empty files array in project code output");
    return null;
  }

  const files = parseFileChanges(raw.files as ReadonlyArray<Record<string, unknown>>);
  if (!files) return null;

  return {
    description: raw.description.slice(0, 200),
    risk: raw.risk,
    rollback: typeof raw.rollback === "string" ? raw.rollback : "",
    files,
  };
}

function parseFileChanges(rawFiles: ReadonlyArray<Record<string, unknown>>): readonly FileChange[] | null {
  const files: FileChange[] = [];

  for (const file of rawFiles) {
    if (typeof file.path !== "string" || file.path.length === 0) {
      logger.error("Invalid file path in project code output");
      return null;
    }
    if (file.action !== "create" && file.action !== "modify") {
      logger.error({ action: file.action }, "Invalid file action in project code output");
      return null;
    }
    if (typeof file.content !== "string") {
      logger.error("Invalid file content in project code output");
      return null;
    }
    files.push({ path: file.path, action: file.action, content: file.content });
  }

  return files;
}

function formatApprovalRequest(
  changeId: string,
  parsed: ForgeProjectCodeOutput,
  risk: number,
  projectId: string,
): string {
  const shortId = changeId.slice(0, 8);
  const filesList = parsed.files.map((f) => `- ${f.action}: ${f.path}`).join("\n");

  return [
    `*[FORGE — Mudanca de Codigo (Projeto)]*`,
    "",
    `*Projeto:* ${projectId}`,
    `*ID:* ${shortId}`,
    `*Risco:* ${String(risk)}/5`,
    `*Descricao:* ${parsed.description}`,
    "",
    `*Arquivos:*`,
    filesList,
    "",
    `*Rollback:* ${parsed.rollback}`,
    "",
    String.raw`Use /approve\_change ` + `${shortId} para aprovar`,
    String.raw`Use /reject\_change ` + `${shortId} para rejeitar`,
  ].join("\n");
}

function buildResult(
  task: string,
  status: "success" | "failed",
  output: string,
  error?: string,
  executionTimeMs?: number,
  tokensUsed?: number,
): ExecutionResult {
  return { agent: "forge", task, status, output, error, executionTimeMs, tokensUsed };
}

function resolveUsage(
  usage: TokenUsageInfo | undefined,
  responseText: string,
  prompt: string,
): TokenUsageInfo {
  if (usage) return usage;

  logger.warn("OpenClaw did not return token usage for project code task, using estimate");
  const inputTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN_ESTIMATE);
  const outputTokens = Math.ceil(responseText.length / CHARS_PER_TOKEN_ESTIMATE);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function recordUsage(db: BetterSqlite3.Database, goalId: string, usage: TokenUsageInfo): void {
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
    "Project code task token usage recorded",
  );
}
