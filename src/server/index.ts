/**
 * server/index.ts — Bootstrap: nạp registry, wiring decision→orchestrator, khởi động
 * poller + keep-warm + refresh status, phục vụ dashboard build (nếu có), mở HTTP server.
 */
import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { cfg, ROOT } from '../config.js';
import { log } from '../log/audit.js';
import { store } from '../state/store.js';
import { registry } from '../switches/registry.js';
import { startKeepWarm } from '../switches/keepwarm.js';
import { poller } from '../price/poller.js';
import { decisionEngine } from '../decision/engine.js';
import { orchestrator } from '../orchestrator/orchestrator.js';
import { tuya } from '../tuya/client.js';
import { buildServer } from './api.js';

async function main(): Promise<void> {
  log.info('boot', `Khởi động Control Panel — chế độ ${cfg.controlMode.toUpperCase()}`);
  if (cfg.controlMode === 'live' && !tuya.hasCredentials()) {
    log.warn('boot', 'CONTROL_MODE=live nhưng thiếu Tuya credentials — lệnh thật sẽ lỗi.');
  }

  registry.load();

  // Decision engine khuyến nghị → orchestrator (chỉ khi autoControl bật).
  decisionEngine.onRecommendation((rec) => {
    if (rec === 'hold') return;
    if (!store.getSettings().autoControl) {
      log.info('boot', `Bỏ qua khuyến nghị ${rec.toUpperCase()} (autoControl tắt — chờ manual).`);
      return;
    }
    void orchestrator.applyRecommendation(rec);
  });

  // Refresh trạng thái fingerbot định kỳ (LIVE).
  await registry.refreshStatus();
  setInterval(() => void registry.refreshStatus(), 30_000);

  poller.start();
  startKeepWarm();

  const app = await buildServer();

  // Phục vụ dashboard đã build (web/dist) nếu có.
  const webDist = path.join(ROOT, 'web', 'dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    log.info('boot', 'Phục vụ dashboard từ web/dist');
  } else {
    app.get('/', async () => ({
      ok: true,
      msg: 'Control Panel API. Dashboard dev: chạy `npm run web:dev` (Vite). API: /api/state',
    }));
  }

  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  log.info('boot', `API listening trên http://localhost:${cfg.port}`);
}

main().catch((e: Error) => {
  log.error('boot', `Khởi động lỗi: ${e.message}`, e.stack);
  process.exit(1);
});
