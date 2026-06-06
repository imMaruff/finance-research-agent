FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy application source
COPY . .

# Expose API port
EXPOSE 3000

# We use concurrently to run both the server and worker in the same container for simplicity
# Alternatively, these can be split into separate services in docker-compose.
CMD ["npx", "tsx", "src/server.ts"]
