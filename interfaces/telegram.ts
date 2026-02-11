import { logger } from "../config/logger.js";

const TELEGRAM_MAX_CHARS = 4000;

export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logger.warn("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. Skipping message.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const chunks = splitMessage(text, TELEGRAM_MAX_CHARS);

  for (const chunk of chunks) {
    const sent = await trySend(url, chatId, chunk, "Markdown");
    if (!sent) {
      logger.warn("Markdown failed, retrying as plain text");
      await trySend(url, chatId, chunk, undefined);
    }
  }
}

function splitMessage(text: string, maxLength: number): readonly string[] {
  if (text.length <= maxLength) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx <= 0) {
      splitIdx = maxLength;
    }

    parts.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return parts;
}

async function trySend(
  url: string,
  chatId: string,
  text: string,
  parseMode: string | undefined,
): Promise<boolean> {
  const payload: Record<string, string> = { chat_id: chatId, text };
  if (parseMode) {
    payload["parse_mode"] = parseMode;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error({ status: response.status, body, parseMode }, "Telegram API error");
    return false;
  }

  logger.info({ parseMode: parseMode ?? "plain" }, "Telegram message sent successfully");
  return true;
}
