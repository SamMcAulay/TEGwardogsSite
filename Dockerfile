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
# The deploy gate, bundled to one file so it runs with plain node in the slim runtime image.
RUN node_modules/.bin/esbuild scripts/doctor.ts --bundle --platform=node --target=node22 --format=esm \
      --log-level=warning --outfile=doctor.mjs

FROM node:22-bookworm-slim AS run
# Links the image in GitHub's registry to the repo (and so to its access rules).
LABEL org.opencontainers.image.source=https://github.com/SamMcAulay/TEGwardogsSite
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 teg
COPY --from=build --chown=teg /app/.next/standalone ./
COPY --from=build --chown=teg /app/.next/static ./.next/static
COPY --from=build --chown=teg /app/public ./public
COPY --from=build --chown=teg /app/doctor.mjs ./doctor.mjs
USER teg
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=12s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
