/**
 * orchestrator/orchestrator.ts — Điều phối tắt/bật theo đúng quy trình an toàn.
 *
 * TẮT (giá cao / auto):   mỗi switch tuần tự → center.reduceClock → center.softShutdown → fingerbot OFF.
 * BẬT (giá thường):        mỗi switch tuần tự → fingerbot ON → center.restart.
 * KHẨN CẤP (curtailment):  ưu tiên tuyệt đối, bỏ qua logic giá, rút ngắn delay, có thể song song.
 *
 * Tuần tự hoá toàn cục bằng 1 hàng đợi (mutex) để không có 2 chiến dịch chạy chồng nhau.
 */
import { log } from '../log/audit.js';
import { store, type DesiredState } from '../state/store.js';
import { center } from '../center/client.js';
import { registry } from '../switches/registry.js';
import { applyState, type ApplyResult, type Target } from '../switches/executor.js';
import type { SwitchDef } from '../switches/model.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface OrchestratorStatus {
  busy: boolean;
  campaign: string | null;
  startedAt: string | null;
}

class Orchestrator {
  private chain: Promise<unknown> = Promise.resolve();
  private busy = false;
  private campaign: string | null = null;
  private startedAt: string | null = null;

  status(): OrchestratorStatus {
    return { busy: this.busy, campaign: this.campaign, startedAt: this.startedAt };
  }

  /** Đưa 1 chiến dịch vào hàng đợi tuần tự; trả promise hoàn tất. */
  private enqueue<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      this.busy = true;
      this.campaign = name;
      this.startedAt = new Date().toISOString();
      log.action('orchestrator', `Started: ${name}`);
      try {
        return await fn();
      } finally {
        this.busy = false;
        this.campaign = null;
        this.startedAt = null;
        log.info('orchestrator', `Completed: ${name}`);
      }
    });
    // Giữ chuỗi không vỡ khi 1 chiến dịch ném lỗi.
    this.chain = run.catch(() => undefined);
    return run;
  }

  // ─── 1 switch ─────────────────────────────────────────────────────────────
  private async offSwitch(sw: SwitchDef): Promise<ApplyResult> {
    if (sw.minerId) {
      await center.reduceClock(sw.minerId);
      await center.softShutdown(sw.minerId);
    }
    const r = await applyState(sw, 'off');
    store.setDesired(sw.id, 'off');
    return r;
  }

  private async onSwitch(sw: SwitchDef): Promise<ApplyResult> {
    const r = await applyState(sw, 'on');
    store.setDesired(sw.id, 'on');
    if (sw.minerId) await center.restart(sw.minerId);
    return r;
  }

  /** Manual override 1 switch (không qua hàng đợi chiến dịch lớn, nhưng vẫn tuần tự hoá). */
  applySwitch(id: string, target: Target): Promise<ApplyResult> {
    const sw = registry.get(id);
    if (!sw) return Promise.reject(new Error(`No switch "${id}"`));
    return this.enqueue(`manual ${target.toUpperCase()} ${id}`, () =>
      target === 'off' ? this.offSwitch(sw) : this.onSwitch(sw),
    );
  }

  // ─── Toàn bộ (tuần tự từng switch) ─────────────────────────────────────────
  applyAll(target: Target): Promise<ApplyResult[]> {
    return this.enqueue(`${target.toUpperCase()} all (sequential)`, async () => {
      const delay = store.getSettings().delaySwitchMs;
      const results: ApplyResult[] = [];
      const list = registry.all();
      for (let i = 0; i < list.length; i++) {
        const sw = list[i]!;
        results.push(target === 'off' ? await this.offSwitch(sw) : await this.onSwitch(sw));
        if (i < list.length - 1) await sleep(delay);
      }
      return results;
    });
  }

  // ─── Khẩn cấp (curtailment) ────────────────────────────────────────────────
  /** Cắt tải khẩn: bỏ qua logic giá, fingerbot OFF SONG SONG tất cả switch (vẫn cố soft-off trước nếu có). */
  emergencyShutdown(): Promise<ApplyResult[]> {
    return this.enqueue('EMERGENCY: shut down all (parallel)', async () => {
      log.warn('orchestrator', '⚠️ CURTAILMENT — emergency load shed, top priority.');
      const list = registry.all();
      // Soft-off song song trước (nhanh), rồi fingerbot OFF song song.
      await Promise.allSettled(
        list.map(async (sw) => {
          if (sw.minerId) {
            await center.reduceClock(sw.minerId).catch(() => undefined);
            await center.softShutdown(sw.minerId).catch(() => undefined);
          }
        }),
      );
      const results = await Promise.all(
        list.map(async (sw) => {
          const r = await applyState(sw, 'off');
          store.setDesired(sw.id, 'off');
          return r;
        }),
      );
      return results;
    });
  }

  /** Đưa toàn hệ về target nhưng BỎ QUA switch đã đúng trạng thái (reconcile) — tuần tự, tránh
   *  thao tác/center-call thừa. Dùng cho auto-control (khác applyAll vốn ép lại TẤT CẢ cho manual). */
  applyAllReconcile(target: Target): Promise<ApplyResult[]> {
    const pending = registry.all().filter((sw) => store.getDesired(sw.id) !== target);
    if (pending.length === 0) {
      log.info('orchestrator', `Reconcile ${target.toUpperCase()}: all switches already in desired state — skipping.`);
      return Promise.resolve([]);
    }
    return this.enqueue(`${target.toUpperCase()} reconcile ${pending.length} switch(es) (sequential)`, async () => {
      const delay = store.getSettings().delaySwitchMs;
      const results: ApplyResult[] = [];
      for (let i = 0; i < pending.length; i++) {
        const sw = pending[i]!;
        results.push(target === 'off' ? await this.offSwitch(sw) : await this.onSwitch(sw));
        if (i < pending.length - 1) await sleep(delay);
      }
      return results;
    });
  }

  /** Thực thi khuyến nghị từ decision engine (chỉ gọi khi autoControl bật). */
  applyRecommendation(rec: 'on' | 'off'): Promise<ApplyResult[]> {
    return this.applyAllReconcile(rec);
  }
}

export const orchestrator = new Orchestrator();
export type { DesiredState };
