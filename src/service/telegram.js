import { info, error } from "./logger.js";

export const sendToTelegram = async (message, { logOnly, telegramBotToken, telegramChatId }) => {
  if (logOnly) {
    info("[LOG_ONLY] Would send to Telegram:\n---\n" + message + "\n---");
    return;
  }

  info("Sending message to Telegram...");
  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
  const body = {
    chat_id: telegramChatId,
    text: message,
    parse_mode: "HTML",
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    error("Telegram error:", data.description);
  } else {
    info("Message sent successfully");
  }
};
