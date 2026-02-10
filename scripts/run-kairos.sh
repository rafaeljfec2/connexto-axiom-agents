#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

export NODE_ENV=production

./node_modules/.bin/tsc

exec node --env-file=.env dist/src/main.js
