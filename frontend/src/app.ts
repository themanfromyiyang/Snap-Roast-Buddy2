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
import { updateReceiptPreview } from "./p5ReceiptRenderer.js";
import {
  connectPrinter,
  disconnectPrinter,
  feedDots,
  isPrinterConnected,
  printRasterFromElement,
  printTestText
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
const connectPrinterButton = mustQuery<HTMLButtonElement>("#connectPrinterButton");
const feedPrinterButton = mustQuery<HTMLButtonElement>("#feedPrinterButton");
const testPrintButton = mustQuery<HTMLButtonElement>("#testPrintButton");
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
  selectedImageDataUrl = await fileToDataUrl(file);
  selectedImageUrl = "";
  imagePreview.src = selectedImageDataUrl;
  resetGeneratedState();
});

analyzeImageButton.addEventListener("click", analyzeImage);
classifyButton.addEventListener("click", classifyDescription);
generateButton.addEventListener("click", generateWithApi);
generateMangaButton.addEventListener("click", generateMangaStep);
testSupabaseButton.addEventListener("click", testSupabaseConnection);
connectPrinterButton.addEventListener("click", togglePrinterConnection);
feedPrinterButton.addEventListener("click", testPrinterFeed);
testPrintButton.addEventListener("click", testPrinterText);
printCurrentButton.addEventListener("click", printCurrentLayout);
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
    const payload = (await response.json()) as ImageAnalysisResponse;
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
    const payload = (await response.json()) as ClassificationResponse;
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

    const payload = (await response.json()) as RoastApiResponse;
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
  const payload = (await response.json()) as DoodleResponse;
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
    const payload = (await response.json()) as { ok?: boolean; table?: string; sampleCount?: number; error?: string; detail?: string };
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

async function togglePrinterConnection() {
  if (isPrinterConnected()) {
    disconnectPrinter();
    setStepStatus(printerStatus, "未连接", "ready");
    connectPrinterButton.textContent = "连接打印机";
    return;
  }

  setBusy(connectPrinterButton, true, "正在连接");
  setStepStatus(printerStatus, "正在连接 SnapPrinter-S3。", "loading");
  try {
    await connectPrinter();
    setStepStatus(printerStatus, "已连接 SnapPrinter-S3。", "ready");
    connectPrinterButton.textContent = "断开打印机";
  } catch (error) {
    setStepStatus(printerStatus, error instanceof Error ? error.message : "连接失败。", "error");
    connectPrinterButton.textContent = "连接打印机";
  } finally {
    connectPrinterButton.disabled = false;
  }
}

async function testPrinterFeed() {
  if (!isPrinterConnected()) {
    setStepStatus(printerStatus, "未连接打印机。", "error");
    return;
  }
  setBusy(feedPrinterButton, true, "发送中");
  setStepStatus(printerStatus, "正在发送进纸指令。", "loading");
  try {
    await feedDots(80);
    setStepStatus(printerStatus, "测试进纸完成。", "ready");
  } catch (error) {
    setStepStatus(printerStatus, error instanceof Error ? error.message : "发送失败。", "error");
  } finally {
    setBusy(feedPrinterButton, false, "测试进纸");
  }
}

async function testPrinterText() {
  if (!isPrinterConnected()) {
    setStepStatus(printerStatus, "未连接打印机。", "error");
    return;
  }
  setBusy(testPrintButton, true, "打印中");
  setStepStatus(printerStatus, "正在打印英文测试文字。", "loading");
  try {
    await printTestText();
    setStepStatus(printerStatus, "测试文字打印完成。", "ready");
  } catch (error) {
    setStepStatus(printerStatus, error instanceof Error ? error.message : "打印失败。", "error");
  } finally {
    setBusy(testPrintButton, false, "测试文字");
  }
}

async function printCurrentLayout() {
  if (!isPrinterConnected()) {
    setStepStatus(printerStatus, "未连接打印机。", "error");
    return;
  }
  setBusy(printCurrentButton, true, "打印中");
  setStepStatus(printerStatus, "正在把当前排版转换为 384 点黑白位图。", "loading");
  try {
    await printRasterFromElement(receiptPaper);
    setStepStatus(printerStatus, "打印完成。", "ready");
  } catch (error) {
    setStepStatus(printerStatus, error instanceof Error ? error.message : "打印失败。", "error");
  } finally {
    setBusy(printCurrentButton, false, "打印当前排版");
  }
}

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
setStepStatus(printerStatus, "未连接", "ready");
setStatus("API 就绪。可以从图片分析开始，也可以直接编辑文字生成。", "ready");
renderClassification();
renderWorkflow();
renderLocal();
