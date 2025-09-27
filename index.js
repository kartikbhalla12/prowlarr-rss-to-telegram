import axios from "axios";
import fs from "fs";
import cron from "node-cron";
import { XMLParser } from "fast-xml-parser";
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import dayjs from "dayjs";

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PROWLARR_URL = process.env.PROWLARR_URL;
const PROWLARR_API_KEY = process.env.PROWLARR_API_KEY;
const INDEXER_ID = process.env.INDEXER_ID;
const FLARE_RESOLVER_URL = process.env.FLARE_RESOLVER_URL;

// Use config directory if it exists, otherwise use current directory
const CONFIG_DIR = fs.existsSync("/app/config") ? "/app/config" : ".";
const CACHE_FILE = `${CONFIG_DIR}/last-guid.txt`;

const rssFeedUrl = new URL(`${PROWLARR_URL}/${INDEXER_ID}/api`);
rssFeedUrl.searchParams.set("apikey", PROWLARR_API_KEY);
rssFeedUrl.searchParams.set("extended", "1");
rssFeedUrl.searchParams.set("t", "search");
rssFeedUrl.searchParams.set("q", "qxr");

function formatBytes(bytes) {
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

async function sendToTelegram(message) {
  console.log(`[${new Date().toISOString()}] Sending message to Telegram...`);
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: TELEGRAM_CHAT_ID,
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
    console.error(
      `[${new Date().toISOString()}] Telegram error:`,
      data.description
    );
  } else {
    console.log(`[${new Date().toISOString()}] Message sent successfully`);
  }
}

function loadLastGuid() {
  try {
    const guid = fs.readFileSync(CACHE_FILE, "utf-8").trim();
    console.log(`[${new Date().toISOString()}] Loaded last GUID: ${guid}`);
    return guid;
  } catch (error) {
    console.log(
      `[${new Date().toISOString()}] No previous GUID found, starting fresh`
    );
    return null;
  }
}

function saveLastGuid(guid) {
  fs.writeFileSync(CACHE_FILE, guid, "utf-8");
  console.log(`[${new Date().toISOString()}] Saved new GUID: ${guid}`);
}

async function getFileDetails(url) {
  try {
    const requestConfig = {
      cmd: "request.get",
      url,
      maxTimeout: 60000,
    };

    const {
      data: {
        solution: { response },
      },
    } = await axios.post(FLARE_RESOLVER_URL, requestConfig);

    const $ = cheerio.load(response);

    const magnetLink = $('a[href^="magnet:"]').attr("href");
    const releaseType = $('li:contains("Type") span').text().trim();

    return {
      magnetLink: magnetLink || "Magnet link not found",
      releaseType: releaseType || "Unknown",
    };
  } catch (error) {
    console.error("Error fetching magnet link:", error);
    return {
      magnetLink: "Error fetching magnet link",
      releaseType: "Unknown",
    };
  }
}

async function checkFeed() {
  console.log(`[${new Date().toISOString()}] Starting feed check...`);
  const lastGuid = loadLastGuid();

  try {
    console.log(
      `[${new Date().toISOString()}] Fetching RSS feed from ${rssFeedUrl}`
    );
    const res = await axios.get(rssFeedUrl);
    const xml = res.data;

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
    });

    const json = parser.parse(xml);
    const items = json.rss.channel.item;
    console.log(
      `[${new Date().toISOString()}] Found ${items.length} total items in feed`
    );

    // If no previous GUID found, save the latest one and exit
    if (lastGuid === null && items.length > 0) {
      const latestGuid = items[0].guid;
      console.log(
        `[${new Date().toISOString()}] First run detected. Saving latest GUID: ${latestGuid}`
      );
      saveLastGuid(latestGuid);
      return;
    }

    const lastGuidIndex = items.findIndex((item) => item.guid === lastGuid);
    const relevantItems =
      lastGuidIndex === -1 ? items : items.slice(0, lastGuidIndex);

    if (relevantItems.length === 0) {
      console.log(
        `[${new Date().toISOString()}] No new items found since last check`
      );
      return;
    }

    console.log(
      `[${new Date().toISOString()}] Processing ${
        relevantItems.length
      } new items`
    );

    for (const item of relevantItems.reverse()) {
      const title = item.title;
      const url = item.guid;
      const size = formatBytes(parseInt(item.size));
      const pubDate = item.pubDate;

      const formattedDate = dayjs(pubDate).format("MMMM D, YYYY h:mm A");
      const { magnetLink, releaseType } = await getFileDetails(url);
      console.log(`[${new Date().toISOString()}] Processing item: ${title}`);

      const message =
        `<b>${title}</b>\n\n` +
        `📦 <b>Size:</b> ${size}\n\n` +
        `📅 <b>Published:</b> ${formattedDate}\n\n` +
        `📁 <b>Type:</b> ${releaseType}\n\n` +
        `🔗 <a href="${url}">Torrent Page</a>\n\n` +
        `<code>${magnetLink}</code>`;

      await sendToTelegram(message);
    }

    saveLastGuid(relevantItems[relevantItems.length - 1].guid);
    console.log(
      `[${new Date().toISOString()}] Feed check completed successfully`
    );
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error during feed check:`,
      error
    );
  }
}

cron.schedule("*/15 * * * *", () => {
  console.log(`[${new Date().toISOString()}] Starting scheduled feed check...`);
  checkFeed();
});
