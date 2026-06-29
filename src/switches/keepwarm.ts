/**
 * switches/keepwarm.ts — Heartbeat giữ fingerbot "ấm": định kỳ tái khẳng định trạng thái
 * hiện tại (gửi lại đúng giá trị `switch` = no-op vật lý) để con không ngủ sâu → phản hồi nhanh.
 * Chỉ chạy khi LIVE + KEEPWARM_SECONDS > 0. Lỗi tạm thời không làm chết vòng lặp.
 */
import { cfg, isLive } from '../config.js';
import { log } from '../log/audit.js';
import { tuya } from '../tuya/client.js';
import { registry } from './registry.js';

let timer: NodeJS.Timeout | null = null;

export function startKeepWarm(): void {
  if (timer || !isLive() || cfg.keepwarmSeconds <= 0) return;
  if (!tuya.hasCredentials()) return;
  const intervalMs = cfg.keepwarmSeconds * 1000;
  log.info('keepwarm', `Bật keep-warm mỗi ${cfg.keepwarmSeconds}s`);

  timer = setInterval(() => {
    void (async () => {
      for (const id of registry.allDeviceIds()) {
        try {
          const cur = await tuya.readSwitch(id);
          if (typeof cur === 'boolean') await tuya.sendSwitch(id, cur);
        } catch (e) {
          log.warn('keepwarm', `Giữ ấm ${id} lỗi tạm thời: ${(e as Error).message}`);
        }
      }
    })();
  }, intervalMs);
}

export function stopKeepWarm(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
