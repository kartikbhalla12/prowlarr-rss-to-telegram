import fs from "fs";

import { info } from "./logger.js";

export const loadLastGuids = (cacheFile) => {
  try {
    const content = fs.readFileSync(cacheFile, "utf-8").trim();
    try {
      const data = JSON.parse(content);
      info(
        "Loaded GUIDs - guid1:",
        data.guid1,
        ", guid2:",
        data.guid2 || "none",
      );
      return { guid1: data.guid1, guid2: data.guid2 || null };
    } catch (jsonError) {
      info("Old format detected, migrating to new format");
      return { guid1: content, guid2: null };
    }
  } catch (error) {
    info("No previous GUIDs found, starting fresh");
    return null;
  }
};

export const saveLastGuids = (cacheFile, { guid1, guid2 = null }) => {
  const data = { guid1, guid2 };
  fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), "utf-8");
  info("Saved GUIDs - guid1:", guid1, ", guid2:", guid2 || "none");
};
