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
```

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
agents/              Configs e prompts dos agentes
config/              Budget e logger
docs/                Documentacao
evaluation/          Avaliadores (forge, marketing)
execution/           Executores, sandbox, budget gate, lint
interfaces/          Telegram (sender + bot)
llm/                 Cliente LLM generico
orchestration/       Ciclo KAIROS, filtros, feedback, briefing
runtime/openclaw/    Config OpenClaw, skills
scripts/             Bootstrap, cron, seed
services/            Aprovacao, metricas, code changes
src/                 Entry points (main.ts, bot.ts)
state/               Schema SQL, migrations, CRUD modules
```

## Banco de Dados

O banco SQLite e criado automaticamente em `state/local.db` na primeira execucao.

Arquivos temporarios do WAL mode (`.db-shm`, `.db-wal`) sao ignorados pelo git.

Para inspecionar o banco:

```bash
sqlite3 state/local.db ".tables"
sqlite3 state/local.db "SELECT * FROM goals WHERE status = 'active'"
```
