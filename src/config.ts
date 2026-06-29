/**
 * config.ts — Tải cấu hình từ .env (nếu có) + process.env. Không thêm dependency:
 * tự parse .env đơn giản. Mọi giá trị runtime đọc qua object `cfg`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const CONFIG_DIR = path.join(ROOT, 'config');

// ─── Nạp .env thủ công (chỉ set biến chưa tồn tại trong process.env) ───────
function loadDotEnv(): void {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

// Thư mục dữ liệu runtime (state.json, audit.log) — TÁCH khỏi config/ (seed) để Docker mount
// volume vào DATA_DIR mà không che mất file seed trong image. Override qua env DATA_DIR.
export const DATA_DIR = process.env['DATA_DIR'] ? path.resolve(process.env['DATA_DIR']) : path.join(ROOT, 'data');
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  /* sẽ thử lại khi ghi file */
}

const str = (k: string, def = ''): string => process.env[k] ?? def;
const num = (k: string, def: number): number => {
  const v = process.env[k];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : def;
};

export type ControlMode = 'dry-run' | 'live';

export const cfg = {
  // Tuya
  tuyaClientId: str('TUYA_CLIENT_ID'),
  tuyaClientSecret: str('TUYA_CLIENT_SECRET'),
  tuyaBase: str('TUYA_BASE', 'https://openapi.tuyaus.com'),

  // Chế độ điều khiển — dry-run là mặc định AN TOÀN.
  controlMode: (str('CONTROL_MODE', 'dry-run') === 'live' ? 'live' : 'dry-run') as ControlMode,

  // Server
  port: num('PORT', 8080),

  // Giá
  priceSource: str('PRICE_SOURCE', 'mock'), // mock | ercot
  pricePollSeconds: num('PRICE_POLL_SECONDS', 120),

  // Thời gian thực thi
  primeWaitMs: num('PRIME_WAIT_MS', 6000),
  confirmTimeoutMs: num('CONFIRM_TIMEOUT_MS', 30000),
  resendMs: num('RESEND_MS', 5000),
  pollMs: num('POLL_MS', 2500),
  keepwarmSeconds: num('KEEPWARM_SECONDS', 0),

  // Cho phép override device id qua env (dùng trong switches.json: "env:DEVICE_A")
  env: process.env as Record<string, string | undefined>,
};

export const isLive = (): boolean => cfg.controlMode === 'live';
