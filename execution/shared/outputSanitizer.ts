export const MAX_FILE_SIZE_BYTES = 1_048_576;

const DANGEROUS_COMMANDS = [
  "rm ",
  "rm -",
  "sudo ",
  "chmod ",
  "chown ",
  "curl ",
  "wget ",
  "nc ",
  "ncat ",
  "dd ",
  "mkfs",
  "shutdown",
  "reboot",
  "kill ",
  "pkill ",
  "eval ",
  "> /dev/",
  "| bash",
  "| sh",
];

const SHELL_BLOCK_REGEX = /```(?:bash|sh|shell|zsh)\n([\s\S]*?)```/gi;
const URL_REGEX = /https?:\/\/[^\s)>\]]+/gi;
const NULL_BYTE_REGEX = /\0/g;

export interface SanitizedOutput {
  readonly content: string;
  readonly warnings: readonly string[];
}

export function sanitizeOutput(raw: string): SanitizedOutput {
  const warnings: string[] = [];

  if (NULL_BYTE_REGEX.test(raw)) {
    warnings.push("Null bytes detected and removed");
  }
  let content = raw.replaceAll(NULL_BYTE_REGEX, "");

  if (!isValidText(content)) {
    warnings.push("Binary content detected, output rejected");
    return { content: "", warnings };
  }

  if (Buffer.byteLength(content, "utf-8") > MAX_FILE_SIZE_BYTES) {
    content = truncateToByteLimit(content, MAX_FILE_SIZE_BYTES);
    warnings.push(`Content truncated to ${MAX_FILE_SIZE_BYTES} bytes`);
  }

  content = content.replaceAll(SHELL_BLOCK_REGEX, (match, blockContent: string) => {
    const lower = blockContent.toLowerCase();
    const hasDangerous = DANGEROUS_COMMANDS.some((cmd) => lower.includes(cmd));
    if (hasDangerous) {
      warnings.push(`Dangerous shell block removed: ${blockContent.slice(0, 80).trim()}`);
      return "```\n[BLOCO REMOVIDO: conteudo potencialmente perigoso]\n```";
    }
    return match;
  });

  const urls = content.match(URL_REGEX);
  if (urls && urls.length > 0) {
    warnings.push(`${urls.length} external URL(s) removed`);
    content = content.replaceAll(URL_REGEX, "[URL REMOVIDA]");
  }

  return { content, warnings };
}

function isValidText(content: string): boolean {
  for (let i = 0; i < content.length; i++) {
    const code = content.codePointAt(i) ?? 0;
    if ((code >= 0 && code <= 8) || (code >= 14 && code <= 31)) {
      return false;
    }
  }
  return true;
}

function truncateToByteLimit(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf-8");
  if (buffer.length <= maxBytes) return text;
  return buffer.subarray(0, maxBytes).toString("utf-8");
}
