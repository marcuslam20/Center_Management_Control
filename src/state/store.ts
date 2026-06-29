/**
 * state/store.ts — Lưu trạng thái mong muốn (desired) từng switch + settings vận hành.
 * Persist JSON file (đủ cho Phase 1 / 6 switch). Settings nạp từ config/settings.json,
 * runtime state lưu config/state.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, DATA_DIR } from '../config.js';
import { log } from '../log/audit.js';

export interface Settings {
  switchOffCost: number;
  switchOnCost: number;
  confirmMinutes: number;
  settlementPoint: string;
  delaySwitchMs: number;
  autoControl: boolean; // true = decision engine tự bật/tắt; false = chỉ manual
}

export type DesiredState = 'on' | 'off' | 'unknown';

interface PersistedState {
  desired: Record<string, DesiredState>;
  settings?: Partial<Settings>; // override runtime (ghi đè seed config/settings.json)
}

const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json'); // seed chỉ-đọc (trong image)
const STATE_FILE = path.join(DATA_DIR, 'state.json'); // runtime (mount volume)

const DEFAULT_SETTINGS: Settings = {
  switchOffCost: 100,
  switchOnCost: 60,
  confirmMinutes: 2,
  settlementPoint: 'LZ_NORTH',
  delaySwitchMs: 2000,
  autoControl: false,
};

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    return obj as T;
  } catch (e) {
    log.warn('store', `Đọc ${path.basename(file)} lỗi, dùng mặc định: ${(e as Error).message}`);
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    log.error('store', `Ghi ${path.basename(file)} lỗi: ${(e as Error).message}`);
  }
}

class Store {
  private settings: Settings;
  private desired: Record<string, DesiredState>;

  constructor() {
    // settings.json = SEED chỉ-đọc (commit vào repo / image). Override runtime nằm trong
    // state.json (gitignore, mount volume khi deploy) → seed không bao giờ bị app ghi đè.
    const seed = readJson<Partial<Settings>>(SETTINGS_FILE, {});
    const persisted = readJson<PersistedState>(STATE_FILE, { desired: {} });
    this.settings = { ...DEFAULT_SETTINGS, ...stripComment(seed), ...stripComment(persisted.settings ?? {}) };
    this.desired = persisted.desired ?? {};
  }

  /** Ghi toàn bộ state runtime (desired + settings override) vào state.json. */
  private persist(): void {
    writeJson(STATE_FILE, { desired: this.desired, settings: this.settings });
  }

  getSettings(): Settings {
    return { ...this.settings };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...stripComment(patch) };
    this.persist();
    log.info('store', 'Cập nhật settings', this.settings);
    return this.getSettings();
  }

  getDesired(switchId: string): DesiredState {
    return this.desired[switchId] ?? 'unknown';
  }

  setDesired(switchId: string, state: DesiredState): void {
    this.desired[switchId] = state;
    this.persist();
  }

  allDesired(): Record<string, DesiredState> {
    return { ...this.desired };
  }
}

/** Bỏ field "_comment" nếu lỡ lọt vào patch/JSON. */
function stripComment<T extends object>(o: T): T {
  const { _comment, ...rest } = o as Record<string, unknown>;
  void _comment;
  return rest as T;
}

export const store = new Store();
