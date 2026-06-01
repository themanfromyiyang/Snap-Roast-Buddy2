import { generateRoastLayoutWithSkills } from "../../packages/layout/src/generateRoastLayoutWithSkills.js";
import type { LayoutType, RoastLevel, RoastMode } from "../../packages/layout/src/types.js";
import {
  createStandaloneMangaTicket,
  describeMode,
  layoutSkills,
  mapRoastLevel,
  modeToRoastMode,
  normalizeTextLayout,
  type MangaMode,
  type ProductRoastLevel,
  type TextGenerationMode
} from "./sharedProductFlow.js";
import { updateReceiptPreview } from "./htmlReceiptRenderer.js";
// 测试台对齐到产品页：打印走 ESP32 HTTP 桥接（HTTPS→HTTP 顶层跳转 + URL hash），
// 不再用 BLE，所以这里只保留 DOM→ESC/POS 位图的工具函数。
import {
  bytesToBase64,
  canvasToEscPosRaster,
  elementToCanvas
} from "./lib/printer.js";

type RoastApiResponse = {
  aiComment?: string;
  enhancedDescription?: string;
  error?: string;
  detail?: string;
};

type ImageAnalysisResponse = {
  photoDescription?: string;
  error?: string;
  detail?: string;
};

type ClassificationResponse = {
  layoutType?: LayoutType;
  reason?: string;
  confidence?: number;
  error?: string;
  detail?: string;
};

type DoodleResponse = {
  imageDataUrl?: string;
  imageUrl?: string;
  imageBase64?: string;
  prompt?: string;
  error?: string;
  detail?: string;
};

const textExamples = [
  {
    name: "朋友聚会自拍",
    text: "一张朋友聚会自拍，四个人挤在画面里，右边的人被裁掉半张脸，中间的人表情很夸张，背景有很多杂物，光线偏暗。"
  },
  {
    name: "景点主体失踪",
    text: "一个人站在景点前拍照，但是人物非常小，背景建筑很大，人物几乎看不清。"
  },
  {
    name: "委屈小狗",
    text: "一张小狗趴在地上的照片，它看着镜头，表情很委屈，画面很可爱。"
  },
  {
    name: "糊掉的夜拍",
    text: "一张夜晚街边自拍，灯光很暗，画面有点糊，朋友的手正在挥动，背景霓虹比人还抢眼。"
  },
  {
    name: "尴尬表情包",
    text: "一张室内生活照，一个人看着镜头表情很呆，像突然被点名，桌面有零食袋和杯子，气氛有点尴尬。"
  }
];

const imageExamples = [
  {
    name: "示例图 A",
    url: "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/suggestion/lbygavkzjykewmmpnzfutkvedlowunms.png"
  },
  {
    name: "小狗",
    url: "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=80"
  },
  {
    name: "旅行打卡",
    url: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80"
  }
];

const input = mustQuery<HTMLTextAreaElement>("#photoDescription");
const mode = mustQuery<HTMLSelectElement>("#mode");
const roastLevel = mustQuery<HTMLSelectElement>("#roastLevel");
const mangaMode = mustQuery<HTMLSelectElement>("#mangaMode");
const workflowReadout = mustQuery<HTMLElement>("#workflowReadout");
const imageUpload = mustQuery<HTMLInputElement>("#imageUpload");
const imageExamplesEl = mustQuery<HTMLDivElement>("#imageExamples");
const imagePreview = mustQuery<HTMLImageElement>("#imagePreview");
const analyzeImageButton = mustQuery<HTMLButtonElement>("#analyzeImageButton");
const classifyButton = mustQuery<HTMLButtonElement>("#classifyButton");
const generateButton = mustQuery<HTMLButtonElement>("#generateButton");
const generateMangaButton = mustQuery<HTMLButtonElement>("#generateMangaButton");
const testSupabaseButton = mustQuery<HTMLButtonElement>("#testSupabaseButton");
const printCurrentButton = mustQuery<HTMLButtonElement>("#printCurrentButton");
const examplesEl = mustQuery<HTMLDivElement>("#examples");
const receiptPaper = mustQuery<HTMLDivElement>("#print-preview");
const textPreview = mustQuery<HTMLPreElement>("#textPreview");
const layoutType = mustQuery<HTMLSpanElement>("#layoutType");
const reason = mustQuery<HTMLParagraphElement>("#reason");
const heightReadout = mustQuery<HTMLSpanElement>("#heightReadout");
const apiStatus = mustQuery<HTMLParagraphElement>("#apiStatus");
const aiCommentEl = mustQuery<HTMLParagraphElement>("#aiComment");
const imageStatus = mustQuery<HTMLParagraphElement>("#imageStatus");
const classificationType = mustQuery<HTMLSpanElement>("#classificationType");
const classificationConfidence = mustQuery<HTMLSpanElement>("#classificationConfidence");
const classificationReason = mustQuery<HTMLParagraphElement>("#classificationReason");
const classificationStatus = mustQuery<HTMLParagraphElement>("#classificationStatus");
const mangaStatus = mustQuery<HTMLParagraphElement>("#mangaStatus");
const supabaseStatus = mustQuery<HTMLParagraphElement>("#supabaseStatus");
const printerStatus = mustQuery<HTMLParagraphElement>("#printerStatus");

let inputUpdateTimer = 0;
let selectedImageUrl = "";
let selectedImageDataUrl = "";
let latestAiComment = "";
let latestEnhancedDescription = "";
let latestMangaImageUrl = "";
let classifiedLayoutType: LayoutType | undefined;
const statusStartTimes = new WeakMap<HTMLElement, number>();

input.value = textExamples[0].text;
selectedImageUrl = imageExamples[0].url;
imagePreview.src = selectedImageUrl;

for (const example of textExamples) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "example-button";
  button.textContent = example.name;
  button.addEventListener("click", () => {
    input.value = example.text;
    resetGeneratedState();
    renderLocal();
  });
  examplesEl.append(button);
}

for (const example of imageExamples) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "image-example-button";
  button.innerHTML = `<img src="${example.url}" alt="${example.name}" /><span>${example.name}</span>`;
  button.addEventListener("click", () => {
    selectedImageUrl = example.url;
    selectedImageDataUrl = "";
    imagePreview.src = example.url;
    resetGeneratedState();
  });
  imageExamplesEl.append(button);
}

imageUpload.addEventListener("change", async () => {
  const file = imageUpload.files?.[0];
  if (!file) return;
  selectedImageDataUrl = await optimizeImageDataUrl(await fileToDataUrl(file));
  selectedImageUrl = "";
  imagePreview.src = selectedImageDataUrl;
  resetGeneratedState();
});

analyzeImageButton.addEventListener("click", analyzeImage);
classifyButton.addEventListener("click", classifyDescription);
generateButton.addEventListener("click", generateWithApi);
generateMangaButton.addEventListener("click", generateMangaStep);
testSupabaseButton.addEventListener("click", testSupabaseConnection);
attachPrintButtonHandlers();
input.addEventListener("input", () => {
  resetGeneratedState();
  window.clearTimeout(inputUpdateTimer);
  inputUpdateTimer = window.setTimeout(renderLocal, 220);
});
mode.addEventListener("change", () => {
  classifiedLayoutType = undefined;
  renderClassification();
  renderWorkflow();
  renderLocal();
});
roastLevel.addEventListener("change", renderLocal);
mangaMode.addEventListener("change", () => {
  latestMangaImageUrl = "";
  renderWorkflow();
  renderLocal();
});

async function analyzeImage() {
  const imagePayload = selectedImageDataUrl || selectedImageUrl;
  if (!imagePayload) {
    setStepStatus(imageStatus, "请先上传图片或选择示例图片。", "error");
    return;
  }

  setBusy(analyzeImageButton, true, "正在分析图片...");
  setStepStatus(imageStatus, "正在调用视觉模型分析图片，请稍等。", "loading");
  setStatus("步骤 1：正在调用视觉模型分析图片。", "loading");

  try {
    const response = await fetch("/api/analyze-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(selectedImageDataUrl ? { imageDataUrl: selectedImageDataUrl } : { imageUrl: selectedImageUrl })
    });
    const payload = await parseJsonResponse<ImageAnalysisResponse>(response);
    if (!response.ok || payload.error) throw new Error(formatApiError(payload, "图片分析失败。"));

    input.value = payload.photoDescription?.trim() || input.value;
    resetGeneratedState();
    setStepStatus(imageStatus, "图片分析完成，描述已填入文本框。", "ready");
    setStepStatus(classificationStatus, "可以进行三分类。", "ready");
    setStatus("步骤 1 完成：已得到图片描述，可以继续三分类。", "ready");
    renderLocal();
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片分析失败。";
    setStepStatus(imageStatus, message, "error");
    setStatus(message, "error");
  } finally {
    setBusy(analyzeImageButton, false, "分析图片内容");
  }
}

async function classifyDescription() {
  const photoDescription = input.value.trim();
  if (!photoDescription) {
    setStepStatus(classificationStatus, "请先输入或分析得到图片描述。", "error");
    return;
  }

  if (mode.value !== "auto") {
    classifiedLayoutType = normalizeTextLayout(mode.value as LayoutType);
    classificationReason.textContent = "当前为强制模式，直接使用用户选择的文字排版。";
    classificationConfidence.textContent = "manual";
    setStepStatus(classificationStatus, "已使用强制模式。", "ready");
    renderClassification();
    renderLocal();
    return classifiedLayoutType;
  }

  setBusy(classifyButton, true, "正在分类...");
  setStepStatus(classificationStatus, "正在调用模型进行三分类。", "loading");
  setStatus("步骤 2：正在把描述分类到三种文字排版。", "loading");

  try {
    const response = await fetch("/api/classify-layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoDescription })
    });
    const payload = await parseJsonResponse<ClassificationResponse>(response);
    if (!response.ok || payload.error || !payload.layoutType) throw new Error(formatApiError(payload, "排版分类失败。"));

    classifiedLayoutType = normalizeTextLayout(payload.layoutType);
    classificationReason.textContent = payload.reason || "已完成分类。";
    classificationConfidence.textContent = typeof payload.confidence === "number" ? payload.confidence.toFixed(2) : "-";
    setStepStatus(classificationStatus, "三分类完成。", "ready");
    setStatus("步骤 2 完成：已选择文字排版类型。", "ready");
    renderClassification();
    renderLocal();
    return classifiedLayoutType;
  } catch (error) {
    classifiedLayoutType = undefined;
    const message = error instanceof Error ? error.message : "排版分类失败。";
    classificationReason.textContent = message;
    classificationConfidence.textContent = "-";
    setStepStatus(classificationStatus, message, "error");
    setStatus("分类失败，当前回退本地自动判断。", "error");
    renderClassification();
    renderLocal();
    return undefined;
  } finally {
    setBusy(classifyButton, false, "进行三分类");
  }
}

async function generateWithApi() {
  const photoDescription = input.value.trim();
  if (!photoDescription) {
    setStatus("请先输入照片描述。", "error");
    return;
  }

  setBusy(generateButton, true, "AI 正在生成...");
  setStatus("步骤 3：正在生成评价并排版。", "loading");

  try {
    const selectedLayout = normalizeTextLayout((classifiedLayoutType ?? (await classifyDescription())) as LayoutType);
    const generationMode = selectedLayout as RoastMode;
    const response = await fetch("/api/roast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        photoDescription,
        mode: generationMode,
        roastLevel: mapRoastLevel(roastLevel.value as ProductRoastLevel)
      })
    });

    const payload = await parseJsonResponse<RoastApiResponse>(response);
    if (!response.ok || payload.error) throw new Error(formatApiError(payload, "API request failed."));

    latestAiComment = payload.aiComment?.trim() ?? "";
    latestEnhancedDescription = payload.enhancedDescription?.trim() ?? "";
    aiCommentEl.textContent = latestAiComment || "模型没有返回评价，已使用本地模板。";
    setStatus("步骤 3 完成：AI 评价已生成，并完成小票排版。", "ready");
    if (mangaMode.value !== "none") {
      setStepStatus(mangaStatus, "可以继续第 4 步生成漫画。", "ready");
    }
    renderLocal();
  } catch (error) {
    latestAiComment = "";
    latestEnhancedDescription = "";
    aiCommentEl.textContent = error instanceof Error ? error.message : "API 调用失败，已回退本地模板。";
    setStatus("API 不可用，当前显示本地模板结果。", "error");
    renderLocal();
  } finally {
    setBusy(generateButton, false, "生成 AI 小票");
  }
}

async function generateMangaStep() {
  if (mangaMode.value === "none") {
    setStepStatus(mangaStatus, "请先在第 2 步把漫画设置为顶部、底部或单独。", "error");
    return;
  }

  const imagePayload = selectedImageDataUrl || selectedImageUrl;
  setBusy(generateMangaButton, true, "正在生成漫画...");
  setStepStatus(mangaStatus, "正在调用图像编辑模型，生成白底黑线漫画。", "loading");
  setStatus("步骤 4：正在生成漫画。", "loading");

  try {
    latestMangaImageUrl = await generateMangaImage(imagePayload);
    if (mangaMode.value === "standalone") {
      latestAiComment = "本机已把这张照片改造成适合热敏纸的白底黑线漫画。";
      latestEnhancedDescription = "";
      aiCommentEl.textContent = latestAiComment;
      renderStandaloneManga();
    } else {
      renderLocal();
    }
    setStepStatus(mangaStatus, "漫画已生成，并按当前设置更新到小票预览。", "ready");
    setStatus("步骤 4 完成：漫画已合入热敏纸结果。", "ready");
  } catch (error) {
    const message = error instanceof Error ? error.message : "漫画生成失败。";
    setStepStatus(mangaStatus, message, "error");
    setStatus(message, "error");
  } finally {
    setBusy(generateMangaButton, false, "生成漫画");
  }
}

async function generateMangaImage(imagePayload: string): Promise<string> {
  if (!imagePayload) throw new Error("漫画生成需要先上传图片或选择示例图片。");

  const response = await fetch("/api/generate-doodle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(selectedImageDataUrl ? { imageDataUrl: selectedImageDataUrl } : { imageUrl: selectedImageUrl })
  });
  const payload = await parseJsonResponse<DoodleResponse>(response);
  if (!response.ok || payload.error) throw new Error(formatApiError(payload, "漫画生成失败。"));

  const imageSrc = payload.imageDataUrl || payload.imageUrl || (payload.imageBase64 ? `data:image/png;base64,${payload.imageBase64}` : "");
  if (!imageSrc) throw new Error("图像编辑模型没有返回图片。");
  return imageSrc;
}

async function testSupabaseConnection() {
  setBusy(testSupabaseButton, true, "正在检测...");
  setStepStatus(supabaseStatus, "正在连接 Supabase product_records 表。", "loading");

  try {
    const response = await fetch("/api/supabase-health");
    const payload = await parseJsonResponse<{ ok?: boolean; table?: string; sampleCount?: number; error?: string; detail?: string }>(response);
    if (!response.ok || !payload.ok) throw new Error(payload.detail || payload.error || "Supabase 连接失败。");
    setStepStatus(
      supabaseStatus,
      `Supabase 连接成功：${payload.table ?? "product_records"}，读取到 ${payload.sampleCount ?? 0} 条样本。`,
      "ready"
    );
  } catch (error) {
    setStepStatus(supabaseStatus, error instanceof Error ? error.message : "Supabase 连接失败。", "error");
  } finally {
    setBusy(testSupabaseButton, false, "测试 Supabase 连接");
  }
}

// === ESP32 WiFi 打印（位图路径，与 product.ts 对齐） ==================
// 同 product.ts：DOM → canvas → ESC/POS GS v 0 → base64 → 跳 ESP32 bridge 页
// （HTTP origin）再同源 POST /print-chunk 分块上传。HTTPS→HTTP 顶层 navigation
// 浏览器放行；body 不会被 mixed-content 吞掉。
const ESP32_IP_STORAGE_KEY = "snap_roast_esp32_ip";
const PRINT_LONG_PRESS_MS = 900;

function getStoredEsp32Ip(): string {
  try {
    return (localStorage.getItem(ESP32_IP_STORAGE_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

function setStoredEsp32Ip(ip: string): void {
  try {
    if (ip) localStorage.setItem(ESP32_IP_STORAGE_KEY, ip);
    else localStorage.removeItem(ESP32_IP_STORAGE_KEY);
  } catch {
    // localStorage 不可用，跳过
  }
}

function normalizeIp(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function askForEsp32Ip(current: string): string {
  const hint =
    "请输入 ESP32 的 IP（在 Arduino 串口监视器里能看到，一般是 172.20.10.X）。\n" +
    "留空可清除已保存的 IP。";
  const next = window.prompt(hint, current);
  if (next === null) return current;
  const normalized = normalizeIp(next);
  setStoredEsp32Ip(normalized);
  if (normalized) {
    setStepStatus(printerStatus, `已保存 ESP32 IP：${normalized}`, "ready");
  } else {
    setStepStatus(printerStatus, "已清除 ESP32 IP（长按按钮可重新设置）。", "ready");
  }
  return normalized;
}

async function buildRasterBase64(element: HTMLElement): Promise<string> {
  const canvas = await elementToCanvas(element);
  const raster = canvasToEscPosRaster(canvas);
  return bytesToBase64(raster);
}

function submitRasterToEsp32(ip: string, base64: string): void {
  // 加 ?t=now 强制浏览器把它当新 URL：否则两次打印同一张小票时 hash 相同，
  // 顶层 navigation 不会重新加载 bridge 页面，里面的 IIFE 不再触发，body 发空。
  const encoded = encodeURIComponent(base64);
  const url = `http://${ip}/print-bridge?t=${Date.now()}#${encoded}`;
  console.log("[print] 跳转到 bridge:", `http://${ip}/print-bridge?t=…#…`, "base64 长度:", base64.length);
  window.location.href = url;
}

async function triggerEsp32Print(): Promise<void> {
  let ip = getStoredEsp32Ip();
  if (!ip) ip = askForEsp32Ip("");
  if (!ip) return;

  setBusy(printCurrentButton, true, "打印中");
  setStepStatus(printerStatus, "正在把当前排版转换为 384 点黑白位图。", "loading");
  let base64: string;
  try {
    base64 = await buildRasterBase64(receiptPaper);
  } catch (error) {
    setStepStatus(printerStatus, "位图生成失败：" + (error instanceof Error ? error.message : String(error)), "error");
    setBusy(printCurrentButton, false, "打印当前小票");
    return;
  }

  setStepStatus(printerStatus, `已生成 base64（${base64.length} 字符），跳 ESP32 bridge…`, "loading");
  try {
    submitRasterToEsp32(ip, base64);
  } catch (error) {
    setStepStatus(printerStatus, "跳转 bridge 失败：" + (error instanceof Error ? error.message : String(error)), "error");
    setBusy(printCurrentButton, false, "打印当前小票");
  }
}

// 长按设置 IP，短按触发打印；与 product.ts 行为一致
function attachPrintButtonHandlers(): void {
  let longPressTimer = 0;
  let longPressFired = false;

  const startLongPress = () => {
    longPressFired = false;
    window.clearTimeout(longPressTimer);
    longPressTimer = window.setTimeout(() => {
      longPressFired = true;
      askForEsp32Ip(getStoredEsp32Ip());
    }, PRINT_LONG_PRESS_MS);
  };
  const cancelLongPress = () => {
    window.clearTimeout(longPressTimer);
  };

  printCurrentButton.addEventListener("pointerdown", startLongPress);
  printCurrentButton.addEventListener("pointerup", cancelLongPress);
  printCurrentButton.addEventListener("pointerleave", cancelLongPress);
  printCurrentButton.addEventListener("pointercancel", cancelLongPress);

  printCurrentButton.addEventListener("click", (event) => {
    if (longPressFired) {
      event.preventDefault();
      longPressFired = false;
      return;
    }
    void triggerEsp32Print();
  });
}
// === /ESP32 WiFi 打印 =================================================

function renderLocal() {
  if (mangaMode.value === "standalone" && latestMangaImageUrl) {
    renderStandaloneManga();
    return;
  }

  const sourceDescription = latestEnhancedDescription || input.value;
  const result = generateRoastLayoutWithSkills(
    {
      photoDescription: sourceDescription,
      generatedComment: latestAiComment,
      mode: modeToRoastMode(mode.value as TextGenerationMode, classifiedLayoutType),
      roastLevel: mapRoastLevel(roastLevel.value as ProductRoastLevel),
      language: "zh",
      printWidthDots: 384,
      returnLayoutJson: true
    },
    layoutSkills
  );

  const previewMode = result.layoutType === "big_text" ? "big_text" : result.layoutType === "pixel_expression" ? "pixel_expression" : "receipt";
  const canvasSize = updateReceiptPreview(receiptPaper, result.content, previewMode, roastLevel.value as ProductRoastLevel, {
    mangaImageUrl: latestMangaImageUrl,
    mangaMode: mangaMode.value as MangaMode
  });
  textPreview.textContent = result.textPreview;
  layoutType.textContent = describeMode(result.layoutType);
  reason.textContent = result.reason;
  heightReadout.textContent = `${canvasSize.width}px x ${canvasSize.height}px`;
}

function renderStandaloneManga() {
  receiptPaper.innerHTML = createStandaloneMangaTicket(latestMangaImageUrl);
  textPreview.textContent = "[ 漫画 ]\n白底黑线、抽象漫画风格，适合热敏纸打印。";
  layoutType.textContent = "漫画";
  reason.textContent = "当前漫画设置为单独生成，直接输出热敏纸漫画。";
  heightReadout.textContent = "384px x manga";
}

function resetGeneratedState() {
  latestAiComment = "";
  latestEnhancedDescription = "";
  latestMangaImageUrl = "";
  classifiedLayoutType = undefined;
  aiCommentEl.textContent = "尚未调用 API，当前为本地模板预览。";
  classificationReason.textContent = "尚未分类。";
  classificationConfidence.textContent = "-";
  setStepStatus(classificationStatus, "等待三分类。", "ready");
  setStepStatus(mangaStatus, "漫画会直接由图片生成白底黑线结果，再按设置插入小票。", "ready");
  renderClassification();
  renderWorkflow();
}

function renderClassification() {
  classificationType.textContent = classifiedLayoutType ? describeMode(classifiedLayoutType) : mode.value === "auto" ? "等待分类" : describeMode(mode.value as TextGenerationMode);
}

function renderWorkflow() {
  const parts = ["图片分析"];
  if (mode.value === "auto" && mangaMode.value !== "standalone") parts.push("排版选择");
  if (mangaMode.value !== "standalone") parts.push("内容生成");
  if (mangaMode.value !== "none") parts.push("漫画生成");
  workflowReadout.textContent = parts.join(" / ");
}

function setStatus(message: string, state: "ready" | "loading" | "error") {
  apiStatus.textContent = formatStatusMessage(apiStatus, message, state);
  apiStatus.dataset.state = state;
}

function setStepStatus(element: HTMLElement, message: string, state: "ready" | "loading" | "error") {
  element.textContent = formatStatusMessage(element, message, state);
  element.dataset.state = state;
}

function formatStatusMessage(element: HTMLElement, message: string, state: "ready" | "loading" | "error"): string {
  if (state === "loading") {
    statusStartTimes.set(element, performance.now());
    return message;
  }

  const startedAt = statusStartTimes.get(element);
  if (startedAt === undefined) return message;
  statusStartTimes.delete(element);
  return `${message} · 耗时 ${formatDuration(performance.now() - startedAt)}`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatApiError(payload: { error?: string; detail?: string }, fallback: string): string {
  const detail = payload.detail || payload.error || fallback;
  if (detail.includes("Model disabled")) {
    return `${fallback} 当前模型不可用：Model disabled。请在 .env 中更换对应模型，或确认模型已在 SiliconFlow 账号中启用。`;
  }
  return detail;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const rawText = await response.text();
  try {
    return (rawText ? JSON.parse(rawText) : {}) as T;
  } catch {
    const message = rawText.trim().slice(0, 240) || `HTTP ${response.status}`;
    throw new Error(response.ok ? `服务器响应格式异常：${message}` : message);
  }
}

function setBusy(button: HTMLButtonElement, busy: boolean, label: string) {
  button.disabled = busy;
  button.textContent = label;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Failed to read image.")));
    reader.readAsDataURL(file);
  });
}

async function optimizeImageDataUrl(imageUrl: string): Promise<string> {
  const image = await loadImageElement(imageUrl);
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return imageUrl;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function loadImageElement(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("读取导入照片失败。")), { once: true });
    image.src = imageUrl;
  });
}

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing DOM element: ${selector}`);
  return element;
}

aiCommentEl.textContent = "尚未调用 API，当前为本地模板预览。";
classificationReason.textContent = "尚未分类。";
classificationConfidence.textContent = "-";
setStepStatus(imageStatus, "请选择示例图或上传图片。", "ready");
setStepStatus(classificationStatus, "等待三分类。", "ready");
setStepStatus(mangaStatus, "漫画会直接由图片生成白底黑线结果，再按设置插入小票。", "ready");
setStepStatus(supabaseStatus, "等待检测 Supabase。", "ready");
{
  const savedIp = getStoredEsp32Ip();
  setStepStatus(
    printerStatus,
    savedIp ? `已保存 ESP32 IP：${savedIp}（长按按钮可修改）` : "未设置 ESP32 IP（长按按钮可设置）",
    "ready"
  );
}
setStatus("API 就绪。可以从图片分析开始，也可以直接编辑文字生成。", "ready");
renderClassification();
renderWorkflow();
renderLocal();
