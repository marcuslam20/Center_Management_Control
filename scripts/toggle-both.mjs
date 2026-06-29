#!/usr/bin/env node
/**
 * toggle-both.mjs — Test bắn lệnh `switch` cho 2 fingerbot ĐỒNG THỜI (Promise.all)
 * để xem 2 con có cộng lực gạt được cầu dao E300 cứng không.
 *
 * KHÔNG hardcode secret. Truyền qua biến môi trường.
 *
 * Yêu cầu: Node 18+ (có global fetch & crypto).
 *
 * Cách chạy (Western America data center):
 *   export TUYA_CLIENT_ID=cpwvjxe5njpg5dvenuwx
 *   export TUYA_CLIENT_SECRET=<Access Secret của bạn>      # lấy ở Overview của project
 *   export TUYA_BASE=https://openapi.tuyaus.com            # WA; EU: openapi.tuyaeu.com; SG: openapi.tuyasg.com
 *   export DEVICE_A=ebe0bai6ermgli9e
 *   export DEVICE_B=ebb4aa111bhzaaw1
 *
 *   node toggle-both.mjs false     # gửi switch=false cho cả 2 (mỗi lệnh = 1 lần đảo tay đòn)
 *   node toggle-both.mjs true      # gửi switch=true  cho cả 2
 *   node toggle-both.mjs status    # chỉ đọc trạng thái 2 con (không điều khiển)
 *
 * Lưu ý: firmware này đảo tay đòn (Servo_Swap) với BẤT KỲ giá trị switch nào,
 * nên chạy lại lệnh là gạt qua/gạt lại. Quan sát 2 con có nhấn cùng nhau không.
 */

import crypto from 'node:crypto';

const CLIENT_ID = process.env.TUYA_CLIENT_ID;
const CLIENT_SECRET = process.env.TUYA_CLIENT_SECRET;
const BASE = process.env.TUYA_BASE || 'https://openapi.tuyaus.com';
const DEVICE_A = process.env.DEVICE_A || 'ebe0bai6ermgli9e';
const DEVICE_B = process.env.DEVICE_B || 'ebb4aa111bhzaaw1';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Thiếu TUYA_CLIENT_ID hoặc TUYA_CLIENT_SECRET (export trước khi chạy).');
  process.exit(1);
}

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (s) => crypto.createHmac('sha256', CLIENT_SECRET).update(s, 'utf8').digest('hex').toUpperCase();

// Tuya signature: sign = HMAC-SHA256(client_id + [access_token] + t + nonce + stringToSign)
// stringToSign = METHOD \n SHA256(body) \n [signHeaders] \n url    (nonce & signHeaders để rỗng)
function signedHeaders({ method, path, body = '', token = '' }) {
  const t = Date.now().toString();
  const stringToSign = [method, sha256(body), '', path].join('\n');
  const sign = hmac(CLIENT_ID + token + t + stringToSign);
  const h = { client_id: CLIENT_ID, sign, t, sign_method: 'HMAC-SHA256' };
  if (token) h.access_token = token;
  if (body) h['Content-Type'] = 'application/json';
  return h;
}

async function getToken() {
  const path = '/v1.0/token?grant_type=1';
  const res = await fetch(BASE + path, { headers: signedHeaders({ method: 'GET', path }) });
  const data = await res.json();
  if (!data.success) throw new Error('Token error: ' + JSON.stringify(data));
  return data.result.access_token;
}

async function getStatus(token, deviceId) {
  const path = `/v1.0/iot-03/devices/${deviceId}/status`;
  const res = await fetch(BASE + path, { headers: signedHeaders({ method: 'GET', path, token }) });
  return res.json();
}

async function sendSwitch(token, deviceId, value) {
  const path = `/v1.0/iot-03/devices/${deviceId}/commands`;
  const body = JSON.stringify({ commands: [{ code: 'switch', value }] });
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: signedHeaders({ method: 'POST', path, body, token }),
    body,
  });
  const data = await res.json();
  return { deviceId, ms: Date.now() - t0, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readSwitch = async (token, id) => {
  const s = await getStatus(token, id);
  return (s.result || []).find((d) => d.code === 'switch')?.value;
};

/*
 * confirmSwitch — gửi lệnh + ĐỌC LẠI trạng thái, retry tới khi `switch` == desired.
 * Khắc phục việc fingerbot ngủ làm lệnh đầu bị lỡ. Đây là PATTERN dùng cho production.
 * (Firmware đảo tay đòn theo mỗi lệnh, nên ta đọc trước, chỉ gửi khi chưa khớp → tự hội tụ.)
 */
const TIMEOUT_MS = parseInt(process.env.CONFIRM_TIMEOUT_MS || '30000', 10);
const RESEND_MS = parseInt(process.env.RESEND_MS || '5000', 10); // gửi lại dày hơn để bắt cửa sổ thức (an toàn nếu switch tuyệt đối)
const POLL_MS = parseInt(process.env.POLL_MS || '2500', 10);

async function confirmSwitch(token, id, desired, { timeoutMs = TIMEOUT_MS, resendMs = RESEND_MS, pollMs = POLL_MS } = {}) {
  let cur = await readSwitch(token, id);
  if (cur === desired) return { id, ok: true, sent: 0, final: cur };

  let sent = 0;
  let lastSend = -Infinity;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (Date.now() - lastSend >= resendMs) {
      await sendSwitch(token, id, desired); // gửi THƯA, không dồn lệnh
      sent++;
      lastSend = Date.now();
    }
    await sleep(pollMs);
    cur = await readSwitch(token, id); // poll trạng thái, chờ con thức
    console.log(`   ${id}: switch=${cur} (đã gửi ${sent}, ${((Date.now() - start) / 1000).toFixed(1)}s)`);
    if (cur === desired) return { id, ok: true, sent, final: cur };
  }
  return { id, ok: false, sent, final: cur };
}

/*
 * CLI:
 *   node toggle-both.mjs status              # đọc trạng thái cả 2
 *   node toggle-both.mjs a false             # CHỈ con A
 *   node toggle-both.mjs b false             # CHỈ con B
 *   node toggle-both.mjs both false          # cả 2 SONG SONG (mặc định nếu bỏ target)
 *   node toggle-both.mjs both false 1000     # cả 2 nhưng A trước, chờ 1000ms rồi B (tuần tự)
 */
(async () => {
  const argv = process.argv.slice(2);
  let target = 'both';
  if (['a', 'b', 'both'].includes(argv[0])) target = argv.shift();
  const cmd = argv[0] || 'false';
  const delay = parseInt(argv[1] || process.env.DELAY_MS || '0', 10);

  if (!['status', 'true', 'false', 'keepwarm'].includes(cmd)) {
    console.error(`Lệnh không hợp lệ: "${cmd}". Dùng: status | true | false | keepwarm`);
    process.exit(1);
  }

  let token = await getToken();
  console.log('✓ Lấy token OK\n');

  if (cmd === 'status') {
    for (const id of [DEVICE_A, DEVICE_B]) {
      const s = await getStatus(token, id);
      console.log(id, JSON.stringify(s.result || s));
    }
    return;
  }

  // keepwarm: mỗi N giây tái khẳng định trạng thái hiện tại (no-op vật lý) để giữ con luôn "ấm".
  // Mở 1 terminal chạy keepwarm, terminal khác bắn lệnh thật → xem có luôn nhanh không.
  if (cmd === 'keepwarm') {
    const intervalSec = parseInt(argv[1] || process.env.KEEPWARM_SEC || '30', 10);
    const ids = target === 'a' ? [DEVICE_A] : target === 'b' ? [DEVICE_B] : [DEVICE_A, DEVICE_B];
    console.log(`KEEP-WARM: mỗi ${intervalSec}s giữ thức ${ids.length} con (tái khẳng định trạng thái). Ctrl+C để dừng.\n`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        token = await getToken(); // refresh token mỗi vòng để khỏi hết hạn
        for (const id of ids) {
          const cur = await readSwitch(token, id);
          if (typeof cur === 'boolean') await sendSwitch(token, id, cur); // gửi lại giá trị hiện tại = không gạt
          console.log(`   ${id}: giữ thức (switch=${cur})`);
        }
      } catch (e) {
        // Lỗi mạng/tạm thời KHÔNG được làm chết vòng lặp 24/7 → log & tiếp tục
        console.log(`   ⚠️ lỗi tạm thời: ${e.message} — bỏ qua, thử lại vòng sau`);
      }
      await sleep(intervalSec * 1000);
    }
  }

  const value = cmd === 'true';

  // confirm: đảm bảo cả 2 con đạt trạng thái mong muốn, có verify + retry (chống ngủ)
  if (cmd === 'true' || cmd === 'false') {
    if (target === 'both' && process.argv.includes('--confirm')) {
      if (process.argv.includes('--prime')) {
        const primeWait = parseInt(process.env.PRIME_WAIT_MS || '4000', 10);
        console.log(`WAKE-PRIME: gửi mồi cả 2 con để đánh thức, chờ ${primeWait}ms...`);
        await Promise.all([sendSwitch(token, DEVICE_A, value), sendSwitch(token, DEVICE_B, value)]);
        await sleep(primeWait);
        console.log('→ Giờ gửi lệnh thật + verify (2 con đã thức):\n');
      }
      console.log(`CONFIRM switch=${value} cho cả A & B (verify + retry)...\n`);
      const [ra, rb] = await Promise.all([
        confirmSwitch(token, DEVICE_A, value),
        confirmSwitch(token, DEVICE_B, value),
      ]);
      console.log(`\nA ok=${ra.ok} (final=${ra.final}) | B ok=${rb.ok} (final=${rb.final})`);
      console.log(ra.ok && rb.ok ? '✅ Cả 2 đã xác nhận đúng trạng thái.' : '⚠️ Có con chưa đạt — kiểm tra pin/gateway.');
      return;
    }
  }

  if (target === 'a' || target === 'b') {
    const id = target === 'a' ? DEVICE_A : DEVICE_B;
    console.log(`Bắn switch=${value} CHỈ con ${target.toUpperCase()}=${id}...\n`);
    const r = await sendSwitch(token, id, value);
    console.log(`${target.toUpperCase()}  ${r.ms}ms  ${JSON.stringify(r.data)}`);
    console.log(`\n→ Con ${target.toUpperCase()} có nhúc nhích không?`);
    return;
  }

  // both
  if (delay > 0) {
    console.log(`Bắn switch=${value}: A trước → chờ ${delay}ms → B (TUẦN TỰ)...\n`);
    const ra = await sendSwitch(token, DEVICE_A, value);
    console.log(`A  ${ra.ms}ms  ${JSON.stringify(ra.data)}`);
    await sleep(delay);
    const rb = await sendSwitch(token, DEVICE_B, value);
    console.log(`B  ${rb.ms}ms  ${JSON.stringify(rb.data)}`);
    console.log(`\n→ Tuần tự có delay: CẢ 2 con có nhúc nhích không?`);
    return;
  }

  console.log(`Bắn switch=${value} cho A=${DEVICE_A} và B=${DEVICE_B} SONG SONG...\n`);
  const start = Date.now();
  const [ra, rb] = await Promise.all([
    sendSwitch(token, DEVICE_A, value),
    sendSwitch(token, DEVICE_B, value),
  ]);
  const wall = Date.now() - start;
  console.log(`A  ${ra.ms}ms  ${JSON.stringify(ra.data)}`);
  console.log(`B  ${rb.ms}ms  ${JSON.stringify(rb.data)}`);
  console.log(`\nTổng wall-clock 2 lệnh: ${wall}ms`);
  console.log(`Chênh thời gian hồi đáp A↔B: ${Math.abs(ra.ms - rb.ms)}ms`);
  console.log('\n→ Nhìn 2 fingerbot: có nhấn gần như cùng lúc & gạt nổi cầu dao không?');
})().catch((e) => {
  console.error('Lỗi:', e.message);
  process.exit(1);
});
