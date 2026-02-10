import type { ProjectStack } from "../../projects/manifest.schema.js";

export interface WritePolicyPaths {
  readonly allowed: readonly string[];
  readonly forbidden: readonly string[];
}

const BASE_FORBIDDEN: readonly string[] = [
  ".git/",
  "node_modules/",
  ".pnpm/",
  ".env",
  ".env.local",
  ".env.production",
  ".env.staging",
  ".env.development",
  "docker/",
  "infra/",
  ".github/",
  "manifest.yaml",
  "Dockerfile",
  "docker-compose.yml",
];

const PATHS_BY_FRAMEWORK: Readonly<Record<string, readonly string[]>> = {
  nestjs: ["src/", "libs/", "test/", "apps/"],
  "nestjs-nextjs-turbo": ["src/", "apps/", "packages/", "test/", "tests/", "lib/"],
  nextjs: ["src/", "app/", "pages/", "components/", "lib/", "utils/", "hooks/", "styles/", "public/"],
  express: ["src/", "routes/", "controllers/", "middleware/", "services/", "models/", "tests/"],
  node: ["src/", "lib/", "test/", "tests/"],
  react: ["src/", "components/", "hooks/", "utils/", "styles/", "pages/", "tests/"],
  angular: ["src/", "e2e/"],
  vue: ["src/", "components/", "views/", "store/", "router/", "tests/"],
  default: [
    "src/", "app/", "apps/", "lib/", "components/", "packages/",
    "test/", "tests/", "utils/", "helpers/", "hooks/", "pages/",
    "views/", "routes/", "middleware/", "modules/", "styles/", "public/",
  ],
};

export function getAllowedWritePaths(stack: ProjectStack): readonly string[] {
  return PATHS_BY_FRAMEWORK[stack.framework] ?? PATHS_BY_FRAMEWORK["default"];
}

export function getForbiddenPaths(): readonly string[] {
  return BASE_FORBIDDEN;
}

export function getWritePolicy(stack: ProjectStack): WritePolicyPaths {
  return {
    allowed: getAllowedWritePaths(stack),
    forbidden: getForbiddenPaths(),
  };
}
