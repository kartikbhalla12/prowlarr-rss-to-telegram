# Base lightweight Node.js image
FROM --platform=linux/amd64 node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files and install only production deps
COPY package*.json ./
RUN npm install --only=production

# Copy app files
COPY . .

# Run the script
CMD ["node", "index.js"]