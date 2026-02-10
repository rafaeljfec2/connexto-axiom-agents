#!/usr/bin/env bash
set -euo pipefail

REQUIRED_NODE_MAJOR=24
DB_PATH="state/local.db"
SCHEMA_PATH="state/schema.sql"

echo "=== connexto-axiom bootstrap ==="
echo ""

# 1. Check Node.js is installed
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed."
  echo "Please install Node.js >= ${REQUIRED_NODE_MAJOR} from https://nodejs.org"
  exit 1
fi

# 2. Check Node.js version
NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  echo "ERROR: Node.js >= ${REQUIRED_NODE_MAJOR} is required. Found: v${NODE_VERSION}"
  exit 1
fi

echo "[ok] Node.js v${NODE_VERSION}"

# 3. Check pnpm is available
if ! command -v pnpm &> /dev/null; then
  echo "ERROR: pnpm is not installed."
  echo "Install it with: corepack enable && corepack prepare pnpm@latest --activate"
  exit 1
fi

echo "[ok] pnpm $(pnpm -v)"

# 4. Install dependencies
echo ""
echo "Installing dependencies..."
pnpm install
echo "[ok] Dependencies installed"

# 5. Initialize SQLite database
echo ""
if [ -f "$DB_PATH" ]; then
  echo "[skip] Database already exists at ${DB_PATH}"
else
  if [ ! -f "$SCHEMA_PATH" ]; then
    echo "ERROR: Schema file not found at ${SCHEMA_PATH}"
    exit 1
  fi

  echo "Initializing SQLite database..."
  node --input-type=module -e "
    import Database from 'better-sqlite3';
    import { readFileSync } from 'fs';
    const schema = readFileSync('${SCHEMA_PATH}', 'utf-8');
    const db = new Database('${DB_PATH}');
    db.exec(schema);
    const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
    console.log('  Tables created: ' + tables.map(t => t.name).join(', '));
    db.close();
  "
  echo "[ok] Database initialized at ${DB_PATH}"
fi

# 6. Done
echo ""
echo "=== bootstrap complete ==="
echo "Run 'pnpm dev' to start in development mode."
