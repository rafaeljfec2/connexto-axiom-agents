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

- `fs.write`, `fs.mkdir`, `fs.read` — operacoes de arquivo no sandbox
- `code.plan`, `code.apply`, `code.lint` — operacoes de codigo

### Diretorios Permitidos

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

### Ciclo PR Virtual

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

### Restricoes

- Max 3 arquivos por mudanca
- Extensoes permitidas: .ts, .js, .json, .sql, .md
- Nenhuma mudanca sem decisao registrada
- Nenhuma mudanca sem diff persistido
- Nenhuma falha sem rollback
- Nao tenta retry no mesmo ciclo
- Codigo deve ser legivel por humanos

---

## Sandbox

### Isolamento

- Cada agente tem diretorio dedicado: `sandbox/<agent>/`
- OpenClaw workspace restrito ao sandbox do agente
- Validacao de path traversal (rejeita `..`, paths absolutos)
- Limite de 100 arquivos por sandbox

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
