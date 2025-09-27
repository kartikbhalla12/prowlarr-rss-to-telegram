# Prowlarr RSS to Telegram

A Node.js application that monitors a Prowlarr RSS feed and forwards new torrent entries to a Telegram chat.

## Features

- Monitors Prowlarr RSS feeds at regular intervals
- Fetches detailed information including magnet links
- Sends formatted notifications to Telegram
- Keeps track of processed items to avoid duplicates
- Works with Cloudflare-protected sites via Flare Resolver

## Configuration

Create a `.env` file based on the provided `sample.env.txt`:

```
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHAT_ID=your_telegram_chat_id_here

# Prowlarr Configuration
PROWLARR_URL=your_prowlarr_url_here
PROWLARR_API_KEY=your_prowlarr_api_key_here
INDEXER_ID=your_indexer_id_here

# Flare Resolver Configuration (for bypassing Cloudflare)
FLARE_RESOLVER_URL=your_flare_resolver_url_here

# Docker Configuration (for building/pushing the image)
DOCKER_IMAGE_NAME=prowlarr-to-telegram
DOCKER_REGISTRY=your_docker_registry_here
```

## Docker Usage

### Building the Docker Image

```bash
./build.sh
```

### Running the Container

```bash
docker run -d --name prowlarr-to-telegram \
  --env-file .env \
  -v /path/on/host/config:/app/config \
  your_registry/prowlarr-to-telegram:latest
```

The `/app/config` volume will store persistent data like the `last-guid.txt` file, which keeps track of which items have already been processed.

## Local Development

```bash
# Install dependencies
npm install

# Run with nodemon for development
npm start
```

## How It Works

1. The application checks the Prowlarr RSS feed every 15 minutes
2. For each new item found, it:
   - Fetches additional details including the magnet link
   - Formats the information (title, size, publish date, type, links)
   - Sends the formatted message to a Telegram chat
3. The last processed item's GUID is stored to avoid sending duplicates
