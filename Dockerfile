# syntax=docker/dockerfile:1.7
#
# Messagerie — one image: the server (8810) and the inbox (3210); with the `worker`
# command, the worker alone. PostgreSQL stays outside it (DATABASE_URL), and HTTPS is the
# job of the gateway in front: see « Mise en production » on the site.
#
#   docker build -t messagerie .
#   docker run -d -p 3210:3210 -p 8810:8810 -v messagerie-files:/data/files \
#     -e DATABASE_URL=postgres://… -e CHAT_SECRET=… \
#     -e CHAT_WEB_ORIGIN=https://support.exemple.fr -e CHAT_API_URL=https://chat.exemple.fr \
#     messagerie
#
# Published as eodia/messagerie on Docker Hub (.github/workflows/docker-publish.yml).

ARG NODE_VERSION=22

# ── Base: Node and the pnpm the lockfile was written with ──────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /repo

# ── Build: the whole workspace, compiled once ──────────────────────────────────────────
FROM base AS build
# The lockfile alone fetches every package: this layer stays cached until it changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline
# The AI package first (the server reads its compiled types), the widget the server
# serves, then the server.
RUN pnpm --filter @chat/ai build \
 && pnpm --filter @chat/widget build \
 && pnpm --filter @chat/server build
# The inbox, as a self-contained server (apps/web/next.config.ts).
RUN CHAT_WEB_STANDALONE=1 pnpm --filter @chat/web build

# ── Server: production dependencies only ───────────────────────────────────────────────
FROM base AS server
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --prefer-offline --filter "@chat/server..."
COPY --from=build /repo/packages/ai/dist packages/ai/dist
COPY --from=build /repo/apps/widget/dist apps/widget/dist
COPY --from=build /repo/apps/server/dist apps/server/dist

# ── The image ──────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS messagerie
ENV NODE_ENV=production
# The files of the conversations (D14): one volume.
RUN mkdir -p /data/files && chown -R node:node /data
COPY --from=server /repo /app/server
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone /app/web
COPY --from=build --chown=node:node /repo/apps/web/.next/static /app/web/apps/web/.next/static
COPY docker/start.mjs docker/health.mjs /app/
WORKDIR /app
ENV CHAT_PORT=8810 \
    CHAT_FILES_DIR=/data/files
USER node
EXPOSE 3210 8810
VOLUME ["/data/files"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD ["node", "/app/health.mjs"]
# `docker run … eodia/messagerie worker`: the worker alone.
ENTRYPOINT ["node", "/app/start.mjs"]
