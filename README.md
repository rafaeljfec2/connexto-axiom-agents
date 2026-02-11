# connexto-axiom-agents

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-9-4B32C3?logo=eslint&logoColor=white)
![Prettier](https://img.shields.io/badge/Prettier-3-F7B93E?logo=prettier&logoColor=black)
![License](https://img.shields.io/badge/License-Private-red)

**Sistema operacional de execucao onde agentes de IA trabalham continuamente para avancar objetivos reais.**

connexto-axiom-agents e um sistema operacional de execucao com IA que orquestra agentes autonomos para planejar, executar, avaliar e aprender com tarefas reais — tudo rodando localmente com controle total de custo, governanca humana e loops de feedback rastreaveis.

---

## Arquitetura

```
src/main.ts          Entry point do ciclo Kairos (one-shot via cron)
src/bot.ts           Entry point do bot Telegram (long-polling persistente)
                              |
         ┌────────────────────┼────────────────────┐
         v                    v                    v
     KAIROS               FORGE                VECTOR
   (orquestrador)     (executor tecnico)   (executor marketing)
    gpt-5.2           gpt-5.3-codex          gpt-4o-mini
         |                    |                    |
         |    ┌───────────────┤                    |
         v    v               v                    v
       NEXUS             ┌──────────────┐    ┌──────────┐
    (pesquisador)        │ Workspaces   │    │ Artefatos│
    gpt-4o-mini          │ Git Branches │    │ Drafts   │
         |               │ Code Changes │    │ Publish  │
         v               └──────────────┘    └──────────┘
   ┌──────────┐               │                    │
   │ Pesquisa │               │                    │
   │ Analise  │               │                    │
   └──────────┘               │                    │
         │                    │                    │
         └────────────────────┼────────────────────┘
                              v
                       SQLite (modo WAL)
                              |
                              v
                    Telegram (Briefing Diario)
```

## Agentes

| Agente       | Papel                                                                          | Modelo LLM       | Status     |
| ------------ | ------------------------------------------------------------------------------ | ----------------- | ---------- |
| **KAIROS**   | Orquestrador estrategico — decide, delega e avalia com contexto historico      | `gpt-5.2`        | Ativo      |
| **FORGE**    | Executor tecnico — le codigo real, gera edits search/replace via OpenClaw      | `gpt-5.3-codex`  | Ativo      |
| **NEXUS**    | Pesquisa tecnica — analisa opcoes, trade-offs e riscos                         | `gpt-4o-mini`    | Ativo      |
| **VECTOR**   | Executor de marketing — gera posts, newsletters, landing copy                  | `gpt-4o-mini`    | Ativo      |
| **QA**       | Validacao funcional — testes E2E hibridos (LLM + Playwright)                   | `gpt-4o-mini`    | Planejado  |
| **SENTINEL** | Monitor de seguranca e compliance                                              | —                 | Planejado  |
| **COVENANT** | Fiscalizador de governanca e politicas                                         | —                 | Planejado  |

## Evolucao

| Fase  | Nome                                | Descricao                                                                 | Status |
| ----- | ----------------------------------- | ------------------------------------------------------------------------- | ------ |
| 12    | Execucao Controlada do FORGE        | FORGE executa tarefas reais em sandbox com permissoes                     | Feito  |
| 13    | Integracao OpenClaw                 | Runtime de execucao LLM via OpenClaw com hardening                        | Feito  |
| 14    | Feedback Loop Automatico            | Sistema aprende com resultados, ajusta scores de decisao                  | Feito  |
| 15    | Execucao Real do VECTOR             | Agente de marketing gera drafts via OpenClaw                              | Feito  |
| 16    | Aprovacao e Publicacao Semi-Auto    | Bot Telegram para aprovacao humana + publicacao stub                      | Feito  |
| 17    | Metricas de Marketing e Feedback    | Metricas de engajamento influenciam decisoes do KAIROS                    | Feito  |
| 18    | Codificacao Governada               | FORGE modifica codigo com ciclo PR virtual                                | Feito  |
| 22    | Pesquisa Tecnica NEXUS              | Agente de pesquisa reduz incerteza antes da codificacao                   | Feito  |
| 23.1  | Manifesto Multi-Projeto             | Manifestos de projeto, isolamento por project_id, estrutura               | Feito  |
| 23.2  | FORGE por Projeto                   | FORGE le codigo real, gera diffs, faz push de branches para review        | Feito  |
| 24    | Contexto Historico do KAIROS        | Dados historicos de execucao injetados no prompt do KAIROS                | Feito  |
| 25    | Governanca Explicita de Decisao     | Classificacao pre-decisao, selecao dinamica de modelo, log de governanca  | Feito  |
| 26    | Agente QA (Validacao Funcional)     | Testes E2E hibridos (LLM gera + Playwright executa) com retroalimentacao | Planejado |
| 27    | FORGE Agent Loop Hibrido            | 3 fases (Planning + Execution + Correction Loop) com ate 4 correcoes     | Feito     |

## Funcionalidades Principais

- **Previsibilidade de Custo** — Orcamento rigido de tokens com limites mensais, por agente, por task e kill switch
- **Compressao de Prompts** — Prompts minimalistas dirigidos por estado, templates estritos, limites rigidos de tokens
- **Feedback Loops** — Feedback de execucao (SUCCESS/PARTIAL/FAILURE) + feedback de marketing (STRONG/AVERAGE/WEAK) ajustam scores de decisao automaticamente
- **Contexto Historico** — KAIROS recebe historico agregado (taxas de sucesso, falhas frequentes, arquivos arriscados) para decisoes informadas
- **Governanca de Decisao** — Classificacao pre-decisao em 4 eixos (complexidade, risco, custo, historico) para selecao dinamica de modelo LLM e thresholds de aprovacao
- **Suporte Multi-Projeto** — Manifestos de projeto com workspaces isolados, governanca e rastreamento de budget por projeto
- **Modificacao de Codigo Real** — FORGE le codigo-fonte real, gera diffs search/replace, faz push de branches para revisao humana
- **Pesquisa Tecnica** — Agente NEXUS pesquisa opcoes, trade-offs e riscos antes do FORGE executar tarefas de codigo
- **Governanca Humana** — Todas as publicacoes e mudancas de codigo de alto risco exigem aprovacao explicita via Telegram
- **Inteligencia de Marketing** — Metricas stub/manuais com avaliador; deteccao de tipos de mensagem fortes/fracas retroalimenta a orquestracao
- **Hardening de Seguranca** — Sanitizacao de output, execucao em sandbox, audit logging, prevencao de SSRF, isolamento de workspaces

## Stack Tecnologica

| Componente      | Tecnologia                          |
| --------------- | ----------------------------------- |
| Runtime         | Node.js >= 24 + TypeScript 5.9      |
| Banco de Dados  | SQLite (modo WAL, better-sqlite3)   |
| Runtime LLM     | OpenClaw (execucao isolada de agentes) |
| Provedores LLM  | OpenAI (gpt-5.2, gpt-5.3-codex, gpt-4o-mini) |
| Controle de Versao | Git (workspaces isolados, branch por task) |
| Agendamento     | Cron (ciclos one-shot)              |
| Interface Humana | Bot Telegram (long-polling)         |
| Logging         | Pino (JSON estruturado)             |
| Linting         | ESLint 9 + Prettier 3               |

## Tabelas do Banco de Dados

| Tabela                 | Finalidade                                                |
| ---------------------- | --------------------------------------------------------- |
| `goals`                | Objetivos estrategicos ativos                             |
| `tasks`                | Tarefas vinculadas a goals                                |
| `decisions`            | Historico de decisoes do KAIROS                           |
| `metrics`              | Metricas genericas de agentes                             |
| `outcomes`             | Resultados de execucao com dados de tempo/tokens/tamanho  |
| `audit_log`            | Trilha de auditoria de seguranca                          |
| `budgets`              | Orcamentos mensais de tokens                              |
| `token_usage`          | Rastreamento granular de tokens por agente                |
| `agent_feedback`       | Avaliacoes de execucao (SUCCESS/PARTIAL/FAILURE)          |
| `artifacts`            | Drafts de conteudo com workflow de aprovacao               |
| `publications`         | Registros de artefatos publicados                         |
| `marketing_metrics`    | Dados de engajamento (stub/manual/api)                    |
| `marketing_feedback`   | Avaliacoes de performance de conteudo (STRONG/AVERAGE/WEAK) |
| `code_changes`         | Mudancas de codigo do FORGE com ciclo PR virtual          |
| `pull_requests`        | Pull requests vinculadas a code_changes                   |
| `nexus_research`       | Pesquisas tecnicas com analise estruturada                |
| `projects`             | Manifestos de projetos registrados com estado de runtime  |
| `governance_decisions` | Log de decisoes de governanca com classificacao e modelo  |

## Estrutura do Projeto

```
agents/              Configs de agentes, system prompts, memoria
  kairos/            Orquestrador (gpt-5.2)
  forge/             Executor tecnico (gpt-5.3-codex via OpenClaw)
  nexus/             Pesquisador tecnico (gpt-4o-mini)
  vector/            Executor de marketing (gpt-4o-mini)
  sentinel/          Monitor de seguranca (planejado)
  covenant/          Fiscalizador de governanca (planejado)
config/              Limites de budget, configuracao de logger
evaluation/          Avaliadores de execucao, marketing e NEXUS
execution/           Executores FORGE/VECTOR/NEXUS, sistema de codigo por projeto, sandbox
  project*.ts        Codigo por projeto: executor, applier, git manager, security, workspace
  nexus*.ts          Executor e validador NEXUS
interfaces/          Telegram sender + bot (long-polling)
llm/                 Cliente LLM com failover (OpenAI + Claude)
orchestration/       Ciclo Kairos, filtro de decisao, ajustadores de feedback, briefing
  historicalContext   Formatacao de dados historicos para prompt do KAIROS
  decisionGovernance Classificacao pre-decisao e selecao de politica de governanca
projects/            Manifestos de projetos e suporte multi-projeto
  default/           Projeto padrao (retrocompatibilidade)
  <project-id>/      Diretorios por projeto
runtime/openclaw/    Configs de agentes e skills do OpenClaw
scripts/             Bootstrap, cron runner, seed data, register-project
services/            Servico de aprovacao, coletor de metricas, servico de code changes
shared/policies/     Politicas cross-projeto (limites de risco, paths permitidos)
src/                 Entry points (main.ts, bot.ts)
state/               Schema SQLite, migrations, modulos CRUD de todas as tabelas
  executionHistory   Agregacao historica para decisoes do KAIROS
  governanceLog      Log de decisoes de governanca
workspaces/          Clones Git isolados temporarios para execucao do FORGE (gitignored)
```

## Pre-requisitos

- Node.js >= 24
- pnpm

## Setup

```bash
./scripts/bootstrap.sh
cp .env.example .env
```

Edite o `.env` com seu token do bot Telegram, chat ID e configuracoes do OpenClaw.

## Desenvolvimento

```bash
pnpm dev
```

Roda o ciclo Kairos uma vez com hot-reload e logs formatados.

## Bot Telegram

```bash
pnpm bot
```

Inicia o bot Telegram persistente para comandos humanos. Roda em paralelo com o ciclo cron do Kairos, compartilhando o banco SQLite via modo WAL.

### Comandos

| Comando                                             | Descricao                                  |
| --------------------------------------------------- | ------------------------------------------ |
| `/drafts`                                           | Listar drafts pendentes de aprovacao       |
| `/approve <id>`                                     | Aprovar um draft                           |
| `/reject <id>`                                      | Rejeitar um draft                          |
| `/publish <id>`                                     | Publicar artefato aprovado (stub v1)       |
| `/metrics <id> <impressions> <clicks> <engagement>` | Registrar metricas de marketing manuais    |
| `/help`                                             | Mostrar comandos disponiveis               |

IDs podem ser parciais (primeiros 8 caracteres).

## Producao

```bash
pnpm build
pnpm start
```

## Cron (execucao autonoma)

O script `scripts/run-kairos.sh` e projetado para cron. Ele resolve seu proprio path, faz build do projeto e executa o ciclo Kairos.

### Teste manual

```bash
./scripts/run-kairos.sh
```

### Registrar o cron

```bash
crontab -e
```

Adicione a seguinte linha para rodar todo dia as 07:00:

```
0 7 * * * /home/rafael/dev-rafael/connexto-axiom-agents/scripts/run-kairos.sh >> /home/rafael/dev-rafael/connexto-axiom-agents/logs/kairos.log 2>&1
```

Substitua o path pelo caminho absoluto do seu diretorio do projeto.

### Verificar

```bash
crontab -l
```

Logs sao adicionados em `logs/kairos.log`. O Briefing Diario via Telegram e enviado automaticamente apos cada ciclo.

## Scripts

| Script              | Descricao                                              |
| ------------------- | ------------------------------------------------------ |
| `pnpm dev`          | Rodar ciclo Kairos com hot-reload e logs formatados    |
| `pnpm bot`          | Iniciar bot Telegram (long-polling persistente)        |
| `pnpm build`        | Compilar TypeScript                                    |
| `pnpm start`        | Rodar output compilado                                 |
| `pnpm lint`         | Verificar erros de linting                             |
| `pnpm lint:fix`     | Corrigir erros de linting automaticamente              |
| `pnpm format`       | Formatar todos os arquivos                             |
| `pnpm format:check` | Verificar formatacao                                   |
