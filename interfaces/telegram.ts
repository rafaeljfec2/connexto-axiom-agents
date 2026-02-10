import { logger } from "../config/logger.js";

export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logger.warn("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. Skipping message.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const sent = await trySend(url, chatId, text, "Markdown");
  if (!sent) {
    logger.warn("Markdown failed, retrying as plain text");
    await trySend(url, chatId, text, undefined);
  }
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
