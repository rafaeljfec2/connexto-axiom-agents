import { describe, it, expect } from "vitest";
import {
  classifyFileType,
  formatIndexForPrompt,
  findRelevantFilesFromIndex,
} from "./repositoryIndexer.js";
import type { RepositoryIndex, FileSymbolIndex } from "./repositoryIndexer.js";

describe("classifyFileType", () => {
  it("should classify .test. files as test", () => {
    expect(classifyFileType("src/utils/helper.test.ts", [])).toBe("test");
  });

  it("should classify .spec. files as test", () => {
    expect(classifyFileType("src/components/Button.spec.tsx", [])).toBe("test");
  });

  it("should classify .d.ts files as type", () => {
    expect(classifyFileType("src/types/global.d.ts", [])).toBe("type");
  });

  it("should classify files starting with use as hook", () => {
    expect(classifyFileType("src/hooks/useTheme.ts", [])).toBe("hook");
  });

  it("should classify files exporting hooks as hook", () => {
    expect(classifyFileType("src/lib/theme.ts", ["useTheme", "ThemeProvider"])).toBe("hook");
  });

  it("should classify config directory files as config", () => {
    expect(classifyFileType("src/config/database.ts", [])).toBe("config");
  });

  it("should classify files named config as config", () => {
    expect(classifyFileType("src/app/config.ts", [])).toBe("config");
  });

  it("should classify files named constants as config", () => {
    expect(classifyFileType("src/shared/constants.ts", [])).toBe("config");
  });

  it("should classify types directory as type", () => {
    expect(classifyFileType("src/types/user.ts", [])).toBe("type");
  });

  it("should classify files named types as type", () => {
    expect(classifyFileType("src/models/types.ts", [])).toBe("type");
  });

  it("should classify util directory files as util", () => {
    expect(classifyFileType("src/utils/format.ts", [])).toBe("util");
  });

  it("should classify helper directory files as util", () => {
    expect(classifyFileType("src/helpers/date.ts", [])).toBe("util");
  });

  it("should classify .tsx files as component", () => {
    expect(classifyFileType("src/components/Button.tsx", ["Button"])).toBe("component");
  });

  it("should classify .jsx files as component", () => {
    expect(classifyFileType("src/views/Dashboard.jsx", ["Dashboard"])).toBe("component");
  });

  it("should classify files with PascalCase exports as component", () => {
    expect(classifyFileType("src/features/auth/LoginForm.ts", ["LoginForm"])).toBe("component");
  });

  it("should classify page directory files as component", () => {
    expect(classifyFileType("src/pages/home.tsx", ["Home"])).toBe("component");
  });

  it("should classify layout directory files as component", () => {
    expect(classifyFileType("src/layouts/main.tsx", ["MainLayout"])).toBe("component");
  });

  it("should return other for unrecognized files", () => {
    expect(classifyFileType("src/services/api.ts", ["fetchData", "postData"])).toBe("other");
  });
});

describe("formatIndexForPrompt", () => {
  function buildTestIndex(entries: readonly FileSymbolIndex[]): RepositoryIndex {
    const fileIndex = new Map<string, FileSymbolIndex>();
    for (const entry of entries) {
      fileIndex.set(entry.path, entry);
    }
    return {
      fileIndex,
      totalFiles: entries.length + 5,
      indexedFiles: entries.length,
    };
  }

  it("should include header with file counts", () => {
    const index = buildTestIndex([]);
    const result = formatIndexForPrompt(index);
    expect(result).toContain("FILE INDEX (5 files, 0 indexed):");
  });

  it("should format entries with path, type and exports", () => {
    const index = buildTestIndex([
      { path: "src/hooks/useAuth.ts", exports: ["useAuth", "AuthContext"], type: "hook", size: 500 },
    ]);
    const result = formatIndexForPrompt(index);
    expect(result).toContain("src/hooks/useAuth.ts [hook]: useAuth, AuthContext");
  });

  it("should show no named exports for empty export lists", () => {
    const index = buildTestIndex([
      { path: "src/app/main.ts", exports: [], type: "other", size: 200 },
    ]);
    const result = formatIndexForPrompt(index);
    expect(result).toContain("src/app/main.ts [other]: (no named exports)");
  });

  it("should sort entries by type priority", () => {
    const index = buildTestIndex([
      { path: "src/utils/format.ts", exports: ["format"], type: "util", size: 100 },
      { path: "src/components/Button.tsx", exports: ["Button"], type: "component", size: 200 },
      { path: "src/hooks/useTheme.ts", exports: ["useTheme"], type: "hook", size: 150 },
    ]);
    const result = formatIndexForPrompt(index);
    const lines = result.split("\n").filter((l) => l.includes("["));
    expect(lines[0]).toContain("[component]");
    expect(lines[1]).toContain("[hook]");
    expect(lines[2]).toContain("[util]");
  });

  it("should respect maxChars limit", () => {
    const entries: FileSymbolIndex[] = [];
    for (let i = 0; i < 100; i++) {
      entries.push({
        path: `src/components/Component${i}.tsx`,
        exports: [`Component${i}`, `Component${i}Props`],
        type: "component",
        size: 500,
      });
    }
    const index = buildTestIndex(entries);
    const result = formatIndexForPrompt(index, 500);
    expect(result.length).toBeLessThanOrEqual(550);
  });
});

describe("findRelevantFilesFromIndex", () => {
  function buildTestIndex(entries: readonly FileSymbolIndex[]): RepositoryIndex {
    const fileIndex = new Map<string, FileSymbolIndex>();
    for (const entry of entries) {
      fileIndex.set(entry.path, entry);
    }
    return { fileIndex, totalFiles: entries.length, indexedFiles: entries.length };
  }

  it("should return empty array when no keywords provided", () => {
    const index = buildTestIndex([
      { path: "src/theme.ts", exports: ["theme"], type: "config", size: 100 },
    ]);
    expect(findRelevantFilesFromIndex(index, [])).toEqual([]);
  });

  it("should match files by export name", () => {
    const index = buildTestIndex([
      { path: "src/hooks/useTheme.ts", exports: ["useTheme", "ThemeProvider"], type: "hook", size: 200 },
      { path: "src/utils/math.ts", exports: ["add", "subtract"], type: "util", size: 100 },
    ]);
    const result = findRelevantFilesFromIndex(index, ["theme"]);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].path).toBe("src/hooks/useTheme.ts");
  });

  it("should match files by path keywords", () => {
    const index = buildTestIndex([
      { path: "src/config/theme.ts", exports: ["darkColors"], type: "config", size: 100 },
      { path: "src/utils/format.ts", exports: ["formatDate"], type: "util", size: 100 },
    ]);
    const result = findRelevantFilesFromIndex(index, ["theme"]);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].path).toBe("src/config/theme.ts");
  });

  it("should give higher score to exact export matches", () => {
    const index = buildTestIndex([
      { path: "src/sidebar.ts", exports: ["Sidebar"], type: "component", size: 200 },
      { path: "src/sidebar-utils.ts", exports: ["sidebarWidth"], type: "util", size: 100 },
    ]);
    const result = findRelevantFilesFromIndex(index, ["sidebar"]);
    expect(result.length).toBe(2);
    expect(result[0].path).toBe("src/sidebar.ts");
  });

  it("should respect maxFiles limit", () => {
    const entries: FileSymbolIndex[] = [];
    for (let i = 0; i < 20; i++) {
      entries.push({
        path: `src/theme/variant${i}.ts`,
        exports: [`themeVariant${i}`],
        type: "config",
        size: 100,
      });
    }
    const index = buildTestIndex(entries);
    const result = findRelevantFilesFromIndex(index, ["theme"], 5);
    expect(result.length).toBe(5);
  });

  it("should give bonus to component, hook and config types", () => {
    const index = buildTestIndex([
      { path: "src/other/dark.ts", exports: ["darkMode"], type: "other", size: 100 },
      { path: "src/config/dark.ts", exports: ["darkMode"], type: "config", size: 100 },
    ]);
    const result = findRelevantFilesFromIndex(index, ["dark"]);
    expect(result[0].path).toBe("src/config/dark.ts");
  });
});
