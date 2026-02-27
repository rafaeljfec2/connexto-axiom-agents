# Claude CLI Executor — Fluxo Completo de Execução

## Visão Geral

O executor `claude-cli` é um dos modos de execução do **Forge**, responsável por delegar tarefas de código diretamente ao Claude CLI (Anthropic) operando no workspace do projeto. Ele funciona de forma autônoma com guardrails de custo, tempo, validação e review heurístico.

---

## Exemplo de Task

O **Kairos** (orquestrador) delega:

> *"Implement user authentication with JWT tokens"*
> para o projeto `connexto-digital-signer` com `forge_executor: "claude-cli"`

---

## Fase 1 — Entrada e Preparação do Workspace

**Arquivo:** `execution/project/projectCodeExecutor.ts` → `executeProjectCode()`

1. **Busca o projeto** no banco via `getProjectById(db, projectId)`
2. **Clona/atualiza o repo base**: `ensureBaseClone()` + `ensureBaseDependencies()`
3. **Cria workspace isolado**: `createTaskWorkspace(projectId, goalId)` — cópia do repo base para a task trabalhar sem afetar outras execuções
4. **Roteia pelo `forge_executor`** configurado no manifest do projeto:
   - `"openclaw"` → executor via HTTP tool loop (gateway OpenClaw)
   - `"claude-cli"` → executor via Claude CLI autônomo
   - `"legacy"` → agent loop interno (plan → edit → correct)

Como `forge_executor: "claude-cli"`, entra em `executeWithClaudeCliMode()`.

---

## Fase 2 — Inicialização do Claude CLI Executor

**Arquivo:** `execution/forge/claudeCliExecutor.ts` → `executeWithClaudeCli()`

5. **Carrega configuração** das variáveis de ambiente:

| Variável | Default | Propósito |
|---|---|---|
| `CLAUDE_CLI_PATH` | `claude` | Caminho do binário |
| `CLAUDE_CLI_MODEL` | `sonnet` | Modelo principal |
| `CLAUDE_CLI_FIX_MODEL` | `haiku` | Modelo para tasks FIX (mais barato) |
| `CLAUDE_CLI_MAX_TURNS` | `25` | Máximo de turns por execução |
| `CLAUDE_CLI_TIMEOUT_MS` | `300000` | Timeout total (5 min) |
| `CLAUDE_CLI_MAX_BUDGET_USD` | `5` | Budget por execução individual |
| `CLAUDE_CLI_MAX_TOTAL_COST_USD` | `10` | Teto de custo acumulado (todos os ciclos) |

6. **Verifica disponibilidade** do CLI: `claude --version`
7. **Classifica o tipo da task**: `classifyTaskType()` analisa palavras-chave e retorna `IMPLEMENT`, `FIX`, `CREATE` ou `REFACTOR`
8. **Seleciona o modelo**: via `selectModelForTask()`
   - Tasks `FIX` → usa `fixModel` (haiku, mais barato e rápido)
   - Demais → usa `model` (sonnet, mais capaz)

---

## Fase 3 — Preparação de Contexto (em paralelo)

Quatro operações rodam em `Promise.all` para máxima performance:

| Operação | O que faz |
|---|---|
| `loadNexusResearchForGoal` | Busca pesquisas do NEXUS associadas ao goal |
| `loadGoalContext` | Título e descrição do goal pai |
| `buildRepositoryIndexSummary` | Mapa da estrutura do repo (truncado em 3000 chars) |
| `checkBaselineBuild` | Verifica se o build já estava quebrado antes de começar |

9. **Gera o `CLAUDE.md`** no workspace — arquivo de guardrails dinâmico contendo:
   - Identidade e papel do agente
   - Protocolo de decisão específico por tipo de task
   - Regras de segurança (não modificar `.env`, não instalar dependências sem necessidade, etc.)
   - Contexto do NEXUS research (se houver)
   - Index do repositório (omitido para tasks FIX)
   - Regras de qualidade de código

10. **Escreve o execution plan** como artefato para auditoria.

---

## Fase 4 — Execução Principal (Claude CLI)

11. **Monta o prompt** com a task, expected output e instruções críticas:

```
IMPLEMENT the following task by making actual code changes:

Implement user authentication with JWT tokens

Expected output: A working auth module with login endpoint

CRITICAL: You MUST use tools to read and modify files. Do NOT just write a plan or explanation.
If you respond with only text and no tool calls, the task will be marked as FAILED.
```

12. **Spawna o processo `claude`** com argumentos:

```bash
claude -p "<prompt>" \
  --output-format json \
  --model sonnet \
  --max-turns 25 \
  --max-budget-usd 5 \
  --allowedTools Edit,Write,Bash,Read,Glob,Grep \
  --dangerously-skip-permissions
```

O Claude CLI opera diretamente no workspace, lendo e modificando arquivos com suas tools nativas. Ele lê o `CLAUDE.md` automaticamente e segue as regras ali definidas.

13. **Parseia o output JSON** retornado pelo CLI:

```json
{
  "type": "result",
  "subtype": "success",
  "result": "Implemented JWT authentication with login endpoint...",
  "session_id": "abc-123",
  "total_cost_usd": 0.058,
  "num_turns": 5,
  "duration_ms": 4325,
  "modelUsage": {
    "claude-sonnet-4-6": {
      "inputTokens": 4,
      "outputTokens": 161,
      "cacheReadInputTokens": 33747,
      "cacheCreationInputTokens": 5986,
      "costUSD": 0.058
    }
  }
}
```

14. **Detecta arquivos alterados** via `git diff --name-only HEAD` + `git ls-files --others`

---

## Fase 5 — Ciclo de Validação (até 5 tentativas)

**Função:** `runCorrectionLoop()`

15. **Roda validações**: install, lint, build, testes (`runValidationCycle`)
16. Se **tudo passou** → segue para review
17. Se **falhou** → verifica 3 guardrails antes de tentar corrigir:

| Guardrail | Limite | Ação se excedido |
|---|---|---|
| Custo acumulado | `maxTotalCostUsd` ($10) | Para o loop |
| Tempo total | `timeoutMs` (5 min) | Para o loop |
| Ciclos de correção | `MAX_CORRECTION_CYCLES` (5) | Para o loop |

18. Se os guardrails permitem, **spawna correção com `--resume`**:

```bash
claude -p "FIX VALIDATION ERRORS: ..." \
  --resume abc-123 \
  --model sonnet \
  ...
```

O `--resume` faz o Claude CLI **continuar a sessão anterior**, reaproveitando o prompt caching — economizando tokens de contexto que já foram processados (CLAUDE.md, repo index, arquivos lidos, etc.).

19. **Acumula custo e tokens** entre ciclos. Repete até passar validação ou atingir um guardrail.

---

## Fase 6 — Review Heurístico

**Função:** `runPostCorrectionReview()`

20. **Analisa os arquivos alterados** com heurísticas:
    - Arquivos sensíveis modificados
    - Tamanho dos arquivos
    - Patterns perigosos (ex: credenciais, force push)
21. Se encontrou issues **CRITICAL** → dispara correção (também com `--resume` e cost ceiling)
22. Se passou ou só tem warnings → continua

---

## Fase 7 — Cleanup

23. **Remove o `CLAUDE.md`** do workspace (no bloco `finally`)
24. **Escreve artefatos** de auditoria: review report, changes manifest

---

## Fase 8 — Commit e Entrega

De volta em `projectCodeExecutor.ts → executeWithClaudeCliMode()`:

25. **Constrói o `ForgeCodeOutput`**: lista de arquivos, nível de risco, comando de rollback
26. **Valida paths** e **calcula risco final**: `validateAndCalculateRisk()`
27. **Salva no banco**: `saveCodeChange()` + `logAudit()`
28. Decisão baseada no risco:

| Risco | Ação |
|---|---|
| `< 3` | Commit automático via `commitVerifiedChanges()` com branch e push (se habilitado) |
| `>= 3` | Salva como `pending_approval` e envia notificação no **Telegram** para aprovação manual |

29. **Limpa o workspace** da task

---

## Diagrama de Fluxo

```
Kairos Delegation
       │
       ▼
executeProjectCode()
       │
       ├── ensureBaseClone()
       ├── ensureBaseDependencies()
       └── createTaskWorkspace()
              │
              ▼
       routeToExecutor("claude-cli")
              │
              ▼
       executeWithClaudeCli()
              │
              ├── loadConfig + verifyAvailable
              ├── classifyTaskType → selectModel (sonnet / haiku)
              ├── Promise.all [nexus, goal, repoIndex, baseline]
              ├── writeClaudeMd (guardrails)
              │
              ├── ┌─────────────────────────────────────┐
              │   │  spawnClaudeCli (execução principal) │
              │   │  → Claude CLI opera no workspace     │
              │   │  → Lê CLAUDE.md automaticamente      │
              │   │  → Usa Edit, Write, Bash, Read, etc. │
              │   └─────────────────────────────────────┘
              │
              ├── parseOutput + detectChangedFiles (git diff)
              │
              ├── ┌──────────────────────────────────────────────┐
              │   │  runCorrectionLoop (até 5x)                  │
              │   │  → runValidationCycle (lint, build, tests)   │
              │   │  → Se falhou: spawnClaudeCli com --resume    │
              │   │  → Guardrails: cost ceiling, timeout, cycles │
              │   └──────────────────────────────────────────────┘
              │
              ├── ┌──────────────────────────────────────────────┐
              │   │  runPostCorrectionReview (até 2x)            │
              │   │  → runHeuristicReview                        │
              │   │  → Se CRITICAL: correção com --resume        │
              │   │  → Guardrail: cost ceiling                   │
              │   └──────────────────────────────────────────────┘
              │
              └── removeClaudeMd (cleanup)
              │
              ▼
       executeWithClaudeCliMode()
              │
              ├── buildForgeCodeOutputFromCli
              └── handleSuccessfulAgentOutput
                     │
                     ├── validateAndCalculateRisk
                     ├── saveCodeChange (DB)
                     ├── logAudit
                     │
                     ├── risco >= 3 → Telegram approval
                     └── risco < 3  → commitVerifiedChanges → push
              │
              ▼
       cleanupTaskWorkspace
              │
              ▼
       ExecutionResult (retorna ao Kairos)
```

---

## Otimizações de Token/Custo Implementadas

| Otimização | Descrição |
|---|---|
| **`--resume` para correções** | Reutiliza sessão anterior, aproveitando prompt caching nativo do Claude CLI |
| **Cost ceiling cumulativo** | Soma `total_cost_usd` entre todos os ciclos e para se atingir `CLAUDE_CLI_MAX_TOTAL_COST_USD` |
| **Haiku para tasks FIX** | Tasks classificadas como FIX usam modelo mais barato (`haiku`) em vez de `sonnet` |
| **`--max-budget-usd` por execução** | Limite hard por spawn individual do CLI |
| **`--max-turns` limitado** | Evita loops infinitos de tool calls |
| **Repo index truncado** | Máximo 3000 chars, omitido completamente para tasks FIX |
| **CLAUDE.md compacto** | Instruções geradas dinamicamente, sem redundância |
| **Prompt caching nativo** | O Claude CLI cacheia automaticamente prefixos longos de contexto |

---

## Arquivos Envolvidos

| Arquivo | Responsabilidade |
|---|---|
| `execution/project/projectCodeExecutor.ts` | Roteamento e pós-processamento (commit, approval) |
| `execution/forge/claudeCliExecutor.ts` | Core do executor: spawn, parse, correction loop, review |
| `execution/forge/claudeCliInstructions.ts` | Geração dinâmica do `CLAUDE.md` |
| `execution/forge/openclawValidation.ts` | Ciclo de validação (lint, build, tests) |
| `execution/forge/openclawReview.ts` | Review heurístico dos arquivos alterados |
| `execution/forge/openclawArtifacts.ts` | Escrita de artefatos (plan, manifest, review report) |
| `execution/forge/forgeValidation.ts` | Baseline build check |
| `execution/discovery/repositoryIndexer.ts` | Indexação da estrutura do repo |
| `projects/manifest.schema.ts` | Schema do manifest (inclui `forge_executor: "claude-cli"`) |
| `orchestration/types.ts` | Tipos da delegação (`KairosDelegation`) |
