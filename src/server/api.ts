/**
 * server/api.ts — REST API + SSE cho dashboard.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { cfg } from '../config.js';
import { log, recentAudit } from '../log/audit.js';
import { store, type Settings } from '../state/store.js';
import { registry } from '../switches/registry.js';
import { PRESET_ROLES } from '../switches/model.js';
import { poller } from '../price/poller.js';
import { decisionEngine } from '../decision/engine.js';
import { orchestrator } from '../orchestrator/orchestrator.js';
import { tuya } from '../tuya/client.js';

/** Snapshot tổng hợp gửi cho dashboard. */
export function buildSnapshot() {
  const settings = store.getSettings();
  const switches = registry.all().map((sw) => ({
    id: sw.id,
    name: sw.name,
    minerId: sw.minerId ?? null,
    preset: sw.preset,
    fireMode: sw.fireMode,
    desired: store.getDesired(sw.id),
    devices: sw.deviceIds.map((id) => {
      const st = registry.getDeviceStatus(id);
      return {
        deviceId: id,
        online: st?.online ?? null,
        battery: st?.battery ?? null,
        switchValue: st?.switchValue ?? null,
      };
    }),
  }));

  return {
    controlMode: cfg.controlMode,
    live: cfg.controlMode === 'live',
    hasTuyaCredentials: tuya.hasCredentials(),
    priceSource: poller.sourceName(),
    price: poller.getLast(),
    decision: decisionEngine.getState(),
    settings,
    switches,
    orchestrator: orchestrator.status(),
    serverTime: new Date().toISOString(),
  };
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // ─── Trạng thái ───────────────────────────────────────────────────────────
  app.get('/api/state', async () => buildSnapshot());

  app.get('/api/audit', async (req) => {
    const limit = Number((req.query as Record<string, string>)?.limit ?? 100);
    return recentAudit(Number.isFinite(limit) ? limit : 100);
  });

  // SSE stream: đẩy snapshot định kỳ.
  app.get('/api/stream', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    const send = (): void => {
      reply.raw.write(`data: ${JSON.stringify(buildSnapshot())}\n\n`);
    };
    send();
    const timer = setInterval(send, 2000);
    req.raw.on('close', () => clearInterval(timer));
  });

  // ─── Điều khiển switch ─────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { target: 'on' | 'off' } }>('/api/switch/:id', async (req, reply) => {
    const { target } = req.body ?? ({} as { target: 'on' | 'off' });
    if (target !== 'on' && target !== 'off') return reply.code(400).send({ error: 'target phải là on|off' });
    const result = await orchestrator.applySwitch(req.params.id, target).catch((e: Error) => ({ error: e.message }));
    return result;
  });

  app.post<{ Body: { target: 'on' | 'off' } }>('/api/all', async (req, reply) => {
    const { target } = req.body ?? ({} as { target: 'on' | 'off' });
    if (target !== 'on' && target !== 'off') return reply.code(400).send({ error: 'target phải là on|off' });
    return orchestrator.applyAll(target);
  });

  app.post('/api/emergency', async () => orchestrator.emergencyShutdown());

  // ─── Settings ──────────────────────────────────────────────────────────────
  app.get('/api/settings', async () => store.getSettings());
  app.put('/api/settings', async (req) => {
    const wasAuto = store.getSettings().autoControl;
    const settings = store.updateSettings((req.body ?? {}) as Partial<Settings>);
    // Vừa BẬT autoControl → áp dụng NGAY khuyến nghị hiện hành (đừng chờ lần đổi khuyến nghị kế tiếp:
    // nếu giá đã ổn định qua ngưỡng từ trước, khuyến nghị sẽ không "đổi" lại nên listener không bắn).
    if (!wasAuto && settings.autoControl) {
      const rec = decisionEngine.getState().recommendation;
      if (rec === 'on' || rec === 'off') {
        log.action('api', `autoControl vừa bật → áp dụng ngay khuyến nghị hiện hành: ${rec.toUpperCase()}`);
        void orchestrator.applyRecommendation(rec);
      } else {
        log.info('api', 'autoControl vừa bật → khuyến nghị hiện là HOLD (chờ giá ổn định qua ngưỡng).');
      }
    }
    return settings;
  });

  // ─── Switch config + discovery (cho trang setup) ───────────────────────────
  app.get('/api/switches', async () =>
    registry.all().map((s) => ({
      id: s.id,
      name: s.name,
      minerId: s.minerId ?? null,
      preset: s.preset,
      fireMode: s.fireMode,
      devices: s.devices,
      roles: PRESET_ROLES[s.preset],
    })),
  );

  app.get('/api/devices', async () => {
    try {
      return await tuya.discoverDevices();
    } catch (e) {
      return { error: (e as Error).message, devices: [] };
    }
  });

  // ─── Mock price control (chỉ khi nguồn giá = mock) — để demo decision engine ──
  app.post<{ Body: { price: number | null } }>('/api/mock/price', async (req, reply) => {
    if (poller.sourceName() !== 'mock') return reply.code(400).send({ error: 'Nguồn giá không phải mock.' });
    const price = req.body?.price ?? null;
    poller.mock.setOverride(price);
    const p = await poller.pollOnce();
    return { override: price, current: p };
  });

  return app;
}
