# syntax=docker/dockerfile:1
#
# Fastify API container for the ethsec-voting-badge backend.
# Build context: repo root (so pnpm workspace paths resolve).
#
#   docker build -f apps/api/Dockerfile -t ethsec-api .

FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Manifests first → cacheable install layer
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json         apps/api/package.json
COPY packages/shared/package.json  packages/shared/package.json
COPY scripts/package.json          scripts/package.json
COPY apps/web/package.json         apps/web/package.json

RUN pnpm install --frozen-lockfile

# Sources
COPY packages/shared  packages/shared
COPY apps/api         apps/api
COPY tsconfig.base.json ./

# Build (@ethsec/api → dist/)
RUN pnpm --filter @ethsec/api build


FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Workspace skeleton needed for pnpm's symlink layout at runtime
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/node_modules                 ./node_modules
COPY --from=builder /app/packages/shared              ./packages/shared
COPY --from=builder /app/apps/api/package.json        ./apps/api/package.json
COPY --from=builder /app/apps/api/dist                ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules        ./apps/api/node_modules

WORKDIR /app/apps/api
EXPOSE 3001

# Container-level healthcheck (compose also has one but this helps when
# run standalone).
HEALTHCHECK --interval=15s --timeout=3s --retries=5 --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
