import { config as forgeConfig } from "../../agents/forge/config.js";
import type { ForgeExecutionConfig } from "./forgeTypes.js";

export function loadForgeAgentConfig(): ForgeExecutionConfig {
  return {
    maxCorrectionRounds: forgeConfig.maxCorrectionRounds,
    contextMaxChars: forgeConfig.contextMaxChars,
    runBuild: forgeConfig.runBuild,
    buildTimeout: forgeConfig.buildTimeout,
    maxContextFiles: forgeConfig.maxContextFiles,
    enableRipgrep: forgeConfig.enableRipgrep,
    enablePlanningPreview: forgeConfig.enablePlanningPreview,
    enableImportExpansion: forgeConfig.enableImportExpansion,
    enableFrameworkRules: forgeConfig.enableFrameworkRules,
    enablePreLintCheck: forgeConfig.enablePreLintCheck,
    enableTestExecution: forgeConfig.enableTestExecution,
    testTimeout: forgeConfig.testTimeout,
    enableAutoFix: forgeConfig.enableAutoFix,
    enableAtomicEdits: forgeConfig.enableAtomicEdits,
    enableStructuredErrors: forgeConfig.enableStructuredErrors,
    enableRepositoryIndex: forgeConfig.enableRepositoryIndex,
  };
}
