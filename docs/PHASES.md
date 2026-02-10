# Evolucao por Fases — connexto-axiom-agents

Este documento descreve todas as fases de desenvolvimento do projeto, da mais antiga a mais recente.

---

## FASE 12 — Execucao Controlada do FORGE

**Objetivo:** Permitir que o agente FORGE execute tarefas reais de forma isolada, rastreavel e com permissoes explicitas.

**Implementado:**

- **Entry point** (`src/main.ts`): inicializa banco, carrega budget, roda ciclo KAIROS
- **Ciclo KAIROS** (`orchestration/runKairos.ts`): carrega goals, chama LLM, valida output, filtra delegacoes, executa agentes
- **LLM Client** (`llm/client.ts`): cliente generico para OpenAI e Claude com retries e timeout
- **Decision Filter** (`orchestration/decisionFilter.ts`): filtra delegacoes por impact/cost/risk, aprova ate 3 por ciclo
- **Sandbox** (`execution/sandbox.ts`): diretorio isolado por agente (`sandbox/forge/`, `sandbox/vector/`), validacao de paths, limite de arquivos
- **Permissions** (`execution/permissions.ts`): permissoes explicitas por agente (`fs.write`, `fs.mkdir`, `fs.read`)
- **Forge Executor** (`execution/forgeExecutor.ts`): executor local que gera Markdown no sandbox
- **Audit Log** (`state/auditLog.ts`): rastreamento de todas as execucoes com hash de input/output
- **Output Sanitizer** (`execution/outputSanitizer.ts`): protecao contra comandos perigosos, URLs externas, conteudo binario
- **Telegram Notification** (`interfaces/telegram.ts`): envio de Daily Briefing via Telegram (Markdown com fallback para plain text)
- **Database** (`state/db.ts`, `state/schema.sql`): SQLite com WAL mode, tabelas `goals`, `tasks`, `decisions`, `metrics`, `outcomes`, `audit_log`
- **State Modules**: CRUD para goals, tasks, decisions, outcomes
- **Daily Briefing** (`orchestration/dailyBriefing.ts`): formatacao do resumo diario com decisoes, delegacoes e execucoes
- **Validation** (`orchestration/validateKairos.ts`): validacao de JSON do LLM com truncamento de strings
- **Scripts**: `bootstrap.sh` (setup), `seed-goal.ts` (dados iniciais), `run-kairos.sh` (cron)
- **Agent Configs**: diretorio `agents/` com `SYSTEM.md`, `MEMORY.md` e `config.ts` para cada agente

**Tabelas criadas:** `goals`, `tasks`, `decisions`, `metrics`, `outcomes`, `audit_log`

---

## FASE 13 — Integracao OpenClaw + Controle de Custo

**Objetivo:** Integrar o runtime OpenClaw para execucao real de LLM e implementar controle rigido de tokens/orcamento.

**Implementado:**

### Integracao OpenClaw

- **OpenClaw Client** (`execution/openclawClient.ts`): cliente HTTP para API do OpenClaw, validacao de endpoint (apenas localhost), retries, timeout
- **Forge OpenClaw Adapter** (`execution/forgeOpenClawAdapter.ts`): adapta o FORGE para rodar via OpenClaw, captura tokens, sanitiza output, salva no sandbox
- **OpenClaw Config** (`runtime/openclaw/config.json`): configuracao de agentes com sandbox isolado, tools permitidos/negados
- **Forge Writer Skill** (`runtime/openclaw/skills/forge-writer/SKILL.md`): skill para geracao de Markdown estruturado
- **Setup Script** (`scripts/setup-openclaw-user.sh`): usuario dedicado do sistema para OpenClaw

### Controle de Custo

- **Budget Config** (`config/budget.ts`): limites mensais, por agente, por task e diario via env vars
- **Budget Gate** (`execution/budgetGate.ts`): gate de execucao que verifica orcamento antes de cada task
- **Budget State** (`state/budgets.ts`): CRUD para tabela `budgets`, kill switch quando esgotado
- **Token Usage** (`state/tokenUsage.ts`): registro granular de tokens por agente/task
- **Budget Visibility**: seção de orcamento no Daily Briefing com % restante e avisos

### Compressao de Prompts

- **State Compressor** (`orchestration/stateCompressor.ts`): comprime estado para LLM (max 3 goals, 3 acoes, 1 linha por item)
- **Kairos LLM** (`orchestration/kairosLLM.ts`): chamada ao LLM com prompts comprimidos, limites de tokens (input: 800, output: 400)
- **Efficiency Metrics** (`state/efficiencyMetrics.ts`): media movel 7d de tokens/decisao

**Tabelas criadas:** `budgets`, `token_usage`

---

## FASE 14 — Feedback Loop Automatico

**Objetivo:** Fazer o sistema aprender com execucoes reais, ajustando decisoes futuras automaticamente sem intervencao humana.

**Implementado:**

- **Forge Evaluator** (`evaluation/forgeEvaluator.ts`): classifica execucoes como SUCCESS, PARTIAL ou FAILURE com base em erros, tokens usados e limites
- **Agent Feedback** (`state/agentFeedback.ts`): persistencia de grades por agente/task_type, calculo de taxa de sucesso, deteccao de tasks problematicas
- **Feedback Adjuster** (`orchestration/feedbackAdjuster.ts`): ajusta metricas de decisao (impact/cost/risk) baseado em feedback recente:
  - Falhas recorrentes → reduz impact, aumenta risk
  - Sucesso consistente → reduz risk
  - Execucoes caras → aumenta cost
- **Integracao com Decision Filter**: ajustes aplicados antes da filtragem de delegacoes
- **Visibilidade no Briefing**: taxa de sucesso por agente (7d), tasks problematicas, ajustes aplicados
- **Limites de Seguranca**: feedback apenas influencia scores, nunca cria tarefas nem altera permissoes

**Tabelas criadas:** `agent_feedback`

---

## FASE 15 — Execucao Real do Agente VECTOR

**Objetivo:** Permitir que o agente VECTOR execute tarefas reais de marketing (posts, newsletters, landing copy) em modo DRAFT, sem publicacao automatica.

**Implementado:**

- **Vector Executor** (`execution/vectorExecutor.ts`): executor que roteia para OpenClaw ou modo local
- **Vector OpenClaw Adapter** (`execution/vectorOpenClawAdapter.ts`): adapta VECTOR para OpenClaw, detecta tipo de artifact (post, newsletter, landing, editorial_calendar, analysis), salva como DRAFT
- **Vector Agent Config** (`runtime/openclaw/config.json`): workspace isolado `sandbox/vector/`, apenas tools de leitura/escrita
- **Copywriter Skill** (`runtime/openclaw/skills/vector-copywriter/SKILL.md`): skill para geracao de conteudo de marketing com briefing estruturado
- **Artifacts** (`state/artifacts.ts`): CRUD para tabela `artifacts` com status workflow (draft → approved → rejected → published)
- **Governanca**: VECTOR limitado a 2 tarefas por ciclo, custo/risco maior para publicacao externa
- **Visibilidade no Briefing**: secao dedicada com drafts criados, pendentes, custo de tokens

**Tabelas criadas:** `artifacts`

**Regras absolutas:**

- VECTOR nao publica nada sozinho
- VECTOR nao acessa rede externa
- VECTOR nao decide estrategia
- Tudo comeca como DRAFT

---

## FASE 16 — Aprovacao e Publicacao Semi-Automatica

**Objetivo:** Permitir que conteudos do VECTOR sejam revisados, aprovados e publicados de forma controlada via Telegram, com governanca explicita e rastreavel.

**Implementado:**

### Modelo de Aprovacao

- **Approval Service** (`services/approvalService.ts`): listar drafts pendentes, aprovar/rejeitar por ID
- **Artifacts expandido**: campos `approved_by`, `approved_at` na tabela `artifacts`

### Interface Telegram (Bot Persistente)

- **Bot Entry Point** (`src/bot.ts`): processo persistente separado, compartilha DB via WAL mode
- **Telegram Bot** (`interfaces/telegramBot.ts`): long-polling com comandos:
  - `/drafts` — lista drafts pendentes
  - `/approve <id>` — aprova um draft
  - `/reject <id>` — rejeita um draft
  - `/publish <id>` — publica artifact aprovado (stub)
  - `/help` — lista comandos
- **Autorizacao**: apenas `chat_id` autorizado pode executar comandos
- **IDs parciais**: primeiros 8 caracteres do UUID sao aceitos

### Publicacao Controlada (Stub)

- **Publisher** (`execution/publisher.ts`): recebe artifact aprovado, executa publicacao stub, registra em `publications`
- **Publications** (`state/publications.ts`): CRUD para tabela `publications` com canal, external_id, metricas stub

**Tabelas criadas:** `publications`

**Regras absolutas:**

- Nada publica sem aprovacao humana
- Nenhum agente decide publicar
- Toda publicacao e rastreavel
- Erro de publicacao nao tenta retry automatico

---

## FASE 17 — Metricas de Marketing e Feedback

**Objetivo:** Introduzir metricas de marketing e conectar resultados ao processo de decisao do KAIROS, usando metricas simuladas ou manuais.

**Implementado:**

### Modelo de Metricas

- **Marketing Metrics** (`state/marketingMetrics.ts`): CRUD para impressions, clicks, engagement_score por artifact
- **Marketing Feedback** (`state/marketingFeedback.ts`): CRUD para grades de performance (STRONG/AVERAGE/WEAK), agregacoes por message_type

### Coleta de Metricas

- **Metrics Collector** (`services/metricsCollector.ts`):
  - `generateStubMetrics`: metricas pseudo-aleatorias geradas automaticamente ao publicar
  - `saveManualMetrics`: metricas manuais via comando Telegram `/metrics`
  - Ambos avaliam e salvam feedback imediatamente

### Avaliacao

- **Marketing Evaluator** (`evaluation/marketingEvaluator.ts`): classifica engagement em STRONG (>= 70), AVERAGE (>= 30), WEAK (< 30)

### Ajuste de Decisao

- **Marketing Feedback Adjuster** (`orchestration/marketingFeedbackAdjuster.ts`): calcula ajustes de impact/risk baseado em performance por message_type
- **Integracao com Decision Filter**: combina ajustes de execucao + marketing para tasks do VECTOR

### Visibilidade

- Performance media (7d) no briefing
- Mensagens fortes e fracas identificadas
- Comando Telegram `/metrics <id> <impressions> <clicks> <engagement>`

**Tabelas criadas:** `marketing_metrics`, `marketing_feedback`

**Limites de seguranca:**

- Feedback apenas influencia scores, nao cria campanhas
- Nao publica automaticamente
- Todas as metricas sao rastreaveis por `source` (stub/manual/api)

---

## FASE 18 — Codificacao Governada pelo Agente FORGE

**Objetivo:** Permitir que o FORGE modifique codigo existente, implemente modulos e escreva testes de forma controlada, revisavel e reversivel, seguindo um ciclo de PR virtual.

**Implementado:**

### Modelo de Dados

- **Code Changes** (`state/codeChanges.ts`): CRUD para tabela `code_changes` com status workflow (pending → pending_approval → approved → applied → failed → rolled_back → rejected)
- Campos: `task_id`, `description`, `files_changed` (JSON), `diff` (JSON before/after), `risk` (1-5), `test_output`, `error`, `approved_by`

### Ciclo PR Virtual

- **Forge Code Executor** (`execution/forgeCodeExecutor.ts`): orquestrador completo:
  1. Detecta coding tasks por keywords ("implementar", "criar arquivo", "test", etc.)
  2. Extrai modulos relevantes do projeto e inclui como contexto no prompt
  3. Chama OpenClaw LLM com skill `forge-coder` para gerar JSON estruturado
  4. Parseia e valida JSON de saida (description, risk, files)
  5. Valida paths contra diretorios permitidos/proibidos
  6. Calcula risk automaticamente (modificacoes > criacoes, protegidos forcam risk >= 3)
  7. Persiste `code_change` com status `pending`
  8. Se risk >= 3: envia para Telegram, aguarda aprovacao
  9. Se risk < 3: aplica automaticamente

### Aplicacao e Rollback

- **Code Applier** (`execution/codeApplier.ts`):
  - `validateFilePaths`: valida contra ALLOWED_DIRECTORIES e FORBIDDEN_FILES
  - `calculateRisk`: calcula risk baseado em quantidade de arquivos, tipo de acao e paths protegidos
  - `applyCodeChange`: backup → escrita → lint → commit ou rollback
  - `rollbackCodeChange`: restaura backups a partir do diff armazenado
  - **Lint real**: `npx eslint` + `npx tsc --noEmit` via `child_process.execFile` com timeout de 30s

### Restricoes de Seguranca

**Diretorios permitidos:**

- `src/`, `orchestration/`, `execution/`, `evaluation/`, `services/`, `state/`, `config/`, `interfaces/`

**Arquivos proibidos (FORGE nunca pode tocar):**

- `agents/kairos/*` — logica de decisao
- `orchestration/decisionFilter.ts` — governanca
- `orchestration/feedbackAdjuster.ts` — governanca
- `orchestration/marketingFeedbackAdjuster.ts` — governanca
- `config/budget.ts` — controle de custo
- `execution/budgetGate.ts` — controle de custo
- `execution/permissions.ts` — permissoes
- `.env*` — segredos

**Arquivo protegido (risk forcado >= 3):**

- `state/schema.sql`

### Skill OpenClaw

- **Forge Coder** (`runtime/openclaw/skills/forge-coder/SKILL.md`): skill que instrui o LLM a gerar JSON com:
  - `description`, `risk`, `rollback`, `files[]` (path, action, content)
  - Maximo 3 arquivos por mudanca
  - Codigo TypeScript ESM sem `any`, com `readonly`, `import type`

### Aprovacao via Telegram

- **Code Change Service** (`services/codeChangeService.ts`): aprovar/rejeitar code changes
- **Novos comandos Telegram**:
  - `/changes` — lista mudancas pendentes de aprovacao
  - `/approve_change <id>` — aprova e aplica
  - `/reject_change <id>` — rejeita

### Tipos e Permissoes

- `ForgeAction` expandido: `"code.plan" | "code.apply" | "code.lint"`
- Permissoes do forge atualizadas

### Visibilidade

- `ForgeCodeInfo` no briefing:
  - Aplicadas (7d)
  - Pendentes de aprovacao
  - Falhas revertidas (7d)
  - Risco tecnico acumulado

**Tabelas criadas:** `code_changes`

**Regras absolutas:**

- Nenhuma mudanca sem decisao registrada
- Nenhuma mudanca sem diff persistido
- Nenhuma falha sem rollback
- Codigo legivel por humanos
- Menos mudancas > muitas mudancas

### Resultado do Teste

O ciclo PR virtual foi testado com sucesso:

- KAIROS delegou "Adicionar teste unitario para budgetGate" como coding task
- Forge Code Executor detectou, chamou OpenClaw, parseou JSON valido
- Arquivo `src/__tests__/budgetGate.test.ts` foi criado
- `tsc --noEmit` detectou erros no codigo gerado pelo LLM
- Rollback automatico restaurou o estado original
- FAILURE registrado no feedback, diff e test_output persistidos
- Briefing enviado com secao de mudancas de codigo

---

## FASE 22 — Agente NEXUS para Research Tecnico

**Objetivo:** Introduzir o agente NEXUS para reduzir incerteza tecnica ANTES de delegar tarefas de codigo ao FORGE, fornecendo pesquisas estruturadas com opcoes, trade-offs e riscos.

**Implementado:**

### Agente NEXUS

- **System Prompt** (`agents/nexus/SYSTEM.md`): papel de pesquisador tecnico read-only, formato de saida obrigatorio (OPCOES / PROS-CONTRAS / RISCO / RECOMENDACAO)
- **Config** (`agents/nexus/config.ts`): permissoes `["research.query"]`, sem acesso a filesystem
- **Executor** (`execution/nexusExecutor.ts`): recebe delegacao do KAIROS, constroi prompt de pesquisa, chama LLM, valida formato, persiste resultado
- **Validador** (`execution/nexusValidator.ts`): valida que output contem todas as secoes obrigatorias com formato correto
- **Avaliador** (`evaluation/nexusEvaluator.ts`): classifica execucoes como SUCCESS, PARTIAL ou FAILURE

### Modelo de Dados

- **CRUD** (`state/nexusResearch.ts`): persistencia de pesquisas com campos estruturados (question, options, pros_cons, risk_analysis, recommendation)
- **Estatisticas**: contagem de pesquisas (7d), temas recentes, riscos identificados

### Integracao com Orquestracao

- **runKairos** (`orchestration/runKairos.ts`): NEXUS executado antes do FORGE e VECTOR, com budget gate e feedback loop
- **Decision Filter**: NEXUS passa pelo mesmo filtro de delegacoes que outros agentes
- **Token Usage**: registro granular de tokens consumidos por pesquisa

### Visibilidade

- **Daily Briefing** (`orchestration/dailyBriefing.ts`): secao dedicada "Pesquisas NEXUS" com execucoes, temas recentes e riscos identificados
- **Feedback**: taxa de sucesso do NEXUS (7d) incluida na secao de feedback

### Governanca

- **Permissoes** (`execution/permissions.ts`): `nexus: ["research.query"]`
- **Budget** (`config/budget.ts`): limite de output tokens controlado por `NEXUS_MAX_OUTPUT_TOKENS`
- **Sanitizacao**: output sanitizado contra comandos perigosos e URLs externas

**Tabelas criadas:** `nexus_research`

**Regras absolutas:**

- NEXUS nunca e acionado diretamente — apenas via delegacao do KAIROS
- NEXUS nunca se comunica diretamente com FORGE ou VECTOR
- Output do NEXUS e insumo para proximas decisoes, nunca comando
- NEXUS nao escreve codigo, nao cria arquivos, nao altera repositorio
- NEXUS nao decide implementacao final
- KAIROS e o unico orquestrador
