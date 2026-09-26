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

# Run as a non-root user inside the container. Node's own `node` image
# already ships a `node` user/group (uid/gid 1000) for exactly this —
# defense-in-depth if the process is ever compromised, it can't write
# outside its own files or touch other host-level things a root process
# could.
RUN chown -R node:node /app
USER node

# Lets `docker ps` / orchestrators (Render, Kubernetes, docker-compose) see
# real app health instead of just "the process is still running" — hits the
# same /api/health the app already exposes, which reflects actual DB
# connectivity (dbReady), not just an open port.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3001) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/server.js"]