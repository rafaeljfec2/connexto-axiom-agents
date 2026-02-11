import type { ForgeAgentConfig } from "../types.js";

export const config: ForgeAgentConfig = {
  name: "forge",
  llmModel: "placeholder",
  permissions: ["fs.write", "fs.mkdir", "fs.read"],
  maxCorrectionRounds: 4,
  contextMaxChars: 20_000,
  runBuild: true,
  buildTimeout: 120_000,
};
