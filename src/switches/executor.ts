/**
 * switches/executor.ts — Thực thi 1 switch về trạng thái mong muốn.
 * Mô hình: muốn 'on'|'off' → chạy command list tương ứng (parallel/sequential)
 * → wake-prime → verify + retry tới khi DP `switch` khớp.
 *
 * DRY-RUN (mặc định): chỉ log command list, KHÔNG gọi Tuya, giả lập verify ok.
 * LIVE: dùng pattern đã kiểm chứng trong scripts/toggle-both.mjs.
 */
import { cfg, isLive } from '../config.js';
import { log } from '../log/audit.js';
import { tuya } from '../tuya/client.js';
import type { Command, SwitchDef } from './model.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export type Target = 'on' | 'off';

export interface ApplyResult {
  switchId: string;
  target: Target;
  ok: boolean;
  dryRun: boolean;
  perDevice: { device: string; ok: boolean; sent: number; final: boolean | null }[];
  ms: number;
}

/** confirmSwitch — gửi thưa + poll trạng thái, retry tới khi `switch` == desired. */
async function confirmSwitch(
  device: string,
  desired: boolean,
): Promise<{ device: string; ok: boolean; sent: number; final: boolean | null }> {
  let cur = await tuya.readSwitch(device);
  if (cur === desired) return { device, ok: true, sent: 0, final: cur };

  let sent = 0;
  let lastSend = -Infinity;
  const start = Date.now();
  while (Date.now() - start < cfg.confirmTimeoutMs) {
    if (Date.now() - lastSend >= cfg.resendMs) {
      await tuya.sendSwitch(device, desired); // gửi THƯA, không dồn lệnh
      sent++;
      lastSend = Date.now();
    }
    await sleep(cfg.pollMs);
    cur = await tuya.readSwitch(device);
    if (cur === desired) return { device, ok: true, sent, final: cur };
  }
  return { device, ok: false, sent, final: cur };
}

/** Đánh thức cả nhóm device (gửi mồi đúng giá trị đích) rồi chờ PRIME_WAIT_MS. */
async function wakePrime(commands: Command[]): Promise<void> {
  log.info('executor', `Wake-prime ${commands.length} device, chờ ${cfg.primeWaitMs}ms`);
  await Promise.allSettled(commands.map((c) => tuya.sendSwitch(c.device, c.value)));
  await sleep(cfg.primeWaitMs);
}

export async function applyState(sw: SwitchDef, target: Target): Promise<ApplyResult> {
  const commands = target === 'on' ? sw.on : sw.off;
  const start = Date.now();

  // ─── DRY-RUN: chỉ log, không chạm Tuya ───────────────────────────────────
  if (!isLive()) {
    log.action(
      'executor',
      `[DRY-RUN] ${sw.id} → ${target.toUpperCase()} (${sw.fireMode})`,
      commands.map((c) => `${c.device}=${c.value}`),
    );
    return {
      switchId: sw.id,
      target,
      ok: true,
      dryRun: true,
      perDevice: commands.map((c) => ({ device: c.device, ok: true, sent: 0, final: c.value })),
      ms: Date.now() - start,
    };
  }

  // ─── LIVE ────────────────────────────────────────────────────────────────
  log.action('executor', `[LIVE] ${sw.id} → ${target.toUpperCase()} (${sw.fireMode})`, commands);

  // Wake-prime cả nhóm để con ngủ kịp thức trước khi verify.
  await wakePrime(commands);

  let perDevice: ApplyResult['perDevice'];
  if (sw.fireMode === 'parallel') {
    perDevice = await Promise.all(commands.map((c) => confirmSwitch(c.device, c.value)));
  } else {
    perDevice = [];
    for (const c of commands) {
      perDevice.push(await confirmSwitch(c.device, c.value));
      if (cfg.env['DELAY_SWITCH_MS']) await sleep(Number(cfg.env['DELAY_SWITCH_MS']) || 0);
    }
  }

  const ok = perDevice.every((d) => d.ok);
  const result: ApplyResult = { switchId: sw.id, target, ok, dryRun: false, perDevice, ms: Date.now() - start };
  log[ok ? 'info' : 'warn']('executor', `${sw.id} → ${target.toUpperCase()} ${ok ? 'OK' : 'CHƯA ĐẠT'}`, perDevice);
  return result;
}
