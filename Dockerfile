FROM node:22-slim

WORKDIR /app

# Install deps (better-sqlite3 needs build tools to compile its native binding)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev=false

COPY . .

# Build the frontend into dist/, served statically by server/server.js
RUN npm run build

# Persisted SQLite database lives here — mount a volume to this path in production
RUN mkdir -p server/data
VOLUME ["/app/server/data"]

ENV PORT=3001
EXPOSE 3001

CMD ["node", "server/server.js"]
