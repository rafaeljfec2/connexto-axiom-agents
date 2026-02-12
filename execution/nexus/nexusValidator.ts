export interface NexusResearchOutput {
  readonly options: string;
  readonly prosCons: string;
  readonly riskAnalysis: string;
  readonly recommendation: string;
}

const SECTION_PATTERNS: ReadonlyArray<{
  readonly key: keyof NexusResearchOutput;
  readonly regex: RegExp;
  readonly label: string;
}> = [
  { key: "options", regex: /^OP[CÇ][OÕ]ES:\s*/im, label: "OPCOES" },
  { key: "prosCons", regex: /^PR[OÓ]S\s*\/\s*CONTRAS:\s*/im, label: "PROS / CONTRAS" },
  { key: "riskAnalysis", regex: /^RISCO:\s*/im, label: "RISCO" },
  { key: "recommendation", regex: /^RECOMENDA[CÇ][AÃ]O:\s*/im, label: "RECOMENDACAO" },
];

export function validateNexusOutput(rawOutput: string): NexusResearchOutput {
  const trimmed = rawOutput.trim();

  if (trimmed.length === 0) {
    throw new NexusValidationError("NEXUS output is empty");
  }

  const sections = extractSections(trimmed);

  validateOptionsSection(sections.options);
  validateProsConsSection(sections.prosCons);
  validateRiskSection(sections.riskAnalysis);
  validateRecommendationSection(sections.recommendation);

  return sections;
}

function extractSections(text: string): NexusResearchOutput {
  const sectionPositions: Array<{
    readonly key: keyof NexusResearchOutput;
    readonly label: string;
    readonly start: number;
    readonly headerEnd: number;
  }> = [];

  for (const pattern of SECTION_PATTERNS) {
    const match = pattern.regex.exec(text);
    if (!match) {
      throw new NexusValidationError(`Missing required section: ${pattern.label}`);
    }
    sectionPositions.push({
      key: pattern.key,
      label: pattern.label,
      start: match.index,
      headerEnd: match.index + match[0].length,
    });
  }

  const sorted = [...sectionPositions].sort((a, b) => a.start - b.start);

  const result: Record<string, string> = {};

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const nextStart = i + 1 < sorted.length ? sorted[i + 1].start : text.length;
    result[current.key] = text.slice(current.headerEnd, nextStart).trim();
  }

  return result as unknown as NexusResearchOutput;
}

function validateOptionsSection(content: string): void {
  const lines = extractBulletLines(content);
  if (lines.length < 2) {
    throw new NexusValidationError(
      `OPCOES section must have at least 2 options, found ${String(lines.length)}`,
    );
  }
}

function validateProsConsSection(content: string): void {
  const lines = extractBulletLines(content);
  if (lines.length === 0) {
    throw new NexusValidationError("PROS / CONTRAS section must have at least 1 entry");
  }
}

function validateRiskSection(content: string): void {
  const lines = extractBulletLines(content);
  if (lines.length === 0) {
    throw new NexusValidationError("RISCO section must have at least 1 entry");
  }

  const validLevels = ["baixo", "medio", "médio", "alto"];
  for (const line of lines) {
    const lower = line.toLowerCase();
    const hasValidLevel = validLevels.some((level) => lower.includes(level));
    if (!hasValidLevel) {
      throw new NexusValidationError(
        `RISCO entry must contain a risk level (baixo/medio/alto): "${line}"`,
      );
    }
  }
}

function validateRecommendationSection(content: string): void {
  const trimmed = content.replace(/^-\s*/, "").trim();
  if (trimmed.length === 0) {
    throw new NexusValidationError("RECOMENDACAO section must not be empty");
  }
}

function extractBulletLines(content: string): readonly string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

export class NexusValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusValidationError";
  }
}
