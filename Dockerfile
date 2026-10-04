# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
# Toolchain for compiling better-sqlite3 when no prebuilt binary matches (e.g. ARM VPSes).
# Build stage only; the runtime image doesn't carry it.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/app/data/teg-wardogs.db \
    SERVERS_CONFIG=/app/config/servers.json \
    BACKUP_DIR=/app/backups
RUN useradd --system --uid 1001 teg && mkdir -p /app/data /app/config /app/backups && chown teg /app/data /app/backups
COPY --from=build --chown=teg /app/.next/standalone ./
COPY --from=build --chown=teg /app/.next/static ./.next/static
COPY --from=build --chown=teg /app/public ./public
COPY --from=build --chown=teg /app/scripts/backup.mjs ./scripts/backup.mjs
USER teg
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
