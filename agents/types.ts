export interface AgentConfig {
  readonly name: string;
  readonly llmModel: string;
  readonly permissions: readonly string[];
}
