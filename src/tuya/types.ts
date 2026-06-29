/** Kiểu dữ liệu Tuya Cloud API. */

export interface TuyaStatusItem {
  code: string;
  value: unknown;
}

export interface TuyaResponse<T = unknown> {
  success: boolean;
  result?: T;
  msg?: string;
  code?: number;
  t?: number;
}

export interface TuyaDeviceInfo {
  id: string;
  name?: string;
  online?: boolean;
  category?: string;
  product_name?: string;
}

/** Trạng thái đã chuẩn hoá của 1 fingerbot. */
export interface FingerbotStatus {
  deviceId: string;
  online: boolean | null;
  switchValue: boolean | null;
  battery: number | null;
  raw: TuyaStatusItem[];
}
