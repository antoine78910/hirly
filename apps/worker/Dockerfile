FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY apps/job-ingestion-audit/package.json apps/job-ingestion-audit/package.json
COPY apps/analytics-backfill/package.json apps/analytics-backfill/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ingestion/package.json packages/ingestion/package.json
COPY packages/matching/package.json packages/matching/package.json
COPY packages/matching-oracle/package.json packages/matching-oracle/package.json
COPY packages/observability/package.json packages/observability/package.json
RUN bun install --frozen-lockfile
COPY apps/worker apps/worker
COPY packages packages
RUN bun run --cwd apps/worker build

FROM oven/bun:1.3.14-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
USER bun
EXPOSE 3001
CMD ["bun", "apps/worker/dist/main.js"]
