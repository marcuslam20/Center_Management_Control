/**
 * tuya/client.ts — Tuya Cloud client (port từ scripts/toggle-both.mjs, đã kiểm chứng hardware thật).
 * Token + ký HMAC-SHA256, getStatus, sendCommand, discoverDevices.
 *
 * Token được cache + tự refresh trước khi hết hạn.
 */
import crypto from 'node:crypto';
import { cfg } from '../config.js';
import type { FingerbotStatus, TuyaDeviceInfo, TuyaResponse, TuyaStatusItem } from './types.js';

const sha256 = (s: string): string => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function hmac(secret: string, s: string): string {
  return crypto.createHmac('sha256', secret).update(s, 'utf8').digest('hex').toUpperCase();
}

interface SignArgs {
  method: 'GET' | 'POST';
  path: string;
  body?: string;
  token?: string;
}

export class TuyaClient {
  private clientId: string;
  private clientSecret: string;
  private base: string;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(opts?: { clientId?: string; clientSecret?: string; base?: string }) {
    this.clientId = opts?.clientId ?? cfg.tuyaClientId;
    this.clientSecret = opts?.clientSecret ?? cfg.tuyaClientSecret;
    this.base = opts?.base ?? cfg.tuyaBase;
  }

  hasCredentials(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  // Tuya sign: HMAC-SHA256(clientId + [token] + t + nonce + stringToSign)
  // stringToSign = METHOD \n SHA256(body) \n [signHeaders] \n url   (nonce & signHeaders rỗng)
  private signedHeaders({ method, path, body = '', token = '' }: SignArgs): Record<string, string> {
    const t = Date.now().toString();
    const stringToSign = [method, sha256(body), '', path].join('\n');
    const sign = hmac(this.clientSecret, this.clientId + token + t + stringToSign);
    const h: Record<string, string> = {
      client_id: this.clientId,
      sign,
      t,
      sign_method: 'HMAC-SHA256',
    };
    if (token) h['access_token'] = token;
    if (body) h['Content-Type'] = 'application/json';
    return h;
  }

  private async request<T>(args: SignArgs): Promise<TuyaResponse<T>> {
    const init: RequestInit = {
      method: args.method,
      headers: this.signedHeaders(args),
    };
    if (args.body) init.body = args.body;
    const res = await fetch(this.base + args.path, init);
    return (await res.json()) as TuyaResponse<T>;
  }

  async getToken(force = false): Promise<string> {
    const now = Date.now();
    if (!force && this.token && now < this.tokenExpiresAt - 60_000) return this.token;
    if (!this.hasCredentials()) {
      throw new Error('Missing TUYA_CLIENT_ID / TUYA_CLIENT_SECRET — cannot obtain token.');
    }
    const path = '/v1.0/token?grant_type=1';
    const data = await this.request<{ access_token: string; expire_time: number }>({ method: 'GET', path });
    if (!data.success || !data.result) throw new Error('Token error: ' + JSON.stringify(data));
    this.token = data.result.access_token;
    this.tokenExpiresAt = now + (data.result.expire_time ?? 7200) * 1000;
    return this.token;
  }

  async getStatusRaw(deviceId: string): Promise<TuyaStatusItem[]> {
    const token = await this.getToken();
    const path = `/v1.0/iot-03/devices/${deviceId}/status`;
    const data = await this.request<TuyaStatusItem[]>({ method: 'GET', path, token });
    if (!data.success) throw new Error(`getStatus ${deviceId} failed: ${JSON.stringify(data)}`);
    return data.result ?? [];
  }

  /** Đọc + chuẩn hoá trạng thái 1 fingerbot (switch / battery / online). */
  async getFingerbotStatus(deviceId: string): Promise<FingerbotStatus> {
    const raw = await this.getStatusRaw(deviceId);
    const find = (code: string): unknown => raw.find((d) => d.code === code)?.value;
    const sw = find('switch');
    const bat = find('battery_percentage');
    const online = await this.isOnline(deviceId).catch(() => null);
    return {
      deviceId,
      online,
      switchValue: typeof sw === 'boolean' ? sw : null,
      battery: typeof bat === 'number' ? bat : null,
      raw,
    };
  }

  async isOnline(deviceId: string): Promise<boolean | null> {
    const token = await this.getToken();
    const path = `/v1.0/iot-03/devices/${deviceId}`;
    const data = await this.request<TuyaDeviceInfo>({ method: 'GET', path, token });
    if (!data.success || !data.result) return null;
    return data.result.online ?? null;
  }

  /** Đọc riêng giá trị DP `switch` (true/false/null). */
  async readSwitch(deviceId: string): Promise<boolean | null> {
    const raw = await this.getStatusRaw(deviceId);
    const v = raw.find((d) => d.code === 'switch')?.value;
    return typeof v === 'boolean' ? v : null;
  }

  /** Gửi lệnh `switch` (bool). DP idempotent/tuyệt đối → gửi trùng = no-op. */
  async sendSwitch(deviceId: string, value: boolean): Promise<TuyaResponse> {
    const token = await this.getToken();
    const path = `/v1.0/iot-03/devices/${deviceId}/commands`;
    const body = JSON.stringify({ commands: [{ code: 'switch', value }] });
    return this.request({ method: 'POST', path, body, token });
  }

  /** Liệt kê device trong project (cho dashboard setup/discovery). */
  async discoverDevices(): Promise<TuyaDeviceInfo[]> {
    const token = await this.getToken();
    // Endpoint cần asset/uid tuỳ project; dùng device list của user nếu có UID, fallback rỗng.
    const uid = cfg.env['TUYA_UID'];
    if (!uid) return [];
    const path = `/v1.0/users/${uid}/devices`;
    const data = await this.request<TuyaDeviceInfo[]>({ method: 'GET', path, token });
    return data.success && data.result ? data.result : [];
  }
}

export const tuya = new TuyaClient();
