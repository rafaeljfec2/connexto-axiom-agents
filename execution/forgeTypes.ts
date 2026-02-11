import type BetterSqlite3 from "better-sqlite3";
import type { KairosDelegation } from "../orchestration/types.js";
import type { FileChange } from "./projectSecurity.js";

export const CHARS_PER_TOKEN_ESTIMATE = 4;
export const DEFAULT_MAX_CORRECTION_ROUNDS = 4;
export const DEFAULT_CONTEXT_MAX_CHARS = 20_000;
export const MAX_LINT_ERROR_CHARS = 2000;

export interface ForgeAgentContext {
  readonly db: BetterSqlite3.Database;
  readonly delegation: KairosDelegation;
  readonly projectId: string;
  readonly workspacePath: string;
  readonly project: {
    readonly language: string;
    readonly framework: string;
    readonly repo_source: string;
  };
  readonly maxCorrectionRounds: number;
}

export interface ForgePlan {
  readonly plan: string;
  readonly filesToRead: readonly string[];
  readonly filesToModify: readonly string[];
  readonly filesToCreate: readonly string[];
  readonly approach: string;
  readonly estimatedRisk: number;
  readonly dependencies: readonly string[];
}

export interface ForgeCodeOutput {
  readonly description: string;
  readonly risk: number;
  readonly rollback: string;
  readonly files: readonly FileChange[];
}

export interface ForgeAgentResult {
  readonly success: boolean;
  readonly parsed: ForgeCodeOutput | null;
  readonly totalTokensUsed: number;
  readonly phasesCompleted: number;
  readonly error?: string;
  readonly lintOutput?: string;
}

export interface PlanningResult {
  readonly plan: ForgePlan | null;
  readonly tokensUsed: number;
}

export interface EditResult {
  readonly parsed: ForgeCodeOutput | null;
  readonly tokensUsed: number;
}

export interface CorrectionResult {
  readonly success: boolean;
  readonly finalParsed: ForgeCodeOutput | null;
  readonly totalTokensUsed: number;
  readonly correctionRoundsUsed: number;
  readonly lintOutput?: string;
  readonly error?: string;
}

export interface CorrectionRoundResult {
  readonly parsed: ForgeCodeOutput | null;
  readonly tokensUsed: number;
}

export function loadForgeAgentConfig(): {
  readonly maxCorrectionRounds: number;
  readonly contextMaxChars: number;
} {
  const maxRounds = Number(process.env.FORGE_MAX_CORRECTION_ROUNDS);
  const maxChars = Number(process.env.FORGE_CONTEXT_MAX_CHARS);

  return {
    maxCorrectionRounds: Number.isFinite(maxRounds) && maxRounds >= 0
      ? maxRounds
      : DEFAULT_MAX_CORRECTION_ROUNDS,
    contextMaxChars: Number.isFinite(maxChars) && maxChars > 0
      ? maxChars
      : DEFAULT_CONTEXT_MAX_CHARS,
  };
}
