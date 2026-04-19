# syntax=docker/dockerfile:1
#
# Web app bundle + Caddy reverse proxy in one image.
# Builds the Vite static bundle with the passed build-args baked in,
# then serves it via Caddy. The Caddyfile also reverse-proxies /config,
# /submit, /token-status, /admin, and /health to the api service.
#
# Build context: repo root.
#
#   docker build -f apps/web/Dockerfile -t ethsec-web .

FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Manifests first
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json         apps/web/package.json
COPY apps/api/package.json         apps/api/package.json
COPY packages/shared/package.json  packages/shared/package.json
COPY scripts/package.json          scripts/package.json

RUN pnpm install --frozen-lockfile

# Sources
COPY packages/shared  packages/shared
COPY apps/web         apps/web
COPY tsconfig.base.json ./

# ----- Build-time env vars (Vite bakes these into the bundle) -----
ARG VITE_API_BASE_URL=
ARG VITE_BADGE_CONTRACT
ARG VITE_CHAIN_ID
ARG VITE_RPC_URL
ARG VITE_WALLETCONNECT_PROJECT_ID=
ARG VITE_ENCRYPTION_PUBLIC_KEY_HEX=

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_BADGE_CONTRACT=$VITE_BADGE_CONTRACT \
    VITE_CHAIN_ID=$VITE_CHAIN_ID \
    VITE_RPC_URL=$VITE_RPC_URL \
    VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID \
    VITE_ENCRYPTION_PUBLIC_KEY_HEX=$VITE_ENCRYPTION_PUBLIC_KEY_HEX

RUN pnpm --filter @ethsec/web build


FROM caddy:2-alpine AS runtime
COPY --from=builder /app/apps/web/dist /srv/web
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=3s --retries=3 --start-period=10s \
  CMD wget -qO- http://127.0.0.1/health >/dev/null 2>&1 || exit 1
