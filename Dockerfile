# Base lightweight Node.js image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Create config directory that can be mounted
RUN mkdir -p /app/config

# Copy package files and install only production deps
COPY package*.json ./
RUN npm install --only=production

# Copy app files (excluding .env files)
COPY index.js ./
COPY build.sh ./

# Set volume for persistent data
VOLUME ["/app/config"]

# Run the script
CMD ["node", "index.js"]