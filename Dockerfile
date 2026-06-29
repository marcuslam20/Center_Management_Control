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
# Không cho gói playwright tự tải Chromium lúc npm ci — chỉ tải khi WITH_BROWSER=true bên dưới.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
# Chỉ prod deps (fastify, cors, static, node-html-parser, playwright) — không có tsx/typescript/vite.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# ─── Tùy chọn: Chromium + Xvfb cho nguồn giá fallback `ercot-browser` ───────
# MẶC ĐỊNH WITH_BROWSER=false → KHÔNG cài Chromium → image GỌN (~300MB), dùng PRICE_SOURCE=ercot.
# Khi fetch thuần bị Incapsula chặn, bật fallback bằng cách build lại với:
#   docker compose build --build-arg WITH_BROWSER=true   (rồi đặt PRICE_SOURCE=ercot-browser)
ARG WITH_BROWSER=false
RUN if [ "$WITH_BROWSER" = "true" ]; then \
      echo "WITH_BROWSER=true → cài Chromium + Xvfb cho ercot-browser" \
      && npx playwright install --with-deps chromium \
      && apt-get update && apt-get install -y --no-install-recommends xvfb xauth \
      && rm -rf /var/lib/apt/lists/*; \
    else \
      echo "WITH_BROWSER=false → bỏ qua Chromium (image gọn, chỉ dùng PRICE_SOURCE=ercot/mock)"; \
    fi
# Backend đã compile + dashboard đã build + config seed.
COPY --from=build /app/dist ./dist
COPY --from=web   /app/web/dist ./web/dist
COPY config/ ./config/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
# Dữ liệu runtime (state.json, audit.log) ghi vào /app/data — mount volume vào đây.
ENV DATA_DIR=/app/data
# Chỉ áp dụng khi build WITH_BROWSER=true + PRICE_SOURCE=ercot-browser.
# true=headless (nhẹ); false=headful dưới Xvfb (khó bị Incapsula phát hiện) — đổi rồi restart, không build lại.
ENV ERCOT_BROWSER_HEADLESS=true
EXPOSE 8080
# Entrypoint tự bật Xvfb khi ERCOT_BROWSER_HEADLESS=false (headful), còn lại exec node thẳng (PID 1).
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
