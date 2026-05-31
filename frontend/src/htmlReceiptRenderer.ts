type ReceiptMode = "simple" | "bigText" | "face" | "receipt" | "big_text" | "pixel_expression" | "expression";
type RoastLevel = "gentle" | "normal" | "spicy" | "execution" | "public_execution";

type RendererOptions = {
  mangaImageUrl?: string;
  mangaMode?: "none" | "top" | "bottom" | "standalone";
};

type ReceiptData = {
  title: string;
  photoType: string;
  atmosphere: string;
  aiMood: string;
  findings: string[];
  scores: Array<{ label: string; value: number }>;
  roast: string;
  advice: string;
  verdict: string;
  headline: string;
  oneLineRoast: string;
  tinyAdvice: string;
  keywords: string[];
};

const WIDTH = 384;

export function destroyReceiptPreviews(root: HTMLElement) {
  const hosts = root.classList.contains("html-receipt-host")
    ? [root]
    : Array.from(root.querySelectorAll<HTMLElement>(".html-receipt-host"));
  hosts.forEach((host) => {
    host.innerHTML = "";
    host.classList.remove("html-receipt-host");
  });
}

export function updateReceiptPreview(
  container: HTMLElement,
  rawData: unknown,
  rawMode: ReceiptMode,
  roastLevel: RoastLevel,
  options: RendererOptions = {}
) {
  const data = normalizeData(rawData);
  const mode = normalizeMode(rawMode);
  const level = normalizeLevel(roastLevel);
  const topManga = options.mangaMode === "top" ? mangaBlock(options.mangaImageUrl) : "";
  const bottomManga = options.mangaMode === "bottom" ? mangaBlock(options.mangaImageUrl) : "";
  const body = mode === "bigText" ? renderBigText(data, level) : mode === "face" ? renderFace(data, level) : renderSimple(data, level);

  container.classList.remove("p5-receipt-host");
  container.classList.add("html-receipt-host");
  container.innerHTML = `<article class="html-receipt html-receipt--${mode} html-receipt--${level}">${topManga}${body}${bottomManga}</article>`;
  const height = Math.ceil(container.scrollHeight || container.getBoundingClientRect().height);
  container.style.setProperty("--paper-height", `${height}px`);
  return { width: WIDTH, height };
}

function renderSimple(data: ReceiptData, level: string) {
  const tags = shortWords(data);
  const scoreCharges = normalizeScores(data.scores).map((score) => `${score.label}${score.value < 58 ? "待抢救" : score.value > 78 ? "表现良好" : "仍有余地"}`);
  const chargeRows = [...data.findings, ...scoreCharges, `${data.photoType}努力营业`, `${data.atmosphere}现场加成`]
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, level === "gentle" ? 6 : level === "normal" ? 7 : 9);
  return [
    header("PHOTO RECEIPT", "照片诊断收据"),
    level !== "gentle" ? `<div class="receipt-alert">${level === "normal" ? "[WARN] 轻度抢戏警告" : "[OUCH] 画面秩序需要抢救"}</div>` : "",
    barrage(tags, level),
    section("今日判词", `<p class="receipt-verdict">${escape(data.roast || data.oneLineRoast)}</p>`, "receipt-section--verdict"),
    section("画面身份卡", `
      <dl class="receipt-identity">
        ${definition("● 主角", data.photoType)}
        ${definition("■ 场景", data.atmosphere)}
        ${definition("♥ 氛围", data.aiMood)}
        ${definition("! 隐藏剧情", data.findings[0] || data.verdict)}
      </dl>`),
    section("照片诊断", `
      <div class="receipt-analysis">
        <div class="receipt-metrics">${metricRows(data.scores)}</div>
        ${radar(data.scores)}
      </div>`),
    section("构图小地图", compositionMap(level)),
    section("本张照片消费明细", `
      <div class="receipt-charges">
        ${chargeRows.map((item, index) => `<div><span>${escape(trim(item, 14))}费</span><b>${index === chargeRows.length - 1 && level === "gentle" ? "-1" : `+${index + 1}`}</b></div>`).join("")}
      </div>
      <p class="receipt-total"><b>合计评价：</b>${escape(data.verdict)}</p>`, "receipt-section--charges"),
    section("AI 建议", `<p class="receipt-advice">→ ${escape(data.advice || data.tinyAdvice)}</p>`),
    lostControlTail(data, level),
    footer(tags, data.verdict)
  ].join("");
}

function renderBigText(data: ReceiptData, level: string) {
  const title = trim(data.headline || data.oneLineRoast || data.roast, level === "gentle" ? 12 : 9);
  const verticalTitle = [...title].map((char, index) => `<span style="--title-index:${index}">${escape(char)}</span>`).join("");
  const tags = shortWords(data);
  const repeats = level === "execution" ? `<div class="receipt-overprint">${Array.from({ length: 3 }, () => `<span>${escape(title)}</span>`).join("")}</div>` : "";
  return [
    header("BIG ROAST", "纵向单字暴击"),
    `<section class="big-roast-stage">
      <div class="big-roast-kicker">${level === "gentle" ? "今日判词" : "[ ROAST WITH THE DAWN ]"}</div>
      ${repeats}
      <div class="big-roast-title">${verticalTitle}</div>
      <p class="big-roast-note">${escape(data.oneLineRoast || data.roast)}</p>
      <div class="big-roast-index">SRB / TYPE IMPACT / 2026</div>
      <div class="receipt-chips">${tags.slice(0, level === "gentle" ? 2 : 4).map((tag) => `<span>${escape(tag)}</span>`).join("")}</div>
    </section>`,
    level === "spicy" || level === "execution" ? `<div class="receipt-side-comments">${tags.slice(0, 4).map((tag) => `<span>! ${escape(tag)}</span>`).join("")}</div>` : "",
    lostControlTail(data, level),
    footer(tags, data.verdict)
  ].join("");
}

function renderFace(data: ReceiptData, level: string) {
  const tags = shortWords(data);
  const face = level === "gentle" ? "^_^" : level === "normal" ? "ಠ_ಠ" : level === "spicy" ? "ಠ益ಠ" : "x_x";
  return [
    header("MOOD STICKER", "情绪贴纸"),
    `<section class="mood-sticker">
      <div class="mood-sticker__frame">
        <span class="mood-sticker__serial">MOOD / ${level.toUpperCase()}</span>
        <div class="mood-sticker__face">${face}</div>
        <strong>${escape(data.aiMood)}</strong>
      </div>
      <p><b>情绪识别：</b>${escape(data.oneLineRoast || data.roast)}</p>
      <p><b>小句补刀：</b>${escape(data.tinyAdvice || data.verdict)}</p>
      <div class="receipt-chips">${tags.slice(0, level === "gentle" ? 2 : 4).map((tag) => `<span>${escape(tag)}</span>`).join("")}</div>
    </section>`,
    lostControlTail(data, level),
    footer(tags, data.verdict)
  ].join("");
}

function header(mode: string, chinese: string) {
  return `<header class="receipt-header">
    <div class="receipt-brand"><strong>拍立怼</strong><span>SNAP ROAST BUDDY</span></div>
    <div class="receipt-mode">${mode}<small>${chinese}</small></div>
  </header>`;
}

function footer(tags: string[], verdict: string) {
  return `<footer class="receipt-footer">
    <p class="receipt-footer__tags"><b>今日标签：</b><span>${tags.slice(0, 4).map((tag) => `#${escape(tag.replace(/^#+/, ""))}`).join(" ")}</span></p>
    <p><b>本次结论：</b>${escape(verdict)}</p>
    <div class="receipt-footer__status">-- 拍立怼 已出单 --</div>
    ${barcode()}
  </footer>`;
}

function barrage(tags: string[], level: string) {
  if (level === "gentle" || !tags.length) return "";
  const count = level === "normal" ? 2 : level === "spicy" ? 3 : 4;
  return `<div class="receipt-barrage">${tags.slice(0, count).map((tag, index) => `<span style="--barrage-index:${index}">${escape(tag)}</span>`).join("")}</div>`;
}

function section(title: string, content: string, className = "") {
  return `<section class="receipt-section ${className}"><h2>[ ${title} ]</h2>${content}</section>`;
}

function definition(label: string, value: string) {
  return `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`;
}

function metricRows(scores: Array<{ label: string; value: number }>) {
  return normalizeScores(scores).map((score) => {
    const filled = Math.round(score.value / 10);
    return `<div class="receipt-metric"><span>${escape(trim(score.label, 6))}</span><i>${"█".repeat(filled)}${"░".repeat(10 - filled)}</i><b>${filled}/10</b></div>`;
  }).join("");
}

function radar(scores: Array<{ label: string; value: number }>) {
  const items = normalizeScores(scores).slice(0, 6);
  const center = 54;
  const radius = 40;
  const points = items.map((score, index) => {
    const angle = -Math.PI / 2 + (index / items.length) * Math.PI * 2;
    const value = radius * score.value / 100;
    return `${center + Math.cos(angle) * value},${center + Math.sin(angle) * value}`;
  }).join(" ");
  const axes = items.map((_, index) => {
    const angle = -Math.PI / 2 + (index / items.length) * Math.PI * 2;
    return `<line x1="${center}" y1="${center}" x2="${center + Math.cos(angle) * radius}" y2="${center + Math.sin(angle) * radius}"/>`;
  }).join("");
  return `<svg class="receipt-radar" viewBox="0 0 108 108" aria-label="照片诊断雷达图">
    <circle cx="54" cy="54" r="40"/><circle cx="54" cy="54" r="26"/><circle cx="54" cy="54" r="13"/>
    ${axes}<polygon points="${points}"/>
  </svg>`;
}

function compositionMap(level: string) {
  const cells = Array.from({ length: 9 }, (_, index) => {
    const isCenter = index === 4;
    const warning = level === "execution" ? !isCenter : level === "spicy" ? [1, 5, 6].includes(index) : index === 5;
    return `<span class="${warning ? "composition-map__warning" : ""}">${isCenter ? "●" : warning ? "!" : ""}</span>`;
  }).join("");
  return `<div class="composition-report">
    <div class="composition-map">
      ${cells}
      <i class="composition-map__focus"></i>
      <i class="composition-map__axis composition-map__axis--x"></i>
      <i class="composition-map__axis composition-map__axis--y"></i>
    </div>
    <dl>
      <div><dt>FRAME</dt><dd>主体位于中心观察区</dd></div>
      <div><dt>NOISE</dt><dd>${level === "gentle" ? "少量边缘干扰" : level === "normal" ? "右侧存在抢镜元素" : "背景干扰区正在扩张"}</dd></div>
      <div><dt>GUIDE</dt><dd>${level === "execution" ? "建议重拍并清空背景" : "建议靠近主体重新裁切"}</dd></div>
    </dl>
  </div><p class="receipt-caption">● 主体观察区 &nbsp; ! 干扰区域 &nbsp; + 构图轴线</p>`;
}

function lostControlTail(data: ReceiptData, level: string) {
  if (level === "gentle") return "";
  const tags = shortWords(data);
  const title = escape(trim(data.headline || data.verdict || data.oneLineRoast, 7));
  const secondary = escape(trim(data.oneLineRoast || data.roast, 12));
  const labels = (tags.length ? tags : ["主体失踪", "构图掉线", "建议重拍"]).slice(0, 4);
  const bandCount = level === "normal" ? 1 : level === "spicy" ? 3 : 5;
  const bands = Array.from({ length: bandCount }, (_, index) => {
    const dark = index % 2 === 0;
    const text = index === 2 && level === "execution" ? secondary : title;
    return `<div class="receipt-chaos-band ${dark ? "receipt-chaos-band--dark" : "receipt-chaos-band--light"}" style="--chaos-index:${index}">
      <span>${text}</span><small>${index % 2 ? "PUBLIC EXECUTION EDITION" : "TYPOGRAPHIC RECEIPT / DISPLAY ONLY"}</small>
    </div>`;
  }).join("");
  const stickers = level === "normal" ? "" : labels.map((tag, index) => `<b class="receipt-chaos-sticker" style="--sticker-index:${index}">${escape(tag)}</b>`).join("");
  const overprint = level === "execution"
    ? `<div class="receipt-chaos-overprint">${Array.from({ length: 3 }, (_, index) => `<span style="--overprint-index:${index}">${title}</span>`).join("")}</div>`
    : "";
  return `<section class="receipt-chaos receipt-chaos--${level}">
    <div class="receipt-chaos-kicker">ROAST WITH THE DAWN / ${level.toUpperCase()}</div>
    ${bands}${stickers}${overprint}
  </section>`;
}

function barcode() {
  const widths = [2, 1, 3, 1, 1, 2, 4, 1, 2, 1, 3, 2, 1, 1, 4, 2, 1, 3, 1, 2, 2, 1, 4, 1, 1, 3, 2, 1, 3, 1, 2, 4, 1, 1, 2, 3, 1, 2, 1, 4, 2, 1, 3, 1, 2, 2, 1, 4, 1, 3, 1, 2, 1, 3, 2, 1, 4, 1, 2, 1, 3, 1, 2, 4, 1, 1, 3, 2, 1, 2, 1, 4, 2, 1, 3, 1, 2, 3, 1, 4];
  const bars = widths.map((width, index) => `<i style="--bar-width:${width}" class="${index % 13 === 0 || index % 17 === 0 ? "receipt-barcode__guard" : ""}"></i>`).join("");
  return `<div class="receipt-barcode" aria-label="购物小票条形码">
    <div class="receipt-barcode__bars">${bars}</div>
    <div class="receipt-barcode__digits"><b>2026</b><span>SRB 314195 / 151857</span></div>
  </div>`;
}

function mangaBlock(url?: string) {
  if (!url) return "";
  return `<section class="receipt-manga"><b>[ BUDDY COMIC STRIP ]</b><img src="${escape(url)}" alt="漫画转译结果"></section>`;
}

function normalizeScores(scores: Array<{ label: string; value: number }>) {
  const fallback = [
    { label: "主体清晰", value: 72 },
    { label: "光线友好", value: 58 },
    { label: "构图稳定", value: 62 },
    { label: "背景干扰", value: 76 },
    { label: "情绪感染", value: 68 },
    { label: "空间层次", value: 64 },
    { label: "时机准确", value: 61 },
    { label: "救片难度", value: 52 }
  ];
  return [...scores, ...fallback].filter((score) => Number.isFinite(score.value)).slice(0, 8).map((score) => ({ ...score, value: Math.max(0, Math.min(100, score.value)) }));
}

function normalizeData(raw: unknown): ReceiptData {
  const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const findings = strings(data.findings ?? data.tags ?? data.keywords);
  const keywords = strings(data.keywords ?? data.tags ?? data.findings);
  const scores = Array.isArray(data.scores) ? data.scores.map((item, index) => {
    const score = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return { label: String(score.label ?? `指标${index + 1}`), value: Number(score.value ?? 50) };
  }) : [];
  const roast = first(data.roast, data.oneLineRoast, data.shortComment, data.caption, "这张照片很努力，努力到机器都想递一张补拍申请。");
  return {
    title: first(data.title, "拍立怼"),
    photoType: first(data.photoType, data.sceneType, keywords[0], "生活切片"),
    atmosphere: first(data.atmosphere, data.mood, "随手现场"),
    aiMood: first(data.aiMood, data.moodLabel, "正在观察"),
    findings: findings.length ? findings : ["主体和背景正在争夺主场", "画面秩序稍微掉线"],
    scores,
    roast,
    advice: first(data.advice, data.tinyAdvice, "建议靠近主体拍摄，减少背景杂物。"),
    verdict: first(data.verdict, data.headline, "可以发，但建议轻微裁剪。"),
    headline: first(data.headline, data.verdict, roast),
    oneLineRoast: first(data.oneLineRoast, roast),
    tinyAdvice: first(data.tinyAdvice, data.advice, "建议重新整理画面。"),
    keywords
  };
}

function shortWords(data: ReceiptData) {
  return [...data.keywords, ...data.findings, data.photoType, data.aiMood].map((item) => trim(item.replace(/[，。！？、,.!?：:；;]/g, ""), 8)).filter(Boolean).filter((item, index, all) => all.indexOf(item) === index);
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : typeof value === "string" ? value.split(/[，,、|/]/).map((item) => item.trim()).filter(Boolean) : [];
}

function first(...values: unknown[]) {
  return String(values.find((value) => typeof value === "string" && value.trim()) ?? "");
}

function trim(value: string, size: number) {
  return [...String(value)].slice(0, size).join("");
}

function normalizeMode(mode: ReceiptMode): "simple" | "bigText" | "face" {
  if (mode === "bigText" || mode === "big_text") return "bigText";
  if (mode === "face" || mode === "pixel_expression" || mode === "expression") return "face";
  return "simple";
}

function normalizeLevel(level: RoastLevel) {
  return level === "public_execution" ? "execution" : level;
}

function escape(value: string) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
