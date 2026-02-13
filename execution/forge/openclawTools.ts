import type { ToolDefinition } from "../shared/openclawResponsesClient.js";

export const TOOL_READ_FILE: ToolDefinition = {
  type: "function",
  function: {
    name: "read_file",
    description:
      "Read the contents of a file in the project workspace. Returns the file content as text. " +
      "Use this before editing a file to understand its current state. " +
      "The path must be relative to the workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file from workspace root (e.g. 'src/components/Button.tsx')",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
};

export const TOOL_WRITE_FILE: ToolDefinition = {
  type: "function",
  function: {
    name: "write_file",
    description:
      "Write or overwrite an entire file in the project workspace. " +
      "Creates the file if it does not exist, including any necessary parent directories. " +
      "Use this for creating new files or when you need to replace the entire file content. " +
      "For partial edits, prefer edit_file instead.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file from workspace root",
        },
        content: {
          type: "string",
          description: "The complete file content to write",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
};

export const TOOL_EDIT_FILE: ToolDefinition = {
  type: "function",
  function: {
    name: "edit_file",
    description:
      "Apply a search-and-replace edit to an existing file. " +
      "The search string must match EXACTLY as it appears in the file (including whitespace and indentation). " +
      "Always read the file first to get the exact content. " +
      "For multiple edits to the same file, call this tool multiple times.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file from workspace root",
        },
        search: {
          type: "string",
          description: "The exact string to find in the file. Must match verbatim.",
        },
        replace: {
          type: "string",
          description: "The string to replace the search match with",
        },
      },
      required: ["path", "search", "replace"],
      additionalProperties: false,
    },
  },
};

export const TOOL_RUN_COMMAND: ToolDefinition = {
  type: "function",
  function: {
    name: "run_command",
    description:
      "Execute a shell command in the project workspace. " +
      "Use this for running lint, type-check, build, tests, or git status. " +
      "Destructive commands (rm -rf, git push, npm publish) are blocked. " +
      "Commands run with a timeout and are sandboxed to the workspace directory.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The shell command to execute (e.g. 'npx tsc --noEmit', 'npx eslint src/', 'git diff --stat')",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
};

export const TOOL_LIST_DIRECTORY: ToolDefinition = {
  type: "function",
  function: {
    name: "list_directory",
    description:
      "List the contents of a directory in the project workspace. " +
      "Returns file and directory names. Use depth to control recursion level. " +
      "Useful for understanding project structure before making changes.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the directory from workspace root (use '.' for root)",
        },
        depth: {
          type: "number",
          description: "Maximum recursion depth (default: 2, max: 5)",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
};

export const TOOL_SEARCH_CODE: ToolDefinition = {
  type: "function",
  function: {
    name: "search_code",
    description:
      "Search for a pattern in the project codebase using ripgrep. " +
      "Returns matching lines with file paths and line numbers. " +
      "Use this to find where variables, functions, classes, or patterns are used. " +
      "Supports regex patterns.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The search pattern (supports regex, e.g. 'export function.*Auth')",
        },
        glob: {
          type: "string",
          description: "Optional file glob to narrow search (e.g. '*.ts', '*.css', 'src/**/*.tsx')",
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
};

export function getAllToolDefinitions(): readonly ToolDefinition[] {
  return [
    TOOL_READ_FILE,
    TOOL_WRITE_FILE,
    TOOL_EDIT_FILE,
    TOOL_RUN_COMMAND,
    TOOL_LIST_DIRECTORY,
    TOOL_SEARCH_CODE,
  ] as const;
}

export function getToolNames(): readonly string[] {
  return getAllToolDefinitions().map((t) => t.function.name);
}
