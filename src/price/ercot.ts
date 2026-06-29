/**
 * price/ercot.ts — ErcotHtmlSource: lấy giá Real-Time SPP từ trang HTML ERCOT.
 * URL theo ngày (giờ Texas): https://www.ercot.com/content/cdr/html/<YYYYMMDD>_real_time_spp.html
 *
 * CẢNH BÁO: trang đứng sau Incapsula/Imperva → request từ server thường bị 403.
 * Ta gửi header giống browser; nếu vẫn bị chặn → ném lỗi rõ ràng để poller fallback sang mock.
 * TODO: chuyển sang ERCOT MIS/Public API chính thức cho ổn định (cần API key) khi có.
 *
 * Cấu trúc bảng: hàng đầu là header (Oper Day, Interval Ending, rồi mỗi Settlement Point 1 cột).
 * Mỗi hàng dữ liệu = 1 mốc 15 phút. Ta lấy HÀNG CUỐI (mốc mới nhất) ở cột settlementPoint.
 */
import { parse } from 'node-html-parser';
import { log } from '../log/audit.js';
import type { PricePoint, PriceSource } from './source.js';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.ercot.com/',
};

/** Ngày hiện tại theo giờ Texas (America/Chicago) dạng YYYYMMDD. */
export function ercotDateString(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

export function ercotUrl(dateStr: string = ercotDateString()): string {
  return `https://www.ercot.com/content/cdr/html/${dateStr}_real_time_spp.html`;
}

export class ErcotHtmlSource implements PriceSource {
  readonly name = 'ercot';

  async getPrice(settlementPoint: string): Promise<PricePoint> {
    const url = ercotUrl();
    let res: Response;
    try {
      res = await fetch(url, { headers: BROWSER_HEADERS });
    } catch (e) {
      throw new Error(`ERCOT fetch lỗi mạng: ${(e as Error).message}`);
    }
    if (res.status === 403) {
      throw new Error('ERCOT trả 403 (Incapsula bot-protection) — cần API chính thức hoặc proxy.');
    }
    if (!res.ok) throw new Error(`ERCOT HTTP ${res.status}`);
    const html = await res.text();
    if (html.includes('Incapsula') || html.includes('_Incapsula_Resource')) {
      throw new Error('ERCOT trả trang chặn Incapsula — không phải dữ liệu giá.');
    }
    return parseSppHtml(html, settlementPoint, this.name);
  }
}

/**
 * parseSppHtml — tách riêng để test được. Bảng ERCOT real_time_spp:
 *   header row: Oper Day | Interval Ending | HB_BUSAVG | HB_HOUSTON | ... | LZ_HOUSTON | ... | LZ_WEST
 *   data rows:  06/28/2026 | 0015 | 24.37 | 24.60 | ...
 * Lấy HÀNG DỮ LIỆU CUỐI có giá số hợp lệ ở cột settlementPoint = mốc 15 phút mới nhất.
 */
export function parseSppHtml(html: string, settlementPoint: string, sourceName = 'ercot'): PricePoint {
  const root = parse(html);
  const rows = root.querySelectorAll('table tr');
  if (rows.length < 2) throw new Error('ERCOT: không tìm thấy bảng dữ liệu.');

  const headerCells = (rows[0]?.querySelectorAll('th, td') ?? []).map((c) => c.text.trim());
  const colIndex = headerCells.findIndex((h) => h.toUpperCase() === settlementPoint.toUpperCase());
  if (colIndex === -1) {
    throw new Error(`ERCOT: không thấy cột "${settlementPoint}". Cột có: ${headerCells.join(', ')}`);
  }
  const dayIdx = headerCells.findIndex((h) => /oper\s*day/i.test(h));
  const intervalIdx = headerCells.findIndex((h) => /interval\s*ending/i.test(h));

  for (let i = rows.length - 1; i >= 1; i--) {
    const cells = (rows[i]?.querySelectorAll('td, th') ?? []).map((c) => c.text.trim());
    const rawPrice = cells[colIndex];
    if (rawPrice === undefined || rawPrice === '') continue;
    const price = Number(rawPrice.replace(/,/g, ''));
    if (!Number.isFinite(price)) continue;
    const intervalEnding = (intervalIdx >= 0 ? cells[intervalIdx] : '') || `row-${i}`;
    const operDay = dayIdx >= 0 ? cells[dayIdx] : '';
    return {
      price,
      intervalEnding: operDay ? `${operDay} ${intervalEnding}` : intervalEnding,
      settlementPoint,
      source: sourceName,
      fetchedAt: new Date().toISOString(),
    };
  }
  throw new Error(`ERCOT: cột "${settlementPoint}" không có giá trị số hợp lệ.`);
}

/** Tiện ích: thử fetch 1 lần để chẩn đoán (dùng trong test/CLI). */
export async function probeErcot(settlementPoint: string): Promise<void> {
  try {
    const p = await new ErcotHtmlSource().getPrice(settlementPoint);
    log.info('ercot', `Giá ${settlementPoint} = $${p.price}/MWh @ ${p.intervalEnding}`);
  } catch (e) {
    log.warn('ercot', `Probe thất bại: ${(e as Error).message}`);
  }
}
