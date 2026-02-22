# Build stage: bundle app into single app.js with Bun
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json ./
RUN bun install

# COPY index.js ./
# COPY app-config ./app-config/
# COPY util ./util/
# COPY service ./service/

COPY src ./src/

RUN bun build ./src/index.js --outfile=app.js --minify

# Run stage: minimal image with only the bundle
FROM oven/bun:1-alpine
WORKDIR /app

RUN mkdir -p /app/config
VOLUME ["/app/config"]

COPY --from=builder /app/app.js ./

CMD ["bun", "run", "app.js"]
