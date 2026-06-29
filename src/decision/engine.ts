/**
 * decision/engine.ts — Quyết định CẮT/CẤP theo giá với hysteresis + cửa sổ ổn định.
 *
 * - price ≥ switchOffCost giữ liên tục ≥ confirmMinutes  → khuyến nghị OFF (tắt miner).
 * - price ≤ switchOnCost  giữ liên tục ≥ confirmMinutes  → khuyến nghị ON  (bật lại).
 *   (switchOnCost < switchOffCost ⇒ vùng chết hysteresis, tránh dao động bật/tắt liên tục.)
 *
 * Engine KHÔNG tự bắn fingerbot — chỉ phát khuyến nghị; lớp trên (index) quyết định có
 * thực thi không (tuỳ settings.autoControl).
 */
import { log } from '../log/audit.js';
import { store } from '../state/store.js';
import type { PricePoint } from '../price/source.js';

export type Recommendation = 'off' | 'on' | 'hold';

export interface DecisionState {
  recommendation: Recommendation; // khuyến nghị hiện hành (đã xác nhận ổn định)
  lastPrice: number | null;
  lastIntervalEnding: string | null;
  aboveSince: number | null; // ms epoch, lần đầu vượt ngưỡng tắt
  belowSince: number | null; // ms epoch, lần đầu dưới ngưỡng bật
  updatedAt: string | null;
}

type Listener = (rec: Recommendation, p: PricePoint) => void;

export class DecisionEngine {
  private state: DecisionState = {
    recommendation: 'hold',
    lastPrice: null,
    lastIntervalEnding: null,
    aboveSince: null,
    belowSince: null,
    updatedAt: null,
  };
  private listeners = new Set<Listener>();

  onRecommendation(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): DecisionState {
    return { ...this.state };
  }

  /** Nạp 1 điểm giá mới; cập nhật state và phát khuyến nghị nếu đổi. */
  ingest(p: PricePoint): Recommendation {
    const { switchOffCost, switchOnCost, confirmMinutes } = store.getSettings();
    const now = Date.now();
    const confirmMs = Math.max(0, confirmMinutes) * 60_000;

    // Theo dõi thời điểm bắt đầu vượt/dưới ngưỡng (reset khi rời vùng).
    if (p.price >= switchOffCost) {
      this.state.aboveSince ??= now;
    } else {
      this.state.aboveSince = null;
    }
    if (p.price <= switchOnCost) {
      this.state.belowSince ??= now;
    } else {
      this.state.belowSince = null;
    }

    let rec: Recommendation = this.state.recommendation;
    if (this.state.aboveSince !== null && now - this.state.aboveSince >= confirmMs) {
      rec = 'off';
    } else if (this.state.belowSince !== null && now - this.state.belowSince >= confirmMs) {
      rec = 'on';
    }

    const changed = rec !== this.state.recommendation;
    this.state.recommendation = rec;
    this.state.lastPrice = p.price;
    this.state.lastIntervalEnding = p.intervalEnding;
    this.state.updatedAt = new Date().toISOString();

    if (changed && rec !== 'hold') {
      log.action(
        'decision',
        `Recommend ${rec.toUpperCase()} — price $${p.price}/MWh (off≥${switchOffCost}, on≤${switchOnCost}, stable ${confirmMinutes}m)`,
      );
      for (const fn of this.listeners) {
        try {
          fn(rec, p);
        } catch (e) {
          log.error('decision', `Listener error: ${(e as Error).message}`);
        }
      }
    }
    return rec;
  }
}

export const decisionEngine = new DecisionEngine();
