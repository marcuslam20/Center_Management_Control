/**
 * price/ercot-browser.ts — ErcotBrowserSource: lấy Real-Time SPP bằng Chromium (Playwright).
 *
 * Vì sao cần: trang ERCOT đứng sau Incapsula → trả về một JS challenge. `fetch` thuần KHÔNG chạy
 * được JS nên luôn nhận trang chặn (xem ErcotHtmlSource). Trình duyệt thật chạy được challenge →
 * thấy bảng giá. Chromium làm y hệt trình duyệt: chạy JS, nhận cookie Incapsula, load trang thật,
 * rồi ta lấy HTML cuối cùng và đưa vào parseSppHtml() (đã unit-test, dùng chung với HTML source).
 *
 * headless (cfg.ercotBrowserHeadless): true = nhẹ, thường đủ ở IP sạch; false = headful dưới Xvfb
 * (container chạy qua xvfb-run) — khó bị Incapsula phát hiện nhất, dùng khi headless bị chặn.
 *
 * Tối ưu: giữ lại browser + context qua các lần poll để cookie Incapsula được tái dùng (lần sau
 * thường khỏi giải challenge lại). Lỗi/timeout → lưu screenshot chẩn đoán + đóng browser để lần
 * poll sau khởi tạo lại sạch.
 */
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import { DATA_DIR, cfg } from '../config.js';
import { ercotUrl, parseSppHtml } from './ercot.js';
import type { PricePoint, PriceSource } from './source.js';

const NAV_TIMEOUT_MS = 45_000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEBUG_SHOT = path.join(DATA_DIR, 'ercot-debug.png');

// Điều kiện "đã qua challenge, bảng giá thật đã render": có chữ "Interval Ending" + đủ hàng bảng.
// Truyền dạng STRING (project Node không có DOM types) để waitForFunction tự eval trong trang.
const READY_EXPR =
  "/Interval\\s*Ending/i.test((document.body && document.body.innerText) || '') " +
  "&& document.querySelectorAll('table tr').length > 3";

export class ErcotBrowserSource implements PriceSource {
  readonly name = 'ercot-browser';
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  private async ensureContext(): Promise<BrowserContext> {
    if (this.browser && this.context) return this.context;
    await this.close(); // dọn nếu lần trước khởi tạo dở
    this.browser = await chromium.launch({
      headless: cfg.ercotBrowserHeadless,
      args: [
        '--no-sandbox', // bắt buộc khi chạy Chromium dưới root trong container
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // /dev/shm nhỏ trong container → tránh crash
        '--disable-blink-features=AutomationControlled', // giảm dấu hiệu "automation" cho Incapsula
      ],
    });
    this.context = await this.browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
    });
    return this.context;
  }

  /** Đóng browser — gọi khi lỗi (để khởi tạo lại sạch) hoặc khi shutdown. */
  async close(): Promise<void> {
    try {
      await this.context?.close();
      await this.browser?.close();
    } catch {
      /* ignore */
    }
    this.context = null;
    this.browser = null;
  }

  async getPrice(settlementPoint: string): Promise<PricePoint> {
    const ctx = await this.ensureContext();
    const page = await ctx.newPage();
    try {
      await page.goto(ercotUrl(), { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      // Incapsula tự submit challenge rồi reload sang trang thật → chờ tới khi bảng giá xuất hiện
      // (waitForFunction sống xuyên qua reload), tránh lấy nhầm trang challenge.
      await page.waitForFunction(READY_EXPR, undefined, { timeout: NAV_TIMEOUT_MS });
      const html = await page.content();
      if (html.includes('_Incapsula_Resource') && !/Interval\s*Ending/i.test(html)) {
        throw new Error('vẫn bị Incapsula chặn (có thể bị phát hiện headless — thử ERCOT_BROWSER_HEADLESS=false).');
      }
      return parseSppHtml(html, settlementPoint, this.name);
    } catch (e) {
      const diag = await this.snapshot(page);
      await this.close(); // reset để lần sau thử lại sạch (cookie/headless có thể đã hỏng)
      throw new Error(`ERCOT (browser) lấy giá lỗi: ${(e as Error).message}${diag}`);
    } finally {
      try {
        await page.close();
      } catch {
        /* page có thể đã đóng theo browser */
      }
    }
  }

  /** Lưu title + screenshot trang lúc lỗi để soi (challenge hay đã qua). Không ném lỗi. */
  private async snapshot(page: Page): Promise<string> {
    try {
      const title = await page.title();
      await page.screenshot({ path: DEBUG_SHOT, fullPage: true });
      return ` [title="${title}", screenshot=${DEBUG_SHOT}]`;
    } catch {
      return '';
    }
  }
}
