export function buildQualityRulesSection(): string {
  return [
    "# Code Quality Rules",
    "",
    "## Coding Standards",
    "- Write all code in English (US)",
    "- Use `??` instead of `||` for nullish coalescing (NEVER use `||` for default assignments)",
    "- Never use `any` type anywhere — always define proper interfaces or types",
    "- Mark component props and interface properties as `readonly`",
    "- Prefer `.at(-1)` over `[arr.length - 1]` for last-element access",
    "- Do NOT add comments to the code unless explaining non-obvious intent or trade-offs",
    "",
    "## Async Patterns",
    "- Use `Promise.all` for independent async operations",
    "- Use `Promise.allSettled` when you need to continue even if some promises fail",
    "- Do NOT use `Promise.all` for dependent/sequential operations",
    "",
    "## Code Organization",
    "- Keep files under 800 lines; if close to limit, extract modules to maintain organization",
    "- Split long functions into smaller ones with clear names and single responsibility",
    "- Before writing new logic, check if similar logic already exists in the codebase to avoid duplication",
    "- Prefer extending existing modules over creating new files",
  ].join("\n");
}

export function isFrontendStack(language: string, framework: string): boolean {
  const frontendIndicators = ["react", "next", "vue", "angular", "svelte", "solid", "astro", "remix"];
  const combined = `${language} ${framework}`.toLowerCase();
  return frontendIndicators.some((indicator) => combined.includes(indicator));
}

export function buildFrontendRulesSection(language: string, framework: string): string {
  if (!isFrontendStack(language, framework)) return "";

  return [
    "# Frontend Rules",
    "",
    "- ALL frontend code MUST be built mobile-first — start with the mobile layout, then add responsive breakpoints",
    "- Mark all component props as `readonly` (SonarQube typescript:S6759)",
    "- Use semantic HTML elements when possible",
    "- Prefer composition over prop drilling — extract reusable hooks for shared logic",
    "- Keep components focused on a single responsibility; extract sub-components when they grow",
  ].join("\n");
}

export function buildTestingRulesSection(): string {
  return [
    "# Testing Rules",
    "",
    "- All test descriptions (describe/it blocks) MUST be written in English",
    "- Prioritize unit tests for business logic and integration tests for cross-module flows",
    "- Tests must be clear, descriptive, and independent from each other",
    "- Never use mock/simulated data in dev or production code — only in tests",
    "- Never use `any` type in test code — define proper types for test fixtures",
  ].join("\n");
}

export function buildDependencyRulesSection(): string {
  return [
    "# Dependency Rules",
    "",
    "- Before adding a new dependency, verify if something similar already exists in the project",
    "- Prefer widely adopted, well-maintained libraries",
    "- Pin dependency versions in package.json (use exact versions, not ranges)",
    "- Minimize external dependencies — use native APIs when possible",
  ].join("\n");
}

export function buildArchitectureRulesSection(): string {
  return [
    "# Architecture Rules",
    "",
    "- Prioritize simple, readable, and reusable solutions",
    "- Consider scalability, testability, and future maintenance when writing code",
    "- Never expose ORM/database entities directly in controllers or API routes — use DTOs or mapped types",
    "- If a file becomes too long, extract modules, components, or classes to keep organization",
    "- Every new feature or fix should be accompanied by automated tests when feasible",
    "- Never introduce new libraries, frameworks, or architecture patterns without verifying necessity",
  ].join("\n");
}

export function buildSecurityRulesSection(): string {
  return [
    "# Security Rules",
    "",
    "- NEVER modify .env files or files containing secrets/credentials",
    "- NEVER commit credentials or API keys",
    "- NEVER run git push, git merge, git rebase, or any git command that alters remote state",
    "- NEVER delete branches or alter git history (no --force, --amend, rebase)",
    "- NEVER run destructive global commands (rm -rf, format, shutdown, npm publish, docker push)",
    "- NEVER modify files outside the workspace",
    "- Validate and sanitize any user input in code you write",
  ].join("\n");
}
