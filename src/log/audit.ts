/**
 * log/audit.ts — Ghi mọi quyết định & lệnh (ai/cái gì/khi nào/kết quả).
 * In ra console + giữ buffer vòng để dashboard hiển thị + nối file audit.log.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

export type AuditLevel = 'info' | 'action' | 'warn' | 'error';

export interface AuditEntry {
  ts: string;
  level: AuditLevel;
  source: string; // module phát log (executor, decision, orchestrator, api, price...)
  message: string;
  data?: unknown;
}

const LOG_FILE = path.join(ROOT, 'audit.log');
const MAX_BUFFER = 500;
const buffer: AuditEntry[] = [];
type Listener = (e: AuditEntry) => void;
const listeners = new Set<Listener>();

export function onAudit(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function recentAudit(limit = 100): AuditEntry[] {
  return buffer.slice(-limit);
}

export function audit(level: AuditLevel, source: string, message: string, data?: unknown): void {
  const entry: AuditEntry = { ts: new Date().toISOString(), level, source, message, data };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();

  const tag = level === 'error' ? '✖' : level === 'warn' ? '⚠' : level === 'action' ? '▶' : '·';
  const line = `${entry.ts} ${tag} [${source}] ${message}`;
  if (level === 'error') console.error(line, data ?? '');
  else if (level === 'warn') console.warn(line, data ?? '');
  else console.log(line, data ?? '');

  try {
    fs.appendFileSync(LOG_FILE, line + (data !== undefined ? ' ' + JSON.stringify(data) : '') + '\n');
  } catch {
    /* không để lỗi ghi file làm chết luồng chính */
  }

  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      /* listener lỗi không ảnh hưởng module khác */
    }
  }
}

export const log = {
  info: (s: string, m: string, d?: unknown) => audit('info', s, m, d),
  action: (s: string, m: string, d?: unknown) => audit('action', s, m, d),
  warn: (s: string, m: string, d?: unknown) => audit('warn', s, m, d),
  error: (s: string, m: string, d?: unknown) => audit('error', s, m, d),
};
