import fetch from 'node-fetch';
import fs from 'fs';
import cron from 'node-cron';
import { XMLParser } from 'fast-xml-parser';
import dotenv from 'dotenv';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RSS_FEED_URL = process.env.RSS_FEED_URL;

const CACHE_FILE = './last-guid.txt';

function getAttr(attrs, name) {
  const attr = attrs.find(a => a.name === name);
  return attr ? attr.value : null;
}

function formatBytes(bytes) {
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function sendToTelegram(message) {
  console.log(`[${new Date().toISOString()}] Sending message to Telegram...`);
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    })
  });

  const data = await res.json();
  if (!data.ok) {
    console.error(`[${new Date().toISOString()}] Telegram error:`, data.description);
  } else {
    console.log(`[${new Date().toISOString()}] Message sent successfully`);
  }
}

function loadLastGuid() {
  try {
    const guid = fs.readFileSync(CACHE_FILE, 'utf-8').trim();
    console.log(`[${new Date().toISOString()}] Loaded last GUID: ${guid}`);
    return guid;
  } catch (error) {
    console.log(`[${new Date().toISOString()}] No previous GUID found, starting fresh`);
    return null;
  }
}

function saveLastGuid(guid) {
  fs.writeFileSync(CACHE_FILE, guid, 'utf-8');
  console.log(`[${new Date().toISOString()}] Saved new GUID: ${guid}`);
}

async function checkFeed() {
  console.log(`[${new Date().toISOString()}] Starting feed check...`);
  const lastGuid = loadLastGuid();

  try {
    console.log(`[${new Date().toISOString()}] Fetching RSS feed from ${RSS_FEED_URL}`);
    const res = await fetch(RSS_FEED_URL);
    const xml = await res.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
    });

    const json = parser.parse(xml);
    const items = json.rss.channel.item;
    console.log(`[${new Date().toISOString()}] Found ${items.length} total items in feed`);

    const lastGuidIndex = items.findIndex(item => item.guid === lastGuid);
    const relevantItems = lastGuidIndex === -1 ? items : items.slice(0, lastGuidIndex);

    if(relevantItems.length === 0) {
      console.log(`[${new Date().toISOString()}] No new items found since last check`);
      return;
    }

    console.log(`[${new Date().toISOString()}] Processing ${relevantItems.length} new items`);

    for (const item of relevantItems.reverse()) {
      const title = item.title;
      const url = item.guid;
      const size = formatBytes(parseInt(item.size));
      const pubDate = item.pubDate;
      const seeders = getAttr(item['torznab:attr'], 'seeders');
      const peers = getAttr(item['torznab:attr'], 'peers');

      console.log(`[${new Date().toISOString()}] Processing item: ${title}`);
      const message = `<b>${title}</b>\n\n🌱 <b>Seeders:</b> ${seeders}\n👥 <b>Peers:</b> ${peers}\n📦 <b>Size:</b> ${size}\n📅 <b>Published:</b> ${pubDate}\n🔗 <a href="${url}">Torrent Page</a>`;
      await sendToTelegram(message);
    }

    saveLastGuid(relevantItems[relevantItems.length - 1].guid);
    console.log(`[${new Date().toISOString()}] Feed check completed successfully`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error during feed check:`, error);
  }
}

cron.schedule('*/15 * * * *', () => {
  console.log(`[${new Date().toISOString()}] Starting scheduled feed check...`);
  checkFeed();
});