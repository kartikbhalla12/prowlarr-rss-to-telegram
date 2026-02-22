import cron from "node-cron";

import { config } from "./config/index.js";
import { checkFeed } from "./service/feed.js";
import { info } from "./service/logger.js";

cron.schedule(config.cronSchedule, () => {
  info("Starting scheduled feed check...");
  checkFeed(config);
});
