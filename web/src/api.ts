/** api.ts — Kiểu dữ liệu snapshot + helper gọi REST backend. */

export interface DeviceStatus {
  deviceId: string;
  online: boolean | null;
  battery: number | null;
  switchValue: boolean | null;
}

export interface SwitchView {
  id: string;
  name: string;
  minerId: string | null;
  preset: 'A' | 'B1' | 'B2';
  fireMode: 'parallel' | 'sequential';
  desired: 'on' | 'off' | 'unknown';
  devices: DeviceStatus[];
}

export interface PricePoint {
  price: number;
  intervalEnding: string;
  settlementPoint: string;
  source: string;
  fetchedAt: string;
}

export interface Settings {
  switchOffCost: number;
  switchOnCost: number;
  confirmMinutes: number;
  settlementPoint: string;
  delaySwitchMs: number;
  autoControl: boolean;
}

export interface DecisionState {
  recommendation: 'on' | 'off' | 'hold';
  lastPrice: number | null;
  lastIntervalEnding: string | null;
  updatedAt: string | null;
}

export interface Snapshot {
  controlMode: 'dry-run' | 'live';
  live: boolean;
  hasTuyaCredentials: boolean;
  priceSource: string;
  price: PricePoint | null;
  decision: DecisionState;
  settings: Settings;
  switches: SwitchView[];
  orchestrator: { busy: boolean; campaign: string | null; startedAt: string | null };
  serverTime: string;
}

export interface AuditEntry {
  ts: string;
  level: 'info' | 'action' | 'warn' | 'error';
  source: string;
  message: string;
}

async function jsonFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  });
  return (await res.json()) as T;
}

export const api = {
  state: () => jsonFetch<Snapshot>('/api/state'),
  audit: () => jsonFetch<AuditEntry[]>('/api/audit?limit=80'),
  switch: (id: string, target: 'on' | 'off') =>
    jsonFetch(`/api/switch/${id}`, { method: 'POST', body: JSON.stringify({ target }) }),
  all: (target: 'on' | 'off') =>
    jsonFetch('/api/all', { method: 'POST', body: JSON.stringify({ target }) }),
  emergency: () => jsonFetch('/api/emergency', { method: 'POST' }),
  putSettings: (s: Partial<Settings>) =>
    jsonFetch<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
  mockPrice: (price: number | null) =>
    jsonFetch('/api/mock/price', { method: 'POST', body: JSON.stringify({ price }) }),
};
