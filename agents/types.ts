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
