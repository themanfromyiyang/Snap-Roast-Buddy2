
// Snap Roast Buddy - WiFi 打印验证 sketch
//
// 在你已经跑通的 WiFi 连接 + Printer.println("Hello") 基础上扩展：
//   - 启动后连接手机热点（同你之前那段代码）
//   - 启动 HTTP 服务器，监听 80 端口
//   - GET  /print?text=...  : 给 HTTPS 页面顶层跳转用（HTTPS→HTTP 顶层跳转浏览器放行）
//   - POST /print           : body 是纯文本（给本地 HTTP 页面 fetch 用）
//   - GET  /ping            : 浏览器健康探测
//   - GET  /                : 简单状态页（IP / RSSI）
// ESP32 同时把收到的文本输出到 Serial（监视器）和打印机。
//
// 注意：打印机硬件本身有没有中文字库未知。如果中文乱码，是芯片字库问题，不是传输问题。
//      验证传输只需看 Serial 监视器里收到的是不是你发的字符串。
//
// 接线（同你之前的代码）：
//   打印机 TX → ESP32 GPIO1 (RX)
//   打印机 RX → ESP32 GPIO2 (TX)
//   打印机 VH → 独立 5-9V 电源（不要从 ESP32 取电）
//   打印机 GND ↔ ESP32 GND 共地

#include <WiFi.h>
#include <WebServer.h>
#include <HardwareSerial.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <DNSServer.h>

// ---- 硬件快门按钮 + MQTT 中转 ----
#define BUTTON_PIN 4
#define BUTTON_DEBOUNCE_MS 30
const char* MQTT_HOST = "broker.emqx.io";
const int   MQTT_PORT = 8883;                                      // 原生 MQTT over TLS
const char* MQTT_TOPIC = "snap-roast/db298f0eed7aa043/shutter";    // 与浏览器端必须一致

static WiFiClientSecure mqttNet;
static PubSubClient     mqtt(mqttNet);

static int      btnLastLevel  = LOW;
static uint32_t btnLastEdgeMs = 0;
static uint32_t mqttLastTryMs = 0;

// ---- WiFi 配网相关 ----
static Preferences prefs;
static DNSServer   dnsServer;
static bool        inApMode = false;
static const uint32_t LONG_PRESS_MS = 5000;
static uint32_t btnPressStartMs = 0;
static bool     longPressFired  = false;
static const uint32_t STA_CONNECT_TIMEOUT_MS = 15000;
static const char* AP_SSID = "SnapRoast-Setup";

// 打印机 DTR 接 ESP32 GPIO 41（硬件流控）
// MY-628 DTR：打印机输出，告诉主机自己是否能接收数据
// 约定（最常见 ESC/POS）：LOW = READY（可接收），HIGH = BUSY（缓冲将满）
// 若实测发现极性反了（一直卡在 BUSY 或所有字节都不等就发），把 DTR_BUSY_LEVEL 改成 LOW
#define DTR_PIN              41
#define DTR_BUSY_LEVEL       HIGH
#define DTR_WAIT_TIMEOUT_MS  500

static uint32_t dtrTimeoutCount = 0;

// ---- WiFi 凭据持久化（NVS / Preferences namespace="wifi"） ----
static String loadSavedSsid() {
  return prefs.getString("ssid", "");
}
static String loadSavedPass() {
  return prefs.getString("pass", "");
}
static void saveCreds(const String& ssid, const String& pass) {
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  Serial.print("已保存 SSID: ");
  Serial.println(ssid);
}
static void clearCreds() {
  prefs.remove("ssid");
  prefs.remove("pass");
  Serial.println("已清除保存的 WiFi 凭据");
}

// 全局打印机串口 + WebServer 实例。声明位置必须早于下面任何 handler，
// 因为后续 handler 函数在文本顺序上引用 `server`（C++ 全局变量按文本可见性解析）。
HardwareSerial Printer(1);
WebServer server(80);

// ---- AP 模式：配网 Web handler ----
static void handleConfigRoot() {
  sendCors();
  String html;
  html.reserve(4096);
  html += "<!doctype html><html lang=\"zh-CN\"><head>";
  html += "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">";
  html += "<title>Snap Roast · 配置 WiFi</title><style>";
  html += "*{box-sizing:border-box}body{font-family:-apple-system,'PingFang SC',sans-serif;padding:20px;max-width:480px;margin:0 auto;background:#f7f7f7;color:#222}";
  html += "h1{font-size:20px;margin:8px 0 16px}";
  html += ".panel{background:#fff;padding:16px;border-radius:10px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}";
  html += ".list{max-height:240px;overflow:auto;border:1px solid #eee;border-radius:8px}";
  html += ".item{padding:10px 12px;border-bottom:1px solid #f0f0f0;cursor:pointer;display:flex;justify-content:space-between;align-items:center}";
  html += ".item:last-child{border-bottom:none}.item:active{background:#eef}.item.sel{background:#e6f0ff}";
  html += ".rssi{color:#888;font-size:12px}";
  html += "label{display:block;font-size:13px;color:#666;margin-top:10px}";
  html += "input{width:100%;padding:10px;font-size:15px;border:1px solid #ddd;border-radius:6px;margin-top:4px}";
  html += "button{width:100%;padding:12px;font-size:15px;border:none;border-radius:8px;background:#06f;color:#fff;margin-top:16px;cursor:pointer}";
  html += "button.secondary{background:#888;margin-top:8px}.muted{color:#666;font-size:13px;margin-top:8px}";
  html += "#status{margin-top:12px;font-size:13px;color:#06a}#status.err{color:#c00}";
  html += "</style></head><body>";
  html += "<h1>Snap Roast Buddy · 配置 WiFi</h1>";
  html += "<div class=\"panel\"><div>附近的 WiFi（点击选择）：</div>";
  html += "<div id=\"list\" class=\"list\"><div class=\"muted\" style=\"padding:12px\">扫描中...</div></div>";
  html += "<button class=\"secondary\" onclick=\"loadScan()\">🔄 重新扫描</button></div>";
  html += "<div class=\"panel\">";
  html += "<label>已选 SSID</label><input id=\"ssid\" placeholder=\"点上面列表，或手动输入\">";
  html += "<label>密码</label><input id=\"pass\" type=\"password\" placeholder=\"WiFi 密码\">";
  html += "<button onclick=\"save()\">保存并连接</button>";
  html += "<div id=\"status\"></div></div>";
  html += "<script>";
  html += "const $=(id)=>document.getElementById(id);";
  html += "async function loadScan(){const l=$('list');l.innerHTML='<div class=\"muted\" style=\"padding:12px\">扫描中...</div>';";
  html += "try{const r=await fetch('/scan');const arr=await r.json();";
  html += "if(!arr.length){l.innerHTML='<div class=\"muted\" style=\"padding:12px\">未扫描到 WiFi</div>';return;}";
  html += "l.innerHTML='';arr.forEach(n=>{const d=document.createElement('div');d.className='item';";
  html += "d.innerHTML='<span>📶 '+n.ssid.replace(/</g,'&lt;')+'</span><span class=\"rssi\">'+n.rssi+' dBm</span>';";
  html += "d.onclick=()=>{document.querySelectorAll('.item').forEach(x=>x.classList.remove('sel'));d.classList.add('sel');$('ssid').value=n.ssid;$('pass').focus();};";
  html += "l.appendChild(d);});}catch(e){l.innerHTML='<div class=\"muted err\" style=\"padding:12px\">扫描失败: '+e.message+'</div>';}}";
  html += "async function save(){const s=$('status');s.classList.remove('err');";
  html += "const ssid=$('ssid').value.trim();const pass=$('pass').value;";
  html += "if(!ssid){s.textContent='请先选择或输入 SSID';s.classList.add('err');return;}";
  html += "s.textContent='保存中...';";
  html += "try{const r=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ssid,pass})});";
  html += "if(!r.ok){const t=await r.text();s.textContent='保存失败 HTTP '+r.status+': '+t;s.classList.add('err');return;}";
  html += "document.body.innerHTML='<h1>✅ 已保存</h1><div class=\"panel\"><p>设备即将重启并连接 <b>'+ssid+'</b>。</p><p>请把手机 WiFi 切回原热点，等设备约 15 秒。</p></div>';";
  html += "}catch(e){s.textContent='请求出错: '+e.message;s.classList.add('err');}}";
  html += "loadScan();";
  html += "</script></body></html>";
  server.send(200, "text/html; charset=utf-8", html);
}

// 扫描周围 WiFi，返回 JSON 数组 [{ssid,rssi}]，按 RSSI 降序去重
static void handleScan() {
  sendCors();
  Serial.println("/scan 开始扫描...");
  int n = WiFi.scanNetworks(/*async=*/false, /*show_hidden=*/false);
  Serial.printf("/scan 扫到 %d 个网络\n", n);

  // 按 RSSI 降序排序索引，n 通常 < 30，插入排序足够。
  // 同 SSID 取最强信号那一条（排序后遇到重复 SSID 必然更弱，直接跳过）。
  const int MAX_SCAN = 64;
  int idx[MAX_SCAN];
  int count = n > MAX_SCAN ? MAX_SCAN : (n < 0 ? 0 : n);
  for (int i = 0; i < count; i++) idx[i] = i;
  for (int i = 1; i < count; i++) {
    int key = idx[i];
    int32_t keyRssi = WiFi.RSSI(key);
    int j = i - 1;
    while (j >= 0 && WiFi.RSSI(idx[j]) < keyRssi) {
      idx[j + 1] = idx[j];
      j--;
    }
    idx[j + 1] = key;
  }

  String resp = "[";
  bool first = true;
  for (int k = 0; k < count; k++) {
    int i = idx[k];
    String s = WiFi.SSID(i);
    if (s.length() == 0) continue;
    int32_t rssi = WiFi.RSSI(i);
    bool dup = false;
    for (int kk = 0; kk < k; kk++) {
      if (WiFi.SSID(idx[kk]) == s) { dup = true; break; }
    }
    if (dup) continue;
    if (!first) resp += ",";
    first = false;
    // SSID 转 JSON 字符串：转义 \ " 和控制字符
    String esc;
    esc.reserve(s.length() + 4);
    for (size_t k = 0; k < s.length(); k++) {
      char c = s[k];
      if (c == '\\' || c == '"') { esc += '\\'; esc += c; }
      else if ((uint8_t)c < 0x20) { /* 跳过控制字符 */ }
      else esc += c;
    }
    resp += "{\"ssid\":\"" + esc + "\",\"rssi\":" + String((int)rssi) + "}";
  }
  resp += "]";
  WiFi.scanDelete();
  server.send(200, "application/json", resp);
}

// 解析 POST body JSON {"ssid":"...","pass":"..."}，写 NVS 后 1.5s 重启。
// 手写极小 JSON 解析：只处理两个 string 字段，不依赖 ArduinoJson 库。
static String jsonExtractString(const String& body, const char* key) {
  String needle = String("\"") + key + "\"";
  int kp = body.indexOf(needle);
  if (kp < 0) return "";
  int colon = body.indexOf(':', kp + needle.length());
  if (colon < 0) return "";
  int q1 = body.indexOf('"', colon + 1);
  if (q1 < 0) return "";
  String out;
  out.reserve(64);
  for (int i = q1 + 1; i < (int)body.length(); i++) {
    char c = body[i];
    if (c == '\\' && i + 1 < (int)body.length()) {
      char n = body[++i];
      if      (n == 'n')  out += '\n';
      else if (n == 't')  out += '\t';
      else if (n == 'r')  out += '\r';
      else                out += n;     // \\ \" \/ 等都按字面下一字符处理
    } else if (c == '"') {
      return out;
    } else {
      out += c;
    }
  }
  return "";  // 找不到收尾引号
}

static void handleSave() {
  sendCors();
  String body = server.arg("plain");
  Serial.print("/save body 长度: ");
  Serial.println(body.length());

  String ssid = jsonExtractString(body, "ssid");
  String pass = jsonExtractString(body, "pass");
  if (ssid.length() == 0) {
    server.send(400, "text/plain", "missing ssid");
    return;
  }
  saveCreds(ssid, pass);
  server.send(200, "text/plain", "ok");
  Serial.println("1.5 秒后重启...");
  delay(1500);
  ESP.restart();
}

// catch-all：iOS/Android captive portal 探测域名都重定向到 /
static void handleCaptiveRedirect() {
  server.sendHeader("Location", "http://192.168.4.1/", true);
  server.send(302, "text/plain", "");
}

// 用 NVS 里保存的账密尝试 STA 连接，timeoutMs 内成功返回 true
static bool tryConnectSavedWiFi(uint32_t timeoutMs) {
  String s = loadSavedSsid();
  String p = loadSavedPass();
  if (s.length() == 0) return false;

  WiFi.mode(WIFI_STA);
  WiFi.begin(s.c_str(), p.c_str());
  Serial.print("尝试连接 ");
  Serial.print(s);
  Serial.print(" ");
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > timeoutMs) {
      Serial.println(" 超时");
      WiFi.disconnect(true);
      return false;
    }
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("已连接！ESP32 IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

// STA 模式下注册全部打印路由 + 初始化 MQTT
static void enterStaMode() {
  inApMode = false;

  server.on("/",      HTTP_GET,     handleRoot);
  server.on("/ping",  HTTP_GET,     handlePing);
  server.on("/print", HTTP_GET,     handlePrintGet);
  server.on("/print", HTTP_POST,    handlePrintPost);
  server.on("/print", HTTP_OPTIONS, handleOptions);
  server.on("/print-raster", HTTP_POST,    handlePrintRaster);
  server.on("/print-raster", HTTP_OPTIONS, handleOptions);
  server.on("/print-chunk",  HTTP_POST,    handlePrintChunk);
  server.on("/print-chunk",  HTTP_OPTIONS, handleOptions);
  server.on("/print-bridge", HTTP_GET,     handlePrintBridge);
  server.onNotFound([]() {
    sendCors();
    server.send(404, "text/plain", "Not found");
  });
  server.begin();
  Serial.println("HTTP server 已启动 (端口 80)");
  Serial.println("浏览器访问: http://" + WiFi.localIP().toString() + "/");

  mqttNet.setInsecure();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  Serial.println("MQTT 客户端已初始化, topic=" + String(MQTT_TOPIC));
}

static void enterApMode() {
  inApMode = true;
  Serial.println("==== 进入 AP 配网模式 ====");

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID);    // 开放无密码
  IPAddress apIp = WiFi.softAPIP();
  Serial.print("AP IP: ");
  Serial.println(apIp);

  // DNS 把所有域名解析到 AP IP，触发 captive portal 弹窗
  dnsServer.start(53, "*", apIp);

  // 只注册配网相关路由；打印路由在 AP 模式下不可用
  server.on("/", HTTP_GET, handleConfigRoot);
  server.on("/scan", HTTP_GET, handleScan);
  server.on("/save", HTTP_POST,    handleSave);
  server.on("/save", HTTP_OPTIONS, handleOptions);
  server.onNotFound(handleCaptiveRedirect);
  server.begin();
  Serial.println("配网 HTTP server 已启动");
  Serial.println("浏览器访问 http://192.168.4.1/");
}

// ---- 分块打印会话状态（/print-chunk 用） ----
// ESP32 WebServer 的 form-urlencoded / text/plain body 解析对 60KB+ 不可靠：
// 1) 库内部 client.readBytes(buf, contentLength) 默认 1000ms 超时，跨 WiFi 收
//    60KB+ 经常掐边；2) 同时持有原始 body String + URL-decoded String + 解析临时
//    buffer，~150KB 在 WiFi 栈剩下的堆里容易 malloc 失败/碎片化。
// 解决：bridge 把 base64 切成 3000 字符/块串行 POST 过来，ESP32 收到一块立刻
// streamBase64ToPrinter 喂打印机，不缓存，单次请求堆占用 < 15KB。
static bool printSessionActive = false;
static int  printSessionExpectedSeq = 0;
static int  printSessionTotalChunks = 0;
static uint32_t printSessionLastMillis = 0;
static uint32_t printSessionBytesOut = 0;
static const uint32_t PRINT_SESSION_TIMEOUT_MS = 30000;

// 检查 DTR 是否 READY，否则忙等到 READY 或超时降级。
// 超时降级：避免 DTR 接错/极性反时整个 HTTP handler 卡死。
static inline void waitPrinterReady() {
  if (digitalRead(DTR_PIN) != DTR_BUSY_LEVEL) return;
  uint32_t start = millis();
  while (digitalRead(DTR_PIN) == DTR_BUSY_LEVEL) {
    if (millis() - start > DTR_WAIT_TIMEOUT_MS) {
      dtrTimeoutCount++;
      return;
    }
    delayMicroseconds(50);
  }
}

static void sendCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

static void handleOptions() {
  sendCors();
  server.send(204);
}

static void handleRoot() {
  sendCors();
  String html;
  html.reserve(256);
  html += "<!doctype html><meta charset=\"utf-8\"><h1>Snap Roast Print</h1>";
  html += "<p>IP: " + WiFi.localIP().toString() + "</p>";
  html += "<p>RSSI: " + String(WiFi.RSSI()) + " dBm</p>";
  html += "<p>GET  /print?text=...    （给 HTTPS 页面顶层跳转用）</p>";
  html += "<p>POST /print  body=text/plain  （给本地 HTTP 页面 fetch 用）</p>";
  server.send(200, "text/html; charset=utf-8", html);
}

static void handlePing() {
  sendCors();
  server.send(200, "text/plain", "pong");
}

static String htmlEscape(const String& s) {
  String r;
  r.reserve(s.length() + 16);
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if      (c == '&')  r += "&amp;";
    else if (c == '<')  r += "&lt;";
    else if (c == '>')  r += "&gt;";
    else if (c == '"')  r += "&quot;";
    else if (c == '\n') r += "<br>";
    else                r += c;
  }
  return r;
}

static void doPrint(const String& text, bool returnHtml) {
  Serial.println();
  Serial.println("==== 收到打印请求 ====");
  Serial.print("长度: ");
  Serial.println(text.length());
  Serial.println("内容:");
  Serial.println(text);
  Serial.println("=====================");

  Printer.write(0x1B);  // ESC @ 初始化
  Printer.write(0x40);
  delay(50);

  Printer.println(text);
  Printer.write('\n');
  Printer.write('\n');
  Printer.write('\n');

  if (returnHtml) {
    String html;
    html.reserve(text.length() + 512);
    html += "<!doctype html><html lang=\"zh-CN\"><head>";
    html += "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">";
    html += "<title>可打印</title><style>";
    html += "body{font-family:-apple-system,'PingFang SC',sans-serif;padding:24px;max-width:520px;margin:0 auto;background:#f7f7f7}";
    html += ".ok{font-size:28px;color:#0a0}h1{margin:8px 0}";
    html += ".panel{background:#fff;padding:16px;border-radius:8px;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}";
    html += ".body{white-space:pre-wrap;font-family:monospace;font-size:14px;background:#fafafa;padding:12px;border-radius:6px;border:1px dashed #ddd}";
    html += ".meta{color:#666;font-size:13px;margin-top:8px}a{display:inline-block;margin-top:18px;color:#06f}";
    html += "</style></head><body>";
    html += "<div class=\"ok\">✅ 可打印</div>";
    html += "<h1>ESP32 已收到文本</h1>";
    html += "<div class=\"panel\"><div class=\"meta\">字节数：" + String(text.length()) + "</div>";
    html += "<div class=\"body\">" + htmlEscape(text) + "</div></div>";
    html += "<a href=\"javascript:history.back()\">← 返回浏览器上一页</a>";
    html += "</body></html>";
    server.send(200, "text/html; charset=utf-8", html);
  } else {
    String resp = "{\"ok\":true,\"bytes\":" + String(text.length()) + "}";
    server.send(200, "application/json", resp);
  }
}

// 给本地 dev HTTP 页面用：fetch('/print', {method:'POST', body:'...'})
static void handlePrintPost() {
  sendCors();
  String body = server.arg("plain");
  doPrint(body, /*returnHtml=*/false);
}

// 给 HTTPS Vercel 页面用：window.location = 'http://.../print?text=...'
// HTTPS -> HTTP 顶层跳转浏览器放行，但子资源 fetch 会被 mixed-content 拦截
static void handlePrintGet() {
  sendCors();
  if (!server.hasArg("text")) {
    server.send(400, "text/html; charset=utf-8",
                "<!doctype html><meta charset=utf-8><p>缺少 ?text= 参数</p>");
    return;
  }
  String text = server.arg("text");
  doPrint(text, /*returnHtml=*/true);
}

// ---- base64 流式解码：每解一字节立刻 Printer.write，不缓存解码后的数据 ----
// 字母表索引：A-Z (0-25), a-z (26-51), 0-9 (52-61), '+' (62), '/' (63)
// 返回 -1 表示非字母表字符（空格/换行/=padding/控制字符），调用方跳过
static int base64Index(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

// 把 base64 串流式解码并立刻发给 Printer，返回真实输出的字节数
static size_t streamBase64ToPrinter(const String& b64) {
  uint32_t buf = 0;     // 累计 6-bit 单元的缓冲（最多 24 bit）
  int bits = 0;         // 当前缓冲里有效 bit 数
  size_t outBytes = 0;
  for (size_t i = 0; i < b64.length(); i++) {
    char c = b64[i];
    if (c == '=') break;          // padding 表示输入结束
    int v = base64Index(c);
    if (v < 0) continue;          // 跳过空白和非字母表字符
    buf = (buf << 6) | (uint32_t)v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      uint8_t byte = (uint8_t)((buf >> bits) & 0xFF);
      waitPrinterReady();
      Printer.write(byte);
      outBytes++;
    }
  }
  return outBytes;
}

// ---- GET /print-bridge：HTTPS 页面跳到这里，URL hash 里带 base64 ----
// 这一页是 HTTP origin，可以同源 fetch POST 到 /print-raster，绕开浏览器
// 对 HTTPS→HTTP form POST 把 body 吞掉的 mixed-content 策略。
static void handlePrintBridge() {
  sendCors();
  String html;
  html.reserve(2048);
  html += "<!doctype html><html lang=\"zh-CN\"><head>";
  html += "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">";
  html += "<title>打印中…</title><style>";
  html += "body{font-family:-apple-system,'PingFang SC',sans-serif;padding:24px;max-width:520px;margin:0 auto;background:#f7f7f7;text-align:center}";
  html += "h1{margin:8px 0}.status{color:#666;margin-top:16px;font-size:14px}.err{color:#c00}";
  html += "a{display:inline-block;margin-top:18px;color:#06f}";
  html += "</style></head><body>";
  html += "<h1>正在传位图给打印机…</h1>";
  html += "<div id=\"status\" class=\"status\">准备中</div>";
  html += "<script>";
  html += "(async()=>{";
  html += "const s=document.getElementById('status');";
  html += "const raw=location.hash.slice(1);";
  html += "if(!raw){s.textContent='错误：URL 没有 hash 数据';s.classList.add('err');return;}";
  html += "const b64=decodeURIComponent(raw);";
  // ESP32 WebServer 单次 POST body 在 60KB+ 不可靠（readBytes 1s 超时 + 内部
  // String 反复 realloc 撞 heap 碎片）。改成分块串行上传：每块 3000 字符（4 的
  // 倍数 → base64 6-bit 单元不会被切断），每块 ~4.5KB urlencoded，远低于库限制。
  html += "const CHUNK=3000;";
  html += "const total=Math.ceil(b64.length/CHUNK);";
  html += "s.textContent='hash='+raw.length+' b64='+b64.length+' 分'+total+'块发送…';";
  html += "for(let i=0;i<total;i++){";
  html += "const data=b64.slice(i*CHUNK,(i+1)*CHUNK);";
  html += "const form=new URLSearchParams();form.set('seq',i);form.set('total',total);form.set('data',data);";
  html += "s.textContent='块 '+(i+1)+'/'+total+'（'+data.length+' 字符）…';";
  html += "try{";
  html += "const r=await fetch('/print-chunk',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form.toString()});";
  html += "const t=await r.text();";
  html += "if(!r.ok){s.innerHTML='块 '+i+'/'+total+' 失败 HTTP '+r.status+': '+t.replace(/<[^>]+>/g,'').slice(0,300);s.classList.add('err');return;}";
  // 最后一块返回完整 HTML，覆盖整页
  html += "if(i===total-1){document.open();document.write(t);document.close();return;}";
  html += "}catch(e){s.innerHTML='块 '+i+'/'+total+' 出错: '+e.message;s.classList.add('err');return;}";
  html += "}";
  html += "})();";
  html += "</script>";
  html += "<a href=\"javascript:history.back()\">← 返回</a>";
  html += "</body></html>";
  server.send(200, "text/html; charset=utf-8", html);
}

// ---- POST /print-raster：form 字段 data=<base64(ESC/POS raster 字节流)> ----
static void handlePrintRaster() {
  sendCors();

  // 诊断日志：进 handler 就打，定位 body 丢失/Content-Type 不对
  Serial.println();
  Serial.println("---- /print-raster 进入 handler ----");
  Serial.print("args count: ");
  Serial.println(server.args());
  for (int i = 0; i < server.args(); i++) {
    Serial.print("  arg["); Serial.print(i); Serial.print("] name='");
    Serial.print(server.argName(i));
    Serial.print("' valueLen=");
    Serial.println(server.arg(i).length());
  }
  Serial.print("hasArg('data'): ");
  Serial.println(server.hasArg("data") ? "yes" : "no");
  Serial.print("arg('plain') length: ");
  Serial.println(server.arg("plain").length());

  // 优先用 'plain'（text/plain 原始 body，bridge 页现在走这条路径，
  // 绕开 form 解析器的 ~8KB body 上限）；兼容老路径 'data' 字段。
  String b64;
  if (server.arg("plain").length() > 0) {
    b64 = server.arg("plain");
  } else if (server.hasArg("data")) {
    b64 = server.arg("data");
  } else {
    server.send(400, "text/html; charset=utf-8",
                "<!doctype html><meta charset=utf-8><p>缺少 body 或 data 字段（看串口诊断）</p>");
    return;
  }
  Serial.println();
  Serial.println("==== 收到位图打印请求 ====");
  Serial.print("base64 长度: ");
  Serial.println(b64.length());
  Serial.print("DTR 初始状态: ");
  Serial.println(digitalRead(DTR_PIN) == DTR_BUSY_LEVEL ? "BUSY" : "READY");

  dtrTimeoutCount = 0;

  // 初始化打印机（ESC @）
  waitPrinterReady(); Printer.write(0x1B);
  waitPrinterReady(); Printer.write(0x40);
  delay(50);

  size_t printedBytes = streamBase64ToPrinter(b64);

  // 走纸
  waitPrinterReady(); Printer.write('\n');
  waitPrinterReady(); Printer.write('\n');
  waitPrinterReady(); Printer.write('\n');

  Serial.print("已发字节数: ");
  Serial.println(printedBytes);
  Serial.print("DTR 超时次数: ");
  Serial.println(dtrTimeoutCount);
  Serial.println("=========================");

  // 返回"已打印"HTML（结构沿用 doPrint(returnHtml=true)）
  String html;
  html.reserve(512);
  html += "<!doctype html><html lang=\"zh-CN\"><head>";
  html += "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">";
  html += "<title>已打印</title><style>";
  html += "body{font-family:-apple-system,'PingFang SC',sans-serif;padding:24px;max-width:520px;margin:0 auto;background:#f7f7f7}";
  html += ".ok{font-size:28px;color:#0a0}h1{margin:8px 0}";
  html += ".panel{background:#fff;padding:16px;border-radius:8px;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}";
  html += ".meta{color:#666;font-size:13px;margin-top:8px}a{display:inline-block;margin-top:18px;color:#06f}";
  html += "</style></head><body>";
  html += "<div class=\"ok\">✅ 已打印</div>";
  html += "<h1>ESP32 已发位图到打印机</h1>";
  html += "<div class=\"panel\"><div class=\"meta\">base64 字符数：" + String(b64.length()) + "</div>";
  html += "<div class=\"meta\">解码后字节数：" + String(printedBytes) + "</div></div>";
  html += "<a href=\"javascript:history.back()\">← 返回浏览器上一页</a>";
  html += "</body></html>";
  server.send(200, "text/html; charset=utf-8", html);
}

// ---- POST /print-chunk：分块流式打印 ----
// form 字段：seq=<块号 0-based>  total=<总块数>  data=<这块的 base64 子串>
// 每块 ~3000 base64 字符（4 的倍数，保证不切断 6-bit 单元）。
// seq=0：初始化打印机 + 重置会话；seq=total-1：走纸 + 返回 done。
static void handlePrintChunk() {
  sendCors();

  if (!server.hasArg("seq") || !server.hasArg("total") || !server.hasArg("data")) {
    Serial.print("/print-chunk 缺字段, args=");
    Serial.println(server.args());
    server.send(400, "text/plain", "missing seq/total/data");
    return;
  }
  int seq = server.arg("seq").toInt();
  int total = server.arg("total").toInt();
  const String& chunk = server.arg("data");

  // 上一会话卡死/被中断 → 超时自动重置，下一次 seq=0 能重新开
  if (printSessionActive && (millis() - printSessionLastMillis) > PRINT_SESSION_TIMEOUT_MS) {
    Serial.println("打印会话超时，自动重置");
    printSessionActive = false;
  }

  if (seq == 0) {
    Serial.println();
    Serial.print("==== 新位图打印会话, 总块: ");
    Serial.println(total);
    // ESC @ 初始化打印机
    waitPrinterReady(); Printer.write(0x1B);
    waitPrinterReady(); Printer.write(0x40);
    delay(50);
    printSessionActive = true;
    printSessionExpectedSeq = 0;
    printSessionTotalChunks = total;
    printSessionBytesOut = 0;
    dtrTimeoutCount = 0;
  }

  if (!printSessionActive) {
    server.send(409, "text/plain", "no active session (need seq=0 first)");
    return;
  }
  if (seq != printSessionExpectedSeq) {
    String msg = "seq mismatch: expected " + String(printSessionExpectedSeq) + " got " + String(seq);
    Serial.println(msg);
    server.send(409, "text/plain", msg);
    return;
  }
  if (total != printSessionTotalChunks) {
    server.send(409, "text/plain", "total changed mid-session");
    return;
  }

  size_t outBytes = streamBase64ToPrinter(chunk);
  printSessionBytesOut += outBytes;
  printSessionExpectedSeq++;
  printSessionLastMillis = millis();

  Serial.print("chunk "); Serial.print(seq);
  Serial.print("/"); Serial.print(total);
  Serial.print(" b64Len="); Serial.print(chunk.length());
  Serial.print(" decoded="); Serial.println(outBytes);

  if (seq == total - 1) {
    // 最后一块：走纸结束
    waitPrinterReady(); Printer.write('\n');
    waitPrinterReady(); Printer.write('\n');
    waitPrinterReady(); Printer.write('\n');
    printSessionActive = false;
    Serial.print("==== 打印完成, 总字节: "); Serial.print(printSessionBytesOut);
    Serial.print(", DTR 超时: "); Serial.println(dtrTimeoutCount);

    String html;
    html.reserve(512);
    html += "<!doctype html><html lang=\"zh-CN\"><head>";
    html += "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">";
    html += "<title>已打印</title><style>";
    html += "body{font-family:-apple-system,'PingFang SC',sans-serif;padding:24px;max-width:520px;margin:0 auto;background:#f7f7f7}";
    html += ".ok{font-size:28px;color:#0a0}h1{margin:8px 0}";
    html += ".panel{background:#fff;padding:16px;border-radius:8px;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}";
    html += ".meta{color:#666;font-size:13px;margin-top:8px}a{display:inline-block;margin-top:18px;color:#06f}";
    html += "</style></head><body>";
    html += "<div class=\"ok\">✅ 已打印</div>";
    html += "<h1>ESP32 已发位图到打印机</h1>";
    html += "<div class=\"panel\"><div class=\"meta\">总块数：" + String(total) + "</div>";
    html += "<div class=\"meta\">解码后字节数：" + String(printSessionBytesOut) + "</div></div>";
    html += "<a href=\"javascript:history.back()\">← 返回浏览器上一页</a>";
    html += "</body></html>";
    server.send(200, "text/html; charset=utf-8", html);
  } else {
    server.send(200, "text/plain", "ok");
  }
}

// 非阻塞重连：每 3 秒最多尝试一次，避免 loop 卡死
static void mqttEnsureConnected() {
  if (mqtt.connected()) return;
  uint32_t now = millis();
  if (now - mqttLastTryMs < 3000) return;
  mqttLastTryMs = now;

  String clientId = "snap-roast-esp32-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.print("MQTT 连接中... ");
  if (mqtt.connect(clientId.c_str())) {
    Serial.println("OK");
  } else {
    Serial.print("失败, state=");
    Serial.println(mqtt.state());
  }
}

// STA 模式：边沿检测短按发布 MQTT；持续按下 5s 触发长按 → 清 NVS + 重启
static void buttonPollStaMode() {
  int level = digitalRead(BUTTON_PIN);
  uint32_t now = millis();

  // 上升沿（按下瞬间）
  if (level == HIGH && btnLastLevel == LOW && (now - btnLastEdgeMs) > BUTTON_DEBOUNCE_MS) {
    btnLastEdgeMs   = now;
    btnPressStartMs = now;
    longPressFired  = false;
    btnLastLevel    = HIGH;
    return;
  }

  // 持续按下 → 检查是否达到长按阈值
  if (level == HIGH && btnLastLevel == HIGH && !longPressFired) {
    if ((now - btnPressStartMs) >= LONG_PRESS_MS) {
      longPressFired = true;
      Serial.println("长按 5s → 清 WiFi 配置并重启");
      clearCreds();
      delay(200);
      ESP.restart();
    }
    return;
  }

  // 下降沿（松开）
  if (level == LOW && btnLastLevel == HIGH && (now - btnLastEdgeMs) > BUTTON_DEBOUNCE_MS) {
    btnLastEdgeMs = now;
    btnLastLevel  = LOW;
    if (!longPressFired) {
      // 短按 → 原 MQTT 快门发布逻辑
      char payload[32];
      snprintf(payload, sizeof(payload), "{\"ts\":%lu}", now);
      bool ok = mqtt.publish(MQTT_TOPIC, payload);
      Serial.printf("短按 → publish %s (ok=%d)\n", payload, ok ? 1 : 0);
    }
    return;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(DTR_PIN, INPUT_PULLUP);
  pinMode(BUTTON_PIN, INPUT);
  Printer.begin(57600, SERIAL_8N1, 1, 2);  // RX=1, TX=2
  delay(500);

  prefs.begin("wifi", /*readOnly=*/false);

  String savedSsid = loadSavedSsid();
  if (savedSsid.length() > 0 && tryConnectSavedWiFi(STA_CONNECT_TIMEOUT_MS)) {
    enterStaMode();
  } else {
    Serial.println(savedSsid.length() == 0
                   ? "NVS 无 WiFi 凭据 → 进 AP 配网"
                   : "保存的 WiFi 连不上 → 进 AP 配网");
    enterApMode();
  }
}

void loop() {
  if (inApMode) {
    dnsServer.processNextRequest();
    server.handleClient();
    // AP 模式下按钮无功能（长按重置只在 STA 模式有意义；
    // AP 模式本身就是"重置后的状态"，再触发 reset 也是回到这里）
  } else {
    server.handleClient();
    mqttEnsureConnected();
    mqtt.loop();
    buttonPollStaMode();
  }
}
