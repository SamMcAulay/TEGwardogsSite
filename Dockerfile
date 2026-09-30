# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
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
    SERVERS_CONFIG=/app/config/servers.json
RUN useradd --system --uid 1001 teg && mkdir -p /app/data /app/config && chown teg /app/data
COPY --from=build --chown=teg /app/.next/standalone ./
COPY --from=build --chown=teg /app/.next/static ./.next/static
COPY --from=build --chown=teg /app/public ./public
USER teg
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server.js"]
