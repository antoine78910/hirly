# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.14 AS build
WORKDIR /app
ARG CONTRACTSPEC_NPM_TOKEN
COPY package.json bun.lock bunfig.toml tsconfig.base.json .npmrc ./
COPY apps/worker/package.json apps/worker/package.json
COPY apps/job-ingestion-audit/package.json apps/job-ingestion-audit/package.json
COPY apps/analytics-backfill/package.json apps/analytics-backfill/package.json
COPY apps/feed-v2/package.json apps/feed-v2/package.json
COPY apps/feed-v2-readiness-gate/package.json apps/feed-v2-readiness-gate/package.json
COPY apps/g009-retirement-gate/package.json apps/g009-retirement-gate/package.json
COPY apps/job-projection-backfill/package.json apps/job-projection-backfill/package.json
COPY apps/matching-shadow-canary/package.json apps/matching-shadow-canary/package.json
COPY apps/matching-supply-readiness/package.json apps/matching-supply-readiness/package.json
COPY packages/application-agent-contracts/package.json packages/application-agent-contracts/package.json
COPY packages/application-agent-runtime/package.json packages/application-agent-runtime/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/feed-v2/package.json packages/feed-v2/package.json
COPY packages/ingestion/package.json packages/ingestion/package.json
COPY packages/matching/package.json packages/matching/package.json
COPY packages/matching-oracle/package.json packages/matching-oracle/package.json
COPY packages/observability/package.json packages/observability/package.json
RUN test -n "$CONTRACTSPEC_NPM_TOKEN" && bun install --frozen-lockfile
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
