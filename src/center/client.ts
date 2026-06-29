/**
 * center/client.ts — Center Management client (giảm clock / soft-shutdown / restart miner).
 *
 * API THẬT CHƯA CÓ — chờ Jay (xác thực, endpoint, định danh miner). Đây là interface đầy đủ
 * + impl MOCK chỉ log & delay. Orchestrator phụ thuộc INTERFACE, nên khi có API thật chỉ cần
 * thay impl, không sửa orchestrator.
 */
import { log } from '../log/audit.js';

export interface CenterManagement {
  /** Hạ xung nhịp/hashrate miner để giảm tải từ từ trước khi cắt điện. */
  reduceClock(minerId: string): Promise<void>;
  /** Tắt mềm miner (kết thúc job đang đào, hạ tải an toàn). */
  softShutdown(minerId: string): Promise<void>;
  /** Khởi động lại miner + ramp clock lên dần sau khi cấp điện. */
  restart(minerId: string): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Mock: log + delay nhỏ để mô phỏng độ trễ. KHÔNG gọi hệ thật. */
export class MockCenterManagement implements CenterManagement {
  async reduceClock(minerId: string): Promise<void> {
    log.info('center', `[MOCK] reduceClock(${minerId})`);
    await sleep(150);
  }
  async softShutdown(minerId: string): Promise<void> {
    log.info('center', `[MOCK] softShutdown(${minerId})`);
    await sleep(200);
  }
  async restart(minerId: string): Promise<void> {
    log.info('center', `[MOCK] restart(${minerId})`);
    await sleep(150);
  }
}

export const center: CenterManagement = new MockCenterManagement();
