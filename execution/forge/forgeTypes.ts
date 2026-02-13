import type BetterSqlite3 from "better-sqlite3";
import type { KairosDelegation } from "../../orchestration/types.js";
import type { FileChange } from "../project/projectSecurity.js";

export const CHARS_PER_TOKEN_ESTIMATE = 4;
export const MAX_LINT_ERROR_CHARS = 2000;

export interface NexusResearchContext {
  readonly question: string;
  readonly recommendation: string;
  readonly rawOutput: string;
}

export interface GoalContext {
  readonly title: string;
  readonly description: string | null;
}

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
  readonly traceId?: string;
  readonly nexusResearch?: readonly NexusResearchContext[];
  readonly goalContext?: GoalContext;
  readonly maxCorrectionRounds: number;
  readonly runBuild: boolean;
  readonly buildTimeout: number;
  readonly maxContextFiles: number;
  readonly enableRipgrep: boolean;
  readonly enablePlanningPreview: boolean;
  readonly enableImportExpansion: boolean;
  readonly enableFrameworkRules: boolean;
  readonly enablePreLintCheck: boolean;
  readonly enableTestExecution: boolean;
  readonly testTimeout: number;
  readonly enableAutoFix: boolean;
  readonly enableAtomicEdits: boolean;
  readonly enableStructuredErrors: boolean;
  readonly enableRepositoryIndex: boolean;
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

export interface ReplanContext {
  readonly failedPlan: ForgePlan;
  readonly failedFiles: readonly string[];
  readonly failureReason: string;
  readonly fileSnippets: readonly { readonly path: string; readonly snippet: string }[];
}

export interface CorrectionResult {
  readonly success: boolean;
  readonly finalParsed: ForgeCodeOutput | null;
  readonly totalTokensUsed: number;
  readonly correctionRoundsUsed: number;
  readonly lintOutput?: string;
  readonly error?: string;
  readonly shouldReplan?: boolean;
  readonly replanContext?: ReplanContext;
}

export interface CorrectionRoundResult {
  readonly parsed: ForgeCodeOutput | null;
  readonly tokensUsed: number;
}

export interface ForgeExecutionConfig {
  readonly maxCorrectionRounds: number;
  readonly contextMaxChars: number;
  readonly runBuild: boolean;
  readonly buildTimeout: number;
  readonly maxContextFiles: number;
  readonly enableRipgrep: boolean;
  readonly enablePlanningPreview: boolean;
  readonly enableImportExpansion: boolean;
  readonly enableFrameworkRules: boolean;
  readonly enablePreLintCheck: boolean;
  readonly enableTestExecution: boolean;
  readonly testTimeout: number;
  readonly enableAutoFix: boolean;
  readonly enableAtomicEdits: boolean;
  readonly enableStructuredErrors: boolean;
  readonly enableRepositoryIndex: boolean;
}

export { loadForgeAgentConfig } from "./forgeConfigLoader.js";
