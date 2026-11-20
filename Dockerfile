# ServerForge on Coolify (claude, 20 Nov 2026, Daniel #ideas 6287: "move it fully").
# Debian (not Alpine): SteamCMD and most game servers need glibc and 32-bit libraries.
# All state lives in /data (persistent volume): data/, servers/, backups/, cache/, steamcmd/ (+ SteamCMD's $HOME).
# Node link (remote nodes, wss) is OFF unless NODE_PORT is set; game ports are published per server by Coolify.

# 1. Build the web panel
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2. Run the backend with the built panel next to it (server.js looks in ./frontend/dist)
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl tar lib32gcc-s1 lib32stdc++6 libatomic1 libpulse0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend/ ./
COPY --from=frontend /app/frontend/dist ./frontend/dist
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3230 HOME=/data \
    DATA_DIR=/data/data SERVERS_ROOT=/data/servers BACKUPS_DIR=/data/backups CACHE_DIR=/data/cache STEAMCMD_DIR=/data/steamcmd
RUN mkdir -p /data/data /data/servers /data/backups /data/cache /data/steamcmd && chown -R node:node /data
USER node
EXPOSE 3230
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "require('http').get('http://127.0.0.1:3230/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
