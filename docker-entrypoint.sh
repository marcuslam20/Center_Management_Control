#!/bin/sh
# Entrypoint: chạy Xvfb nền NẾU cần Chromium headful (ERCOT_BROWSER_HEADLESS=false) rồi exec node.
# Dùng exec để node thành PID 1 → log chảy ra stdout bình thường + docker stop forward SIGTERM đúng.
set -e

if [ "$ERCOT_BROWSER_HEADLESS" = "false" ]; then
  if command -v Xvfb >/dev/null 2>&1; then
    echo "[entrypoint] ERCOT_BROWSER_HEADLESS=false → khởi động Xvfb (DISPLAY=:99) cho Chromium headful."
    Xvfb :99 -screen 0 1366x768x24 -nolisten tcp >/dev/null 2>&1 &
    export DISPLAY=:99
    # Chờ Xvfb sẵn sàng (socket xuất hiện) tối đa ~4s.
    i=0
    while [ ! -e /tmp/.X11-unix/X99 ] && [ "$i" -lt 20 ]; do
      i=$((i + 1))
      sleep 0.2
    done
  else
    # Image gọn (build WITH_BROWSER=false) không có Xvfb → không crash, chỉ cảnh báo.
    echo "[entrypoint] CẢNH BÁO: ERCOT_BROWSER_HEADLESS=false nhưng image không có Xvfb." \
         "Hãy build với --build-arg WITH_BROWSER=true để dùng ercot-browser headful. Bỏ qua Xvfb."
  fi
fi

exec node dist/server/index.js
