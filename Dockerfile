# syntax=docker/dockerfile:1.7

# ── deps stage: install production node_modules ──────
FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── runtime stage: minimal image with non-root user ──
FROM node:18-alpine AS runtime
WORKDIR /app

# Drop privileges. node:alpine ships a `node` user already, but we create
# a dedicated `app` user with a known uid so logs and file ownership are
# easy to reason about.
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package*.json ./
COPY --chown=app:app server.js ./
COPY --chown=app:app public ./public

USER app

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
