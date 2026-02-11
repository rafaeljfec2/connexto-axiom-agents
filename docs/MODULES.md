# Modulos — connexto-axiom-agents

Referencia de todos os modulos do projeto, organizados por diretorio.

---

## `src/` — Entry Points

### `main.ts`

Entry point do ciclo KAIROS (one-shot). Abre o banco, inicializa budget e executa `runKairos()`.

### `bot.ts`

Entry point do Telegram bot (persistente). Abre o banco, inicializa budget e executa `startTelegramBot()` em long-polling.

---

## `orchestration/` — Orquestracao

### `runKairos.ts`

Ciclo principal. Carrega goals, chama LLM, valida output, filtra delegacoes, executa agentes, avalia resultados, envia briefing.

- **Export:** `runKairos(db)`

### `kairosLLM.ts`

Chamada ao LLM com prompts comprimidos e contexto historico. Carrega system prompt do KAIROS, comprime estado, injeta historico de execucoes, verifica limites de tokens. Usa modelo especifico do agente (`gpt-5.2`) via `createKairosLLMConfig()`.

- **Exports:** `callKairosLLM(goals, recentDecisions, db)`, `KairosLLMResult`

### `stateCompressor.ts`

Comprime estado para o LLM: max 3 goals, max 3 acoes recentes, 1 linha por item.

- **Export:** `compressState(goals, recentDecisions)`

### `decisionFilter.ts`

Filtra delegacoes por metricas (impact/cost/risk). Aplica ajustes de feedback. Aprova max 3 por ciclo, rejeita baixo impacto, sinaliza alto risco.

- **Export:** `filterDelegations(delegations, db, budgetConfig)`

### `feedbackAdjuster.ts`

Ajusta metricas de delegacao baseado em feedback de execucao (SUCCESS/PARTIAL/FAILURE).

- **Export:** `computeAdjustment(db, agentId, taskType, budgetConfig)`

### `marketingFeedbackAdjuster.ts`

Ajusta metricas de delegacao do VECTOR baseado em feedback de marketing (STRONG/AVERAGE/WEAK).

- **Export:** `computeMarketingAdjustment(db, messageType)`

### `historicalContext.ts`

Formata dados historicos de execucao em bloco de texto compacto para o prompt do KAIROS. Maximo ~500 chars.

- **Exports:** `buildHistoricalContext(db, agentId, days?, maxChars?)`, `injectHistoricalContext(inputText, historicalBlock)`

### `dailyBriefing.ts`

Formata o Daily Briefing com todas as secoes: resumo, decisoes, delegacoes, execucoes, orcamento, eficiencia, feedback, marketing, mudancas de codigo, historico, pesquisas NEXUS.

- **Export:** `formatDailyBriefing(output, filtered, forgeExecutions, budgetInfo, efficiencyInfo, feedbackInfo, vectorInfo, forgeCodeInfo, nexusInfo?, historicalInfo?)`

### `validateKairos.ts`

Valida e sanitiza JSON de saida do LLM. Trunca strings, valida tipos, garante estrutura.

- **Export:** `validateKairosOutput(output)`

### `types.ts`

Tipos compartilhados: `KairosDecision`, `KairosDelegation`, `KairosOutput`, `FilteredDelegations`, `BudgetInfo`, `EfficiencyInfo`, `FeedbackInfo`, `VectorInfo`, `ForgeCodeInfo`, `NexusInfo`, `HistoricalPatternInfo`.

### `dispatcher.ts`

Placeholder para roteamento futuro de tasks para agentes.

### `evaluator.ts`

Placeholder para avaliacao futura de resultados de execucao.

### `scheduler.ts`

Placeholder para agendamento futuro de agentes.

---

## `execution/` — Execucao

### `forgeExecutor.ts`

Executor do FORGE. Roteia para codigo (forgeCodeExecutor), OpenClaw ou modo local.

- **Export:** `executeForge(db, delegation)`

### `forgeCodeExecutor.ts`

Orquestrador do ciclo PR virtual. Detecta coding tasks, inclui contexto de codigo no prompt, chama OpenClaw, parseia JSON, valida paths, calcula risk, aplica ou envia para aprovacao.

- **Exports:** `isCodingTask(delegation)`, `executeForgeCode(db, delegation)`

### `codeApplier.ts`

Modulo de baixo nivel para aplicar mudancas de codigo. Backup, escrita, lint real (eslint + tsc), rollback automatico.

- **Exports:** `validateFilePaths(files)`, `calculateRisk(files, pathsRequireApproval)`, `applyCodeChange(db, changeId, files)`, `rollbackCodeChange(db, changeId)`

### `nexusExecutor.ts`

Executor do agente NEXUS. Recebe delegacao do KAIROS, constroi prompt de pesquisa, chama LLM, valida formato, persiste resultado em `nexus_research`.

- **Export:** `executeNexus(db, delegation)`

### `nexusValidator.ts`

Validador de output do NEXUS. Verifica que output contem todas as secoes obrigatorias (OPCOES, PROS-CONTRAS, RISCO, RECOMENDACAO) com formato correto.

- **Export:** `validateNexusOutput(output)`

### `projectWorkspace.ts`

Gerencia workspaces isolados para FORGE por projeto. Clona `repo_source` do manifesto para `workspaces/forge/<project_id>/<task_id>/`.

- **Exports:** `cloneProjectWorkspace(projectId, taskId, repoSource)`, `cleanupWorkspace(workspacePath)`

### `projectCodeExecutor.ts`

Executor principal do FORGE por projeto. Descobre arquivos reais (5 estrategias), monta prompt com codigo, chama LLM pedindo search/replace edits, implementa retry com feedback.

- **Exports:** `executeProjectCode(db, delegation, project)`

### `projectCodeApplier.ts`

Aplica mudancas de codigo no workspace isolado. Search/replace com fuzzy matching, remocao automatica de imports, lint, commit e push.

- **Exports:** `applySearchReplaceEdits(fullPath, relativePath, edits)`, `fixUnusedImports(filePaths, workspacePath, lintOutput)`, `lintAndAutoFix(filePaths, workspacePath)`, `commitAndFinalize(db, changeId, description, filePaths, ctx)`

### `projectGitManager.ts`

Operacoes Git no workspace isolado. Cria branches, commits (com Husky desabilitado), push para repo_source.

- **Exports:** `createBranch(branchName, cwd)`, `commitChanges(message, files, cwd)`, `pushBranchToSource(branchName, repoSource, cwd)`

### `projectSecurity.ts`

Politicas de seguranca para paths de arquivo no workspace. Define paths permitidos/proibidos, interface `FileEdit` para edicoes diff-based.

- **Exports:** `isPathAllowed(filePath)`, `isPathForbidden(filePath)`, `FileEdit`, `FileChange`

### `forgeOpenClawAdapter.ts`

Adapta FORGE para rodar via OpenClaw. Captura tokens, sanitiza output, salva Markdown no sandbox.

- **Export:** `executeForgeViaOpenClaw(db, delegation)`

### `vectorExecutor.ts`

Executor do VECTOR. Roteia para OpenClaw ou modo local.

- **Export:** `executeVector(db, delegation)`

### `vectorOpenClawAdapter.ts`

Adapta VECTOR para rodar via OpenClaw. Detecta tipo de artifact, salva como DRAFT.

- **Export:** `executeVectorViaOpenClaw(db, delegation)`

### `openclawClient.ts`

Cliente HTTP para API do OpenClaw. Validacao de endpoint (apenas localhost), retries, timeout.

- **Export:** `callOpenClaw(request)`

### `budgetGate.ts`

Gate de orcamento. Verifica limites antes de qualquer execucao de agente.

- **Export:** `checkBudget(db, agentId)`

### `outputSanitizer.ts`

Sanitiza output de LLM: remove null bytes, bloqueia shell perigoso, remove URLs, limita tamanho.

- **Export:** `sanitizeOutput(raw)`

### `publisher.ts`

Publica artifacts aprovados (stub v1). Registra em `publications`, gera metricas stub.

- **Export:** `publishArtifact(db, artifactId, channel)`

### `sandbox.ts`

Gerencia diretorios isolados por agente. Validacao de paths, limite de arquivos.

- **Exports:** `ensureSandbox()`, `resolveSandboxPath(filename)`, `ensureAgentSandbox(agentId)`, `resolveAgentSandboxPath(agentId, filename)`

### `permissions.ts`

Permissoes explicitas por agente.

- **Exports:** `hasPermission(agent, action)`, `getAllowedActions(agent)`

### `types.ts`

Tipos: `ForgeAction`, `VectorAction`, `AgentAction`, `ExecutionResult`.

---

## `evaluation/` — Avaliacao

### `forgeEvaluator.ts`

Classifica execucoes do FORGE como SUCCESS, PARTIAL ou FAILURE.

- **Export:** `evaluateExecution(result, budgetConfig)`

### `nexusEvaluator.ts`

Classifica execucoes do NEXUS como SUCCESS, PARTIAL ou FAILURE com base na completude das secoes de pesquisa.

- **Export:** `evaluateNexusExecution(result)`

### `marketingEvaluator.ts`

Classifica engagement de marketing: STRONG (>= 70), AVERAGE (>= 30), WEAK (< 30).

- **Export:** `evaluateMarketingPerformance(engagementScore)`

---

## `services/` — Servicos

### `approvalService.ts`

Gerencia aprovacao/rejeicao de artifacts (drafts).

- **Exports:** `listPendingDrafts(db)`, `approveDraft(db, artifactId, approvedBy)`, `rejectDraft(db, artifactId, rejectedBy)`

### `codeChangeService.ts`

Gerencia aprovacao/rejeicao de mudancas de codigo.

- **Exports:** `listPendingCodeChanges(db)`, `approveCodeChange(db, changeId, approvedBy)`, `rejectCodeChange(db, changeId, rejectedBy)`

### `metricsCollector.ts`

Coleta de metricas de marketing (stub + manual).

- **Exports:** `generateStubMetrics(db, artifactId, channel)`, `saveManualMetrics(db, artifactId, impressions, clicks, engagementScore)`

---

## `interfaces/` — Interfaces

### `telegram.ts`

Envio de mensagens via Telegram (Markdown com fallback plain text).

- **Export:** `sendTelegramMessage(text)`

### `telegramBot.ts`

Bot Telegram persistente com long-polling. Comandos: `/drafts`, `/approve`, `/reject`, `/publish`, `/metrics`, `/changes`, `/approve_change`, `/reject_change`, `/help`.

- **Export:** `startTelegramBot(db)`

---

## `llm/` — LLM Client

### `client.ts`

Cliente generico para OpenAI e Claude. Retries, timeout, captura de usage.

- **Exports:** `callLLM(config, request)`, `createLLMConfig()`

---

## `config/` — Configuracao

### `budget.ts`

Carrega limites de orcamento de env vars.

- **Export:** `loadBudgetConfig()`

### `logger.ts`

Logger Pino com pino-pretty em dev.

- **Export:** `logger`

---

## `state/` — Estado (Banco de Dados)

### `db.ts`

Abre e inicializa SQLite. Aplica schema e migracoes.

- **Export:** `openDatabase()`

### `schema.sql`

Schema completo com 15 tabelas e indices otimizados.

### `executionHistory.ts`

Agregacao de dados historicos de execucao para o KAIROS. Calcula taxa de sucesso, tasks problematicas, arquivos frequentes, padroes de falha recorrentes.

- **Exports:** `getExecutionHistory(db, days?)`, `getAgentSummary(db, agentId, days?)`, `getTaskTypeAggregates(db, days?)`, `getFrequentFiles(db, days?)`, `getRecurrentFailurePatterns(db, days?)`, `getFullExecutionHistoryContext(db, days?)`

### Modulos CRUD

| Modulo                 | Tabela                                     |
| ---------------------- | ------------------------------------------ |
| `goals.ts`             | `goals`                                    |
| `decisions.ts`         | `decisions`                                |
| `outcomes.ts`          | `outcomes`                                 |
| `auditLog.ts`          | `audit_log`                                |
| `budgets.ts`           | `budgets`                                  |
| `tokenUsage.ts`        | `token_usage`                              |
| `agentFeedback.ts`     | `agent_feedback`                           |
| `artifacts.ts`         | `artifacts`                                |
| `publications.ts`      | `publications`                             |
| `marketingMetrics.ts`  | `marketing_metrics`                        |
| `marketingFeedback.ts` | `marketing_feedback`                       |
| `codeChanges.ts`       | `code_changes`                             |
| `nexusResearch.ts`     | `nexus_research`                           |
| `projects.ts`          | `projects`                                 |
| `efficiencyMetrics.ts` | Queries de eficiencia (sem tabela propria) |

---

## `runtime/openclaw/` — OpenClaw

### `config.json`

Configuracao de agentes, sandbox e tools permitidos.

### Skills

| Skill               | Agente | Proposito                              |
| ------------------- | ------ | -------------------------------------- |
| `forge-writer`      | FORGE  | Geracao de Markdown estruturado        |
| `forge-coder`       | FORGE  | Geracao de JSON com mudancas de codigo |
| `vector-copywriter` | VECTOR | Geracao de conteudo de marketing       |

---

## `projects/` — Projetos

### `manifest.schema.ts`

Interface `ProjectManifest` e validacao rigorosa de manifestos YAML. Valida `projectId` (kebab-case), budget positivo, risk profile valido.

- **Exports:** `ProjectManifest`, `validateManifest(manifest)`, `ManifestValidationError`

### `manifestLoader.ts`

Carrega e parseia manifestos YAML de projetos.

- **Exports:** `loadManifest(projectId)`, `loadAllManifests()`

---

## `shared/policies/` — Politicas Cross-Project

### `project-limits.ts`

Mapeia `riskProfile` para limites concretos de operacao por projeto.

- **Exports:** `getProjectLimits(riskProfile)`, `ProjectLimits`

### `project-allowed-paths.ts`

Define paths permitidos e proibidos por projeto para operacoes de escrita do FORGE.

- **Exports:** `isAllowedPath(path, allowedPaths)`, `isForbiddenPath(path, forbiddenPaths)`

---

## `agents/` — Configuracao de Agentes

Cada agente tem:

- `SYSTEM.md` — System prompt para o LLM
- `MEMORY.md` — Memoria persistente (placeholder)
- `config.ts` — Configuracao (nome, modelo LLM, permissoes)

| Agente       | Modelo LLM       | Permissoes                                    | Status    |
| ------------ | ----------------- | --------------------------------------------- | --------- |
| **KAIROS**   | `gpt-5.2`         | —                                             | Ativo     |
| **FORGE**    | `gpt-5.3-codex`   | `fs.write`, `fs.mkdir`, `fs.read`             | Ativo     |
| **NEXUS**    | `gpt-4o-mini`     | `research.query`                              | Ativo     |
| **VECTOR**   | `gpt-4o-mini`     | `content.draft`, `content.analyze`            | Ativo     |
| **SENTINEL** | —                 | —                                             | Planejado |
| **COVENANT** | —                 | —                                             | Planejado |

---

## `scripts/` — Scripts Utilitarios

| Script                   | Proposito                                                         |
| ------------------------ | ----------------------------------------------------------------- |
| `bootstrap.sh`           | Setup: verifica Node.js >= 24, pnpm, instala deps, inicializa DB |
| `run-kairos.sh`          | Runner de producao: compila e executa ciclo                       |
| `seed-goal.ts`           | Insere goal de exemplo (aceita `--project <id>`)                 |
| `register-project.ts`    | CLI para registrar projeto: cria estrutura e manifesto template  |
| `setup-openclaw-user.sh` | Cria usuario dedicado para OpenClaw                               |
