/**
 * switches/registry.ts — Nạp switches.json → resolve thành SwitchDef.
 * Giữ snapshot trạng thái thực tế (actual) từng fingerbot (đọc từ Tuya khi LIVE).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, isLive } from '../config.js';
import { log } from '../log/audit.js';
import { tuya } from '../tuya/client.js';
import type { FingerbotStatus } from '../tuya/types.js';
import { resolveSwitch, type SwitchConfig, type SwitchDef } from './model.js';

const SWITCHES_FILE = path.join(CONFIG_DIR, 'switches.json');

interface SwitchesFile {
  switches: SwitchConfig[];
}

class Registry {
  private switches: SwitchDef[] = [];
  private deviceStatus = new Map<string, FingerbotStatus>();

  load(): void {
    const raw = JSON.parse(fs.readFileSync(SWITCHES_FILE, 'utf8')) as SwitchesFile;
    const list = raw.switches ?? [];
    this.switches = [];
    for (const c of list) {
      try {
        this.switches.push(resolveSwitch(c));
      } catch (e) {
        log.error('registry', `Switch "${c.id}" lỗi config: ${(e as Error).message}`);
      }
    }
    log.info('registry', `Đã nạp ${this.switches.length} switch`, this.switches.map((s) => s.id));
  }

  all(): SwitchDef[] {
    return this.switches;
  }

  get(id: string): SwitchDef | undefined {
    return this.switches.find((s) => s.id === id);
  }

  /** Tất cả device_id duy nhất trong toàn bộ switch. */
  allDeviceIds(): string[] {
    return Array.from(new Set(this.switches.flatMap((s) => s.deviceIds)));
  }

  getDeviceStatus(deviceId: string): FingerbotStatus | undefined {
    return this.deviceStatus.get(deviceId);
  }

  /** Làm mới trạng thái fingerbot từ Tuya (chỉ khi LIVE + có credentials). */
  async refreshStatus(): Promise<void> {
    if (!isLive() || !tuya.hasCredentials()) return;
    for (const id of this.allDeviceIds()) {
      try {
        const s = await tuya.getFingerbotStatus(id);
        this.deviceStatus.set(id, s);
      } catch (e) {
        log.warn('registry', `Đọc status ${id} lỗi: ${(e as Error).message}`);
      }
    }
  }

  snapshotStatuses(): FingerbotStatus[] {
    return Array.from(this.deviceStatus.values());
  }
}

export const registry = new Registry();
