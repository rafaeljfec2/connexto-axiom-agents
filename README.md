# connexto-axiom-agents

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-9-4B32C3?logo=eslint&logoColor=white)
![Prettier](https://img.shields.io/badge/Prettier-3-F7B93E?logo=prettier&logoColor=black)
![License](https://img.shields.io/badge/License-Private-red)

**Operational execution system where AI agents work continuously to advance real objectives.**

connexto-axiom-agents is an AI execution operating system that orchestrates autonomous agents to plan, execute, evaluate, and learn from real tasks — all running locally with full cost control, human governance, and traceable feedback loops.

---

## Architecture

```
src/main.ts          Kairos cycle entry point (one-shot via cron)
src/bot.ts           Telegram bot entry point (persistent long-polling)
                          |
         ┌────────────────┼────────────────┐
         v                v                v
     KAIROS           FORGE            VECTOR
   (orchestrator)   (tech executor)  (marketing executor)
         |                |                |
         v                v                v
   ┌──────────┐    ┌──────────┐    ┌──────────┐
   │ Decisions │    │ Outcomes │    │ Artifacts│
   │ Feedback  │    │ Sandbox  │    │ Drafts   │
   │ Metrics   │    │ Audit    │    │ Publish  │
   └──────────┘    └──────────┘    └──────────┘
         │                │                │
         └────────────────┼────────────────┘
                          v
                   SQLite (WAL mode)
```

## Agents

| Agent        | Role                                                              | Status  |
| ------------ | ----------------------------------------------------------------- | ------- |
| **KAIROS**   | Strategic orchestrator — decides what to do, delegates, evaluates | Active  |
| **FORGE**    | Technical executor — generates code, docs, configs via OpenClaw   | Active  |
| **VECTOR**   | Marketing executor — generates posts, newsletters, landing copy   | Active  |
| **SENTINEL** | Security & compliance monitor                                     | Planned |
| **NEXUS**    | Technical research — analyzes options, trade-offs and risks        | Active  |
| **COVENANT** | Governance & policy enforcer                                      | Planned |

## Evolution

| Phase | Name                             | Description                                           | Status |
| ----- | -------------------------------- | ----------------------------------------------------- | ------ |
| 12    | Controlled Forge Execution       | FORGE executes real tasks in sandbox with permissions | Done   |
| 13    | OpenClaw Integration             | LLM execution runtime via OpenClaw with hardening     | Done   |
| 14    | Automatic Feedback Loop          | System learns from outcomes, adjusts decision scores  | Done   |
| 15    | VECTOR Real Execution            | Marketing agent generates drafts via OpenClaw         | Done   |
| 16    | Approval & Semi-Auto Publication | Telegram bot for human approval + stub publication    | Done   |
| 17    | Marketing Metrics & Feedback     | Engagement metrics influence KAIROS decisions         | Done   |
| 18    | Governed Code Changes            | FORGE modifies code with PR virtual cycle             | Done   |
| 22    | NEXUS Technical Research         | Research agent reduces uncertainty before coding      | Done   |

## Key Features

- **Cost Predictability** — Rigid token budget with monthly limits, per-agent caps, per-task gates, and kill switch
- **Prompt Compression** — Minimalist state-driven prompts, strict templates, hard token limits
- **Feedback Loops** — Execution feedback (SUCCESS/PARTIAL/FAILURE) + marketing feedback (STRONG/AVERAGE/WEAK) automatically adjust decision scores
- **Human Governance** — All publications require explicit approval via Telegram (`/approve`, `/publish`)
- **Marketing Intelligence** — Stub/manual metrics with evaluator; strong/weak message type detection feeds back into orchestration
- **Security Hardening** — Output sanitization, sandboxed execution, audit logging, SSRF prevention, dedicated system user

## Tech Stack

| Component       | Technology                          |
| --------------- | ----------------------------------- |
| Runtime         | Node.js >= 24 + TypeScript 5.9      |
| Database        | SQLite (WAL mode, better-sqlite3)   |
| LLM Runtime     | OpenClaw (isolated agent execution) |
| Scheduling      | Cron (one-shot cycles)              |
| Human Interface | Telegram Bot (long-polling)         |
| Logging         | Pino (structured JSON)              |
| Linting         | ESLint 9 + Prettier 3               |

## Database Tables

| Table                | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `goals`              | Active strategic objectives                           |
| `tasks`              | Tasks linked to goals                                 |
| `decisions`          | KAIROS decision history                               |
| `metrics`            | Generic agent metrics                                 |
| `outcomes`           | Execution results with timing/token/size data         |
| `audit_log`          | Security audit trail                                  |
| `budgets`            | Monthly token budgets                                 |
| `token_usage`        | Granular per-agent token tracking                     |
| `agent_feedback`     | Execution evaluation grades (SUCCESS/PARTIAL/FAILURE) |
| `artifacts`          | Content drafts with approval workflow                 |
| `publications`       | Published artifact records                            |
| `marketing_metrics`  | Engagement data (stub/manual/api)                     |
| `marketing_feedback` | Content performance grades (STRONG/AVERAGE/WEAK)      |
| `nexus_research`     | Technical research outputs with structured analysis   |

## Project Structure

```
agents/              Agent configs, system prompts, memory
config/              Budget limits, logger setup
evaluation/          Execution evaluator, marketing evaluator
execution/           FORGE/VECTOR executors, OpenClaw adapters, publisher, sandbox
interfaces/          Telegram sender + bot (long-polling)
llm/                 LLM client with failover
orchestration/       Kairos cycle, decision filter, feedback adjusters, briefing
runtime/openclaw/    OpenClaw agent configs and skills
scripts/             Bootstrap, cron runner, seed data
services/            Approval service, metrics collector
src/                 Entry points (main.ts, bot.ts)
state/               SQLite schema, migrations, all table CRUD modules
```

## Prerequisites

- Node.js >= 24
- pnpm

## Setup

```bash
./scripts/bootstrap.sh
cp .env.example .env
```

Edit `.env` with your Telegram bot token, chat ID, and OpenClaw settings.

## Development

```bash
pnpm dev
```

Runs the Kairos cycle once with hot-reload and formatted logs.

## Telegram Bot

```bash
pnpm bot
```

Starts the persistent Telegram bot for human commands. Runs in parallel with the Kairos cron cycle, sharing the SQLite database via WAL mode.

### Commands

| Command                                             | Description                            |
| --------------------------------------------------- | -------------------------------------- |
| `/drafts`                                           | List pending drafts awaiting approval  |
| `/approve <id>`                                     | Approve a draft                        |
| `/reject <id>`                                      | Reject a draft                         |
| `/publish <id>`                                     | Publish an approved artifact (stub v1) |
| `/metrics <id> <impressions> <clicks> <engagement>` | Register manual marketing metrics      |
| `/help`                                             | Show available commands                |

IDs can be partial (first 8 characters).

## Production

```bash
pnpm build
pnpm start
```

## Cron (autonomous execution)

The script `scripts/run-kairos.sh` is designed for cron. It resolves its own path, builds the project, and executes the Kairos cycle.

### Manual test

```bash
./scripts/run-kairos.sh
```

### Register the cron

```bash
crontab -e
```

Add the following line to run every day at 07:00:

```
0 7 * * * /home/rafael/dev-rafael/connexto-axiom-agents/scripts/run-kairos.sh >> /home/rafael/dev-rafael/connexto-axiom-agents/logs/kairos.log 2>&1
```

Replace the path with the absolute path to your project directory.

### Verify

```bash
crontab -l
```

Logs are appended to `logs/kairos.log`. The Telegram Daily Briefing is sent automatically after each cycle.

## Scripts

| Script              | Description                                         |
| ------------------- | --------------------------------------------------- |
| `pnpm dev`          | Run Kairos cycle with hot-reload and formatted logs |
| `pnpm bot`          | Start Telegram bot (persistent long-polling)        |
| `pnpm build`        | Compile TypeScript                                  |
| `pnpm start`        | Run compiled output                                 |
| `pnpm lint`         | Check for linting errors                            |
| `pnpm lint:fix`     | Auto-fix linting errors                             |
| `pnpm format`       | Format all files                                    |
| `pnpm format:check` | Check formatting                                    |
