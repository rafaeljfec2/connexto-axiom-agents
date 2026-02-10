import type { AgentConfig } from "../types.js";

export const config: AgentConfig = {
  name: "vector",
  llmModel: "gpt-4o-mini",
  permissions: ["content.draft", "content.analyze"],
};
