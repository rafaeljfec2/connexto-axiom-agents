import type { AgentAction } from "./types.js";

const AGENT_PERMISSIONS: Readonly<Record<string, readonly AgentAction[]>> = {
  forge: ["fs.write", "fs.mkdir", "fs.read", "code.plan", "code.apply", "code.lint"],
  vector: ["content.draft", "content.analyze"],
};

export function hasPermission(agent: string, action: AgentAction): boolean {
  const allowed = AGENT_PERMISSIONS[agent];
  if (!allowed) return false;
  return allowed.includes(action);
}

export function getAllowedActions(agent: string): readonly AgentAction[] {
  return AGENT_PERMISSIONS[agent] ?? [];
}
