import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateNexusOutput, NexusValidationError } from "./nexusValidator.js";

const VALID_OUTPUT = [
  "OPCOES:",
  "- Opcao A: Redis como cache distribuido",
  "- Opcao B: Cache in-memory com Map nativo",
  "",
  "PROS / CONTRAS:",
  "- A: +escalavel, +persistente, -complexidade operacional",
  "- B: +simples, +sem dependencia, -nao compartilhado entre instancias",
  "",
  "RISCO:",
  "- A: medio",
  "- B: baixo",
  "",
  "RECOMENDACAO:",
  "- Considerar cache in-memory para MVP e migrar para Redis quando houver multiplas instancias",
].join("\n");

describe("validateNexusOutput", () => {
  it("should parse a valid output with all required sections", () => {
    const result = validateNexusOutput(VALID_OUTPUT);

    assert.ok(result.options.includes("Opcao A"));
    assert.ok(result.options.includes("Opcao B"));
    assert.ok(result.prosCons.includes("escalavel"));
    assert.ok(result.riskAnalysis.includes("medio"));
    assert.ok(result.riskAnalysis.includes("baixo"));
    assert.ok(result.recommendation.includes("cache in-memory"));
  });

  it("should throw NexusValidationError for empty output", () => {
    assert.throws(() => validateNexusOutput(""), NexusValidationError);
    assert.throws(() => validateNexusOutput("   "), NexusValidationError);
  });

  it("should throw when OPCOES section is missing", () => {
    const output = [
      "PROS / CONTRAS:",
      "- A: +simples",
      "RISCO:",
      "- A: baixo",
      "RECOMENDACAO:",
      "- Usar opcao A",
    ].join("\n");

    assert.throws(() => validateNexusOutput(output), NexusValidationError);
  });

  it("should throw when PROS / CONTRAS section is missing", () => {
    const output = [
      "OPCOES:",
      "- Opcao A: algo",
      "- Opcao B: outro",
      "RISCO:",
      "- A: baixo",
      "- B: medio",
      "RECOMENDACAO:",
      "- Usar opcao A",
    ].join("\n");

    assert.throws(() => validateNexusOutput(output), NexusValidationError);
  });

  it("should throw when RISCO section is missing", () => {
    const output = [
      "OPCOES:",
      "- Opcao A: algo",
      "- Opcao B: outro",
      "PROS / CONTRAS:",
      "- A: +simples",
      "RECOMENDACAO:",
      "- Usar opcao A",
    ].join("\n");

    assert.throws(() => validateNexusOutput(output), NexusValidationError);
  });

  it("should throw when RECOMENDACAO section is missing", () => {
    const output = [
      "OPCOES:",
      "- Opcao A: algo",
      "- Opcao B: outro",
      "PROS / CONTRAS:",
      "- A: +simples",
      "RISCO:",
      "- A: baixo",
      "- B: medio",
    ].join("\n");

    assert.throws(() => validateNexusOutput(output), NexusValidationError);
  });

  it("should throw when OPCOES has fewer than 2 options", () => {
    const output = [
      "OPCOES:",
      "- Opcao A: unica opcao",
      "",
      "PROS / CONTRAS:",
      "- A: +simples",
      "",
      "RISCO:",
      "- A: baixo",
      "",
      "RECOMENDACAO:",
      "- Usar opcao A",
    ].join("\n");

    assert.throws(() => validateNexusOutput(output), NexusValidationError);
  });

  it("should throw when RISCO has no valid level", () => {
    const output = [
      "OPCOES:",
      "- Opcao A: algo",
      "- Opcao B: outro",
      "",
      "PROS / CONTRAS:",
      "- A: +simples",
      "",
      "RISCO:",
      "- A: indefinido",
      "",
      "RECOMENDACAO:",
      "- Usar opcao A",
    ].join("\n");

    assert.throws(() => validateNexusOutput(output), NexusValidationError);
  });

  it("should accept accented section headers", () => {
    const output = [
      "OPÇÕES:",
      "- Opcao A: algo",
      "- Opcao B: outro",
      "",
      "PRÓS / CONTRAS:",
      "- A: +simples",
      "",
      "RISCO:",
      "- A: baixo",
      "- B: alto",
      "",
      "RECOMENDAÇÃO:",
      "- Usar opcao A para simplicidade",
    ].join("\n");

    const result = validateNexusOutput(output);
    assert.ok(result.options.includes("Opcao A"));
    assert.ok(result.recommendation.includes("simplicidade"));
  });

  it("should accept 'medio' with accent in risk section", () => {
    const output = [
      "OPCOES:",
      "- Opcao A: algo",
      "- Opcao B: outro",
      "",
      "PROS / CONTRAS:",
      "- A: +simples",
      "",
      "RISCO:",
      "- A: médio",
      "- B: baixo",
      "",
      "RECOMENDACAO:",
      "- Avaliar ambas",
    ].join("\n");

    const result = validateNexusOutput(output);
    assert.ok(result.riskAnalysis.includes("médio"));
  });

  it("should throw when RECOMENDACAO is empty", () => {
    const output = [
      "OPCOES:",
      "- Opcao A: algo",
      "- Opcao B: outro",
      "",
      "PROS / CONTRAS:",
      "- A: +simples",
      "",
      "RISCO:",
      "- A: baixo",
      "- B: medio",
      "",
      "RECOMENDACAO:",
      "",
    ].join("\n");

    assert.throws(() => validateNexusOutput(output), NexusValidationError);
  });

  it("should handle output with 3+ options", () => {
    const output = [
      "OPCOES:",
      "- Opcao A: Redis",
      "- Opcao B: Memcached",
      "- Opcao C: In-memory Map",
      "",
      "PROS / CONTRAS:",
      "- A: +escalavel, -complexo",
      "- B: +rapido, -sem persistencia",
      "- C: +simples, -nao distribuido",
      "",
      "RISCO:",
      "- A: medio",
      "- B: medio",
      "- C: baixo",
      "",
      "RECOMENDACAO:",
      "- Usar C para MVP e avaliar A quando escalar",
    ].join("\n");

    const result = validateNexusOutput(output);
    assert.ok(result.options.includes("Opcao C"));
  });
});
