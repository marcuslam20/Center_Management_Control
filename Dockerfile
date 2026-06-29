# syntax=docker/dockerfile:1
# Multi-stage: build dashboard (Vite) + backend (tsc), runtime image gọn chỉ chứa Node + prod deps.

# ─── Stage 1: build dashboard (Vite → web/dist) ────────────────────────────
FROM node:20-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ─── Stage 2: build backend (tsc → dist) ───────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Stage 3: runtime ──────────────────────────────────────────────────────
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Chỉ prod deps (fastify, cors, static, node-html-parser) — không có tsx/typescript/vite.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Backend đã compile + dashboard đã build + config seed.
COPY --from=build /app/dist ./dist
COPY --from=web   /app/web/dist ./web/dist
COPY config/ ./config/
# Dữ liệu runtime (state.json, audit.log) ghi vào /app/data — mount volume vào đây.
ENV DATA_DIR=/app/data
EXPOSE 8080
CMD ["node", "dist/server/index.js"]
