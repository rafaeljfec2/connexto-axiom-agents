# Governanca e Seguranca — connexto-axiom-agents

Este documento descreve todas as regras de governanca, limites de seguranca e controles que garantem a operacao segura e previsivel do sistema.

---

## Principios

1. **Nenhuma execucao sem orcamento valido**
2. **Nenhuma publicacao sem aprovacao humana**
3. **Nenhuma mudanca de codigo sem diff persistido**
4. **Nenhuma falha sem rollback**
5. **Feedback ajusta pesos, nao logica**
6. **Previsibilidade > conveniencia**
7. **Nenhuma modificacao fora do workspace isolado**
8. **Aprendizado comeca na decisao, nao na execucao**

---

## Controle de Custo

### Limites Configurados (via `.env`)

| Variavel                   | Descricao                  | Valor Padrao |
| -------------------------- | -------------------------- | ------------ |
| `BUDGET_MONTHLY_TOKENS`    | Limite mensal total        | 500.000      |
| `BUDGET_PER_AGENT_TOKENS`  | Limite mensal por agente   | 500.000      |
| `BUDGET_PER_TASK_TOKENS`   | Limite por task individual | 50.000       |
| `BUDGET_MAX_TASKS_DAY`     | Maximo de tasks por dia    | 10           |
| `KAIROS_MAX_INPUT_TOKENS`  | Limite input do KAIROS     | 800          |
| `KAIROS_MAX_OUTPUT_TOKENS` | Limite output do KAIROS    | 400          |
| `NEXUS_MAX_OUTPUT_TOKENS`  | Limite output do NEXUS     | 600          |

### Budget Gate (`execution/budgetGate.ts`)

Antes de qualquer execucao de agente, o budget gate verifica:

1. Budget mensal nao esgotado (kill switch)
2. `used_tokens < monthly_token_limit`
3. Uso mensal do agente < `per_agent_monthly_limit`
4. Tasks hoje < `max_tasks_per_day`

Se qualquer verificacao falha: execucao abortada, motivo registrado, informado no briefing.

### Kill Switch

Quando `used_tokens >= total_tokens` com `hard_limit = 1`:

- Todas as execucoes de agentes sao bloqueadas
- FORGE entra em modo read-only
- Evento critico registrado no log

### Compressao de Prompts

Para minimizar consumo de tokens:

- System prompt contem apenas regras invariantes
- Estado comprimido a max 3 goals e 3 acoes recentes
- Output obrigatoriamente em JSON (sem texto livre)
- Strings truncadas: summary <= 200 chars, task <= 120 chars

---

## Governanca de Delegacoes

### Decision Filter (`orchestration/decisionFilter.ts`)

Cada delegacao do KAIROS passa por:

1. **Ajuste de feedback** — impact/cost/risk modificados por historico de execucao
2. **Ajuste de marketing** — para VECTOR, performance de conteudo influencia scores
3. **Filtragem**:
   - Impact < 2: rejeitada
   - Cost >= 4: rejeitada
   - Risk >= 4: requer aprovacao humana
   - Cost >= 3: requer aprovacao humana
4. **Limite**: max 3 delegacoes aprovadas por ciclo

### Feedback Automatico

O sistema aprende com dados reais:

- **Falhas recorrentes** (>= 2 em 7d) → reduz impact, aumenta risk
- **Sucesso consistente** (>= 3 em 7d) → reduz risk
- **Execucoes caras** → aumenta cost
- **Marketing forte** → aumenta impact
- **Marketing fraco** → reduz impact, aumenta risk

Limites de seguranca:

- Feedback nunca cria novas tarefas
- Feedback nunca altera objetivos
- Feedback nunca muda permissoes
- Feedback apenas influencia SCORES

---

## Governanca do NEXUS

### Permissoes

- `research.query` — realizar pesquisas tecnicas

### Restricoes

- NEXUS nunca e acionado diretamente — apenas via delegacao do KAIROS
- NEXUS nunca se comunica diretamente com FORGE ou VECTOR
- Output do NEXUS e insumo para proximas decisoes, nunca comando
- NEXUS nao escreve codigo, nao cria arquivos, nao altera repositorio
- NEXUS nao decide implementacao final
- KAIROS e o unico orquestrador
- Limite de output tokens controlado por `NEXUS_MAX_OUTPUT_TOKENS`
- Output sanitizado contra comandos perigosos e URLs externas

### Formato de Saida Obrigatorio

O NEXUS deve retornar pesquisas com as seguintes secoes:

1. **OPCOES** — alternativas tecnicas identificadas
2. **PROS-CONTRAS** — trade-offs de cada opcao
3. **RISCO** — analise de riscos tecnicos
4. **RECOMENDACAO** — sugestao fundamentada

---

## Contexto Historico no KAIROS

### Mecanismo

O KAIROS recebe um bloco `HISTORICO:` no prompt com dados agregados de execucoes anteriores (7 dias):

- Taxa de sucesso por agente
- Tasks problematicas (>= 2 falhas)
- Arquivos frequentemente modificados
- Ultimas execucoes com status

### Regras de Uso

- Historico NAO e comando — e insumo de decisao
- Se historico indicar alto risco ou baixa taxa de sucesso, KAIROS pode:
  - Reduzir autonomia
  - Exigir aprovacao humana
  - Acionar NEXUS antes de delegar
- FORGE NAO recebe historico, NAO altera prompt, NAO "aprende" diretamente
- Maximo ~500 caracteres no bloco historico
- Apenas ultimos 7 dias
- Descricoes truncadas (60 chars tasks, 40 chars erros)

---

## Governanca Multi-Projeto

### Isolamento

- Cada projeto tem manifesto em `projects/<project_id>/manifest.yaml`
- Max 1 projeto `active` por ciclo
- Goals filtrados por `project_id`
- FORGE opera em workspace isolado: `workspaces/forge/<project_id>/<task_id>/`
- FORGE nunca opera no repositorio original (`repo_source`)

### Manifesto

Cada projeto define:

- `projectId` (kebab-case)
- `repo_source` (path local ou URL)
- `riskProfile` (`conservative`, `moderate`, `aggressive`)
- `budget_monthly` (limite de tokens)
- `allowed_paths` e `forbidden_paths`

### Limites por Risk Profile

| Risk Profile | Max Risk Level | Max Files/Change | Approval Required Above Risk |
| ------------ | -------------- | ---------------- | ---------------------------- |
| conservative | 2              | 3                | 1                            |
| moderate     | 3              | 5                | 2                            |
| aggressive   | 4              | 10               | 3                            |

---

## Governanca do VECTOR

### Permissoes

- `content.draft` — gerar rascunhos
- `content.analyze` — analisar conteudo existente

### Restricoes

- Max 2 tasks por ciclo
- Nao publica sozinho (tudo e DRAFT)
- Nao acessa rede externa
- Nao decide estrategia
- Publicacao requer aprovacao humana via Telegram

### Fluxo de Publicacao

```
VECTOR gera draft → Humano revisa via /drafts
                   → /approve → status = approved
                   → /publish → publisher stub → publications table
                   → Metricas stub geradas automaticamente
                   → Metricas manuais via /metrics
```

---

## Governanca do FORGE (Codigo)

### Permissoes

- `fs.write`, `fs.mkdir`, `fs.read` — operacoes de arquivo no workspace
- `code.plan`, `code.apply`, `code.lint` — operacoes de codigo

### Modelo de Execucao (Por Projeto)

FORGE opera exclusivamente em workspaces isolados clonados do `repo_source`:

```
1. Resolver project_id ativo e carregar manifesto
2. Clonar repo_source para workspaces/forge/<project_id>/<task_id>/
3. Descobrir arquivos relevantes (keyword, grep, imports, reverse imports, neighbors)
4. Gerar search/replace edits via LLM (gpt-5.3-codex)
5. Aplicar edits com fuzzy matching
6. Lint (eslint + tsc) + auto-fix imports
7. Commit na branch forge/task-<id>
8. Push branch para repo_source para review
```

### Estrategia de Edicao: Search/Replace

FORGE nunca gera arquivos inteiros. Gera edicoes granulares:

```json
{ "search": "linhas exatas do codigo", "replace": "codigo modificado" }
```

Com fuzzy matching (exact → trimmed → single-line → substring).

### Diretorios Permitidos (Projeto)

Definidos por projeto no manifesto. Padrao:

```
src/**
app/**
components/**
packages/**
tests/**
```

### Diretorios Permitidos (Interno - Sandbox)

```
src/
orchestration/
execution/
evaluation/
services/
state/
config/
interfaces/
```

### Arquivos Proibidos (FORGE nunca pode tocar)

```
agents/kairos/*              — logica de decisao
orchestration/decisionFilter.ts  — governanca
orchestration/feedbackAdjuster.ts — governanca
orchestration/marketingFeedbackAdjuster.ts — governanca
config/budget.ts             — controle de custo
execution/budgetGate.ts      — controle de custo
execution/permissions.ts     — permissoes
.env*                        — segredos
```

### Arquivo Protegido (risk >= 3 forcado)

```
state/schema.sql
```

### Ciclo PR Virtual (Sandbox Interno)

```
1. FORGE gera plano de mudanca (JSON via OpenClaw)
2. Validacao de paths (permitidos/proibidos)
3. Calculo de risco (1-5)
4. Se risk >= 3: envio para Telegram, aguarda aprovacao
5. Se risk < 3: aplica automaticamente
6. Aplica: backup → escrita → lint (eslint + tsc)
7. Se lint OK: status = applied
8. Se lint falha: rollback automatico, status = failed
9. Diff e test_output persistidos
```

### Ciclo por Projeto (Workspace Isolado)

```
1. Clone repo_source para workspace isolado
2. Descoberta de arquivos relevantes (5 estrategias)
3. Geracao de search/replace edits via LLM
4. Aplicacao com fuzzy matching
5. Lint + auto-fix imports nao utilizados
6. Se lint falha: retry com feedback de erro ao LLM
7. Commit na branch forge/task-<id>
8. Push branch para repo_source
9. Registra code_changes com project_id
```

### Restricoes

- Max 3 arquivos por mudanca
- Extensoes permitidas: .ts, .js, .json, .sql, .md
- Nenhuma mudanca sem decisao registrada
- Nenhuma mudanca sem diff persistido
- Nenhuma falha sem rollback
- Retry unico com feedback de erro ao LLM
- FORGE nunca opera no repo_source original
- FORGE nunca acessa outros repositorios
- Codigo deve ser legivel por humanos
- Husky hooks desabilitados no workspace

---

## Sandbox e Workspaces

### Sandbox (Agentes Internos)

- Cada agente tem diretorio dedicado: `sandbox/<agent>/`
- OpenClaw workspace restrito ao sandbox do agente
- Validacao de path traversal (rejeita `..`, paths absolutos)
- Limite de 100 arquivos por sandbox

### Workspaces de Projeto (FORGE)

- Clone isolado do repo_source: `workspaces/forge/<project_id>/<task_id>/`
- Diretorio `workspaces/` e gitignored (nao versionado)
- Cada execucao tem workspace proprio
- FORGE nunca opera no repositorio original
- Branch `forge/task-<id>` criada e pushada para review

### OpenClaw Tools

| Tool    | forge     | vector    |
| ------- | --------- | --------- |
| read    | permitido | permitido |
| write   | permitido | permitido |
| exec    | negado    | negado    |
| edit    | negado    | negado    |
| browser | negado    | negado    |
| gateway | negado    | negado    |
| process | negado    | negado    |

---

## Output Sanitization

Todo output de LLM passa por sanitizacao (`execution/outputSanitizer.ts`):

1. Remove null bytes
2. Rejeita conteudo binario
3. Trunca a 1MB
4. Remove blocos shell perigosos (`rm`, `sudo`, `curl|bash`, etc.)
5. Remove URLs externas

---

## Audit Trail

Toda execucao gera registro em `audit_log`:

- `agent_id`: quem executou
- `action`: o que foi executado
- `input_hash`: SHA-256 do input
- `output_hash`: SHA-256 do output
- `sanitizer_warnings`: avisos do sanitizador
- `runtime`: `local` ou `openclaw`

---

## Seguranca de Rede

### OpenClaw Client

- Endpoint restrito a localhost (`127.0.0.1`, `::1`)
- Apenas protocolo HTTP
- Porta entre 1024 e 65535
- Timeout de 120 segundos
- Max 2 retries

### Lint Execution

- Apenas `npx eslint` e `npx tsc` sao permitidos (whitelist)
- Timeout de 30 segundos
- Execucao via `child_process.execFile` (nao `exec`)
