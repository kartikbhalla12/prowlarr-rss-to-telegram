import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const LOG_ONLY =
  process.env.LOG_ONLY === "1" ||
  process.env.LOG_ONLY === "true" ||
  process.env.LOG_ONLY === "yes";

const CONFIG_DIR = fs.existsSync("/app/config") ? "/app/config" : ".";
const CACHE_FILE = `${CONFIG_DIR}/last-guid.txt`;

const rssFeedUrl = new URL(
  `${process.env.PROWLARR_URL}/${process.env.INDEXER_ID}/api`
);
rssFeedUrl.searchParams.set("apikey", process.env.PROWLARR_API_KEY);
rssFeedUrl.searchParams.set("extended", "1");
rssFeedUrl.searchParams.set("t", "search");
rssFeedUrl.searchParams.set("q", "qxr");

export const config = {
  logOnly: LOG_ONLY,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  prowlarrUrl: process.env.PROWLARR_URL,
  prowlarrApiKey: process.env.PROWLARR_API_KEY,
  indexerId: process.env.INDEXER_ID,
  flareResolverUrl: process.env.FLARE_RESOLVER_URL,
  cronSchedule: process.env.CRON_SCHEDULE || "*/15 * * * *",
  maxRetries: Math.max(1, parseInt(process.env.MAX_RETRIES, 10) || 3),
  configDir: CONFIG_DIR,
  cacheFile: CACHE_FILE,
  rssFeedUrl,
};
