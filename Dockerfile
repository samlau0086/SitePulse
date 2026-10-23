FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install --global pnpm@10.32.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/api-contracts/package.json packages/api-contracts/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS source
COPY . .

FROM source AS api
ENV NODE_ENV=production
USER node
EXPOSE 4000
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]

FROM source AS worker
ENV NODE_ENV=production
USER node
CMD ["node", "--import", "tsx", "apps/worker/src/server.ts"]

FROM source AS web-builder
ENV API_INTERNAL_ORIGIN=http://sitepulse-api:4000
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @sitepulse/web build

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=web-builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
