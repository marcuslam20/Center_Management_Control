# Osprey Fingerbot Control Panel

Tool nội bộ: tắt/bật E300 miner qua **fingerbot Tuya**, điều khiển theo **giá điện ERCOT real-time** + curtailment.
Phase 1: **6 switch** (mỗi switch = 1 cặp fingerbot). Thiết kế đầy đủ: [`DESIGN.md`](./DESIGN.md).

> **DRY-RUN là mặc định** — không bắn lệnh Tuya thật. Phải đặt `CONTROL_MODE=live` mới điều khiển fingerbot thật.

## Chạy

```bash
# Backend
cp .env.example .env          # điền TUYA_CLIENT_SECRET nếu muốn LIVE
npm install
npm run dev                   # API http://localhost:8080 (dry-run)

# Dashboard (terminal khác)
cd web && npm install && npm run dev   # http://localhost:5173 (proxy /api → 8080)
```

Build dashboard để backend tự phục vụ ở `/`:
```bash
npm run web:build && npm start   # mở http://localhost:8080
```

## Chế độ
- `CONTROL_MODE=dry-run` (mặc định): chỉ log command list, không gọi Tuya.
- `CONTROL_MODE=live`: wake-prime → verify/retry trên fingerbot thật (pattern từ `scripts/toggle-both.mjs`).
- `PRICE_SOURCE=mock` (mặc định) | `ercot` (fetch HTML thật — **có thể bị Incapsula chặn 403**, poller tự fallback giữ giá cuối).

## Cấu hình
- `config/switches.json` — 6 switch: chọn `preset` (A cộng lực / B1 đối nhau / B2 riêng lẻ) + gán `device_id` cho vai trò. `device_id` dạng `env:NAME` lấy từ biến môi trường. Backend tự sinh command list `on`/`off`.
- `config/settings.json` — ngưỡng giá, confirmMinutes, settlement point, delay, autoControl (sửa được qua dashboard).

## API chính
`GET /api/state` · `GET /api/stream` (SSE) · `POST /api/switch/:id {target}` · `POST /api/all {target}` · `POST /api/emergency` · `GET/PUT /api/settings` · `GET /api/switches` · `GET /api/devices` · `POST /api/mock/price {price}`.

## Còn chờ Jay/sếp (đã chừa interface/stub + config)
Center management API thật (`src/center/client.ts` đang mock), settlement point chính xác, ngưỡng giá, SLA curtailment, fail-safe khi mất mạng, gateway, đo công suất thật để xác nhận đã tắt.
