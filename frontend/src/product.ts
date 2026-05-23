import { generateRoastLayoutWithSkills } from "../../packages/layout/src/generateRoastLayoutWithSkills.js";
import type { LayoutSkill, LayoutType, RoastLevel, RoastMode } from "../../packages/layout/src/types.js";

type ProductLayoutType = "receipt" | "big_text" | "expression" | "sketch";
type TriggerMode = "auto" | "manual";
type GenerationMode = "auto" | "receipt" | "big_text" | "expression";
type ProductRoastLevel = RoastLevel | "public_execution";
type SketchMode = "none" | "top" | "bottom" | "standalone";

type ProductSettings = {
  triggerMode: TriggerMode;
  generationMode: GenerationMode;
  roastLevel: ProductRoastLevel;
  sketchMode: SketchMode;
};

type PhotoRecord = {
  id: string;
  originalImageUrl: string;
  createdAt: string;
  description?: string;
  layoutType: ProductLayoutType;
  generationMode: GenerationMode;
  roastLevel: ProductRoastLevel;
  sketchMode: SketchMode;
  ticketHtml?: string;
  ticketText?: string;
  sketchImageUrl?: string;
  caption?: string;
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

type RoastApiResponse = {
  aiComment?: string;
  enhancedDescription?: string;
  error?: string;
  detail?: string;
};

type DoodleResponse = {
  imageUrl?: string;
  imageBase64?: string;
  error?: string;
  detail?: string;
};

type ProductRecordsResponse = {
  records?: PhotoRecord[];
  record?: PhotoRecord;
  error?: string;
  detail?: string;
};

const layoutSkills: LayoutSkill[] = [
  {
    name: "receipt_default",
    layoutType: "receipt",
    tone: "normal",
    triggerKeywords: ["自拍", "合照", "聚会", "美食", "旅行", "宠物", "杂物", "光线"],
    visualMotifs: ["今日照片审判小票", "朋友合照检测单", "AI 成片体检报告"]
  },
  {
    name: "big_text_variety_show",
    layoutType: "big_text",
    tone: "normal",
    triggerKeywords: ["糊", "裁掉", "太近", "太远", "主体不明", "背景抢戏", "离谱", "非常小"],
    visualMotifs: [">>> 紧急播报 <<<", "!!! 构图警告 !!!", ">>> 现场判定 <<<", "=== 友情事故 ==="]
  },
  {
    name: "pixel_expression_default",
    layoutType: "pixel_expression",
    tone: "normal",
    triggerKeywords: ["可爱", "尴尬", "震惊", "无语", "浪漫", "委屈", "呆", "小狗", "小猫"],
    visualMotifs: ["SNAP BUDDY MOOD", "BUDDY FACE", "AI 心情卡片"]
  }
];

const settings: ProductSettings = {
  triggerMode: "auto",
  generationMode: "auto",
  roastLevel: "normal",
  sketchMode: "none"
};

const cameraScreen = mustQuery<HTMLElement>("#cameraScreen");
const generatingScreen = mustQuery<HTMLElement>("#generatingScreen");
const resultScreen = mustQuery<HTMLElement>("#resultScreen");
const settingsSheet = mustQuery<HTMLElement>("#settingsSheet");
const settingsBackdrop = mustQuery<HTMLElement>("#settingsBackdrop");
const regenerateSheet = mustQuery<HTMLElement>("#regenerateSheet");
const regenerateBackdrop = mustQuery<HTMLElement>("#regenerateBackdrop");
const sketchDetailGroup = mustQuery<HTMLElement>("#sketchDetailGroup");
const regenerateSketchDetailGroup = mustQuery<HTMLElement>("#regenerateSketchDetailGroup");
const settingsButton = mustQuery<HTMLButtonElement>("#settingsButton");
const sketchToggleButton = mustQuery<HTMLButtonElement>("#sketchToggleButton");
const closeSettingsButton = mustQuery<HTMLButtonElement>("#closeSettingsButton");
const closeRegenerateButton = mustQuery<HTMLButtonElement>("#closeRegenerateButton");
const viewfinder = mustQuery<HTMLDivElement>("#viewfinder");
const cameraPreview = mustQuery<HTMLImageElement>("#cameraPreview");
const emptyViewfinder = mustQuery<HTMLDivElement>("#emptyViewfinder");
const manualStartPanel = mustQuery<HTMLDivElement>("#manualStartPanel");
const cameraHint = mustQuery<HTMLParagraphElement>("#cameraHint");
const modeStrip = mustQuery<HTMLDivElement>(".camera-mode-strip");
const shutterButton = mustQuery<HTMLButtonElement>("#shutterButton");
const galleryButton = mustQuery<HTMLButtonElement>("#galleryButton");
const latestButton = mustQuery<HTMLButtonElement>("#latestButton");
const latestThumb = mustQuery<HTMLSpanElement>("#latestThumb");
const startGenerateButton = mustQuery<HTMLButtonElement>("#startGenerateButton");
const imageInput = mustQuery<HTMLInputElement>("#productImageInput");
const generatingImage = mustQuery<HTMLImageElement>("#generatingImage");
const generatingStep = mustQuery<HTMLParagraphElement>("#generatingStep");
const generatingTitle = mustQuery<HTMLHeadingElement>("#generatingTitle");
const generatingMessage = mustQuery<HTMLParagraphElement>("#generatingMessage");
const progressFill = mustQuery<HTMLSpanElement>("#progressFill");
const resultScroller = mustQuery<HTMLDivElement>("#resultScroller");
const resultOriginalImage = mustQuery<HTMLImageElement>("#resultOriginalImage");
const recordTime = mustQuery<HTMLSpanElement>("#recordTime");
const recordMode = mustQuery<HTMLElement>("#recordMode");
const recordCounter = mustQuery<HTMLHeadingElement>("#recordCounter");
const ticketLongPreview = mustQuery<HTMLDivElement>("#ticketLongPreview");
const regenerateButton = mustQuery<HTMLButtonElement>("#regenerateButton");
const deleteRecordButton = mustQuery<HTMLButtonElement>("#deleteRecordButton");
const backToCameraButton = mustQuery<HTMLButtonElement>("#backToCameraButton");
const confirmRegenerateButton = mustQuery<HTMLButtonElement>("#confirmRegenerateButton");
const imageLightbox = mustQuery<HTMLDivElement>("#imageLightbox");
const lightboxImage = mustQuery<HTMLImageElement>("#lightboxImage");
const closeImageLightboxButton = mustQuery<HTMLButtonElement>("#closeImageLightboxButton");

let selectedImageUrl = "";
let records: PhotoRecord[] = [];
let currentRecordIndex = 0;
let isGenerating = false;
let messageTimer = 0;
let swipeStartX = 0;
let funMessageIndex = 0;
let regenerateDraftSettings: ProductSettings = { ...settings };

const funGeneratingMessages = [
  "正在寻找照片里最会抢戏的角落。",
  "Buddy 正在压住自己不要笑太大声。",
  "正在把离谱程度换算成热敏纸长度。",
  "正在确认吐槽集中在构图、光线和氛围。",
  "正在给这张照片找一个体面的下台阶。",
  "热敏纸已就位，节目效果正在加载。"
];

settingsButton.addEventListener("click", openSettings);
sketchToggleButton.addEventListener("click", () => {
  settings.sketchMode = settings.sketchMode === "none" ? "top" : "none";
  renderSettings(false);
});
closeSettingsButton.addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", closeSettings);
closeRegenerateButton.addEventListener("click", closeRegenerateSheet);
regenerateBackdrop.addEventListener("click", closeRegenerateSheet);
shutterButton.addEventListener("click", openImagePicker);
galleryButton.addEventListener("click", () => {
  if (records.length > 0) showResult(0);
});
latestButton.addEventListener("click", () => {
  cameraHint.textContent = "镜头翻转会在接入真实相机后启用。";
});
viewfinder.addEventListener("click", openImagePicker);
viewfinder.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") openImagePicker();
});
manualStartPanel.addEventListener("click", (event) => event.stopPropagation());
startGenerateButton.addEventListener("click", (event) => {
  event.stopPropagation();
  void startGenerationFromSelected();
});
backToCameraButton.addEventListener("click", showCamera);
regenerateButton.addEventListener("click", openRegenerateSheet);
confirmRegenerateButton.addEventListener("click", () => confirmRegenerate());
deleteRecordButton.addEventListener("click", () => deleteCurrentRecord());
resultOriginalImage.addEventListener("click", openImageLightbox);
closeImageLightboxButton.addEventListener("click", closeImageLightbox);
imageLightbox.addEventListener("click", (event) => {
  if (event.target === imageLightbox) closeImageLightbox();
});
document.addEventListener("keydown", (event) => {
  if (!resultScreen.hidden && event.key === "ArrowLeft") shiftRecord(-1);
  if (!resultScreen.hidden && event.key === "ArrowRight") shiftRecord(1);
  if (!imageLightbox.hidden && event.key === "Escape") closeImageLightbox();
});
resultScreen.addEventListener("touchstart", (event) => {
  swipeStartX = event.touches[0]?.clientX ?? 0;
});
resultScreen.addEventListener("touchend", (event) => {
  const endX = event.changedTouches[0]?.clientX ?? swipeStartX;
  const delta = endX - swipeStartX;
  if (Math.abs(delta) > 58) shiftRecord(delta > 0 ? -1 : 1);
});

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  imageInput.value = "";
  if (!file) return;
  selectedImageUrl = await fileToDataUrl(file);
  cameraPreview.src = selectedImageUrl;
  cameraPreview.hidden = false;
  emptyViewfinder.hidden = true;
  manualStartPanel.hidden = settings.triggerMode === "auto";
  cameraHint.textContent =
    settings.triggerMode === "auto" ? "Buddy 已经开始观察这张照片。" : "照片已放进取景框，按开始生成。";
  if (settings.triggerMode === "auto") await startGenerationFromSelected();
});

document.querySelectorAll<HTMLElement>("[data-setting]").forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-value]");
    if (!button) return;
    updateSetting(button.dataset.setting ?? group.dataset.setting ?? "", button.dataset.value ?? "");
  });
});

document.querySelectorAll<HTMLElement>("[data-regenerate-setting]").forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-value]");
    if (!button) return;
    updateRegenerateDraft(group.dataset.regenerateSetting ?? "", button.dataset.value ?? "");
  });
});

function openImagePicker() {
  if (isGenerating) return;
  imageInput.click();
}

async function startGenerationFromSelected() {
  if (!selectedImageUrl || isGenerating) return;
  isGenerating = true;
  showGenerating(selectedImageUrl);

  try {
    const record = await generateSnapRoastResult(selectedImageUrl, settings);
    const savedRecord = await saveProductRecord(record);
    records = [savedRecord, ...records.filter((item) => item.id !== savedRecord.id)];
    renderLatestThumb();
    showResult(0);
  } catch (error) {
    showCamera();
    cameraHint.textContent = error instanceof Error ? error.message : "生成失败，请换一张照片再试。";
  } finally {
    window.clearInterval(messageTimer);
    isGenerating = false;
  }
}

async function regenerateCurrent() {
  const current = records[currentRecordIndex];
  if (!current || isGenerating) return;
  selectedImageUrl = current.originalImageUrl;
  isGenerating = true;
  showGenerating(selectedImageUrl);

  try {
    const record = await generateSnapRoastResult(selectedImageUrl, settings);
    const savedRecord = await saveProductRecord(record);
    records = [savedRecord, ...records.filter((item) => item.id !== savedRecord.id)];
    renderLatestThumb();
    showResult(0);
  } catch (error) {
    showResult(currentRecordIndex);
    cameraHint.textContent = error instanceof Error ? error.message : "重新生成失败。";
  } finally {
    window.clearInterval(messageTimer);
    isGenerating = false;
  }
}

function openRegenerateSheet() {
  if (!records[currentRecordIndex] || isGenerating) return;
  regenerateDraftSettings = { ...settings };
  renderRegenerateSettings();
  regenerateBackdrop.hidden = false;
  regenerateSheet.hidden = false;
}

function closeRegenerateSheet() {
  regenerateBackdrop.hidden = true;
  regenerateSheet.hidden = true;
}

async function confirmRegenerate() {
  settings.triggerMode = regenerateDraftSettings.triggerMode;
  settings.generationMode = regenerateDraftSettings.generationMode;
  settings.roastLevel = regenerateDraftSettings.roastLevel;
  settings.sketchMode = regenerateDraftSettings.sketchMode;
  renderSettings(false);
  closeRegenerateSheet();
  await regenerateCurrent();
}

async function deleteCurrentRecord() {
  const current = records[currentRecordIndex];
  if (!current) return;
  await deleteProductRecord(current.id);
  records = records.filter((item) => item.id !== current.id);
  renderLatestThumb();
  if (records.length === 0) {
    showCamera();
    return;
  }
  showResult(Math.min(currentRecordIndex, records.length - 1));
}

async function generateSnapRoastResult(imageUrl: string, productSettings: ProductSettings): Promise<PhotoRecord> {
  const createdAt = new Date().toISOString();
  const wantsStandaloneSketch = productSettings.sketchMode === "standalone";
  const shouldAddSketch = productSettings.sketchMode === "top" || productSettings.sketchMode === "bottom";
  const needsLayoutChoice = productSettings.generationMode === "auto";
  const totalSteps = wantsStandaloneSketch ? 1 : 2 + (needsLayoutChoice ? 1 : 0) + (shouldAddSketch ? 1 : 0);
  let currentStep = 1;

  if (wantsStandaloneSketch) {
    setGenerationStage(currentStep, totalSteps, "正在生成漫画……", "正在把照片压成白底黑线。");
    const sketchImageUrl = await generateSketch(imageUrl);
    return {
      id: createId(),
      originalImageUrl: imageUrl,
      createdAt,
      layoutType: "sketch",
      generationMode: productSettings.generationMode,
      roastLevel: productSettings.roastLevel,
      sketchMode: productSettings.sketchMode,
      sketchImageUrl
    };
  }

  const sketchPromise = shouldAddSketch ? generateSketch(imageUrl) : undefined;

  setGenerationStage(currentStep, totalSteps, "正在分析图片……", "正在把照片翻译成 Buddy 看得懂的描述。");
  const description = await analyzeImage(imageUrl);
  currentStep += 1;
  const layoutType = await resolveLayoutType(description, productSettings, currentStep, totalSteps);
  if (needsLayoutChoice) currentStep += 1;

  setGenerationStage(currentStep, totalSteps, "正在生成内容……", "正在写一段能打印出来的评价。");
  const roast = await generateRoast(description, layoutType, productSettings.roastLevel);
  const sourceDescription = roast.enhancedDescription || description;

  const layoutResult = generateRoastLayoutWithSkills(
    {
      photoDescription: sourceDescription,
      generatedComment: roast.aiComment,
      mode: layoutType,
      roastLevel: mapRoastLevel(productSettings.roastLevel),
      language: "zh",
      printWidthDots: 384,
      returnLayoutJson: true
    },
    layoutSkills
  );
  currentStep += 1;
  let sketchImageUrl: string | undefined;
  if (sketchPromise) {
    setGenerationStage(currentStep, totalSteps, "正在生成漫画……", "漫画和内容已并行处理，正在合并最终结果。");
    sketchImageUrl = await sketchPromise;
  }

  return {
    id: createId(),
    originalImageUrl: imageUrl,
    createdAt,
    description,
    layoutType: toProductLayoutType(layoutType),
    generationMode: productSettings.generationMode,
    roastLevel: productSettings.roastLevel,
    sketchMode: shouldAddSketch ? productSettings.sketchMode : "none",
    ticketHtml: layoutResult.renderResult?.svg,
    ticketText: layoutResult.textPreview,
    sketchImageUrl,
    caption: roast.aiComment
  };
}

async function analyzeImage(imageUrl: string): Promise<string> {
  const payload = await postJson<ImageAnalysisResponse>("/api/analyze-image", { imageDataUrl: imageUrl });
  if (!payload.photoDescription) throw new Error("视觉模型没有返回图片描述。");
  return payload.photoDescription.trim();
}

async function resolveLayoutType(
  description: string,
  productSettings: ProductSettings,
  currentStep: number,
  totalSteps: number
): Promise<RoastMode> {
  if (productSettings.generationMode === "receipt") return "receipt";
  if (productSettings.generationMode === "big_text") return "big_text";
  if (productSettings.generationMode === "expression") return "pixel_expression";

  setGenerationStage(currentStep, totalSteps, "正在选择排版……", "正在决定该开小票、爆大字，还是摆表情。");
  const payload = await postJson<ClassificationResponse>("/api/classify-layout", { photoDescription: description });
  return payload.layoutType && payload.layoutType !== "pixel_doodle" ? payload.layoutType : "receipt";
}

async function generateRoast(description: string, layoutType: RoastMode, roastLevel: ProductRoastLevel) {
  return postJson<RoastApiResponse>("/api/roast", {
    photoDescription: description,
    mode: layoutType,
    roastLevel: mapRoastLevel(roastLevel)
  });
}

async function generateSketch(imageUrl: string): Promise<string> {
  const payload = await postJson<DoodleResponse>("/api/generate-doodle", { imageDataUrl: imageUrl });
  const result = payload.imageUrl || (payload.imageBase64 ? `data:image/png;base64,${payload.imageBase64}` : "");
  if (!result) throw new Error("漫画模型没有返回图片。");
  return result;
}

function renderCurrentRecord() {
  const record = records[currentRecordIndex];
  if (!record) return;

  resultOriginalImage.src = record.originalImageUrl;
  recordTime.textContent = formatTime(record.createdAt);
  recordMode.textContent = modeLabel(record);
  recordCounter.textContent = `${currentRecordIndex + 1} / ${records.length}`;
  ticketLongPreview.innerHTML = "";

  if (
    record.sketchImageUrl &&
    (record.sketchMode === "top" || record.layoutType === "sketch")
  ) {
    ticketLongPreview.append(createSketchBlock(record));
  }

  if (record.ticketHtml) {
    ticketLongPreview.append(createPrinterSlot());
    const shell = document.createElement("div");
    shell.className = "product-paper";
    shell.innerHTML = record.ticketHtml;
    ticketLongPreview.append(shell);
  } else if (record.ticketText) {
    ticketLongPreview.append(createPrinterSlot());
    const paper = document.createElement("pre");
    paper.className = "product-paper text-paper";
    paper.textContent = record.ticketText;
    ticketLongPreview.append(paper);
  }

  if (record.sketchImageUrl && record.sketchMode === "bottom") {
    ticketLongPreview.append(createSketchBlock(record));
  }

  if (!record.ticketHtml && !record.ticketText && !record.sketchImageUrl) {
    const empty = document.createElement("p");
    empty.className = "empty-ticket";
    empty.textContent = "这张结果还没有可展示内容。";
    ticketLongPreview.append(empty);
  }

  resultScroller.scrollTop = 0;
}

function createPrinterSlot(): HTMLElement {
  const slot = document.createElement("div");
  slot.className = "printer-slot";
  const mouth = document.createElement("span");
  slot.append(mouth);
  return slot;
}

function createSketchBlock(record: PhotoRecord): HTMLElement {
  const block = document.createElement("figure");
  block.className = "sketch-ticket-block";
  const img = document.createElement("img");
  img.src = record.sketchImageUrl ?? "";
  img.alt = "白底黑线漫画";
  block.append(img);
  if (record.caption && record.layoutType === "sketch") {
    const caption = document.createElement("figcaption");
    caption.textContent = record.caption;
    block.append(caption);
  }
  return block;
}

function showCamera() {
  cameraScreen.hidden = false;
  generatingScreen.hidden = true;
  resultScreen.hidden = true;
}

function showGenerating(imageUrl: string) {
  cameraScreen.hidden = true;
  generatingScreen.hidden = false;
  resultScreen.hidden = true;
  generatingImage.src = imageUrl;
  window.clearInterval(messageTimer);
  setGenerationStage(1, 3, "正在准备生成……", "Buddy 正在观察照片。");
  messageTimer = window.setInterval(() => {
    funMessageIndex = (funMessageIndex + 1) % funGeneratingMessages.length;
    generatingMessage.textContent = funGeneratingMessages[funMessageIndex];
  }, 1500);
}

function showResult(index: number) {
  currentRecordIndex = Math.max(0, Math.min(index, records.length - 1));
  cameraScreen.hidden = true;
  generatingScreen.hidden = true;
  resultScreen.hidden = false;
  renderCurrentRecord();
}

function shiftRecord(offset: number) {
  if (records.length <= 1) return;
  const next = (currentRecordIndex + offset + records.length) % records.length;
  showResult(next);
}

function openImageLightbox() {
  const current = records[currentRecordIndex];
  if (!current) return;
  lightboxImage.src = current.originalImageUrl;
  imageLightbox.hidden = false;
}

function closeImageLightbox() {
  imageLightbox.hidden = true;
}

function openSettings() {
  settingsBackdrop.hidden = false;
  settingsSheet.hidden = false;
  renderSettings();
}

function closeSettings() {
  settingsBackdrop.hidden = true;
  settingsSheet.hidden = true;
}

function updateRegenerateDraft(key: string, value: string) {
  if (key === "generationMode") regenerateDraftSettings.generationMode = value as GenerationMode;
  if (key === "roastLevel") regenerateDraftSettings.roastLevel = value as ProductRoastLevel;
  if (key === "sketchEnabled") {
    regenerateDraftSettings.sketchMode =
      value === "on" ? (regenerateDraftSettings.sketchMode === "none" ? "top" : regenerateDraftSettings.sketchMode) : "none";
  }
  if (key === "sketchMode") regenerateDraftSettings.sketchMode = value as SketchMode;
  renderRegenerateSettings();
}

function updateSetting(key: string, value: string) {
  if (key === "triggerMode") settings.triggerMode = value as TriggerMode;
  let shouldCenterMode = false;
  if (key === "generationMode") {
    settings.generationMode = value as GenerationMode;
    shouldCenterMode = true;
  }
  if (key === "roastLevel") settings.roastLevel = value as ProductRoastLevel;
  if (key === "sketchEnabled") settings.sketchMode = value === "on" ? (settings.sketchMode === "none" ? "top" : settings.sketchMode) : "none";
  if (key === "sketchMode") settings.sketchMode = value as SketchMode;
  renderSettings(shouldCenterMode);
}

function renderSettings(shouldCenterMode = true) {
  document.querySelectorAll<HTMLElement>("[data-setting]").forEach((group) => {
    const key = group.dataset.setting as keyof ProductSettings | "sketchEnabled";
    const value = key === "sketchEnabled" ? (settings.sketchMode === "none" ? "off" : "on") : settings[key];
    const buttons = group.matches("button[data-value]")
      ? [group as HTMLButtonElement]
      : Array.from(group.querySelectorAll<HTMLButtonElement>("button[data-value]"));
    buttons.forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.value === value);
    });
  });
  sketchDetailGroup.hidden = settings.sketchMode === "none";
  sketchToggleButton.classList.toggle("is-selected", settings.sketchMode !== "none");
  sketchToggleButton.setAttribute("aria-pressed", String(settings.sketchMode !== "none"));
  if (shouldCenterMode) centerSelectedCameraMode();
}

function renderRegenerateSettings() {
  document.querySelectorAll<HTMLElement>("[data-regenerate-setting]").forEach((group) => {
    const key = group.dataset.regenerateSetting as keyof ProductSettings | "sketchEnabled";
    const value =
      key === "sketchEnabled" ? (regenerateDraftSettings.sketchMode === "none" ? "off" : "on") : regenerateDraftSettings[key];
    group.querySelectorAll<HTMLButtonElement>("button[data-value]").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.value === value);
    });
  });
  regenerateSketchDetailGroup.hidden = regenerateDraftSettings.sketchMode === "none";
}

function renderLatestThumb() {
  const latest = records[0];
  latestThumb.style.backgroundImage = latest ? `url("${latest.originalImageUrl}")` : "";
  latestThumb.classList.toggle("has-image", Boolean(latest));
}

async function loadProductRecords() {
  try {
    const payload = await getJson<ProductRecordsResponse>("/api/product-records");
    records = [...(payload.records ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    renderLatestThumb();
  } catch {
    records = [];
    renderLatestThumb();
  }
}

async function saveProductRecord(record: PhotoRecord): Promise<PhotoRecord> {
  const payload = await postJson<ProductRecordsResponse>("/api/product-records", { record });
  return payload.record ?? record;
}

async function deleteProductRecord(id: string): Promise<void> {
  const response = await fetch(`/api/product-records/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("删除记录失败。");
}

async function getJson<T extends { error?: string; detail?: string }>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = (await response.json()) as T;
  if (!response.ok || payload.error) throw new Error(formatApiError(payload, "读取记录失败。"));
  return payload;
}

function centerSelectedCameraMode() {
  const selected = modeStrip.querySelector<HTMLButtonElement>("button.is-selected");
  if (!selected) return;
  window.requestAnimationFrame(() => {
    const targetLeft = selected.offsetLeft + selected.offsetWidth / 2 - modeStrip.clientWidth / 2;
    modeStrip.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: "smooth"
    });
  });
}

function setGenerationStage(step: number, total: number, title: string, message: string) {
  generatingStep.textContent = `${step}/${total}`;
  generatingTitle.textContent = title;
  generatingMessage.textContent = message;
  progressFill.style.width = `${Math.max(8, Math.min((step / total) * 100, 96))}%`;
}

async function postJson<T extends { error?: string; detail?: string }>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = (await response.json()) as T;
  if (!response.ok || payload.error) throw new Error(formatApiError(payload, "生成失败。"));
  return payload;
}

function mapRoastLevel(level: ProductRoastLevel): RoastLevel {
  return level === "public_execution" ? "spicy" : level;
}

function modeLabel(record: PhotoRecord): string {
  const labels: Record<ProductLayoutType, string> = {
    receipt: "小票式",
    big_text: "大字式",
    expression: "表情式",
    sketch: "漫画"
  };
  return labels[record.layoutType] ?? "自动模式";
}

function toProductLayoutType(layoutType: RoastMode): ProductLayoutType {
  if (layoutType === "big_text") return "big_text";
  if (layoutType === "pixel_expression") return "expression";
  return "receipt";
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatApiError(payload: { error?: string; detail?: string }, fallback: string): string {
  const detail = payload.detail || payload.error || fallback;
  if (detail.includes("Model disabled")) return `${fallback} 当前模型不可用：Model disabled。`;
  return detail;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Failed to read image.")));
    reader.readAsDataURL(file);
  });
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing DOM element: ${selector}`);
  return element;
}

renderSettings();
showCamera();
window.setTimeout(centerSelectedCameraMode, 80);
void loadProductRecords();
