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
         ┌────────────────────┼────────────────────┐
         v                    v                    v
     KAIROS               FORGE                VECTOR
   (orchestrator)      (tech executor)     (marketing executor)
    gpt-5.2           gpt-5.3-codex          gpt-4o-mini
         |                    |                    |
         |    ┌───────────────┤                    |
         v    v               v                    v
       NEXUS             ┌──────────────┐    ┌──────────┐
    (researcher)         │ Workspaces   │    │ Artifacts│
    gpt-4o-mini          │ Git Branches │    │ Drafts   │
         |               │ Code Changes │    │ Publish  │
         v               └──────────────┘    └──────────┘
   ┌──────────┐               │                    │
   │ Research │               │                    │
   │ Analysis │               │                    │
   └──────────┘               │                    │
         │                    │                    │
         └────────────────────┼────────────────────┘
                              v
                       SQLite (WAL mode)
                              |
                              v
                    Telegram (Daily Briefing)
```

## Agents

| Agent        | Role                                                              | LLM Model       | Status  |
| ------------ | ----------------------------------------------------------------- | ---------------- | ------- |
| **KAIROS**   | Strategic orchestrator — decides, delegates, evaluates with historical context | `gpt-5.2`       | Active  |
| **FORGE**    | Technical executor — reads real code, generates search/replace edits via OpenClaw | `gpt-5.3-codex` | Active  |
| **NEXUS**    | Technical research — analyzes options, trade-offs and risks       | `gpt-4o-mini`    | Active  |
| **VECTOR**   | Marketing executor — generates posts, newsletters, landing copy   | `gpt-4o-mini`    | Active  |
| **SENTINEL** | Security & compliance monitor                                     | —                | Planned |
| **COVENANT** | Governance & policy enforcer                                      | —                | Planned |

## Evolution

| Phase | Name                             | Description                                                        | Status |
| ----- | -------------------------------- | ------------------------------------------------------------------ | ------ |
| 12    | Controlled Forge Execution       | FORGE executes real tasks in sandbox with permissions               | Done   |
| 13    | OpenClaw Integration             | LLM execution runtime via OpenClaw with hardening                  | Done   |
| 14    | Automatic Feedback Loop          | System learns from outcomes, adjusts decision scores               | Done   |
| 15    | VECTOR Real Execution            | Marketing agent generates drafts via OpenClaw                      | Done   |
| 16    | Approval & Semi-Auto Publication | Telegram bot for human approval + stub publication                 | Done   |
| 17    | Marketing Metrics & Feedback     | Engagement metrics influence KAIROS decisions                      | Done   |
| 18    | Governed Code Changes            | FORGE modifies code with PR virtual cycle                          | Done   |
| 22    | NEXUS Technical Research         | Research agent reduces uncertainty before coding                   | Done   |
| 23.1  | Multi-Project Manifest           | Project manifests, isolation by project_id, structure              | Done   |
| 23.2  | FORGE Per-Project Execution      | FORGE reads real code, generates diffs, pushes branches for review | Done   |
| 24    | KAIROS Historical Context        | Historical execution data injected into KAIROS prompt              | Done   |

## Key Features

- **Cost Predictability** — Rigid token budget with monthly limits, per-agent caps, per-task gates, and kill switch
- **Prompt Compression** — Minimalist state-driven prompts, strict templates, hard token limits
- **Feedback Loops** — Execution feedback (SUCCESS/PARTIAL/FAILURE) + marketing feedback (STRONG/AVERAGE/WEAK) automatically adjust decision scores
- **Historical Context** — KAIROS receives aggregated execution history (success rates, frequent failures, risky files) to make informed delegation decisions
- **Multi-Project Support** — Project manifests with isolated workspaces, per-project governance and budget tracking
- **Real Code Modification** — FORGE reads actual source code, generates search/replace diffs, pushes branches for human review
- **Technical Research** — NEXUS agent researches options, trade-offs, and risks before FORGE executes code tasks
- **Human Governance** — All publications and high-risk code changes require explicit approval via Telegram
- **Marketing Intelligence** — Stub/manual metrics with evaluator; strong/weak message type detection feeds back into orchestration
- **Security Hardening** — Output sanitization, sandboxed execution, audit logging, SSRF prevention, workspace isolation

## Tech Stack

| Component       | Technology                          |
| --------------- | ----------------------------------- |
| Runtime         | Node.js >= 24 + TypeScript 5.9      |
| Database        | SQLite (WAL mode, better-sqlite3)   |
| LLM Runtime     | OpenClaw (isolated agent execution) |
| LLM Providers   | OpenAI (gpt-5.2, gpt-5.3-codex, gpt-4o-mini) |
| Version Control | Git (isolated workspaces, branch per task) |
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
| `projects`           | Registered project manifests with runtime state       |

## Project Structure

```
agents/              Agent configs, system prompts, memory
  kairos/            Orchestrator (gpt-5.2)
  forge/             Technical executor (gpt-5.3-codex via OpenClaw)
  nexus/             Technical researcher (gpt-4o-mini)
  vector/            Marketing executor (gpt-4o-mini)
  sentinel/          Security monitor (planned)
  covenant/          Governance enforcer (planned)
config/              Budget limits, logger setup
evaluation/          Execution evaluator, marketing evaluator, NEXUS evaluator
execution/           FORGE/VECTOR/NEXUS executors, project code system, sandbox
  project*.ts        Per-project code: executor, applier, git manager, security, workspace
  nexus*.ts          NEXUS executor and validator
interfaces/          Telegram sender + bot (long-polling)
llm/                 LLM client with failover (OpenAI + Claude)
orchestration/       Kairos cycle, decision filter, feedback adjusters, briefing
  historicalContext   Historical execution data formatting for KAIROS prompt
projects/            Project manifests and multi-project support
  default/           Default project (retrocompatibility)
  <project-id>/      Per-project directories
runtime/openclaw/    OpenClaw agent configs and skills
scripts/             Bootstrap, cron runner, seed data, register-project
services/            Approval service, metrics collector, code change service
shared/policies/     Cross-project policies (risk limits, allowed paths)
src/                 Entry points (main.ts, bot.ts)
state/               SQLite schema, migrations, all table CRUD modules
  executionHistory   Historical aggregation for KAIROS decisions
workspaces/          Temporary isolated Git clones for FORGE execution (gitignored)
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
