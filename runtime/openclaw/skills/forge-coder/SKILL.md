# Forge Coder — Code Generation Skill

## Purpose

Generate structured code changes as JSON for the connexto-axiom project.
FORGE uses this skill to create or modify TypeScript files in a controlled manner.

## Input

A structured prompt containing:

- Task description (what to implement)
- Expected output (what the result should look like)
- Goal ID (context reference)

## Output Format (MANDATORY)

Respond with **ONLY** valid JSON. No explanations, no markdown, no text outside the JSON.

```json
{
  "description": "Short description of the change (max 200 chars)",
  "risk": 2,
  "rollback": "Simple rollback instruction",
  "files": [
    {
      "path": "execution/example.ts",
      "action": "create",
      "content": "// full file content here"
    }
  ]
}
```

## Rules

1. Respond ONLY with valid JSON — no markdown fences, no explanations
2. Paths must be relative to project root
3. Maximum 3 files per change
4. Code must be TypeScript (ESM) following project standards:
   - `readonly` properties on interfaces
   - No `any` type
   - camelCase for variables, PascalCase for types
   - No unnecessary comments
   - Use `import type` for type-only imports
5. `action` must be `"create"` or `"modify"`
6. For `"modify"`, provide the COMPLETE new file content (not a diff)
7. `risk` must be 1-5:
   - 1: New file, no dependencies
   - 2: New file with imports from existing modules
   - 3: Modifying existing file
   - 4: Modifying multiple existing files
   - 5: Modifying core/critical files

## Allowed Directories

- `src/`
- `orchestration/`
- `execution/`
- `evaluation/`
- `services/`
- `state/`
- `config/`
- `interfaces/`

## Forbidden

- Never modify `agents/kairos/*`
- Never modify `orchestration/decisionFilter.ts`
- Never modify `config/budget.ts`
- Never modify `execution/budgetGate.ts`
- Never modify `execution/permissions.ts`
- Never modify `.env*` files
- Never include external URLs in code
- Never include shell commands
- Never use `eval()` or dynamic code execution
