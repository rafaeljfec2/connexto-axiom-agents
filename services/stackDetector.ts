import fs from "node:fs";
import path from "node:path";

export interface DetectedStack {
  readonly language: string;
  readonly framework: string;
  readonly packageManager: string | null;
}

interface StackSignature {
  readonly file: string;
  readonly language: string;
  readonly framework: string;
  readonly packageManager?: string;
}

const STACK_SIGNATURES: readonly StackSignature[] = [
  { file: "package.json", language: "typescript", framework: "node", packageManager: "npm" },
  { file: "pnpm-lock.yaml", language: "typescript", framework: "node", packageManager: "pnpm" },
  { file: "yarn.lock", language: "typescript", framework: "node", packageManager: "yarn" },
  { file: "requirements.txt", language: "python", framework: "unknown" },
  { file: "pyproject.toml", language: "python", framework: "unknown" },
  { file: "Pipfile", language: "python", framework: "django" },
  { file: "go.mod", language: "go", framework: "unknown" },
  { file: "Cargo.toml", language: "rust", framework: "unknown" },
  { file: "pom.xml", language: "java", framework: "maven" },
  { file: "build.gradle", language: "java", framework: "gradle" },
  { file: "Gemfile", language: "ruby", framework: "rails" },
  { file: "composer.json", language: "php", framework: "unknown" },
  { file: "mix.exs", language: "elixir", framework: "phoenix" },
  { file: "pubspec.yaml", language: "dart", framework: "flutter" },
];

function detectFrameworkFromPackageJson(projectPath: string): string {
  const packageJsonPath = path.join(projectPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) return "node";

  try {
    const content = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
    const deps = {
      ...(content.dependencies as Record<string, string> | undefined),
      ...(content.devDependencies as Record<string, string> | undefined),
    };

    if (deps["next"]) return "nextjs";
    if (deps["nuxt"]) return "nuxt";
    if (deps["@angular/core"]) return "angular";
    if (deps["vue"]) return "vue";
    if (deps["react"]) return "react";
    if (deps["svelte"]) return "svelte";
    if (deps["@nestjs/core"]) return "nestjs";
    if (deps["express"]) return "express";
    if (deps["fastify"]) return "fastify";
    if (deps["hono"]) return "hono";
    return "node";
  } catch {
    return "node";
  }
}

function detectLanguageFromPackageJson(projectPath: string): string {
  const tsconfigPath = path.join(projectPath, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) return "typescript";
  return "javascript";
}

export function detectStack(projectPath: string): DetectedStack {
  let language = "unknown";
  let framework = "unknown";
  let packageManager: string | null = null;

  for (const sig of STACK_SIGNATURES) {
    if (fs.existsSync(path.join(projectPath, sig.file))) {
      language = sig.language;
      framework = sig.framework;
      if (sig.packageManager) packageManager = sig.packageManager;
      break;
    }
  }

  if (language === "typescript" || language === "javascript") {
    language = detectLanguageFromPackageJson(projectPath);
    framework = detectFrameworkFromPackageJson(projectPath);
  }

  if (fs.existsSync(path.join(projectPath, "package.json")) && language === "unknown") {
    language = detectLanguageFromPackageJson(projectPath);
    framework = detectFrameworkFromPackageJson(projectPath);
  }

  return { language, framework, packageManager };
}
