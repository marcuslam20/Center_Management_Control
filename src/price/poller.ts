/**
 * price/poller.ts — Định kỳ lấy giá từ PriceSource đã chọn, đẩy vào DecisionEngine.
 * ERCOT lỗi (403/parse) → log cảnh báo, KHÔNG làm chết vòng lặp (giữ giá cuối).
 */
import { cfg } from '../config.js';
import { log } from '../log/audit.js';
import { store } from '../state/store.js';
import { decisionEngine } from '../decision/engine.js';
import { ErcotHtmlSource } from './ercot.js';
import { MockPriceSource, type PricePoint, type PriceSource } from './source.js';

class Poller {
  private source: PriceSource;
  readonly mock: MockPriceSource;
  private timer: NodeJS.Timeout | null = null;
  private last: PricePoint | null = null;

  constructor() {
    this.mock = new MockPriceSource();
    this.source = cfg.priceSource === 'ercot' ? new ErcotHtmlSource() : this.mock;
    log.info('poller', `Nguồn giá: ${this.source.name} (poll mỗi ${cfg.pricePollSeconds}s)`);
  }

  getLast(): PricePoint | null {
    return this.last;
  }

  sourceName(): string {
    return this.source.name;
  }

  async pollOnce(): Promise<PricePoint | null> {
    const sp = store.getSettings().settlementPoint;
    try {
      const p = await this.source.getPrice(sp);
      this.last = p;
      decisionEngine.ingest(p);
      return p;
    } catch (e) {
      log.warn('poller', `Lấy giá thất bại (${this.source.name}): ${(e as Error).message}`);
      return this.last;
    }
  }

  start(): void {
    if (this.timer) return;
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), cfg.pricePollSeconds * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const poller = new Poller();
