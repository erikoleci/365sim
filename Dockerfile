FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Build the frontend into dist/, served statically by server/server.js
RUN npm run build

ENV PORT=3001
EXPOSE 3001

# Data now lives in PostgreSQL (DATABASE_URL env var, e.g. a free Neon.tech
# database) instead of a local SQLite file — no volume/mount needed here.
CMD ["node", "server/server.js"]
