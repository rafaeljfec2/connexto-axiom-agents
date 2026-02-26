import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

export interface AuditEntry {
  readonly agent: string;
  readonly action: string;
  readonly inputHash: string;
  readonly outputHash: string | null;
  readonly sanitizerWarnings: readonly string[];
  readonly runtime: "local" | "openclaw" | "claude-cli";
}

export function logAudit(db: BetterSqlite3.Database, entry: AuditEntry): void {
  const warnings =
    entry.sanitizerWarnings.length > 0 ? JSON.stringify(entry.sanitizerWarnings) : null;

  db.prepare(
    "INSERT INTO audit_log (id, agent_id, action, input_hash, output_hash, sanitizer_warnings, runtime) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    crypto.randomUUID(),
    entry.agent,
    entry.action,
    entry.inputHash,
    entry.outputHash,
    warnings,
    entry.runtime,
  );
}

export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}
