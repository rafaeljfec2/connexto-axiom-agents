import type { AgentConfig } from "../types.js";

export const config: AgentConfig = {
  name: "forge",
  llmModel: "placeholder",
  permissions: ["fs.write", "fs.mkdir", "fs.read"],
};
