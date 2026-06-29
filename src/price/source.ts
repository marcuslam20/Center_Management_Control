/**
 * price/source.ts — Interface nguồn giá + MockPriceSource (dev/test decision engine).
 * Nguồn giá là PLUGGABLE: ERCOT HTML có thể bị Incapsula chặn nên luôn có mock fallback.
 */

export interface PricePoint {
  /** Giá Settlement Point Price ($/MWh). */
  price: number;
  /** Mốc 15 phút (vd "0915") hoặc ISO time, tuỳ nguồn. */
  intervalEnding: string;
  settlementPoint: string;
  source: string;
  fetchedAt: string;
}

export interface PriceSource {
  readonly name: string;
  getPrice(settlementPoint: string): Promise<PricePoint>;
}

/**
 * MockPriceSource — giá giả lập điều khiển được, phục vụ dev + demo decision engine.
 * Mặc định dao động hình sin quanh `base`; có thể ép giá cố định qua setOverride().
 */
export class MockPriceSource implements PriceSource {
  readonly name = 'mock';
  private base: number;
  private amplitude: number;
  private override: number | null = null;
  private tick = 0;

  constructor(base = 55, amplitude = 70) {
    this.base = base;
    this.amplitude = amplitude;
  }

  /** Ép giá về 1 giá trị cố định (dùng để test trigger OFF/ON). null = trả lại dao động. */
  setOverride(price: number | null): void {
    this.override = price;
  }

  async getPrice(settlementPoint: string): Promise<PricePoint> {
    this.tick++;
    // Dao động xác định (không dùng Math.random) để dễ quan sát.
    const wave = Math.sin(this.tick / 3) * this.amplitude;
    const price = this.override ?? Math.max(0, Math.round((this.base + wave) * 100) / 100);
    return {
      price,
      intervalEnding: `mock-${this.tick}`,
      settlementPoint,
      source: this.name,
      fetchedAt: new Date().toISOString(),
    };
  }
}
