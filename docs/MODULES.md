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

Chamada ao LLM com prompts comprimidos. Carrega system prompt do KAIROS, comprime estado, verifica limites de tokens.

- **Export:** `callKairosLLM(goals, recentDecisions)`

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

### `dailyBriefing.ts`

Formata o Daily Briefing com todas as secoes: resumo, decisoes, delegacoes, execucoes, orcamento, eficiencia, feedback, marketing, mudancas de codigo.

- **Export:** `formatDailyBriefing(output, filtered, forgeExecutions, budgetInfo, efficiencyInfo, feedbackInfo, vectorInfo, forgeCodeInfo)`

### `validateKairos.ts`

Valida e sanitiza JSON de saida do LLM. Trunca strings, valida tipos, garante estrutura.

- **Export:** `validateKairosOutput(output)`

### `types.ts`

Tipos compartilhados: `KairosDecision`, `KairosDelegation`, `KairosOutput`, `FilteredDelegations`, `BudgetInfo`, `EfficiencyInfo`, `FeedbackInfo`, `VectorInfo`, `ForgeCodeInfo`.

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

Classifica execucoes como SUCCESS, PARTIAL ou FAILURE.

- **Export:** `evaluateExecution(result, budgetConfig)`

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

## `agents/` — Configuracao de Agentes

Cada agente tem:

- `SYSTEM.md` — System prompt para o LLM
- `MEMORY.md` — Memoria persistente (placeholder)
- `config.ts` — Configuracao (nome, modelo, permissoes)

---

## `scripts/` — Scripts Utilitarios

| Script                   | Proposito                                                        |
| ------------------------ | ---------------------------------------------------------------- |
| `bootstrap.sh`           | Setup: verifica Node.js >= 24, pnpm, instala deps, inicializa DB |
| `run-kairos.sh`          | Runner de producao: compila e executa ciclo                      |
| `seed-goal.ts`           | Insere goal de exemplo                                           |
| `setup-openclaw-user.sh` | Cria usuario dedicado para OpenClaw                              |
