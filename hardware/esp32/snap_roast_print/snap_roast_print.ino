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

const char* ssid     = "iPhone on the beach";
const char* password = "Qwer123321";

// 打印机 DTR 接 ESP32 GPIO 41（硬件流控）
// MY-628 DTR：打印机输出，告诉主机自己是否能接收数据
// 约定（最常见 ESC/POS）：LOW = READY（可接收），HIGH = BUSY（缓冲将满）
// 若实测发现极性反了（一直卡在 BUSY 或所有字节都不等就发），把 DTR_BUSY_LEVEL 改成 LOW
#define DTR_PIN              41
#define DTR_BUSY_LEVEL       HIGH
#define DTR_WAIT_TIMEOUT_MS  500

static uint32_t dtrTimeoutCount = 0;

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

HardwareSerial Printer(1);
WebServer server(80);

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

void setup() {
  Serial.begin(115200);
  pinMode(DTR_PIN, INPUT_PULLUP);
  Printer.begin(57600, SERIAL_8N1, 1, 2);  // RX=1, TX=2
  delay(500);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("正在连接热点");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.println("已连接！");
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

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
}

void loop() {
  server.handleClient();
}
