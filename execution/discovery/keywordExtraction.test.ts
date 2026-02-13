import { describe, it, expect } from "vitest";
import { extractKeywords, extractGlobPatterns, extractKeywordsFromMultipleSources } from "./keywordExtraction.js";

describe("extractKeywords", () => {
  it("should extract meaningful keywords from a Portuguese task", () => {
    const task = "Preparar PR mínimo alterando apenas tokens/vars do dark p/ vermelho e rodar lint/teste antes de subir";
    const keywords = extractKeywords(task);

    expect(keywords).not.toContain("preparar");
    expect(keywords).not.toContain("apenas");
    expect(keywords).not.toContain("rodar");
    expect(keywords).not.toContain("lint");
    expect(keywords).not.toContain("teste");
    expect(keywords).not.toContain("antes");
    expect(keywords).not.toContain("subir");

    expect(keywords).toContain("tokens");
    expect(keywords).toContain("vars");
    expect(keywords).toContain("dark");
    expect(keywords).toContain("vermelho");
  });

  it("should filter out gerund forms of stop verbs", () => {
    const task = "Implementando alterando modificando corrigindo o componente sidebar";
    const keywords = extractKeywords(task);

    expect(keywords).not.toContain("implementando");
    expect(keywords).not.toContain("alterando");
    expect(keywords).not.toContain("modificando");
    expect(keywords).not.toContain("corrigindo");
    expect(keywords).toContain("componente");
    expect(keywords).toContain("sidebar");
  });

  it("should filter out participle forms of stop verbs", () => {
    const task = "Codigo alterado modificado corrigido no modulo auth";
    const keywords = extractKeywords(task);

    expect(keywords).not.toContain("alterado");
    expect(keywords).not.toContain("modificado");
    expect(keywords).not.toContain("corrigido");
    expect(keywords).toContain("codigo");
    expect(keywords).toContain("modulo");
    expect(keywords).toContain("auth");
  });

  it("should filter words shorter than 4 characters", () => {
    const task = "add new PR for the API";
    const keywords = extractKeywords(task);

    expect(keywords).not.toContain("add");
    expect(keywords).not.toContain("new");
  });

  it("should handle English task descriptions", () => {
    const task = "Add dark mode support to the theme provider component";
    const keywords = extractKeywords(task);

    expect(keywords).toContain("dark");
    expect(keywords).toContain("mode");
    expect(keywords).toContain("support");
    expect(keywords).toContain("theme");
    expect(keywords).toContain("provider");
    expect(keywords).toContain("component");
  });

  it("should normalize accented characters", () => {
    const task = "Alterar configuração de autenticação";
    const keywords = extractKeywords(task);

    expect(keywords).toContain("configuracao");
    expect(keywords).toContain("autenticacao");
  });

  it("should limit keywords to 10 maximum", () => {
    const task = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
    const keywords = extractKeywords(task);
    expect(keywords.length).toBeLessThanOrEqual(10);
  });

  it("should return empty array for empty task", () => {
    expect(extractKeywords("")).toEqual([]);
  });

  it("should filter common task action words in Portuguese", () => {
    const task = "Precisa verificar garantir validar testar aplicar executar corrigir";
    const keywords = extractKeywords(task);
    expect(keywords).toEqual([]);
  });

  it("should keep domain-specific keywords", () => {
    const task = "Implementar dark theme com tokens de cor vermelho no sidebar";
    const keywords = extractKeywords(task);

    expect(keywords).toContain("dark");
    expect(keywords).toContain("theme");
    expect(keywords).toContain("tokens");
    expect(keywords).toContain("vermelho");
    expect(keywords).toContain("sidebar");
  });

  it("should filter newly added stop words: tests, registrar, conforme, mudanca, minima, mapeamento", () => {
    const task = "Implementar mudanca minima conforme mapeamento; rodar lint/tests e registrar evidencias visuais";
    const keywords = extractKeywords(task);

    expect(keywords).not.toContain("mudanca");
    expect(keywords).not.toContain("minima");
    expect(keywords).not.toContain("conforme");
    expect(keywords).not.toContain("mapeamento");
    expect(keywords).not.toContain("tests");
    expect(keywords).not.toContain("registrar");
    expect(keywords).not.toContain("evidencias");
    expect(keywords).toContain("visuais");
  });

  it("should filter verb stems registr- and mape-", () => {
    const task = "Registrando mapeando evidencias no sistema";
    const keywords = extractKeywords(task);

    expect(keywords).not.toContain("registrando");
    expect(keywords).not.toContain("mapeando");
    expect(keywords).toContain("sistema");
  });
});

describe("extractKeywordsFromMultipleSources", () => {
  it("should combine keywords from multiple sources", () => {
    const sources = [
      "Implementar mudanca minima conforme mapeamento",
      "Dark theme com paleta vermelha",
      "Mapear ThemeProvider tokens CSS vars",
    ];
    const keywords = extractKeywordsFromMultipleSources(sources);

    expect(keywords).toContain("dark");
    expect(keywords).toContain("theme");
    expect(keywords).toContain("paleta");
    expect(keywords).toContain("vermelha");
    expect(keywords).toContain("themeprovider");
    expect(keywords).toContain("tokens");
    expect(keywords).toContain("vars");
  });

  it("should deduplicate keywords across sources", () => {
    const sources = [
      "dark theme tokens",
      "dark theme palette",
    ];
    const keywords = extractKeywordsFromMultipleSources(sources);
    const darkCount = keywords.filter((k) => k === "dark").length;
    expect(darkCount).toBe(1);
  });

  it("should filter empty sources", () => {
    const sources = ["", "dark theme", ""];
    const keywords = extractKeywordsFromMultipleSources(sources);
    expect(keywords).toContain("dark");
    expect(keywords).toContain("theme");
  });

  it("should return empty array for all empty sources", () => {
    const keywords = extractKeywordsFromMultipleSources(["", ""]);
    expect(keywords).toEqual([]);
  });
});

describe("extractGlobPatterns", () => {
  it("should generate glob patterns from keywords", () => {
    const patterns = extractGlobPatterns(["theme", "dark"]);

    expect(patterns).toContain("**/*theme*.*");
    expect(patterns).toContain("**/*Theme*.*");
    expect(patterns).toContain("**/*dark*.*");
    expect(patterns).toContain("**/*Dark*.*");
  });

  it("should skip keywords shorter than 3 characters", () => {
    const patterns = extractGlobPatterns(["ab", "theme"]);

    expect(patterns.some((p) => p.includes("ab"))).toBe(false);
    expect(patterns).toContain("**/*theme*.*");
  });
});
