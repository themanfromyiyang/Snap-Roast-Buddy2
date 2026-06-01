# ESP32 WiFi 配网设计（AP + Captive Portal）

**日期：** 2026-06-01
**目标文件：** [hardware/esp32/snap_roast_print/snap_roast_print.ino](../../../hardware/esp32/snap_roast_print/snap_roast_print.ino)

## 背景

当前固件在源码中硬编码 WiFi SSID 和密码（[snap_roast_print.ino:42-43](../../../hardware/esp32/snap_roast_print/snap_roast_print.ino#L42-L43)），并在 `setup()` 里死循环等待连接（[L489-L493](../../../hardware/esp32/snap_roast_print/snap_roast_print.ino#L489-L493)）。换一台手机/热点就必须重新烧录固件，对终端用户不可接受。

本设计把 WiFi 凭据改为运行时配置：首次开机自动进入配网模式，用户用手机连接 ESP32 临时热点，在自动弹出的网页里选择真正的 WiFi 并输入密码，保存后设备重启并连接，**之后正常使用，配网页不再出现**。

## 用户决策汇总

| 项 | 决策 |
|---|---|
| 强制重配网触发 | 自动检测 + 长按硬件按钮 5 秒重置 |
| AP 模式手机端连接 | 用户手动连接 `SnapRoast-Setup`（手机系统层不允许网页自动切换 WiFi） |
| 配网页 WiFi 选择 | 扫描周围 WiFi，列表点击选择 |
| AP 热点密码 | 开放（无密码） |
| Vercel 网页侧改动 | 不动 |
| WiFi 掉线行为 | ESP32 后台自动重连，不进 AP 模式 |

## 状态机

```
┌─────────────────┐       NVS 无账密 / 连不上 / 长按重置        ┌─────────────────┐
│   STA 模式     │ ─────────────────────────────────────────────→ │   AP 模式      │
│ （正常工作）   │                                                 │ （配网中）     │
│                │                                                 │                │
│ 连用户 WiFi    │ ←─────────── 保存成功，自动重启 ──────────── │ 开热点          │
│ HTTP 打印服务  │                                                 │ SnapRoast-Setup│
│ MQTT 快门订阅  │                                                 │ 只跑配网页      │
│ 短按→MQTT     │                                                 │ 按键被忽略      │
│ 长按 5s→重置  │                                                 │                │
└─────────────────┘                                                 └─────────────────┘
```

**STA → AP 触发条件**（任一）：

- 开机时 NVS 没保存 SSID
- 开机时连保存的 WiFi 连续 15 秒失败
- 工作中长按硬件按钮 ≥ 5 秒（清 NVS + `ESP.restart()`）

**AP → STA**：用户在配网页点"保存"后，ESP32 写 NVS + 重启，下次开机走 STA 流程。

**STA 工作中掉线**：靠 ESP32 自带 WiFi 后台重连机制，**不进 AP**。

## 持久存储

使用 ESP32 `Preferences` 库（基于 NVS 分区，掉电不丢）：

```
namespace: "wifi"
  key "ssid"  → String
  key "pass"  → String
```

读不到 `ssid` 即视为首次启动，直接进 AP 模式（跳过 STA 尝试）。

## AP 模式网络栈

ESP32 同时跑三件事：

| 服务 | 端口 | 作用 |
|---|---|---|
| `WiFi.softAP("SnapRoast-Setup")` | — | 开放无密码热点，IP 固定 `192.168.4.1` |
| `DNSServer`（catch-all） | 53 | 所有域名解析到 `192.168.4.1`，触发 iOS/Android captive portal 探测 |
| `WebServer` | 80 | 处理 `/`、`/scan`、`/save`，以及 catch-all 路由（探测域名 302 跳到 `/`） |

效果：用户连上 `SnapRoast-Setup` → 系统探测 → DNS 命中 → ESP32 返回 302 → 手机系统弹出配网页。**用户不用手动输 IP。**

## 配网页（`GET /`）

单页静态 HTML，纯原生 JS（AP 模式无外网，禁止外部 CDN）。布局：

```
┌────────────────────────────────────┐
│   Snap Roast Buddy · 配置 WiFi    │
│                                    │
│   附近的 WiFi（点击选择）：       │
│   ┌──────────────────────────┐   │
│   │ 📶 iPhone on the beach  │   │
│   │ 📶 Xiaomi_5G            │   │
│   │ 📶 ChinaNet-xxxx        │   │
│   └──────────────────────────┘   │
│   [ 🔄 重新扫描 ]                 │
│                                    │
│   已选：iPhone on the beach       │
│   密码：[______________]          │
│   [ 保存并连接 ]                  │
└────────────────────────────────────┘
```

**前端逻辑：**

- 页面加载时 `fetch('/scan')` 拿 JSON 列表
- 点击列表项填入"已选"输入框
- 点"保存并连接" → `POST /save` body `{"ssid":"...","pass":"..."}`
- 收到 200 后前端把页面替换成"已保存，设备即将重启连接 WiFi，请把手机切回原热点"提示页

**ESP32 端 `POST /save` 流程：**

1. 解析 JSON body
2. 调 `saveCreds(ssid, pass)` 写入 NVS
3. 返回 `200 text/plain "ok"`（轻量，前端负责显示提示文案）
4. `delay(1500)` → `ESP.restart()`

**密码错误的回退：** 不在配网页里现场试连。直接信任输入 + 重启走 STA 流程；密码错则 15 秒超时后自动再进 AP 模式，用户重连 `SnapRoast-Setup` 即可。理由：若现场试连成功，AP 关闭后手机立即丢失与 ESP32 的连接，无法显示结果反馈。

**`/scan` 端点：** 调用 `WiFi.scanNetworks()`，按信号强度排序，返回 JSON：

```json
[
  {"ssid":"iPhone on the beach","rssi":-45},
  {"ssid":"Xiaomi_5G","rssi":-62}
]
```

去重（同 SSID 取最强信号），过滤空 SSID。

## 与现有代码的集成

### 删除 / 替换

| 现状位置 | 改动 |
|---|---|
| [L42-L43](../../../hardware/esp32/snap_roast_print/snap_roast_print.ino#L42-L43) 硬编码 `ssid` / `password` 常量 | 删除；改从 `Preferences` 读 |
| [L486-L497](../../../hardware/esp32/snap_roast_print/snap_roast_print.ino#L486-L497) 死循环等 WiFi | 改成 `tryConnectSavedWiFi(15000)` 函数，超时返回 false |
| [L499-L519](../../../hardware/esp32/snap_roast_print/snap_roast_print.ino#L499-L519) `server.begin()` + MQTT 初始化 | 包到 `enterStaMode()`，只在 STA 成功时调用 |

### 新增（同一 .ino 文件，不拆 .h）

```cpp
// --- WiFi 配置存储 ---
Preferences prefs;
String loadSavedSsid();
String loadSavedPass();
void   saveCreds(const String& ssid, const String& pass);
void   clearCreds();

// --- WiFi 模式切换 ---
bool tryConnectSavedWiFi(uint32_t timeoutMs);
void enterApMode();
void enterStaMode();
bool inApMode = false;

// --- 配网 WebServer 处理器（仅 AP 模式注册） ---
void handleConfigRoot();      // GET  /
void handleScan();            // GET  /scan
void handleSave();            // POST /save
void handleCaptiveRedirect(); // catch-all → 302 → /

// --- DNS captive ---
DNSServer dnsServer;

// --- 长按检测常量 ---
const uint32_t LONG_PRESS_MS = 5000;
uint32_t btnPressStartMs = 0;
bool     longPressFired  = false;
```

### `setup()` 重写

```cpp
void setup() {
  Serial.begin(115200);
  pinMode(DTR_PIN, INPUT_PULLUP);
  pinMode(BUTTON_PIN, INPUT);
  Printer.begin(57600, SERIAL_8N1, 1, 2);
  delay(500);

  prefs.begin("wifi", /*readOnly=*/false);
  String savedSsid = loadSavedSsid();

  if (savedSsid.length() > 0 && tryConnectSavedWiFi(15000)) {
    enterStaMode();
  } else {
    Serial.println(savedSsid.length() == 0 ? "未保存账密" : "保存的 WiFi 连不上");
    enterApMode();
  }
}
```

### `loop()` 按状态分支

```cpp
void loop() {
  if (inApMode) {
    dnsServer.processNextRequest();
    server.handleClient();
    buttonPollApMode();   // AP 模式下按钮无效
  } else {
    server.handleClient();
    mqttEnsureConnected();
    mqtt.loop();
    buttonPollStaMode();  // 短按 MQTT，长按 5s 重置
  }
}
```

### 长按 / 短按互斥逻辑（`buttonPollStaMode`）

带防抖（30ms）的边沿检测：

- **上升沿**（按下瞬间）：记 `btnPressStartMs = millis()`；`longPressFired = false`
- **持续按下 ≥ 5000ms 且 `!longPressFired`**：置 `longPressFired = true`；`Serial.println("长按 → 清 WiFi 配置")`；`clearCreds()`；`delay(200)`；`ESP.restart()`
- **下降沿**（松开）：若 `!longPressFired`，视为短按 → 走原 MQTT 发布逻辑（[L470-L475](../../../hardware/esp32/snap_roast_print/snap_roast_print.ino#L470-L475)）；否则忽略

短按和长按互斥：长按到 5 秒立即重启，松开时不会再触发短按 MQTT 发布。

### 不动的部分

- 全部打印相关代码：`doPrint`、`handlePrintPost`、`handlePrintGet`、`handlePrintBridge`、`handlePrintRaster`、`handlePrintChunk`、`streamBase64ToPrinter`、`waitPrinterReady`、CORS/OPTIONS、DTR 处理
- MQTT 配置常量与 `mqttEnsureConnected`
- 短按 MQTT 发布的内部逻辑（仅搬位置进 `buttonPollStaMode`）

## 用户文档

在 [hardware/esp32/snap_roast_print/](../../../hardware/esp32/snap_roast_print/) 目录追加或新建一份简短 README，包含：

> **首次使用 / 换 WiFi：** 通电后等 15 秒，若设备未连上保存的 WiFi 会自动开热点 `SnapRoast-Setup`。用手机连这个热点（无密码），系统会自动弹出配网页；若没弹，浏览器访问 `http://192.168.4.1`。在列表里选你的手机热点，输密码，点保存。设备会自动重启并连接，之后正常使用打印按钮。
>
> **强制重新配网（换手机时）：** 设备运行时长按硬件按钮 **5 秒**，会清除已保存的 WiFi 并重新进入配网热点模式。

## 测试计划

无法用单元测试（嵌入式 .ino），采用手工验收：

1. **首次烧录**：擦 NVS（或新烧录），上电 → 应看到串口"未保存账密"→ AP 启动 → 手机能看到 `SnapRoast-Setup` → 连上后弹出配网页 → 扫描列表非空 → 选 WiFi 输密码 → 保存 → 重启 → 串口显示连上目标 WiFi 并打印 IP
2. **正常重启**：已配置好的设备重启 → 15 秒内连上 → HTTP 端口可访问 `/ping` → MQTT 订阅生效
3. **保存的 WiFi 不可达**：把手机热点关掉再上电 → 串口 15 秒后超时 → 自动进 AP 模式
4. **密码错误回退**：故意输错密码保存 → 重启 → 15 秒超时 → 自动回 AP 模式
5. **长按重置**：正常工作中按住按钮 5 秒 → 串口显示清配置 → 重启 → 进 AP 模式
6. **短按打印不受影响**：STA 模式下短按按钮 → 仍能通过 MQTT 触发原快门/打印行为
7. **打印功能回归**：STA 模式下从 Vercel 页面打印一张位图 → `/print-chunk` 走通 → 打印机出纸

## 不在本次范围

- 多套 WiFi 凭据轮询
- AP 模式下任何打印或 MQTT 功能
- Vercel 网页侧任何改动
- 二维码方式辅助加入 AP（用户当前接受手动连接，先不做）
- WPS 一键配网
- 蓝牙 / SmartConfig / ESP-Touch 配网（库依赖大，AP 模式已足够覆盖场景）
