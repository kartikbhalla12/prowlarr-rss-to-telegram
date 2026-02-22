import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import dayjs from "dayjs";

import { formatBytes } from "../util/format.js";
import { sendToTelegram } from "./telegram.js";
import { loadLastGuids, saveLastGuids } from "./state.js";
import { getFileDetails } from "./fileDetails.js";
import { info, error } from "./logger.js";

export const checkFeed = async (config) => {
  const {
    logOnly,
    telegramBotToken,
    telegramChatId,
    cacheFile,
    rssFeedUrl,
    flareResolverUrl,
    maxRetries,
  } = config;

  info("Starting feed check...");
  const lastGuids = loadLastGuids(cacheFile);

  try {
    info("Fetching RSS feed from", rssFeedUrl.toString());
    const res = await axios.get(rssFeedUrl);
    const xml = res.data;

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
    });

    const json = parser.parse(xml);
    const items = json.rss.channel.item;
    info("Found", items.length, "total items in feed");

    if (lastGuids === null && items.length > 0) {
      const latestGuid = items[0].guid;
      info("First run detected. Saving latest GUID as guid1:", latestGuid);
      saveLastGuids(cacheFile, { guid1: latestGuid });
      return;
    }

    let guid;
    let lastGuidIndex;

    const lastGuid1Index = items.findIndex(
      (item) => item.guid === lastGuids.guid1
    );

    const lastGuid2Index = items.findIndex(
      (item) => item.guid === lastGuids.guid2
    );

    if (lastGuid1Index !== -1) {
      guid = lastGuids.guid1;
      lastGuidIndex = lastGuid1Index;
    } else if (lastGuid2Index !== -1) {
      guid = lastGuids.guid2;
      lastGuidIndex = lastGuid2Index;
    } else {
      error("No previous GUIDs found");
      lastGuidIndex = 0;
      guid = items[lastGuidIndex].guid;
    }

    const relevantItems =
      lastGuidIndex === -1 ? items : items.slice(0, lastGuidIndex);

    if (relevantItems.length === 0) {
      info("No new items found since last check");
      return;
    }

    info("Processing", relevantItems.length, "new items");

    for (let i = relevantItems.length - 1; i >= 0; i--) {
      const item = relevantItems[i];
      const title = item.title;
      const url = item.guid;
      const size = formatBytes(parseInt(item.size));
      const pubDate = item.pubDate;

      const formattedDate = dayjs(pubDate).format("MMMM D, YYYY h:mm A");
      const { magnetLink, releaseType } = await getFileDetails(url, {
        flareResolverUrl,
        maxRetries,
      });
      info("Processing item:", title);

      const message =
        `<b>${title}</b>\n\n` +
        `📦 <b>Size:</b> ${size}\n\n` +
        `📅 <b>Published:</b> ${formattedDate}\n\n` +
        `📁 <b>Type:</b> ${releaseType}\n\n` +
        `🔗 <a href="${url}">Torrent Page</a>\n\n` +
        `<code>${magnetLink}</code>`;

      await sendToTelegram(message, {
        logOnly,
        telegramBotToken,
        telegramChatId,
      });
    }

    const newGuid1 = relevantItems[0].guid;
    const newGuid2 = guid;
    info("Saving new GUIDs - guid1:", newGuid1, ", guid2:", newGuid2);
    saveLastGuids(cacheFile, { guid1: newGuid1, guid2: newGuid2 });

    info("Feed check completed successfully");
  } catch (err) {
    error("Error during feed check:", err);
  }
};
