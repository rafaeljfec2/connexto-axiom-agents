# Setup e Operacao — connexto-axiom-agents

## Pre-requisitos

- Node.js >= 24
- pnpm
- OpenClaw CLI (para execucao real de LLM)

## Instalacao

```bash
# Bootstrap automatico
./scripts/bootstrap.sh

# Ou manualmente:
pnpm install

# Configurar variaveis de ambiente
cp .env.example .env
```

Editar `.env` com:

- Token e chat_id do Telegram
- Chaves de API do LLM (OpenAI)
- Configuracoes de orcamento

## Variaveis de Ambiente

| Variavel                   | Descricao                                 | Obrigatorio          |
| -------------------------- | ----------------------------------------- | -------------------- |
| `TELEGRAM_BOT_TOKEN`       | Token do BotFather                        | Sim                  |
| `TELEGRAM_CHAT_ID`         | Chat ID autorizado                        | Sim                  |
| `LLM_PROVIDER`             | Provider do LLM (`openai` ou `anthropic`) | Sim                  |
| `LLM_API_KEY`              | Chave de API do LLM                       | Sim                  |
| `LLM_MODEL`                | Modelo do LLM (ex: `gpt-4o-mini`)         | Sim                  |
| `USE_OPENCLAW`             | Habilitar OpenClaw (`true`/`false`)       | Nao                  |
| `OPENCLAW_ENDPOINT`        | URL do gateway OpenClaw                   | Se USE_OPENCLAW=true |
| `OPENCLAW_API_KEY`         | Chave do OpenClaw                         | Se USE_OPENCLAW=true |
| `OPENAI_API_KEY`           | Chave OpenAI (para OpenClaw)              | Se USE_OPENCLAW=true |
| `BUDGET_MONTHLY_TOKENS`    | Limite mensal de tokens                   | Nao (padrao: 500000) |
| `BUDGET_PER_AGENT_TOKENS`  | Limite por agente                         | Nao (padrao: 500000) |
| `BUDGET_PER_TASK_TOKENS`   | Limite por task                           | Nao (padrao: 50000)  |
| `BUDGET_MAX_TASKS_DAY`     | Max tasks/dia                             | Nao (padrao: 10)     |
| `KAIROS_MAX_INPUT_TOKENS`  | Limite input KAIROS                       | Nao (padrao: 800)    |
| `KAIROS_MAX_OUTPUT_TOKENS` | Limite output KAIROS                      | Nao (padrao: 400)    |
| `NEXUS_MAX_OUTPUT_TOKENS`  | Limite output NEXUS                       | Nao (padrao: 600)    |
| `GITHUB_TOKEN`             | Token GitHub para criacao de PRs          | Nao                  |
| `GITHUB_REPO`              | Repositorio GitHub (`owner/repo`)         | Nao                  |
| `PR_MAX_AUTO_RISK`         | Risco maximo para PR automatico (1-5)     | Nao (padrao: 2)      |
| `MERGE_MAX_RISK`           | Risco maximo para merge automatico (1-5)  | Nao (padrao: 3)      |
| `PR_STALE_DAYS`            | Dias para considerar PR stale             | Nao (padrao: 7)      |
| `LOG_LEVEL`                | Nivel de log (`info`, `debug`, `warn`)    | Nao (padrao: info)   |
| `NODE_ENV`                 | Ambiente (`development`, `production`)    | Nao                  |

## Desenvolvimento

### Rodar ciclo KAIROS (one-shot com hot-reload)

```bash
pnpm dev
```

### Rodar Telegram bot (persistente)

```bash
pnpm bot
```

### Iniciar OpenClaw gateway

```bash
openclaw gateway --auth token --token "dev-local"
```

O gateway roda em `http://localhost:18789`.

### Inserir goal de teste

```bash
npx tsx scripts/seed-goal.ts
npx tsx scripts/seed-goal.ts --project connexto-digital-signer
```

### Registrar projeto

```bash
npx tsx scripts/register-project.ts <project-id>
```

Cria a estrutura em `projects/<project-id>/` com `manifest.yaml` template. Edite o manifesto com `repo_source`, `risk_profile` e demais configuracoes.

### Modelos LLM por Agente

Os modelos sao configurados em `agents/<agente>/config.ts`:

| Agente   | Modelo           | Arquivo de Config                      |
| -------- | ---------------- | -------------------------------------- |
| KAIROS   | `gpt-5.2`        | `agents/kairos/config.ts`              |
| FORGE    | `gpt-5.3-codex`  | `runtime/openclaw/config.json`         |
| NEXUS    | `gpt-4o-mini`    | `agents/nexus/config.ts` (fallback)    |
| VECTOR   | `gpt-4o-mini`    | `agents/vector/config.ts`              |

FORGE usa modelo via OpenClaw, os demais via chamada direta ao LLM client.

## Producao

### Compilar

```bash
pnpm build
```

### Executar ciclo

```bash
pnpm start
```

### Cron (execucao autonoma)

O script `scripts/run-kairos.sh` compila e executa o ciclo:

```bash
# Teste manual
./scripts/run-kairos.sh

# Registrar no cron (diariamente as 07:00)
crontab -e
```

Adicionar:

```
0 7 * * * /caminho/para/connexto-axiom-agents/scripts/run-kairos.sh >> /caminho/para/connexto-axiom-agents/logs/kairos.log 2>&1
```

O Telegram bot deve rodar como servico separado (ex: systemd, pm2, screen).

## Qualidade de Codigo

### Lint

```bash
pnpm lint          # Verificar erros
pnpm lint:fix      # Corrigir automaticamente
```

### Formatacao

```bash
pnpm format        # Formatar todos os arquivos
pnpm format:check  # Verificar formatacao
```

### Type check

```bash
npx tsc --noEmit
```

## Scripts Disponiveis

| Script              | Descricao                                     |
| ------------------- | --------------------------------------------- |
| `pnpm dev`          | Ciclo KAIROS com hot-reload e logs formatados |
| `pnpm bot`          | Telegram bot (persistente long-polling)       |
| `pnpm build`        | Compilar TypeScript                           |
| `pnpm start`        | Executar compilado                            |
| `pnpm lint`         | Verificar lint                                |
| `pnpm lint:fix`     | Corrigir lint automaticamente                 |
| `pnpm format`       | Formatar todos os arquivos                    |
| `pnpm format:check` | Verificar formatacao                          |

## Estrutura de Diretorios

```
agents/              Configs e prompts dos agentes (kairos, forge, nexus, vector, sentinel, covenant)
config/              Budget e logger
docs/                Documentacao
evaluation/          Avaliadores (forge, nexus, marketing)
execution/           Executores, sandbox, budget gate, lint, project code system
interfaces/          Telegram (sender + bot)
llm/                 Cliente LLM generico (OpenAI + Claude)
orchestration/       Ciclo KAIROS, filtros, feedback, briefing, contexto historico
projects/            Manifestos de projetos (manifest.yaml por projeto)
runtime/openclaw/    Config OpenClaw, skills
scripts/             Bootstrap, cron, seed, register-project
services/            Aprovacao, metricas, code changes
shared/policies/     Politicas cross-project (risk limits, allowed paths)
src/                 Entry points (main.ts, bot.ts)
state/               Schema SQL, migrations, CRUD modules, execution history
workspaces/          Workspaces isolados do FORGE por projeto (gitignored)
```

## Recomendacao: Husky + lint-staged nos Projetos-Alvo

Projetos gerenciados pelo FORGE se beneficiam de hooks Git pre-commit para lint e formatacao.
Isso adiciona uma camada extra de protecao no commit, independente da validacao que o FORGE ja executa.

Para configurar no projeto-alvo:

```bash
pnpm add -D husky lint-staged
npx husky init
```

Configurar `lint-staged` no `package.json` do projeto-alvo:

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

O FORGE continuara rodando sua propria validacao (lint/build/tests) durante o desenvolvimento.
Os hooks Husky funcionam como safety net adicional no momento do commit via `projectGitManager.ts`.

## Banco de Dados

O banco SQLite e criado automaticamente em `state/local.db` na primeira execucao.

Arquivos temporarios do WAL mode (`.db-shm`, `.db-wal`) sao ignorados pelo git.

Para inspecionar o banco:

```bash
sqlite3 state/local.db ".tables"
sqlite3 state/local.db "SELECT * FROM goals WHERE status = 'active'"
```
