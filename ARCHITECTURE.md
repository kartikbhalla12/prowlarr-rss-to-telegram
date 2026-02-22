# Prowlarr RSS → Telegram — Architecture & Runtime Lifecycle

Reverse-engineered system overview. All behaviour is traced to **`index.js`** (single-file app).

---

## 1. 🧠 System Overview

| Aspect | Answer |
|--------|--------|
| **Runtime type** | **Long-running worker** with an internal cron. Process starts once and runs until killed; it does not exit after each run. |
| **Start** | `node index.js` (or `npm start` → nodemon). `dotenv.config()` loads env; `cron.schedule(...)` registers the job; process stays alive. |
| **Stop** | Process exit only (SIGTERM/SIGINT, container stop, or crash). No graceful shutdown hook. |
| **Statefulness** | **Stateful**. Persists last-seen GUIDs in a file (`last-guid.txt`) so runs are not idempotent and depend on prior state. |

**Project identity:** Single-file Node.js (ESM) worker that polls a Prowlarr RSS feed on a schedule, enriches items via a Cloudflare bypass (Flare Resolver), and posts new items to Telegram. No database; file-based cursor for deduplication.

---

## 2. ▶️ Full Runtime Lifecycle

```
Process start
    → dotenv.config()                    [index.js:9]
    → Env vars read (TELEGRAM_*, PROWLARR_*, etc.) [11-16]
    → CONFIG_DIR / CACHE_FILE set        [18-19]
    → rssFeedUrl built (PROWLARR_URL + INDEXER_ID + apikey, extended, t=search, q=qxr) [21-24]
    → cron.schedule("*/15 * * * *", checkFeed)  [233-236]
    → Process remains running; no further top-level async work

Every 15 minutes (cron tick):
    → checkFeed() invoked
        → loadLastGuids() from file
        → axios.get(rssFeedUrl) → raw XML
        → Parse XML → items
        → Dedupe: slice items from start to last known GUID
        → For each new item (oldest first): getFileDetails(url) → format message → sendToTelegram(message)
        → saveLastGuids() with new cursor
    → Returns to sleep until next cron tick

Exit: only on process kill / crash / container stop.
```

**Files:** Entire flow is in **`index.js`**. No separate entry script; `main` in package.json is `index.js`.

---

## 3. 🕷 Scraping Architecture

### 3.1 Prowlarr RSS (primary scrape)

| Concern | Implementation | File:Line |
|--------|----------------|-----------|
| **HTTP client** | `axios.get(rssFeedUrl)` | 131 |
| **URL construction** | Base: `PROWLARR_URL + "/" + INDEXER_ID + "/api"`. Query: `apikey`, `extended=1`, `t=search`, `q=qxr` | 21-24 |
| **Authentication** | API key in query string (`apikey=PROWLARR_API_KEY`) | 22 |
| **Pagination** | None. Single GET; Prowlarr returns one feed page. | — |
| **Rate limiting** | None. Only constraint is cron (every 15 min). | 233 |
| **Retries** | None. One attempt per run; on failure only logging in catch. | 224-229 |
| **Error handling** | `try/catch` around full `checkFeed`; `console.error`; no retry, no backoff. | 224-229 |

**RSS URL example:**  
`https://prowlarr.example.com/42/api?apikey=xxx&extended=1&t=search&q=qxr`

Search query is hardcoded as `qxr` (line 24).

### 3.2 Flare Resolver (secondary scrape — per item)

Used to get **magnet link** and **release type** from the torrent’s detail page (often behind Cloudflare).

| Concern | Implementation | File:Line |
|--------|----------------|-----------|
| **HTTP** | `axios.post(FLARE_RESOLVER_URL, { cmd: "request.get", url, maxTimeout: 60000 })` | 94-104 |
| **Input** | `url` = item’s `guid` (torrent page URL) | 195, 201 |
| **Parsing** | `cheerio.load(response)`; magnet from `a[href^="magnet:"]`; release type from `li:contains("Type") span` | 105-113 |
| **Errors** | On failure: returns `{ magnetLink: "Error fetching magnet link", releaseType: "Unknown" }`; no retry. | 114-120 |

**Files:** Prowlarr fetch and parsing in **`index.js`** (`checkFeed`, `getFileDetails`). No separate scraper module.

---

## 4. 🔄 Processing Pipeline

Full pipeline (all in **`index.js`**):

| Stage | What happens | Code location |
|-------|----------------|----------------|
| **Raw response** | `axios.get(rssFeedUrl)` → XML string in `res.data` | 131-132 |
| **Parsing** | `XMLParser` (fast-xml-parser) → `json.rss.channel.item` array | 134-139 |
| **Normalization** | None. Items used as-is (e.g. `item.title`, `item.guid`, `item.size`, `item.pubDate`). | 139 |
| **Filtering** | Only “new” items: `items.slice(0, lastGuidIndex)` (items above cursor). No category/filter rules. | 176-177 |
| **Deduplication** | Cursor-based: only items “newer” than last saved GUID(s); first-run saves latest GUID and exits without notifying. | 145-153, 156-177 |
| **Formatting for Telegram** | Per item: title (bold), size (GB), published (dayjs), type (from Flare), torrent page link, magnet in `<code>`. HTML. | 200-210 |

**Order of processing:** Loop runs from **oldest to newest** (`i = relevantItems.length - 1` down to `0`) so notifications are chronological (line 193).

**Enrichment:** For each item, `getFileDetails(item.guid)` is called before formatting (line 201). So: **RSS → slice to “new” items → for each item: Flare scrape → format → send**.

No separate “processor” or “filter” modules; pipeline is inline in `checkFeed`.

---

## 5. 💾 State & Deduplication Strategy

### 5.1 No DB; file-based cursor

- **Storage:** Single file: `last-guid.txt` (path from `CACHE_FILE`: `/app/config/last-guid.txt` in Docker, else `./last-guid.txt`).  
- **Format:** JSON: `{ "guid1": "<latest known>", "guid2": "<previous>" }`. Old format was plain text (one GUID); migration on read (lines 68-72).  
- **Read:** `loadLastGuids()` — sync `fs.readFileSync` + JSON.parse.  
- **Write:** `saveLastGuids({ guid1, guid2 })` — sync `fs.writeFileSync` after each successful run.  
- **Location:** **`index.js`**: `loadLastGuids` (57-79), `saveLastGuids` (81-89), `CACHE_FILE` (18-19).

### 5.2 Idempotency / duplicate avoidance

- **Mechanism:** Cursor, not hashing. Two GUIDs are stored: `guid1` = newest item we’ve seen, `guid2` = previous run’s “newest”.  
- **Logic:** Find `lastGuid1Index` / `lastGuid2Index` in current feed. Use the one that exists; “new” items = `items.slice(0, lastGuidIndex)`. After sending, update to `guid1 = relevantItems[0].guid`, `guid2 = previous guid`.  
- **First run:** If no cache file or parse fails, `lastGuids === null`. Then if there are items, it only saves `guid1 = items[0].guid` and **returns without sending** (145-152). So first run never notifies.  
- **Persistence:** File survives restarts. Same file used in Docker when `/app/config` is mounted (README, Dockerfile VOLUME).

### 5.3 Summary

- **In-memory state:** Only the current run’s `relevantItems` and loop index; no long-lived in-memory set of seen IDs.  
- **File-based:** One JSON file, two GUIDs.  
- **External store:** None.  
- **Persistence across runs:** Yes, via the same file path; no TTL or expiry.

---

## 6. ⏱ Scheduling Model

| Aspect | Implementation | File:Line |
|--------|----------------|-----------|
| **Mechanism** | `node-cron`: `cron.schedule("*/15 * * * *", () => checkFeed())` | 233-236 |
| **Schedule** | Every 15 minutes (at :00, :15, :30, :45). | 233 |
| **Concurrency** | No lock. If a run overruns 15 minutes, the next cron tick can start another `checkFeed()` while the first is still in progress (overlapping runs possible). | — |
| **Overlap protection** | None. No mutex, no “running” flag. | — |
| **External trigger** | None. No HTTP server or CLI subcommand. | — |
| **Manual single run** | Not built-in. Options: run a one-off script that calls `checkFeed()`, or temporarily change cron to `* * * * *` and wait 1 minute. | — |

**Files:** **`index.js`** 233-236. No separate scheduler module.

---

## 7. ✉️ Telegram Integration

| Concern | Implementation | File:Line |
|--------|----------------|-----------|
| **Initialization** | No SDK; no “bot” object. Uses Telegram Bot API over HTTP. | — |
| **Send** | `sendToTelegram(message)`: `fetch(url, { method: "POST", body: JSON.stringify({ chat_id, text, parse_mode: "HTML" }) })` with `url = https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`. | 31-55 |
| **Message construction** | In `checkFeed`: string concatenation: bold title, size, published date, type, link to torrent page, magnet in `<code>`. All HTML. | 204-210 |
| **Rate limits** | No throttling. Sequential `await sendToTelegram(message)` per item; if many items, many requests in a short time (Telegram has per-bot limits). | 212 |
| **Format** | `parse_mode: "HTML"`. Escaping: none; if title or other fields contain `<`, `>`, `&`, they can break rendering or cause bad output. | 37, 204-210 |
| **Errors** | `res.json()` then `if (!data.ok)` → `console.error(data.description)`. No retry, no backoff, no throwing; failed sends are silent from the caller’s perspective. | 46-53 |

**Config:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` from env (11-12).  
**Files:** **`index.js`** 31-55 (send), 204-210 (format).

---

## 8. 🔗 Dependency Graph

### 8.1 Internal modules

There are no internal modules. Single file **`index.js`** contains all logic; no `import` from local files.

### 8.2 External libraries (used)

| Package | Purpose in this app | Where used |
|---------|---------------------|------------|
| **axios** | HTTP: Prowlarr RSS GET, Flare Resolver POST | 131, 104 |
| **cheerio** | Parse HTML from Flare response; select magnet link and release type | 105-108 |
| **dayjs** | Format pub date for display | 200 |
| **dotenv** | Load `.env` into `process.env` | 9 |
| **fast-xml-parser** | Parse RSS XML to JSON | 134-139 |
| **node-cron** | Schedule `checkFeed` every 15 minutes | 233-236 |

### 8.3 Declared but unused (package.json)

- **rss-parser** — not imported; RSS is parsed with fast-xml-parser.  
- **node-fetch** — not imported; Telegram uses global `fetch`, Prowlarr/Flare use axios.

### 8.4 Node built-ins

- **fs** — read/write `last-guid.txt`.  
- **fetch** — global (Node 18+); used for Telegram only.

---

## 9. ⚠️ Failure Handling

| Scenario | Behaviour | Retry / backoff / recovery |
|----------|-----------|----------------------------|
| **Prowlarr down / network error** | `axios.get(rssFeedUrl)` throws → caught in `checkFeed` catch → `console.error` → no state change, no retry. | None. |
| **Telegram API error** | `sendToTelegram` logs `data.description`; doesn’t throw. Caller continues to next item. | None. |
| **Telegram rate limit (429)** | Same as above; no retry, no backoff. | None. |
| **Network timeout** | Axios default timeout (none set); Flare has `maxTimeout: 60000`. On timeout, exception → catch → log. | None. |
| **Invalid/malformed RSS** | If `json.rss.channel.item` is missing or not an array, later code can throw (e.g. `items.length`, `items[0]`). Caught by same catch; no partial recovery. | None. |
| **Flare fails for an item** | `getFileDetails` returns `{ magnetLink: "Error fetching magnet link", releaseType: "Unknown" }`. Message still sent to Telegram with that text. | None. |
| **Cache file missing** | `loadLastGuids()` returns `null` → first-run behaviour (save latest GUID, no notifications). | N/A. |
| **Cache file corrupted** | JSON parse fails → old-format migration (single GUID) or throw; if throw, `loadLastGuids` could throw (not wrapped in try for JSON parse only). Actually the whole read is in try; JSON parse failure goes to catch and “Old format” migration. So corrupted JSON is treated as old format and may produce bad state. | Partial: fallback to old format. |

**Summary:** No retries, no backoff, no circuit breaker. Partial success possible (e.g. some Telegram sends fail, others succeed); GUIDs are only saved after the full loop, so a crash mid-loop can cause the same items to be reprocessed next run.

---

## 10. 🚀 Performance & Scaling

| Topic | Detail |
|-------|--------|
| **Parallel vs sequential** | Fully sequential: one RSS fetch per run; then for each new item, sequential `getFileDetails` → `sendToTelegram`. No parallelization. |
| **Memory** | RSS response and parsed items kept in memory for one run; then discarded. File cache is two GUIDs. Risk: very large feed could use a lot of memory; no streaming or pagination. |
| **Duplicate processing** | If process crashes after sending some messages but before `saveLastGuids`, next run will see same “new” items again and resend. No per-item idempotency key. |
| **Safe frequency** | Cron limits to every 15 minutes. No other rate limiting; Flare and Telegram are called once per new item per run. |

**Files:** All behaviour in **`index.js`** (loop 193-212, single-threaded).

---

## 11. 🧭 Diagrams

### 11.1 Runtime lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│  Process Start (node index.js)                                  │
│  → dotenv.config() → cron.schedule("*/15 * * * *", checkFeed)   │
│  → Process stays alive                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Every 15 min: checkFeed()                                       │
│  → loadLastGuids() → axios.get(RSS) → parse XML                  │
│  → slice new items → for each: getFileDetails → sendToTelegram  │
│  → saveLastGuids()                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    (repeat until process exit)
```

### 11.2 Scraper → processor → notifier pipeline

```
rssFeedUrl (Prowlarr)          item.guid (per item)
       │                              │
       ▼                              ▼
  axios.get()                  axios.post(Flare)
       │                              │
       ▼                              ▼
  XMLParser → items             cheerio → magnet, type
       │                              │
       └──────────┬───────────────────┘
                  ▼
         slice(0, lastGuidIndex)  [dedupe]
                  │
                  ▼
         for each item (oldest first):
                  │
                  ├→ format message (title, size, date, type, link, magnet)
                  │
                  ▼
         sendToTelegram(message)  [fetch POST]
                  │
                  ▼
         saveLastGuids(guid1, guid2)
```

### 11.3 Module responsibility map

```
index.js (single file)
├── Config: CONFIG_DIR, CACHE_FILE, rssFeedUrl, env (11-24)
├── formatBytes (27-29)
├── sendToTelegram (31-55)
├── loadLastGuids (57-79)
├── saveLastGuids (81-89)
├── getFileDetails (91-121)   ← Flare + cheerio
├── checkFeed (123-230)       ← RSS + parse + dedupe + loop + format + send + save
└── cron.schedule (233-236)
```

---

## 12. 🛠 Developer Modification Guide

### Add a new scraper source

- Today there is one feed: URL from `PROWLARR_URL` + `INDEXER_ID` + fixed query `q=qxr`.
- To add another source:
  - Add a new URL (env or build like `rssFeedUrl`).
  - In `checkFeed`, either call the same logic for a second feed (with a **separate cache file** per source, or a cache structure that includes a key per source) or merge feeds and then dedupe (e.g. by GUID).
  - Important: dedupe state must be per-source or keyed by source, or one feed’s cursor will affect the other.

### Add a new filter

- Filtering is currently “new since last GUID” only. To add e.g. category or size filters:
  - After `relevantItems = items.slice(0, lastGuidIndex)`, add a filter:  
    `relevantItems = relevantItems.filter(item => ...)`.
  - Or filter before the loop using `item` properties (e.g. `item.category`, `item.size`). All item fields come from Prowlarr’s RSS/API (see what the feed actually returns).

### Change Telegram message format

- Edit the string in **`index.js`** around 204-210 (the `message` variable). Keep `parse_mode: "HTML"` in mind; escape user-derived content if needed, or switch to Markdown and set `parse_mode` accordingly.

### Run a single test cycle

- **Option A:** Add a temporary script that imports and calls `checkFeed()` then exits (would require exporting `checkFeed` or running in a small wrapper that imports the same env and URL logic and invokes the same function).
- **Option B:** From project root, run once with a tight cron: temporarily change line 233 to `cron.schedule("* * * * *", ...)` (every minute), run `node index.js`, wait for one execution, then stop (Ctrl+C) and revert the cron.
- **Option C:** Use Node REPL: `node --experimental-vm-modules` and dynamic import of `index.js` is awkward because of cron; so the cleanest “single run” is a small script that loads dotenv, builds the same URL, and calls the same logic (e.g. copy `checkFeed` into a script or export it and call from a `run-once.js`).

---

**Document generated from code in `index.js` (and package.json, Dockerfile, sample.env.txt, README). No assumptions beyond what is in the repo.**
