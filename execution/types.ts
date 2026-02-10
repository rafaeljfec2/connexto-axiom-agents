export type ForgeAction =
  | "fs.write"
  | "fs.mkdir"
  | "fs.read"
  | "code.plan"
  | "code.apply"
  | "code.lint";
export type VectorAction = "content.draft" | "content.analyze";
export type NexusAction = "research.query";
export type AgentAction = ForgeAction | VectorAction | NexusAction;

export interface ExecutionResult {
  readonly agent: string;
  readonly task: string;
  readonly status: "success" | "failed";
  readonly output: string;
  readonly error?: string;
  readonly tokensUsed?: number;
  readonly executionTimeMs?: number;
  readonly artifactSizeBytes?: number;
}
