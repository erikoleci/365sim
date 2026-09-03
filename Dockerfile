FROM node:22-slim

WORKDIR /app

# Repo is managed with pnpm (pnpm-lock.yaml); enable it via corepack bundled with Node 22.
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Build the frontend into dist/, served statically by server/server.js
RUN pnpm run build

ENV PORT=3001
EXPOSE 3001

# Data now lives in PostgreSQL (DATABASE_URL env var, e.g. a free Neon.tech
# database) instead of a local SQLite file — no volume/mount needed here.
CMD ["node", "server/server.js"]