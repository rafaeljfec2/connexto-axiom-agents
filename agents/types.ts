export interface AgentConfig {
  readonly name: string;
  readonly llmModel: string;
  readonly permissions: readonly string[];
}

export interface ForgeAgentConfig extends AgentConfig {
  readonly maxCorrectionRounds: number;
  readonly contextMaxChars: number;
  readonly runBuild: boolean;
  readonly buildTimeout: number;
}
