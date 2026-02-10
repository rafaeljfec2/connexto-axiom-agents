import type { ForgeAction } from "./types.js";

const AGENT_PERMISSIONS: Readonly<Record<string, readonly ForgeAction[]>> = {
  forge: ["fs.write", "fs.mkdir", "fs.read"],
};

export function hasPermission(agent: string, action: ForgeAction): boolean {
  const allowed = AGENT_PERMISSIONS[agent];
  if (!allowed) return false;
  return allowed.includes(action);
}

export function getAllowedActions(agent: string): readonly ForgeAction[] {
  return AGENT_PERMISSIONS[agent] ?? [];
}
