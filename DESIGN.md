# Osprey Fingerbot Control Panel — Design Doc

> Trạng thái: **DRAFT** — chờ Jay xác nhận phần *center management* và vài thông số vận hành.
> Mục tiêu tài liệu: thống nhất kiến trúc với sếp & Jay trước khi code.

---

## 1. Bối cảnh & Yêu cầu

Datacenter chạy ~**300 máy E300 miner**. Giá điện (ERCOT real-time SPP) đổi **mỗi 15 phút**.
Khi giá quá cao → **tắt miner** để giảm chi phí; khi giá về bình thường → **bật lại**.
Ngoài ra nhà cung cấp điện đôi khi **yêu cầu cắt tải (curtailment)** → phải phản hồi **trong vài phút**.

Việc cắt/cấp điện vật lý thực hiện bằng **fingerbot** gạt cầu dao của từng máy.

### Yêu cầu gốc (từ sếp)
- Theo dõi giá điện liên tục (nguồn: ERCOT real-time SPP, cập nhật 15 phút).
- Giá cao → tắt các cầu dao, **tuần tự từng cái** (không cắt đồng loạt).
- Giá về bình thường → cấp điện lại.
- Có trường hợp lưới yêu cầu cắt tải → phản hồi trong vài phút.

### Yêu cầu bổ sung (từ Jay)
Trước khi cắt điện vật lý, phải gọi **center management** để:
1. **Giảm clock** miner (hạ xung nhịp/hashrate, giảm tải từ từ),
2. **Tắt mềm (soft shutdown)** miner,
3. **Rồi mới** dùng fingerbot cắt cầu dao.

→ Fingerbot là **bước cuối**, tránh cắt phũ làm hỏng miner / mất việc đang đào / gây inrush.

---

## 2. Topology phần cứng

> **SCOPE THỰC TẾ (Phase 1):** **12 fingerbot / 6 switch** (mỗi switch = 1 cặp 2 fingerbot nhấn đồng thời).
> UI: **6 nút**, mỗi nút điều khiển 1 cặp = 1 switch. **2 ngưỡng giá**: `switch_off_cost` & `switch_on_cost` (hysteresis).
> Con số 300 miner / 600 fingerbot bên dưới là **tầm nhìn mở rộng** sau này. Ở quy mô 12 con:
> tắt/bật tuần tự 6 switch thừa thời gian; **keep-warm 12 con khả thi** (giữ phản hồi nhanh + đồng thời);
> chưa cần lo bài toán scale lớn.


```
Site
 └─ Miner E300        × 300
      ├─ minerId                         (định danh trong center management)
      └─ Switch (cầu dao riêng, cứng)
           ├─ fingerbot A (device_id Tuya)
           └─ fingerbot B (device_id Tuya)   ← 2 con nhấn ĐỒNG THỜI để cộng lực
```

- **1 E300 = 1 switch = 2 fingerbot** → tổng **600 fingerbot**.
- 2 fingerbot/switch phải nhấn **đồng thời** (switch cứng, 1 con không đủ lực).
- 600 fingerbot RF → cần **nhiều gateway** (mỗi gateway gánh vài chục con) → ước ~10–20 gateway, chia theo khu vực + tầm sóng RF.

### Mô hình Switch LINH HOẠT — "mỗi trạng thái → danh sách lệnh"
KHÔNG hardcode "2 con cùng giá trị". Mỗi switch định nghĩa tập lệnh để **ON** và để **OFF**; mỗi lệnh = `(device_id, value)`.
Bộ thực thi chỉ làm 1 việc: *muốn trạng thái X → chạy danh sách lệnh X (parallel/sequential) → verify*.
→ **Đổi kiểu lắp = sửa config, KHÔNG sửa code.** Mỗi switch có thể một kiểu khác nhau.
```json
{ "id":"sw1", "name":"Atomat 1", "fireMode":"parallel",
  "on":  [ {"device":"A","value":true},  {"device":"B","value":true}  ],
  "off": [ {"device":"A","value":false}, {"device":"B","value":false} ] }
```
3 preset lắp đặt (đều chỉ là config):
- **A — Cộng lực** (2 con cùng chiều, parallel): on=[A:true,B:true] / off=[A:false,B:false]. Khi atomat cứng, 1 con không đủ lực.
- **B1 — Cặp đối nhau** (2 con khác giá trị, parallel): on=[A:true,B:false] / off=[A:false,B:true]. 1 con đẩy ON, 1 con đẩy OFF.
- **B2 — Riêng lẻ** (1 con/chiều, KHÔNG cần đồng thời): on=[ON_bot:true] / off=[OFF_bot:true]. Gọn & tin cậy nhất —
  NHƯNG cần 1 con đủ lực gạt 1 chiều (test thực tế; nếu vẫn cứng → 2 con/chiều = 4 con/atomat).

Dashboard setup: chọn **preset** → gán device_id cho từng vai trò → backend tự sinh `on`/`off` actions.

---

## 3. Kiến trúc tổng thể

```
                    ┌─────────────────────────────────────────────┐
                    │            CONTROL PANEL (Node/TS)           │
                    │                                              │
  ERCOT SPP  ──────▶│  Price Poller ──▶ Decision Engine            │
  (15 phút)         │                     │  (ngưỡng + hysteresis) │
                    │                     ▼                        │
  Curtailment ─────▶│  Emergency Endpoint ─▶ Orchestrator/Queue    │
  (webhook/manual)  │                     │   (tuần tự từng switch)│
                    │          ┌──────────┴───────────┐            │
                    │          ▼                      ▼            │
                    │  Center Mgmt Client      Tuya Cloud Client   │
                    │  (giảm clock/tắt miner)  (gạt fingerbot)      │
                    │          │                      │            │
                    │  State Store + Logs   Battery/Online Monitor │
                    └──────────┼──────────────────────┼────────────┘
                               ▼                      ▼
                    Center Management API      Tuya Cloud OpenAPI
                    (hệ quản lý miner)         openapi.tuyaus.com
                               │                      │
                          E300 miners          Gateway → RF → fingerbot
```

**Web Dashboard** (cùng app) cung cấp: giá hiện tại, trạng thái từng switch/miner/fingerbot,
pin & online từng fingerbot, cấu hình ngưỡng/delay, manual override, **nút khẩn cấp**, lịch sử log.

---

## 4. Thành phần Backend

| Module | Trách nhiệm |
|---|---|
| **Price Poller** | Lấy giá ERCOT SPP (mỗi vài phút), parse đúng Settlement Point, đẩy vào Decision Engine. |
| **Decision Engine** | So giá với ngưỡng tắt/bật + **hysteresis** + thời gian ổn định; quyết định CẮT / CẤP. |
| **Orchestrator / Queue** | Thực thi lệnh **tuần tự từng switch** (one-by-one), có delay; retry khi lỗi. |
| **Center Mgmt Client** | Giảm clock, soft-off, restart miner (API chờ Jay). |
| **Tuya Cloud Client** | Lấy token, ký HMAC, `Send Commands` gạt fingerbot, `Get Status` đọc pin/online. |
| **Emergency Endpoint** | Nhận lệnh curtailment → đường ưu tiên tuyệt đối, bỏ qua logic giá. |
| **State Store** | Trạng thái mong muốn vs thực tế của từng switch/miner; chống lệnh trùng. |
| **Battery/Online Monitor** | Theo dõi `battery_percentage` + online từng fingerbot, cảnh báo sớm. |
| **Logger/Audit** | Ghi mọi quyết định & lệnh (ai/cái gì/khi nào/kết quả) để truy vết. |

---

## 5. Các luồng điều khiển

> **Đã kiểm chứng (PoC, fingerbot Tuya chuẩn):** verify+retry (gửi thưa + poll trạng thái) đưa được
> con đang ngủ về đúng trạng thái sau **~15s / 2 lần gửi**, xác nhận `ok`. → Giải quyết lỗi "không trigger".
> **Hệ quả thời gian:** ~15s/con khi ngủ → tắt **thuần tuần tự 300 con ≈ 75 phút** → KHÔNG đạt curtailment
> "trong vài phút". Phải tắt **theo NHÓM song song** (trong giới hạn điện) + **wake mồi cả nhóm trước**.
> **Đã kiểm chứng:** con ĐANG NGỦ → chậm (~12–27s, cần retry); con ĐANG THỨC → bắn song song **nhanh ~700ms
> & gần đồng thời (~16ms)**. → Pattern production: (1) gửi lệnh MỒI đánh thức cả nhóm → chờ ~4s →
> (2) gửi lệnh thật + verify → con nào cũng thức → nhanh + đồng thời. (Xem cờ `--prime` trong `toggle-both.mjs`.)
> **Giá trị đã kiểm chứng:** prime wait ~**6s** đủ đánh thức con ngủ sâu → sau đó confirm xong ~3s/1 lệnh, lệch ~1ms.
> (4s đôi khi chưa đủ.) Giá trị này cần **tinh chỉnh theo môi trường RF/khoảng cách gateway** khi triển khai thật.
> Verify qua DP `switch` = con tự báo (chưa chắc cầu dao đã gạt) → production nên xác nhận bằng **đo công suất thật**.

### 5.1 Tắt (giá cao)
```
1. Giá ERCOT > NGƯỠNG_TẮT, giữ ổn định ≥ T_xác_nhận phút
2. for each switch in danh_sách (TUẦN TỰ):
     a. Center Mgmt: giảm clock miner
     b. Center Mgmt: soft shutdown miner
     c. Chờ xác nhận miner idle/off
     d. Fingerbot A + B: nhấn ĐỒNG THỜI cắt cầu dao   (Promise.all)
     e. Xác nhận (Get Status / đo công suất) → chờ DELAY_SWITCH → switch kế tiếp
```

### 5.2 Bật lại (giá bình thường)
```
1. Giá < NGƯỠNG_BẬT (NGƯỠNG_BẬT < NGƯỠNG_TẮT → hysteresis), giữ ổn định ≥ T_xác_nhận
2. for each switch in danh_sách (TUẦN TỰ — tránh inrush khi cả dàn khởi động):
     a. Fingerbot A + B: nhấn đồng thời BẬT cầu dao
     b. Center Mgmt: khởi động lại miner, ramp clock lên dần
     c. Chờ DELAY_SWITCH → switch kế tiếp
```

### 5.3 Khẩn cấp (curtailment từ lưới)
```
- Ưu tiên TUYỆT ĐỐI, bỏ qua logic giá.
- Phản hồi trong vài phút → rút ngắn delay, có thể chạy nhiều switch song song hơn nếu điện cho phép.
- Vẫn cố graceful (giảm clock → soft off → fingerbot) nếu kịp thời gian.
- Kích hoạt: nút trên dashboard + (lý tưởng) webhook/API từ nhà cung cấp.
```

---

## 6. Tích hợp Tuya Cloud (ĐÃ KIỂM CHỨNG ✅)

Đã test thành công bằng thiết bị thật qua API Explorer:
- Data center: **Western America** → base URL `https://openapi.tuyaus.com`
- Auth: token (`GET /v1.0/token?grant_type=1`) + ký `HMAC-SHA256`.
- Đọc trạng thái: `GET /v1.0/iot-03/devices/{device_id}/status`
- Gửi lệnh: `POST /v1.0/iot-03/devices/{device_id}/commands`

**DP codes của fingerbot** (xác nhận từ Get Status thực tế):
| code | kiểu | ý nghĩa |
|---|---|---|
| `switch` | bool | **TUYỆT ĐỐI/idempotent** (đã kiểm chứng trên fingerbot Tuya): `true`=ấn, `false`=nhả; gửi trùng giá trị → đứng yên → **retry an toàn** |
| `arm_up_percent` | 0–180 | góc vị trí **nhả** |
| `arm_down_percent` | 0–180 | góc vị trí **ấn** |
| `click_sustain_time` | ms | thời gian giữ trước khi bật về (mode button) |
| `mode` | enum | switch / long_press (button) |
| `battery_percentage` | 0–100 | pin (đo lúc nghỉ) |
| `charge_status` | enum | trạng thái sạc |

**Lưu ý quan trọng về phần cứng test**: PoC hiện chạy bằng **fingerbot Tuya chuẩn** (off-the-shelf),
KHÔNG phải firmware Osprey trong `Firmware/`. Hành vi DP (`switch` absolute, sleep/wake) do Tuya quyết định.
Khi lên sản phẩm Osprey thật thì hành vi firmware có thể khác (vd chốt pin-dưới-tải, master/slave) — đánh giá lại lúc đó.

### 6.1 Nhấn 2 fingerbot "đồng thời"

**Kết quả test thực tế (2 fingerbot chung 1 gateway, chạy không tải):**
- Bắn 2 `Send Commands` **song song** (`Promise.all`) → cả 2 nhấn **gần như cùng lúc**, lệch ~**30–68ms**
  (đủ để cộng lực nếu 2 con giữ vị trí). → Cách đơn giản **về cơ bản chạy được**.
- **NHƯNG không 100% tin cậy**: quan sát thấy thỉnh thoảng **rớt gói RF** (1 trong 2 con không nhận lệnh
  dù cloud trả `success:true`) — do RF bán song công qua **gateway chung**. Bắn từng con riêng / tuần tự
  có delay thì cả 2 luôn chạy.

**Hệ quả thiết kế:**
- **Mặc định:** bắn song song + cấu hình 2 con **mode giữ vị trí** (không tự nhả sớm) để lực chồng nhau.
- **BẮT BUỘC có verify + retry:** sau khi bắn, **đọc lại trạng thái / đo công suất** xác nhận cả 2 đã
  actuate; con nào trượt thì **bắn lại**. Không tin `success:true` của cloud là đã actuate vật lý.
- **Plan B (độ tin cậy/đồng thời cao hơn):** ghép **master/slave** ở firmware gateway Osprey
  (firmware có sẵn `MASTER_DEVICE`/`SLAVE_DEVICE`/`PRE_DUAL_DEVICE_PAIR`) → cloud gửi **1 lệnh** tới master,
  master kích slave qua RF ngang hàng → đồng thời thật, gateway không phải relay 2 gói → hết rớt.
  *Cần hỏi Jay xem ghép được không.*

**CHƯA test (quan trọng):** cộng lực trên **cầu dao E300 cứng thật** (mới chỉ test không tải).
Cần gắn 2 con vào 1 switch thật, bắn song song, xác nhận gạt nổi & `ADC_Check` không chặn dưới tải nặng.

---

## 7. Nguồn giá ERCOT

- Sếp đưa: `https://www.ercot.com/content/cdr/html/<YYYYMMDD>_real_time_spp.html` (ngày trong URL đổi mỗi ngày).
- Trang HTML chứa giá Settlement Point Price cho nhiều điểm, cập nhật ~15 phút.
- Backend: dựng URL theo ngày → fetch → parse bảng → lấy **đúng Settlement Point** của datacenter.
- **Cần xác nhận**: Settlement Point / Load Zone nào ứng với site. (Cân nhắc dùng ERCOT API/MIS chính thức thay HTML cho ổn định.)

---

## 8. Độ tin cậy & Fail-safe

- **Điều khiển mù**: API trả `success` chỉ nghĩa *lệnh đã gửi*, không chắc cầu dao đã chuyển.
  → Nên có **phản hồi xác nhận** (đo công suất từng máy / cảm biến) để biết đã tắt thật.
- **Fingerbot NGỦ khi idle**: để yên lâu → fingerbot vào sleep; **lệnh đầu tiên thường chỉ đánh thức,
  cú actuate bị lỡ** → phải gửi lại. Cloud vẫn trả `success:true`. → **BẮT BUỘC verify+retry**: gửi → đọc
  lại `switch` → chưa đổi thì gửi lại tới khi khớp (xem `confirmSwitch` trong `scripts/toggle-both.mjs`).
  Cân nhắc thêm: lệnh "wake" mồi trước, hoặc heartbeat giữ thức (đánh đổi pin) — hỏi Jay về chu kỳ sleep firmware.
- **Pin yếu**: theo dõi `battery_percentage` + thử-tải; cảnh báo & lên lịch sạc/thay trước khi trượt lệnh.
- **Mất mạng/cloud/gateway**: định nghĩa trạng thái an toàn khi nghi ngờ (đề xuất: ưu tiên *tắt*,
  vì rủi ro hoá đơn/phạt curtailment > rủi ro dừng đào tạm). **Chờ chốt với sếp.**
- **Retry + idempotency**: lệnh có timeout + thử lại; tránh bắn trùng gây gạt qua gạt lại.
- **Audit log**: ghi mọi quyết định/lệnh để truy vết và đối soát.

---

## 9. Tech stack đề xuất

- **Backend**: Node.js + TypeScript (đồng bộ với miniapp). HTTP server (Fastify/Express).
- **Scheduler/Queue**: hàng đợi nội bộ để tuần tự hoá theo switch (BullMQ hoặc queue đơn giản in-memory + persist).
- **State/Log**: SQLite/Postgres (tuỳ quy mô) + file log.
- **Web Dashboard**: React/Next.js (hoặc thuần React) gọi API backend.
- **Tuya**: tự ký HMAC (đã có mẫu) hoặc `tuya-connector-nodejs`.

---

## 10. Lộ trình

1. **PoC điều khiển** ✅ — đã gạt được fingerbot qua Cloud API (thực địa).
2. **Test 2 fingerbot/switch** — bắn song song trên cầu dao cứng thật; chốt cần master/slave hay không.
3. **Tuya client + device registry** — quản 600 device_id, map switch↔cặp fingerbot↔minerId.
4. **Price poller + decision engine** — ERCOT + ngưỡng/hysteresis.
5. **Orchestrator** — tuần tự từng switch, tích hợp center management (chờ Jay).
6. **Emergency path** — curtailment.
7. **Dashboard** — giám sát + cấu hình + manual override.
8. **Hardening** — fail-safe, retry, monitor pin/online, audit.

---

## 11. Câu hỏi mở (cần Jay / sếp)

1. **Center management là hệ gì?** API để *giảm clock*, *soft shutdown*, *restart* miner ra sao? (xác thực, endpoint, định danh miner) — **mảnh thiếu lớn nhất.**
2. **Settlement Point** nào trên ERCOT ứng với datacenter?
3. **Ngưỡng giá** tắt & bật ($/MWh)? Biên hysteresis? Thời gian xác nhận ổn định?
4. **Delay** giữa các switch khi tắt/bật tuần tự?
5. **Fail-safe**: mất mạng/cloud/pin yếu → miner về trạng thái nào?
6. **Curtailment** đến qua kênh nào (người/email/API)? SLA thời gian phản hồi cụ thể?
7. **Gateway**: model nào, gánh tối đa bao nhiêu fingerbot, bố trí ra sao cho 600 con?
8. **Phản hồi công suất**: có đo được công suất/ trạng thái thật từng máy E300 để xác nhận đã tắt không?
