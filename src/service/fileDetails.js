import axios from "axios";
import * as cheerio from "cheerio";

import { error } from "./logger.js";

export const getFileDetails = async (url, { flareResolverUrl, maxRetries }) => {
  const fallback = {
    magnetLink: "Error fetching magnet link",
    releaseType: "Unknown",
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
      } = await axios.post(flareResolverUrl, requestConfig);

      const $ = cheerio.load(response);

      const magnetLink = $('a[href^="magnet:"]').attr("href");
      const releaseType = $('li:contains("Type") span').text().trim();

      return {
        magnetLink: magnetLink || "Magnet link not found",
        releaseType: releaseType || "Unknown",
      };
    } catch (err) {
      error(
        "getFileDetails attempt",
        attempt + "/" + maxRetries,
        "failed:",
        err.message
      );
      if (attempt === maxRetries) {
        return fallback;
      }
    }
  }

  return fallback;
};
