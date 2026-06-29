/**
 * switches/model.ts — Mô hình switch "desired-state → command list".
 * Mỗi switch sinh ra danh sách lệnh ON và OFF từ preset + gán device_id cho vai trò.
 * Đổi kiểu lắp = đổi config, KHÔNG đổi code.
 */
import { cfg, isLive } from '../config.js';
import { log } from '../log/audit.js';

export type Preset = 'A' | 'B1' | 'B2';
export type FireMode = 'parallel' | 'sequential';

/** 1 lệnh = đặt device về 1 giá trị switch tuyệt đối. */
export interface Command {
  device: string; // device_id Tuya đã resolve
  value: boolean;
}

/** Cấu hình thô đọc từ switches.json. */
export interface SwitchConfig {
  id: string;
  name: string;
  minerId?: string;
  preset: Preset;
  fireMode: FireMode;
  devices: Record<string, string>; // role -> device_id (có thể 'env:NAME')
}

/** Switch đã resolve: kèm command list on/off + danh sách device_id liên quan. */
export interface SwitchDef extends SwitchConfig {
  on: Command[];
  off: Command[];
  deviceIds: string[];
}

/** Resolve 'env:NAME' → giá trị biến môi trường (giữ nguyên nếu không phải env ref). */
function resolveDeviceId(raw: string): string {
  if (raw.startsWith('env:')) {
    const key = raw.slice(4);
    const v = cfg.env[key];
    if (v) return v;
    // LIVE thì bắt buộc có id thật; DRY-RUN cho qua bằng placeholder để switch vẫn nạp được.
    if (isLive()) throw new Error(`switches.json: device "${raw}" — biến môi trường ${key} chưa set.`);
    log.warn('model', `Biến môi trường ${key} chưa set — dùng placeholder (dry-run).`);
    return `missing:${key}`;
  }
  return raw;
}

/**
 * Sinh command list on/off theo preset. Vai trò device theo từng preset:
 *  - A  (cộng lực):     A,B cùng chiều.  on=[A:t,B:t]  off=[A:f,B:f]
 *  - B1 (cặp đối nhau):  A đẩy ON, B đẩy OFF. on=[A:t,B:f] off=[A:f,B:t]
 *  - B2 (riêng lẻ):      ON con bật, OFF con tắt. on=[ON:t] off=[OFF:t]
 */
export function buildActions(preset: Preset, devices: Record<string, string>): { on: Command[]; off: Command[] } {
  const dev = (role: string): string => {
    const raw = devices[role];
    if (!raw) throw new Error(`Preset ${preset} cần vai trò "${role}" nhưng switches.json không có.`);
    return resolveDeviceId(raw);
  };

  switch (preset) {
    case 'A':
      return {
        on: [{ device: dev('A'), value: true }, { device: dev('B'), value: true }],
        off: [{ device: dev('A'), value: false }, { device: dev('B'), value: false }],
      };
    case 'B1':
      return {
        on: [{ device: dev('A'), value: true }, { device: dev('B'), value: false }],
        off: [{ device: dev('A'), value: false }, { device: dev('B'), value: true }],
      };
    case 'B2':
      return {
        on: [{ device: dev('ON'), value: true }],
        off: [{ device: dev('OFF'), value: true }],
      };
    default:
      throw new Error(`Preset không hợp lệ: ${preset as string}`);
  }
}

/** Vai trò device mỗi preset cần — dùng cho dashboard setup/validate. */
export const PRESET_ROLES: Record<Preset, string[]> = {
  A: ['A', 'B'],
  B1: ['A', 'B'],
  B2: ['ON', 'OFF'],
};

export function resolveSwitch(c: SwitchConfig): SwitchDef {
  const { on, off } = buildActions(c.preset, c.devices);
  const deviceIds = Array.from(new Set([...on, ...off].map((cmd) => cmd.device)));
  return { ...c, on, off, deviceIds };
}
