/**
 * price/poller.ts — Định kỳ lấy giá từ PriceSource đã chọn, đẩy vào DecisionEngine.
 * ERCOT lỗi (403/parse) → log cảnh báo, KHÔNG làm chết vòng lặp (giữ giá cuối).
 */
import { cfg } from '../config.js';
import { log } from '../log/audit.js';
import { store } from '../state/store.js';
import { decisionEngine } from '../decision/engine.js';
import { ErcotHtmlSource } from './ercot.js';
import { ErcotBrowserSource } from './ercot-browser.js';
import { MockPriceSource, type PricePoint, type PriceSource } from './source.js';

class Poller {
  private source: PriceSource;
  readonly mock: MockPriceSource;
  private timer: NodeJS.Timeout | null = null;
  private last: PricePoint | null = null;
  private lastLoggedInterval: string | null = null; // chỉ log info khi sang mốc 15 phút mới
  private hadError = false; // để log "khôi phục" sau chuỗi lỗi

  constructor() {
    this.mock = new MockPriceSource();
    this.source =
      cfg.priceSource === 'ercot'
        ? new ErcotHtmlSource() // fetch thuần — chạy được nơi IP không bị Incapsula chặn (datacenter sạch/đã "ấm" nhờ truy cập browser)
        : cfg.priceSource === 'ercot-browser'
          ? new ErcotBrowserSource() // Chromium (Playwright) tự giải Incapsula JS challenge — dùng khi fetch thuần bị chặn
          : this.mock;
    log.info('poller', `Price source: ${this.source.name} (poll every ${cfg.pricePollSeconds}s)`);
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
      // Log THÀNH CÔNG khi: sang mốc 15 phút mới, hoặc vừa khôi phục sau lỗi. (Tránh spam mỗi poll
      // mà vẫn cho thấy hệ thống đang lấy được giá — trước đây poll thành công hoàn toàn im lặng.)
      if (p.intervalEnding !== this.lastLoggedInterval || this.hadError) {
        log.info('poller', `Price ${p.settlementPoint} = $${p.price}/MWh @ ${p.intervalEnding} (${this.source.name})`);
        this.lastLoggedInterval = p.intervalEnding;
      }
      this.hadError = false;
      return p;
    } catch (e) {
      this.hadError = true;
      log.warn('poller', `Price fetch failed (${this.source.name}) — keeping last price: ${(e as Error).message}`);
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
