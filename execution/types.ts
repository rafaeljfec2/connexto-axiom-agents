export type ForgeAction = "fs.write" | "fs.mkdir" | "fs.read";

export interface ExecutionResult {
  readonly agent: string;
  readonly task: string;
  readonly status: "success" | "failed";
  readonly output: string;
  readonly error?: string;
}
