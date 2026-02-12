import { logger } from "../../config/logger.js";

export interface FrameworkRules {
  readonly alwaysIncludePatterns: readonly string[];
  readonly priorityDirs: readonly string[];
  readonly contextualFiles: ReadonlyMap<string, readonly string[]>;
}

interface FrameworkRuleSet {
  readonly patterns: readonly string[];
  readonly dirs: readonly string[];
  readonly contextual: ReadonlyMap<string, readonly string[]>;
}

const NEXTJS_RULES: FrameworkRuleSet = {
  patterns: ["**/layout.tsx", "**/layout.ts", "**/app-shell*"],
  dirs: ["app", "pages", "components", "lib"],
  contextual: new Map<string, readonly string[]>([
    ["page", ["layout.tsx", "layout.ts", "loading.tsx", "error.tsx"]],
    ["route", ["layout.tsx", "layout.ts", "page.tsx", "page.ts"]],
    ["sidebar", ["app-shell*", "layout.tsx", "navigation*", "nav*"]],
    ["nav", ["app-shell*", "layout.tsx", "sidebar*", "navigation*"]],
    ["menu", ["app-shell*", "layout.tsx", "sidebar*", "navigation*"]],
    ["layout", ["page.tsx", "page.ts", "app-shell*"]],
    ["middleware", ["middleware.ts", "middleware.js"]],
    ["api", ["route.ts", "route.js"]],
  ]),
};

const NESTJS_RULES: FrameworkRuleSet = {
  patterns: ["**/*.module.ts", "**/main.ts"],
  dirs: ["src", "libs", "apps"],
  contextual: new Map<string, readonly string[]>([
    ["controller", ["*.module.ts", "*.service.ts", "*.dto.ts"]],
    ["service", ["*.module.ts", "*.controller.ts", "*.repository.ts"]],
    ["module", ["*.controller.ts", "*.service.ts", "*.entity.ts"]],
    ["guard", ["*.module.ts", "auth*"]],
    ["pipe", ["*.dto.ts", "*.controller.ts"]],
    ["entity", ["*.repository.ts", "*.service.ts", "*.module.ts"]],
    ["dto", ["*.controller.ts", "*.service.ts", "*.pipe.ts"]],
  ]),
};

const REACT_RULES: FrameworkRuleSet = {
  patterns: ["**/index.ts", "**/index.tsx"],
  dirs: ["src", "components", "hooks", "utils", "lib", "features"],
  contextual: new Map<string, readonly string[]>([
    ["component", ["index.ts", "index.tsx", "*.types.ts", "*.styles.ts"]],
    ["hook", ["*.types.ts", "use*.ts", "use*.tsx"]],
    ["context", ["*.provider.tsx", "*.context.tsx", "use*.ts"]],
    ["form", ["*.schema.ts", "*.validation.ts", "use*.ts"]],
    ["modal", ["*.types.ts", "index.ts"]],
    ["table", ["*.columns.tsx", "*.types.ts", "use*.ts"]],
  ]),
};

const TURBO_RULES: FrameworkRuleSet = {
  patterns: ["**/turbo.json", "**/package.json"],
  dirs: ["packages", "apps"],
  contextual: new Map<string, readonly string[]>([
    ["package", ["package.json", "index.ts", "tsconfig.json"]],
    ["shared", ["index.ts", "package.json"]],
  ]),
};

function matchFramework(framework: string): readonly FrameworkRuleSet[] {
  const lower = framework.toLowerCase();
  const matched: FrameworkRuleSet[] = [];

  if (lower.includes("next")) matched.push(NEXTJS_RULES);
  if (lower.includes("nest")) matched.push(NESTJS_RULES);
  if (lower.includes("react") || lower.includes("next")) matched.push(REACT_RULES);
  if (lower.includes("turbo") || lower.includes("mono")) matched.push(TURBO_RULES);

  if (matched.length === 0) matched.push(REACT_RULES);

  return matched;
}

export function getFrameworkDiscoveryRules(framework: string): FrameworkRules {
  const ruleSets = matchFramework(framework);

  const allPatterns = new Set<string>();
  const allDirs = new Set<string>();
  const mergedContextual = new Map<string, readonly string[]>();

  for (const ruleSet of ruleSets) {
    for (const p of ruleSet.patterns) allPatterns.add(p);
    for (const d of ruleSet.dirs) allDirs.add(d);
    for (const [key, files] of ruleSet.contextual) {
      const existing = mergedContextual.get(key) ?? [];
      const merged = new Set([...existing, ...files]);
      mergedContextual.set(key, [...merged]);
    }
  }

  logger.debug(
    {
      framework,
      patterns: allPatterns.size,
      dirs: allDirs.size,
      contextualRules: mergedContextual.size,
    },
    "Framework rules loaded",
  );

  return {
    alwaysIncludePatterns: [...allPatterns],
    priorityDirs: [...allDirs],
    contextualFiles: mergedContextual,
  };
}

export function getContextualPatternsForTask(
  rules: FrameworkRules,
  taskKeywords: readonly string[],
): readonly string[] {
  const patterns: string[] = [];

  for (const keyword of taskKeywords) {
    const contextFiles = rules.contextualFiles.get(keyword);
    if (contextFiles) {
      for (const pattern of contextFiles) {
        if (!patterns.includes(pattern)) {
          patterns.push(pattern);
        }
      }
    }
  }

  return patterns;
}
