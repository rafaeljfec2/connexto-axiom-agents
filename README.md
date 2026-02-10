# connexto-axiom-agents

Operational execution system where AI agents work continuously to advance real objectives.

## Prerequisites

- Node.js >= 24
- pnpm

## Setup

```bash
./scripts/bootstrap.sh
cp .env.example .env
```

Edit `.env` with your Telegram bot token and chat ID.

## Development

```bash
pnpm dev
```

Runs the Kairos cycle once with hot-reload and formatted logs.

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

| Script              | Description                            |
| ------------------- | -------------------------------------- |
| `pnpm dev`          | Run with hot-reload and formatted logs |
| `pnpm build`        | Compile TypeScript                     |
| `pnpm start`        | Run compiled output                    |
| `pnpm lint`         | Check for linting errors               |
| `pnpm lint:fix`     | Auto-fix linting errors                |
| `pnpm format`       | Format all files                       |
| `pnpm format:check` | Check formatting                       |
