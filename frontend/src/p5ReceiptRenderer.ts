import p5 from "p5";

type ReceiptMode = "simple" | "bigText" | "face" | "receipt" | "big_text" | "pixel_expression" | "expression";
type RoastLevel = "gentle" | "normal" | "spicy" | "execution" | "public_execution";

type RendererOptions = {
  mangaImageUrl?: string;
  mangaMode?: "none" | "top" | "bottom" | "standalone";
};

type NormalizedReceiptData = {
  title: string;
  subtitle: string;
  photoType: string;
  atmosphere: string;
  aiMood: string;
  findings: string[];
  scores: Array<{ label: string; value: number }>;
  roast: string;
  advice: string;
  verdict: string;
  topLabel: string;
  headline: string;
  subHeadline: string;
  oneLineRoast: string;
  tinyAdvice: string;
  moodLabel: string;
  keywords: string[];
  shortComment: string;
};

const receiptWidth = 384;
const rendererMap = new WeakMap<HTMLElement, p5>();
const fontStack = "PingFang SC, Microsoft YaHei, Noto Sans SC, SimHei, sans-serif";

export function initP5ReceiptRenderer(container: HTMLElement) {
  container.classList.add("p5-receipt-host");
}

export function destroyReceiptPreviews(root: HTMLElement) {
  const hosts = root.classList.contains("p5-receipt-host")
    ? [root]
    : Array.from(root.querySelectorAll<HTMLElement>(".p5-receipt-host"));
  hosts.forEach((host) => {
    rendererMap.get(host)?.remove();
    rendererMap.delete(host);
  });
}

export function updateReceiptPreview(
  container: HTMLElement,
  data: unknown,
  receiptMode: ReceiptMode,
  roastLevel: RoastLevel,
  options: RendererOptions = {}
) {
  initP5ReceiptRenderer(container);
  rendererMap.get(container)?.remove();
  container.innerHTML = "";

  const mode = normalizeReceiptMode(receiptMode);
  const intensity = getRoastIntensity(roastLevel);
  const normalized = normalizeReceiptData(data);
  const baseHeight = getReceiptHeight(mode, roastLevel, normalized);
  const mangaBlockHeight = options.mangaImageUrl && options.mangaMode && options.mangaMode !== "none" ? 292 : 0;
  const height = baseHeight + mangaBlockHeight;

  const sketch = (p: p5) => {
    let mangaImage: p5.Image | undefined;

    p.setup = () => {
      const canvas = p.createCanvas(receiptWidth, height);
      canvas.parent(container);
      p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
      p.noLoop();
      p.textFont(fontStack);
      drawReceipt(p, normalized, mode, roastLevel, intensity, baseHeight, options, mangaImage);
      if (options.mangaImageUrl && options.mangaMode && options.mangaMode !== "none") {
        p.loadImage(
          options.mangaImageUrl,
          (image) => {
            mangaImage = image;
            drawReceipt(p, normalized, mode, roastLevel, intensity, baseHeight, options, mangaImage);
          },
          () => drawReceipt(p, normalized, mode, roastLevel, intensity, baseHeight, options, undefined)
        );
      }
    };
  };

  rendererMap.set(container, new p5(sketch));
  container.style.setProperty("--paper-height", `${height}px`);
  return { width: receiptWidth, height };
}

export function renderReceipt(data: unknown, receiptMode: ReceiptMode, roastLevel: RoastLevel, container: HTMLElement) {
  return updateReceiptPreview(container, data, receiptMode, roastLevel);
}

export function renderSimpleReceipt(p: p5, data: unknown, roastLevel: RoastLevel) {
  const normalized = normalizeReceiptData(data);
  renderSimpleReceiptCanvas(p, normalized, getRoastIntensity(roastLevel), getReceiptHeight("simple", roastLevel, normalized), roastLevel);
}

export function renderBigTextReceipt(p: p5, data: unknown, roastLevel: RoastLevel) {
  const normalized = normalizeReceiptData(data);
  renderBigTextReceiptCanvas(p, normalized, getRoastIntensity(roastLevel), getReceiptHeight("bigText", roastLevel, normalized), roastLevel);
}

export function renderFaceReceipt(p: p5, data: unknown, roastLevel: RoastLevel) {
  const normalized = normalizeReceiptData(data);
  renderFaceReceiptCanvas(p, normalized, getRoastIntensity(roastLevel), getReceiptHeight("face", roastLevel, normalized), roastLevel);
}

export function getRoastIntensity(roastLevel: RoastLevel): number {
  if (roastLevel === "gentle") return 0.25;
  if (roastLevel === "normal") return 0.5;
  if (roastLevel === "spicy") return 0.75;
  return 1;
}

export function getReceiptHeight(mode: "simple" | "bigText" | "face", roastLevel: RoastLevel, data: NormalizedReceiptData = normalizeReceiptData({})) {
  const intensity = getRoastIntensity(roastLevel);
  if (mode === "simple") {
    const textLoad = data.findings.join("").length + data.roast.length + data.advice.length + data.verdict.length;
    return Math.round(500 + intensity * 430 + Math.min(260, textLoad * (0.9 + intensity * 0.6)));
  }
  if (mode === "bigText") return Math.round(500 + intensity * 210);
  return Math.round(520 + intensity * 240);
}

export function wrapChineseText(p: p5, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = String(text || "").split(/\n+/);
  for (const paragraph of paragraphs) {
    let line = "";
    for (const char of [...paragraph]) {
      const next = line + char;
      if (line && p.textWidth(next) > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

export function drawDashedLine(p: p5, x1: number, y: number, x2: number, dash = 9, gap = 6) {
  p.push();
  p.stroke(0);
  p.strokeWeight(2);
  for (let x = x1; x < x2; x += dash + gap) p.line(x, y, Math.min(x + dash, x2), y);
  p.pop();
}

export function drawStamp(p: p5, text: string, x: number, y: number, size = 72, angle = -0.15) {
  p.push();
  p.translate(x, y);
  p.rotate(angle);
  p.noFill();
  p.stroke(0);
  p.strokeWeight(4);
  p.rectMode(p.CENTER);
  p.rect(0, 0, size * 1.52, size * 0.72);
  p.textAlign(p.CENTER, p.CENTER);
  p.textStyle(p.BOLD);
  p.textSize(size * 0.23);
  p.noStroke();
  p.fill(0);
  p.text(text, 0, 1);
  p.pop();
}

export function drawTag(p: p5, text: string, x: number, y: number, inverted = false, angle = 0) {
  p.push();
  p.translate(x, y);
  p.rotate(angle);
  p.textStyle(p.BOLD);
  p.textSize(13);
  const width = Math.max(48, p.textWidth(text) + 14);
  p.stroke(0);
  p.strokeWeight(2);
  p.fill(inverted ? 0 : 255);
  p.rect(0, -14, width, 22);
  p.noStroke();
  p.fill(inverted ? 255 : 0);
  p.textAlign(p.LEFT, p.CENTER);
  p.text(text, 7, -3);
  p.pop();
}

export function drawSpeedLines(p: p5, x: number, y: number, width: number, count: number, angle = -0.25) {
  p.push();
  p.stroke(0);
  p.strokeWeight(2.4);
  for (let i = 0; i < count; i += 1) {
    const yy = y + i * 9;
    const len = width * (0.42 + ((i * 37) % 50) / 100);
    p.line(x + i % 3 * 7, yy, x + len, yy + Math.sin(angle) * len * 0.18);
  }
  p.pop();
}

export function extractShortWords(data: unknown): string[] {
  const normalized = normalizeReceiptData(data);
  const pool = [
    normalized.photoType,
    normalized.atmosphere,
    normalized.aiMood,
    normalized.moodLabel,
    ...normalized.keywords,
    ...normalized.findings,
    normalized.verdict,
    normalized.headline,
    normalized.oneLineRoast
  ];
  const words = pool
    .flatMap((item) => String(item || "").split(/[，。！？、\s:：/|]+/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 6);
  return Array.from(new Set(words)).slice(0, 18);
}

export function drawTextDensityBlock(p: p5, phrases: string[], x: number, y: number, width: number, height: number, intensity: number) {
  p.push();
  p.textStyle(p.BOLD);
  p.fill(0);
  p.noStroke();
  const rows = Math.round(20 + intensity * 42);
  for (let i = 0; i < rows; i += 1) {
    const progress = i / Math.max(1, rows - 1);
    p.textSize(11 + progress * 4);
    const phrase = phrases[i % phrases.length] || "检测异常";
    const yy = y + progress * height + Math.sin(i * 1.7) * 4;
    const repeats = Math.round(2 + progress * 7);
    for (let j = 0; j < repeats; j += 1) {
      p.push();
      p.translate(x + ((i * 29 + j * 43) % width), yy + j * (3 - progress * 2));
      p.rotate((j - repeats / 2) * 0.015 * intensity);
      p.text(phrase, 0, 0);
      p.pop();
    }
  }
  p.pop();
}

function drawReceipt(
  p: p5,
  data: NormalizedReceiptData,
  mode: "simple" | "bigText" | "face",
  roastLevel: RoastLevel,
  intensity: number,
  baseHeight: number,
  options: RendererOptions,
  mangaImage?: p5.Image
) {
  p.background(255);
  p.textFont(fontStack);
  p.noStroke();
  p.fill(0);
  drawThermalTexture(p, baseHeight + (options.mangaImageUrl && options.mangaMode !== "none" ? 292 : 0), intensity);

  let offsetY = 0;
  if (options.mangaImageUrl && options.mangaMode === "top") {
    drawMangaBlock(p, mangaImage, 0, options.mangaImageUrl);
    offsetY = 292;
  }

  p.push();
  p.translate(0, offsetY);
  if (mode === "simple") renderSimpleReceiptCanvas(p, data, intensity, baseHeight, roastLevel);
  if (mode === "bigText") renderBigTextReceiptCanvas(p, data, intensity, baseHeight, roastLevel);
  if (mode === "face") renderFaceReceiptCanvas(p, data, intensity, baseHeight, roastLevel);
  p.pop();

  if (options.mangaImageUrl && options.mangaMode === "bottom") drawMangaBlock(p, mangaImage, baseHeight, options.mangaImageUrl);
}

function renderSimpleReceiptCanvas(p: p5, data: NormalizedReceiptData, intensity: number, height: number, roastLevel: RoastLevel) {
  const margin = 18;
  const width = receiptWidth - margin * 2;
  let y = 25;
  p.textAlign(p.CENTER, p.TOP);
  p.textStyle(p.BOLD);
  p.textSize(22 + intensity * 7);
  p.text(data.title, receiptWidth / 2 + jitter(1, intensity), y);
  y += 34;
  drawDashedLine(p, margin, y, receiptWidth - margin);
  y += 15;

  p.textSize(13);
  p.text(data.subtitle, receiptWidth / 2, y);
  y += 26;
  drawTag(p, data.photoType, margin, y + 12, intensity > 0.7, -0.03 * intensity);
  drawTag(p, data.aiMood, 178, y + 12, false, 0.045 * intensity);
  y += 42;

  const scores = data.scores.slice(0, intensity >= 0.75 ? 3 : 2);
  for (const score of scores) {
    p.textAlign(p.LEFT, p.TOP);
    p.textStyle(p.BOLD);
    p.textSize(13);
    p.text(score.label, margin, y);
    p.stroke(0);
    p.strokeWeight(2);
    p.noFill();
    p.rect(margin + 94, y + 3, 170, 10);
    p.fill(0);
    p.noStroke();
    p.rect(margin + 94, y + 3, Math.max(12, 170 * score.value / 100), 10);
    p.textAlign(p.RIGHT, p.TOP);
    p.text(`${Math.round(score.value)}`, receiptWidth - margin, y - 2);
    y += 24 - intensity * 3;
  }

  y += 8;
  drawSectionLabel(p, "AI FINDINGS", margin, y, intensity);
  y += 24;
  const findingCount = roastLevel === "gentle" ? 2 : roastLevel === "normal" ? 3 : data.findings.length;
  p.textAlign(p.LEFT, p.TOP);
  p.textStyle(p.BOLD);
  p.textSize(14);
  for (const finding of data.findings.slice(0, findingCount)) {
    y = drawWrappedLine(p, `- ${finding}`, margin + jitter(3, intensity), y, width, 14, 20 - intensity * 4);
    y += 4 - intensity * 2;
  }

  y += 8;
  drawDashedLine(p, margin, y, receiptWidth - margin, 7, 5);
  y += 18;
  const paragraphs = [data.roast, data.advice, data.verdict];
  for (const [index, paragraph] of paragraphs.entries()) {
    const density = roastLevel === "execution" || roastLevel === "public_execution" ? y / height : 0;
    const size = 16 + intensity * 3 + density * 3;
    const leading = Math.max(9, 24 - density * 17);
    p.textStyle(index === 0 ? p.BOLD : p.NORMAL);
    p.textSize(size);
    y = drawWrappedLine(p, paragraph, margin + jitter(7, intensity * density), y, width, size, leading, density * intensity * 0.2);
    y += Math.max(4, 22 - density * 20);
  }

  if (intensity >= 0.7) {
    drawStamp(p, intensity >= 1 ? "事故存档" : "重点观察", 278, 214 + intensity * 44, 82 + intensity * 16, -0.18);
    drawSpeedLines(p, 244, 84, 94, Math.round(4 + intensity * 7));
  }

  const tags = extractShortWords(data);
  for (let i = 0; i < Math.round(intensity * 9); i += 1) {
    drawTag(p, tags[i % tags.length] || "异常", 18 + (i * 73) % 260, y + 8 + i * 21, i % 3 === 0, (i % 2 ? -1 : 1) * 0.08 * intensity);
  }

  if (intensity >= 1) {
    const blockY = height * 0.72;
    drawTextDensityBlock(p, [data.roast, data.verdict, ...tags], margin - 4, blockY, width + 8, height - blockY - 18, intensity);
  } else {
    drawBarcode(p, margin, height - 56, width, 34, intensity);
  }
}

function renderBigTextReceiptCanvas(p: p5, data: NormalizedReceiptData, intensity: number, height: number, roastLevel: RoastLevel) {
  const phrase = cleanBigPhrase(data.oneLineRoast || data.headline || data.roast);
  const chunks = splitBigPhrase(phrase);
  p.fill(0);
  p.noStroke();
  drawSpeedLines(p, 18, 32, 160 + intensity * 150, Math.round(5 + intensity * 12), -0.4);
  drawTag(p, data.topLabel || "SNAP VERDICT", 18, 36, intensity > 0.6, -0.06);

  let y = 92;
  chunks.slice(0, intensity >= 1 ? 5 : 4).forEach((chunk, index) => {
    const targetWidth = receiptWidth * (index === 0 ? 1.02 : 0.88 + intensity * 0.12);
    const size = fitTextSize(p, chunk, targetWidth, receiptWidth * (0.45 + intensity * 0.45), 34, 132 + intensity * 34);
    p.push();
    p.translate(receiptWidth / 2 + jitter(16, intensity), y + size * 0.52);
    p.rotate((index % 2 ? 1 : -1) * (0.04 + intensity * 0.13));
    p.textAlign(p.CENTER, p.CENTER);
    p.textStyle(p.BOLD);
    p.textSize(size);
    for (let ghost = 0; ghost < Math.round(intensity * 4); ghost += 1) {
      p.fill(0, 45 + ghost * 22);
      p.text(chunk, -ghost * 4, ghost * 5);
    }
    p.fill(0);
    p.text(chunk, 0, 0);
    p.pop();
    if (index === 1 && intensity > 0.55) {
      p.fill(0);
      p.rect(0, y + size * 0.28, receiptWidth, 18 + intensity * 18);
    }
    y += size * (0.76 - intensity * 0.1);
  });

  const notes = [data.subHeadline, data.tinyAdvice, data.verdict, ...extractShortWords(data)].filter(Boolean);
  p.textStyle(p.BOLD);
  p.textSize(11 + intensity * 3);
  for (let i = 0; i < Math.round(5 + intensity * 13); i += 1) {
    const x = 16 + (i * 61) % 300;
    const yy = Math.min(height - 32, 88 + (i * 47) % Math.max(140, height - 132));
    drawTag(p, String(notes[i % notes.length] || "补刀"), x, yy, i % 4 === 0, (i % 2 ? 1 : -1) * 0.13 * intensity);
  }

  if (roastLevel === "execution" || roastLevel === "public_execution") {
    p.textAlign(p.CENTER, p.CENTER);
    p.textStyle(p.BOLD);
    p.textSize(18);
    for (let yy = height - 124; yy < height - 20; yy += 21) p.text(`/// ${phrase} ///`, receiptWidth / 2, yy);
  }
}

function renderFaceReceiptCanvas(p: p5, data: NormalizedReceiptData, intensity: number, height: number, roastLevel: RoastLevel) {
  const words = extractShortWords(data);
  const pattern = facePatternType(roastLevel, data);
  p.textAlign(p.CENTER, p.CENTER);
  p.textStyle(p.BOLD);
  p.fill(0);
  drawTag(p, `${data.moodLabel || "BUDDY FACE"} / ${pattern}`, 18, 36, intensity > 0.75, 0);

  const cx = receiptWidth / 2;
  const cy = height * 0.47;
  const faceW = 270 + intensity * 34;
  const faceH = 300 + intensity * 80;
  drawTextArc(p, words, cx, cy, faceW / 2, faceH / 2, 0.18, Math.PI * 1.82, 12 + intensity * 7);

  const eyeWord = words[0] || "嗯？";
  const browWord = words[1] || "行吧";
  const mouthWord = words[2] || data.shortComment.slice(0, 4) || "离谱";
  const angry = pattern === "angry" || pattern === "breakdown" || pattern === "judgement";
  const disgust = pattern === "disgust" || pattern === "speechless";
  drawFaceFeature(p, browWord, cx - 76, cy - 100, 58, angry ? -0.38 : -0.12, intensity);
  drawFaceFeature(p, browWord, cx + 76, cy - 100, 58, angry ? 0.38 : 0.12, intensity);
  drawFaceFeature(p, eyeWord, cx - 70, cy - 58, 42 + intensity * 18, disgust ? 0.18 : 0, intensity);
  drawFaceFeature(p, eyeWord, cx + 70, cy - 58, 42 + intensity * 18, disgust ? -0.18 : 0, intensity);

  if (pattern === "smile" || pattern === "confused") {
    drawTextArc(p, [mouthWord, data.shortComment, ...words], cx, cy + 70, 86, 46, 0.12, Math.PI - 0.12, 13 + intensity * 5);
  } else if (pattern === "breakdown") {
    drawTextArc(p, [mouthWord, data.shortComment, ...words], cx, cy + 82, 118, 84, 0.04, Math.PI * 1.96, 16 + intensity * 8);
    p.stroke(0);
    p.strokeWeight(8);
    p.noFill();
    p.rect(cx - 72, cy + 36, 144, 112);
  } else {
    drawFaceFeature(p, mouthWord.repeat(2), cx, cy + 78, 70 + intensity * 36, disgust ? -0.16 : 0.08, intensity);
  }

  const labelCount = Math.round(5 + intensity * 16);
  for (let i = 0; i < labelCount; i += 1) {
    const angle = (i / labelCount) * Math.PI * 2;
    const radius = 120 + ((i * 31) % 54) + intensity * 20;
    drawTag(
      p,
      words[i % words.length] || "检测",
      cx + Math.cos(angle) * radius - 24,
      cy + Math.sin(angle) * radius,
      intensity > 0.7 && i % 3 === 0,
      angle * 0.18
    );
  }

  if (intensity >= 0.75) drawSpeedLines(p, 20, height - 116, 320, Math.round(8 + intensity * 10), -0.25);
  if (intensity >= 1) drawTextDensityBlock(p, [data.shortComment, ...words], 20, height - 150, 344, 120, 0.7);
}

function normalizeReceiptData(data: unknown): NormalizedReceiptData {
  const value = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const findings = arrayOfStrings(value.findings ?? value.tags ?? value.keywords);
  const keywords = arrayOfStrings(value.keywords ?? value.tags ?? value.findings);
  const scores = Array.isArray(value.scores)
    ? (value.scores as Array<{ label?: unknown; value?: unknown }>).map((score, index) => ({
        label: String(score.label ?? `SCORE ${index + 1}`),
        value: Number(score.value ?? 50)
      }))
    : [
        { label: "构图风险", value: 72 },
        { label: "吐槽浓度", value: 84 },
        { label: "可发程度", value: 58 }
      ];
  const roast = firstString(value.roast, value.oneLineRoast, value.shortComment, value.caption, value.aiComment, value.generatedComment, "这张照片很努力，努力到机器都想递一张补拍申请。");

  return {
    title: firstString(value.title, "SNAP ROAST BUDDY"),
    subtitle: firstString(value.subtitle, value.topLabel, "AI 照片检测小票"),
    photoType: firstString(value.photoType, value.sceneType, keywords[0], "生活切片"),
    atmosphere: firstString(value.atmosphere, value.mood, "努力营业中"),
    aiMood: firstString(value.aiMood, value.moodLabel, "正在憋笑"),
    findings: findings.length ? findings : ["主体和背景正在争夺主场", "画面诚意很足，秩序稍微掉线"],
    scores,
    roast,
    advice: firstString(value.advice, value.tinyAdvice, "建议下次先稳住镜头，再稳住全场。"),
    verdict: firstString(value.verdict, value.headline, "可发，但需要配文自救"),
    topLabel: firstString(value.topLabel, value.subtitle, ">>> 现场判定 <<<"),
    headline: firstString(value.headline, value.verdict, roast.slice(0, 8)),
    subHeadline: firstString(value.subHeadline, value.subtitle, ""),
    oneLineRoast: firstString(value.oneLineRoast, roast),
    tinyAdvice: firstString(value.tinyAdvice, value.advice, "建议：重拍也不是不行"),
    moodLabel: firstString(value.moodLabel, value.aiMood, "无语检测"),
    keywords,
    shortComment: firstString(value.shortComment, roast)
  };
}

function normalizeReceiptMode(mode: ReceiptMode): "simple" | "bigText" | "face" {
  if (mode === "bigText" || mode === "big_text") return "bigText";
  if (mode === "face" || mode === "pixel_expression" || mode === "expression") return "face";
  return "simple";
}

function drawThermalTexture(p: p5, height: number, intensity: number) {
  p.push();
  p.stroke(0, 16);
  p.strokeWeight(1);
  for (let y = 0; y < height; y += 9) p.line(0, y, receiptWidth, y);
  p.stroke(0, 18 + intensity * 12);
  for (let x = 10; x < receiptWidth; x += 31) p.point(x, (x * 17) % height);
  p.pop();
}

function drawMangaBlock(p: p5, image: p5.Image | undefined, y: number, imageUrl: string) {
  p.push();
  p.fill(255);
  p.stroke(0);
  p.strokeWeight(2);
  drawDashedLine(p, 18, y + 16, receiptWidth - 18, y + 16);
  p.noStroke();
  p.fill(0);
  p.textAlign(p.CENTER, p.TOP);
  p.textStyle(p.BOLD);
  p.textSize(17);
  p.text("[ BUDDY COMIC STRIP ]", receiptWidth / 2, y + 32);
  p.stroke(0);
  p.strokeWeight(2);
  p.noFill();
  p.rect(18, y + 62, receiptWidth - 36, 200);
  if (image) {
    p.image(image, 26, y + 70, receiptWidth - 52, 184);
  } else {
    p.noStroke();
    p.fill(0);
    p.textSize(13);
    p.text("漫画加载中", receiptWidth / 2, y + 148);
    if (imageUrl.startsWith("data:")) p.text("本地图片", receiptWidth / 2, y + 170);
  }
  drawDashedLine(p, 18, y + 278, receiptWidth - 18, y + 278);
  p.pop();
}

function drawSectionLabel(p: p5, text: string, x: number, y: number, intensity: number) {
  p.push();
  p.fill(0);
  p.rect(x, y - 2, 112 + intensity * 30, 20);
  p.fill(255);
  p.textAlign(p.LEFT, p.TOP);
  p.textStyle(p.BOLD);
  p.textSize(12);
  p.text(text, x + 8, y + 2);
  p.pop();
}

function drawWrappedLine(p: p5, text: string, x: number, y: number, width: number, size: number, leading: number, overlap = 0) {
  const lines = wrapChineseText(p, text, width);
  for (const [index, line] of lines.entries()) {
    p.push();
    p.translate(x + jitter(7, overlap), y + index * leading);
    p.rotate(jitter(0.04, overlap));
    p.text(line, 0, 0);
    p.pop();
  }
  return y + lines.length * leading + size * 0.2;
}

function drawBarcode(p: p5, x: number, y: number, width: number, height: number, intensity: number) {
  p.push();
  p.noStroke();
  p.fill(0);
  let cursor = x;
  while (cursor < x + width) {
    const w = 2 + ((cursor * 7) % 9) * (0.45 + intensity * 0.16);
    p.rect(cursor, y, w, height);
    cursor += w + 2 + ((cursor * 5) % 6);
  }
  p.pop();
}

function cleanBigPhrase(text: string) {
  return String(text || "").replace(/\n+/g, " ").replace(/\s+/g, "").slice(0, 24) || "离谱";
}

function splitBigPhrase(text: string): string[] {
  if (text.length <= 4) return [...text];
  if (text.length <= 9) return text.match(/.{1,3}/g) ?? [text];
  return text.match(/.{1,4}/g) ?? [text];
}

function fitTextSize(p: p5, text: string, maxWidth: number, targetHeight: number, min: number, max: number) {
  let size = max;
  p.textStyle(p.BOLD);
  while (size > min) {
    p.textSize(size);
    if (p.textWidth(text) <= maxWidth && size <= targetHeight) break;
    size -= 2;
  }
  return size;
}

function facePatternType(roastLevel: RoastLevel, data: NormalizedReceiptData) {
  if (roastLevel === "gentle") return data.shortComment.includes("？") ? "confused" : "smile";
  if (roastLevel === "normal") return "speechless";
  if (roastLevel === "spicy") return data.shortComment.includes("怒") ? "angry" : "disgust";
  return data.shortComment.includes("审") ? "judgement" : "breakdown";
}

function drawTextArc(p: p5, words: string[], cx: number, cy: number, rx: number, ry: number, start: number, end: number, size: number) {
  const count = Math.max(10, Math.round((end - start) * 8));
  p.textStyle(p.BOLD);
  p.textSize(size);
  for (let i = 0; i < count; i += 1) {
    const t = start + (end - start) * (i / Math.max(1, count - 1));
    const word = words[i % words.length] || "检测";
    p.push();
    p.translate(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry);
    p.rotate(t + Math.PI / 2);
    p.text(word, 0, 0);
    p.pop();
  }
}

function drawFaceFeature(p: p5, text: string, x: number, y: number, size: number, angle: number, intensity: number) {
  p.push();
  p.translate(x, y);
  p.rotate(angle);
  p.textAlign(p.CENTER, p.CENTER);
  p.textStyle(p.BOLD);
  p.textSize(size);
  for (let i = 0; i < Math.round(intensity * 3); i += 1) {
    p.fill(0, 56);
    p.text(text, -i * 3, i * 3);
  }
  p.fill(0);
  p.text(text, 0, 0);
  p.pop();
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function arrayOfStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string") return value.split(/[，。！？、\n,;；]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function jitter(range: number, intensity: number) {
  return (Math.random() - 0.5) * range * intensity;
}
