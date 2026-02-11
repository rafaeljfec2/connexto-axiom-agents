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

---

## FASE 23.1 -- Manifesto de Projeto e Estrutura Base

**Objetivo:** Introduzir suporte a multiplos projetos como camada sobre a arquitetura existente, sem mover arquivos ou quebrar imports. O conceito de `project_id` e adicionado progressivamente nas tabelas e fluxos.

**Abordagem:** Camada por cima (layer on top) com banco unico e coluna `project_id`.

### Componentes Implementados

1. **Manifest Schema** (`projects/manifest.schema.ts`): interface `ProjectManifest`, validacao rigorosa (`projectId` kebab-case, budget positivo, risk profile valido), tipo `ManifestValidationError`
2. **Manifest Loader** (`projects/manifestLoader.ts`): `loadManifest(projectId)` e `loadAllManifests()` para carregar e parsear YAML
3. **Tabela `projects`** (`state/schema.sql`): armazena manifestos com campos de runtime (`tokens_used_month`, `created_at`, `updated_at`)
4. **Migration** (`state/db.ts`): `migrateGoalsProjectId()` adiciona coluna `project_id` na tabela `goals` e migra existentes para `"default"`
5. **Projects CRUD** (`state/projects.ts`): `saveProject`, `getActiveProject`, `getAllProjects`, `getProjectById`, `updateProjectStatus`, `getProjectTokenUsage`, `incrementProjectTokens`, `syncProjectsFromManifests`
6. **Project Limits** (`shared/policies/project-limits.ts`): mapeia `riskProfile` para limites concretos (`maxRiskLevel`, `maxFilesPerChange`, `approvalRequiredAboveRisk`)
7. **Goals por Projeto** (`state/goals.ts`): `loadGoalsByProject(db, projectId)` filtra goals por projeto
8. **Default Manifest** (`projects/default/manifest.yaml`): projeto existente registrado como `"default"` com `status: active`
9. **Register Script** (`scripts/register-project.ts`): CLI para criar estrutura de projeto e manifesto template
10. **Seed Goal** (`scripts/seed-goal.ts`): aceita `--project <id>` para associar goals a projetos

### Integracao

- **main.ts**: carrega manifestos, sincroniza com DB, resolve projeto ativo, passa `projectId` para `runKairos`
- **runKairos**: aceita `projectId` opcional, filtra goals por projeto quando informado

### Retrocompatibilidade

- Se `projects/` nao existir ou estiver vazio, o sistema usa `projectId = "default"`
- Goals existentes sem `project_id` sao migrados automaticamente para `"default"`
- `runKairos(db)` sem segundo argumento continua funcionando como antes
- Nenhum fluxo existente quebra

### Regra de Ouro

No maximo 1 projeto `active` por ciclo. Se houver mais de 1, o sistema loga warning e usa o primeiro por ordem de criacao.

**Tabelas criadas:** `projects`
**Colunas adicionadas:** `goals.project_id`

---

## FASE 23.2 -- FORGE por Projeto com Modificacao Controlada do Repositorio Real

**Objetivo:** Permitir que o FORGE leia o codigo-fonte REAL do projeto ativo, gere mudancas CONCRETAS baseadas no codigo existente e proponha alteracoes via branch/PR mantendo isolamento, rastreabilidade e controle humano.

**Principio Central:** FORGE nunca trabalha em abstracao. FORGE sempre trabalha sobre o repositorio definido em `manifest.yaml`.

### Componentes Implementados

1. **Project Workspace** (`execution/projectWorkspace.ts`): clona `repo_source` do manifesto para workspace isolado (`workspaces/forge/<project_id>/<task_id>/`), garante que FORGE nunca opera no repo original
2. **Project Security** (`execution/projectSecurity.ts`): define paths permitidos (`src/**`, `app/**`, `components/**`, `packages/**`, `tests/**`) e proibidos (`.git/**`, `node_modules/**`, `.env*`), interface `FileEdit { search, replace }` para edicoes diff-based
3. **Project Code Executor** (`execution/projectCodeExecutor.ts`): executor principal do FORGE por projeto:
   - Resolve contexto do projeto (manifesto, `repo_source`)
   - Descobre arquivos relevantes via keyword matching, Content Grep, Import Chain Following, Reverse Import Tracking e Neighbor Expansion
   - Monta prompt com codigo real do projeto
   - Solicita edicoes no formato search/replace (diff-based) ao LLM
   - Implementa retry com feedback de erros (lint/search-replace failures)
   - Instrui LLM sobre efeitos cascata (imports nao utilizados)
4. **Project Code Applier** (`execution/projectCodeApplier.ts`): aplica mudancas no workspace isolado:
   - `applySearchReplaceEdits()`: fuzzy matching (exact, trimmed multi-line, single-line trim, substring)
   - `fixUnusedImports()`: remocao automatica de imports nao utilizados baseada no output do ESLint
   - `lintAndAutoFix()`: orquestra linting, auto-fix e remocao de imports
   - `commitAndFinalize()`: staging, commit, push da branch para `repo_source`
5. **Project Git Manager** (`execution/projectGitManager.ts`): operacoes Git no workspace:
   - Cria branch `forge/task-<id>`
   - Desabilita Husky hooks (`HUSKY=0`, `GIT_TERMINAL_PROMPT=0`)
   - Sanitiza mensagens de commit (remove newlines)
   - `pushBranchToSource()`: faz push da branch para o repositorio original para review/PR
6. **LLM Model**: FORGE usa `gpt-5.3-codex` via OpenClaw

### Estrategia de Edicao: Search/Replace (Diff-based)

Em vez de gerar arquivos inteiros (propenso a erros), FORGE gera edicoes granulares:

```json
{
  "action": "modify",
  "edits": [
    { "search": "linhas exatas do codigo original", "replace": "codigo modificado" }
  ]
}
```

Regras para o LLM:
- `search` deve ser copia exata do codigo-fonte (letra por letra)
- Incluir 2-3 linhas de contexto para unicidade
- Tratar efeitos cascata (ex: import removido apos uso removido)

### File Discovery

O FORGE descobre arquivos relevantes usando 5 estrategias combinadas:

1. **Keyword Matching**: paths que contem keywords da task
2. **Content Grep**: busca por termos dentro dos arquivos
3. **Import Chain Following**: segue imports a partir dos arquivos encontrados
4. **Reverse Import Tracking**: encontra quem importa os arquivos afetados
5. **Neighbor Expansion**: inclui arquivos vizinhos no mesmo diretorio

### Fluxo de Execucao

```
1. Resolver project_id ativo e carregar manifesto
2. Clonar repo_source para workspaces/forge/<project_id>/<task_id>/
3. Descobrir arquivos relevantes (5 estrategias)
4. Montar prompt com codigo real
5. Chamar LLM (gpt-5.3-codex via OpenClaw) pedindo search/replace
6. Aplicar edits com fuzzy matching
7. Rodar eslint --fix + tsc --noEmit
8. Se falha: retry com feedback de erro ao LLM
9. fixUnusedImports() automatico
10. Criar branch forge/task-<id>
11. Commit + push para repo_source
12. Registrar code_changes com project_id
```

### Visibilidade no Briefing

- Projeto afetado
- Arquivos reais modificados
- Status (SUCESSO / FALHA)
- Risco tecnico
- Branch / PR gerado

**Colunas adicionadas:** `outcomes.project_id`

---

## FASE 24 -- Contexto Historico de Tentativas Anteriores no KAIROS

**Objetivo:** Permitir que o KAIROS considere historico de tentativas anteriores para avaliar sucesso, falha e risco real, decidindo delegacoes futuras de forma mais informada, sem alterar o comportamento do FORGE.

**Principio Central:** Aprendizado comeca na decisao, nao na execucao.

### Componentes Implementados

1. **Execution History** (`state/executionHistory.ts`): agregacao de dados historicos por `project_id + task_type`:
   - `getExecutionHistory()`: carrega execucoes recentes
   - `getAgentSummary()`: taxa de sucesso, total de execucoes (7d)
   - `getTaskTypeAggregates()`: sucesso/falha por tipo de task
   - `getFrequentFiles()`: arquivos mais modificados
   - `getRecurrentFailurePatterns()`: tasks com >= 2 falhas
   - `getFullExecutionHistoryContext()`: contexto completo agregado
2. **Historical Context** (`orchestration/historicalContext.ts`): formata dados historicos em bloco de texto compacto para o prompt do KAIROS:
   - `buildHistoricalContext(db, agentId, days, maxChars)`: gera bloco `HISTORICO:` com taxa de sucesso, tasks problematicas, arquivos frequentes e ultimas execucoes
   - Maximo ~500 caracteres para nao estourar tokens
   - Trunca descricoes de tasks em 60 chars e erros em 40 chars
3. **Kairos LLM Integration** (`orchestration/kairosLLM.ts`):
   - `callKairosLLM()` recebe `db` e injeta bloco historico antes de `CONSTRAINTS:` no prompt
   - `injectHistoricalContext()`: insere bloco no local correto do prompt
4. **KAIROS System Prompt** (`agents/kairos/SYSTEM.md`): secao `## Historico` instruindo KAIROS a interpretar e usar dados historicos (reduzir autonomia para baixa taxa de sucesso, acionar NEXUS para falhas recorrentes)
5. **Daily Briefing** (`orchestration/dailyBriefing.ts`): secao historica com decisoes influenciadas, alertas de padroes de falha, melhoria/piora de taxa de sucesso
6. **Database Migration** (`state/db.ts`): adiciona coluna `project_id TEXT` e indices na tabela `outcomes`

### Formato do Bloco HISTORICO (token-eficiente)

```
HISTORICO:
- FORGE: 63% sucesso (38 exec, 7d)
- Tasks problematicas: forge/remover-signatarios (6 falhas)
- Ultimas execucoes:
  - forge: remover signatarios -> SUCCESS
  - forge: adicionar teste -> FAILURE (lint failed)
  - forge: implementar util -> SUCCESS
```

### Regras de Uso

- Historico NAO e comando, NAO e regra fixa — e insumo de decisao
- Se historico indicar alto risco ou baixa taxa de sucesso, KAIROS pode: reduzir autonomia, exigir aprovacao humana, acionar NEXUS antes de delegar
- FORGE NAO recebe historico, NAO altera prompt, NAO "aprende" diretamente
- Nenhuma memoria longa no FORGE
- Historico sempre resumido e limitado em caracteres

### Testes

- `state/executionHistory.test.ts`: 18 testes cobrindo todas as funcoes de agregacao
- `orchestration/historicalContext.test.ts`: 9 testes cobrindo formatacao, limites de caracteres e filtragem

**Colunas adicionadas:** `outcomes.project_id`
**Indices adicionados:** `idx_outcomes_project_id`, `idx_outcomes_created_at`
