import fsPromises from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger.js";

export interface ProjectConfig {
  readonly importAliases: ReadonlyMap<string, string>;
  readonly baseUrl: string | null;
  readonly packageManager: string;
  readonly dependencies: readonly string[];
}

interface TsConfigJson {
  readonly compilerOptions?: {
    readonly paths?: Record<string, readonly string[]>;
    readonly baseUrl?: string;
  };
  readonly extends?: string;
}

interface PackageJson {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const TSCONFIG_CANDIDATES = [
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.base.json",
] as const;

export async function readProjectConfig(workspacePath: string): Promise<ProjectConfig> {
  const [tsConfig, pkgConfig, pkgManager] = await Promise.all([
    readTsConfig(workspacePath),
    readPackageJsonDeps(workspacePath),
    detectPackageManager(workspacePath),
  ]);

  const aliases = new Map<string, string>();
  if (tsConfig.paths) {
    for (const [alias, targets] of Object.entries(tsConfig.paths)) {
      const cleanAlias = alias.replace("/*", "/");
      const cleanTarget = targets[0]?.replace("/*", "/") ?? "";
      if (cleanAlias.length > 0 && cleanTarget.length > 0) {
        aliases.set(cleanAlias, cleanTarget);
      }
    }
  }

  logger.debug(
    {
      aliases: aliases.size,
      baseUrl: tsConfig.baseUrl ?? "none",
      dependencies: pkgConfig.length,
      packageManager: pkgManager,
    },
    "Project config loaded",
  );

  return {
    importAliases: aliases,
    baseUrl: tsConfig.baseUrl ?? null,
    packageManager: pkgManager,
    dependencies: pkgConfig,
  };
}

async function readTsConfig(
  workspacePath: string,
): Promise<{ paths: Record<string, readonly string[]> | null; baseUrl: string | null }> {
  for (const candidate of TSCONFIG_CANDIDATES) {
    try {
      const fullPath = path.join(workspacePath, candidate);
      const raw = await fsPromises.readFile(fullPath, "utf-8");
      const stripped = stripJsonComments(raw);
      const parsed = JSON.parse(stripped) as TsConfigJson;

      if (parsed.compilerOptions?.paths) {
        return {
          paths: parsed.compilerOptions.paths,
          baseUrl: parsed.compilerOptions.baseUrl ?? null,
        };
      }

      if (parsed.extends) {
        const extendedResult = await readExtendedTsConfig(workspacePath, parsed.extends);
        if (extendedResult.paths) return extendedResult;
      }
    } catch {
      continue;
    }
  }

  return { paths: null, baseUrl: null };
}

async function readExtendedTsConfig(
  workspacePath: string,
  extendsPath: string,
): Promise<{ paths: Record<string, readonly string[]> | null; baseUrl: string | null }> {
  try {
    const resolvedPath = extendsPath.startsWith(".")
      ? path.join(workspacePath, extendsPath)
      : path.join(workspacePath, "node_modules", extendsPath);

    const fullPath = resolvedPath.endsWith(".json") ? resolvedPath : `${resolvedPath}.json`;
    const raw = await fsPromises.readFile(fullPath, "utf-8");
    const stripped = stripJsonComments(raw);
    const parsed = JSON.parse(stripped) as TsConfigJson;

    return {
      paths: (parsed.compilerOptions?.paths as Record<string, readonly string[]>) ?? null,
      baseUrl: parsed.compilerOptions?.baseUrl ?? null,
    };
  } catch {
    return { paths: null, baseUrl: null };
  }
}

function stripJsonComments(json: string): string {
  return json
    .replaceAll(/\/\/.*$/gm, "")
    .replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

async function readPackageJsonDeps(workspacePath: string): Promise<readonly string[]> {
  try {
    const fullPath = path.join(workspacePath, "package.json");
    const raw = await fsPromises.readFile(fullPath, "utf-8");
    const pkg = JSON.parse(raw) as PackageJson;

    const deps = new Set<string>();
    if (pkg.dependencies) {
      for (const name of Object.keys(pkg.dependencies)) deps.add(name);
    }
    if (pkg.devDependencies) {
      for (const name of Object.keys(pkg.devDependencies)) deps.add(name);
    }

    return [...deps].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function detectPackageManager(workspacePath: string): Promise<string> {
  try {
    await fsPromises.access(path.join(workspacePath, "pnpm-lock.yaml"));
    return "pnpm";
  } catch { /* not pnpm */ }

  try {
    await fsPromises.access(path.join(workspacePath, "yarn.lock"));
    return "yarn";
  } catch { /* not yarn */ }

  return "npm";
}

export function formatAliasesForPrompt(config: ProjectConfig): string {
  if (config.importAliases.size === 0) return "";

  const lines = ["IMPORT ALIASES DO PROJETO:"];
  for (const [alias, target] of config.importAliases) {
    lines.push(`  ${alias} -> ${target}`);
  }
  if (config.baseUrl) {
    lines.push(`  baseUrl: ${config.baseUrl}`);
  }
  lines.push("Use estes aliases nos imports ao inves de caminhos relativos longos.");
  return lines.join("\n");
}
