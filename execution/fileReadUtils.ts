import fsPromises from "node:fs/promises";

const TRUNCATION_SUFFIX = "\n// ... truncated ...";

export function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + TRUNCATION_SUFFIX;
}

export function truncateWithBudget(
  content: string,
  currentTotal: number,
  maxTotal: number,
): string {
  const available = maxTotal - currentTotal;
  if (content.length <= available) return content;
  return content.slice(0, available) + TRUNCATION_SUFFIX;
}

export async function readFirstLines(filePath: string, maxLines: number): Promise<string> {
  const content = await fsPromises.readFile(filePath, "utf-8");
  const lines = content.split("\n");
  return lines.slice(0, maxLines).join("\n");
}
