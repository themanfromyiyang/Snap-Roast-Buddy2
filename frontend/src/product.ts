import { generateRoastLayoutWithSkills } from "../../packages/layout/src/generateRoastLayoutWithSkills.js";
import type { LayoutType, RoastLevel, RoastMode } from "../../packages/layout/src/types.js";
import { createStandaloneMangaTicket, createTicketHtmlWithManga, layoutSkills as sharedLayoutSkills } from "./sharedProductFlow.js";

type ProductLayoutType = "receipt" | "big_text" | "expression" | "sketch";
type TriggerMode = "auto" | "manual";
type CaptureOrientation = "portrait" | "landscape";
type GenerationMode = "auto" | "receipt" | "big_text" | "expression";
type ProductRoastLevel = RoastLevel | "public_execution";
type SketchMode = "none" | "top" | "bottom" | "standalone";

type ProductSettings = {
  triggerMode: TriggerMode;
  captureOrientation: CaptureOrientation;
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
  total?: number;
  offset?: number;
  limit?: number;
  error?: string;
  detail?: string;
};

type FocusConstraintSet = MediaTrackConstraintSet & {
  focusMode?: string;
  pointsOfInterest?: { x: number; y: number }[];
  zoom?: number;
};

type ZoomCapabilities = MediaTrackCapabilities & {
  zoom?: {
    min?: number;
    max?: number;
    step?: number;
  };
};

const settings: ProductSettings = {
  triggerMode: "auto",
  captureOrientation: "portrait",
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
const cameraFeed = mustQuery<HTMLVideoElement>("#cameraFeed");
const cameraPreview = mustQuery<HTMLImageElement>("#cameraPreview");
const emptyViewfinder = mustQuery<HTMLDivElement>("#emptyViewfinder");
const cameraDebugMessage = mustQuery<HTMLElement>("#cameraDebugMessage");
const manualStartPanel = mustQuery<HTMLDivElement>("#manualStartPanel");
const cameraHint = mustQuery<HTMLParagraphElement>("#cameraHint");
const modeStrip = mustQuery<HTMLDivElement>(".camera-mode-strip");
const cameraZoomStrip = mustQuery<HTMLDivElement>("#cameraZoomStrip");
const cameraZoomRange = mustQuery<HTMLInputElement>("#cameraZoomRange");
const shutterButton = mustQuery<HTMLButtonElement>("#shutterButton");
const galleryButton = mustQuery<HTMLButtonElement>("#galleryButton");
const latestButton = mustQuery<HTMLButtonElement>("#latestButton");
const latestThumb = mustQuery<HTMLSpanElement>("#latestThumb");
const startGenerateButton = mustQuery<HTMLButtonElement>("#startGenerateButton");
const uploadPhotoButton = mustQuery<HTMLButtonElement>("#uploadPhotoButton");
const imageInput = mustQuery<HTMLInputElement>("#productImageInput");
const generatingImage = mustQuery<HTMLImageElement>("#generatingImage");
const generatingStep = mustQuery<HTMLParagraphElement>("#generatingStep");
const generatingTitle = mustQuery<HTMLHeadingElement>("#generatingTitle");
const generatingMessage = mustQuery<HTMLParagraphElement>("#generatingMessage");
const progressFill = mustQuery<HTMLSpanElement>("#progressFill");
const resultScroller = mustQuery<HTMLDivElement>("#resultScroller");
const resultOriginalImage = mustQuery<HTMLImageElement>("#resultOriginalImage");
const imageCarousel = mustQuery<HTMLDivElement>("#imageCarousel");
const recordTime = mustQuery<HTMLSpanElement>("#recordTime");
const recordMode = mustQuery<HTMLElement>("#recordMode");
const recordCounter = mustQuery<HTMLHeadingElement>("#recordCounter");
const fixedPrinterSlot = mustQuery<HTMLDivElement>("#fixedPrinterSlot");
const ticketLongPreview = mustQuery<HTMLDivElement>("#ticketLongPreview");
const ticketCarousel = mustQuery<HTMLDivElement>("#ticketCarousel");
const regenerateButton = mustQuery<HTMLButtonElement>("#regenerateButton");
const deleteRecordButton = mustQuery<HTMLButtonElement>("#deleteRecordButton");
const backToCameraButton = mustQuery<HTMLButtonElement>("#backToCameraButton");
const confirmRegenerateButton = mustQuery<HTMLButtonElement>("#confirmRegenerateButton");
const deleteConfirmBackdrop = mustQuery<HTMLDivElement>("#deleteConfirmBackdrop");
const deleteConfirmSheet = mustQuery<HTMLElement>("#deleteConfirmSheet");
const cancelDeleteButton = mustQuery<HTMLButtonElement>("#cancelDeleteButton");
const confirmDeleteButton = mustQuery<HTMLButtonElement>("#confirmDeleteButton");
const imageLightbox = mustQuery<HTMLDivElement>("#imageLightbox");
const lightboxImage = mustQuery<HTMLImageElement>("#lightboxImage");

const focusReticle = document.createElement("span");
focusReticle.className = "focus-reticle";
viewfinder.append(focusReticle);

let selectedImageUrl = "";
let cameraStream: MediaStream | undefined;
let cameraFacingMode: "user" | "environment" = "environment";
let cameraZoom = 1;
let cameraUsesHardwareZoom = false;
let records: PhotoRecord[] = [];
let currentRecordIndex = 0;
let isGenerating = false;
let messageTimer = 0;
let swipeStartX = 0;
let swipeStartY = 0;
let modeSnapTimer = 0;
let albumSnapTimer = 0;
let isSyncingAlbum = false;
let visibleAlbumIndex = -1;
let funMessageIndex = 0;
let regenerateDraftSettings: ProductSettings = { ...settings };
let productRecordsLoadPromise: Promise<void> | undefined;
let productRecordsTotal = 0;
let isLoadingMoreRecords = false;
let usingLocalRecordStore = false;
const productRecordsPageSize = 5;
const localProductRecordsKey = "snap-roast-buddy.product-records.v1";
const productRecordsDbName = "snap-roast-buddy";
const productRecordsStoreName = "product-records";

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
shutterButton.addEventListener("click", () => {
  void captureFromCamera();
});
galleryButton.addEventListener("click", async () => {
  await ensureProductRecordsLoaded();
  showResult(0);
});
latestButton.addEventListener("click", () => {
  void flipCamera();
});
uploadPhotoButton.addEventListener("click", () => {
  closeSettings();
  openImagePicker();
});
viewfinder.addEventListener("pointerdown", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest(".manual-start, button")) return;
  if (!cameraStream) {
    void startCamera();
    return;
  }
  void focusCameraAt(event);
});
viewfinder.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") void captureFromCamera();
});
manualStartPanel.addEventListener("click", (event) => event.stopPropagation());
startGenerateButton.addEventListener("click", (event) => {
  event.stopPropagation();
  void startGenerationFromSelected();
});
backToCameraButton.addEventListener("click", showCamera);
regenerateButton.addEventListener("click", openRegenerateSheet);
confirmRegenerateButton.addEventListener("click", () => confirmRegenerate());
deleteRecordButton.addEventListener("click", openDeleteConfirmDialog);
cancelDeleteButton.addEventListener("click", closeDeleteConfirmDialog);
confirmDeleteButton.addEventListener("click", () => {
  closeDeleteConfirmDialog();
  void deleteCurrentRecord();
});
deleteConfirmBackdrop.addEventListener("click", closeDeleteConfirmDialog);
document.addEventListener("keydown", (event) => {
  if (!deleteConfirmSheet.hidden && event.key === "Escape") closeDeleteConfirmDialog();
});
resultOriginalImage.addEventListener("click", openImageLightbox);
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
  swipeStartY = event.touches[0]?.clientY ?? 0;
});
resultScreen.addEventListener("touchend", (event) => {
  if ((event.target as HTMLElement).closest(".album-carousel")) return;
  const endX = event.changedTouches[0]?.clientX ?? swipeStartX;
  const endY = event.changedTouches[0]?.clientY ?? swipeStartY;
  const delta = endX - swipeStartX;
  const verticalDelta = endY - swipeStartY;
  if (Math.abs(delta) > 58 && Math.abs(delta) > Math.abs(verticalDelta)) shiftRecord(delta > 0 ? -1 : 1);
});

modeStrip.addEventListener("scroll", () => {
  updateCameraModeFromScroll();
  window.clearTimeout(modeSnapTimer);
  modeSnapTimer = window.setTimeout(snapCameraModeToNearest, 90);
});

cameraZoomRange.addEventListener("input", () => {
  setCameraZoom(Number(cameraZoomRange.value) || 1, false);
});

cameraZoomRange.addEventListener("change", () => {
  softHaptic();
});

imageCarousel.addEventListener("scroll", () => syncAlbumScroll(imageCarousel));

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  imageInput.value = "";
  if (!file) return;
  selectedImageUrl = await fileToDataUrl(file);
  showSelectedImagePreview(selectedImageUrl);
  cameraHint.textContent =
    settings.triggerMode === "auto" ? "Buddy 已经开始观察导入的照片。" : "照片已放进取景框，按开始生成。";
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

document
  .querySelectorAll<HTMLButtonElement>(
    ".product-back, .icon-button, .round-tool, .pill-button, .settings-upload-button, .shutter-button, .thumbnail-button, .segmented-control button, .option-list button"
  )
  .forEach((button) => {
    button.addEventListener("pointerdown", softHaptic);
  });

function openImagePicker() {
  if (isGenerating) return;
  imageInput.click();
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraHint.textContent = "当前浏览器不支持直接调用摄像头，请在设置里导入照片。";
    emptyViewfinder.hidden = false;
    cameraZoomStrip.hidden = true;
    return;
  }

  stopCameraStream();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: cameraFacingMode },
        width: { ideal: 1080 },
        height: { ideal: 1440 },
        aspectRatio: { ideal: 0.75 }
      },
      audio: false
    });
    cameraFeed.srcObject = cameraStream;
    await cameraFeed.play();
    updateCameraFacingState();
    await applyCameraZoom();
    cameraFeed.hidden = false;
    cameraPreview.hidden = true;
    emptyViewfinder.hidden = true;
    manualStartPanel.hidden = true;
    cameraZoomStrip.hidden = false;
    cameraHint.textContent = "按下快门，生成今日照片审判。";
  } catch (error) {
    cameraStream = undefined;
    cameraFeed.hidden = true;
    cameraZoomStrip.hidden = true;
    emptyViewfinder.hidden = false;
    const isSecure = window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    cameraDebugMessage.textContent = isSecure
      ? "摄像头未打开。请检查浏览器权限，或在设置里导入照片。"
      : "摄像头需要 HTTPS 或 localhost。当前页面无法直接调用摄像头。";
    cameraHint.textContent = "无法打开摄像头，请允许权限，或在设置里导入照片。";
    if (error instanceof Error) {
      cameraDebugMessage.textContent = `${cameraDebugMessage.textContent} (${error.name}: ${error.message})`;
    }
  }
}

function stopCameraStream() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
  cameraUsesHardwareZoom = false;
  cameraFeed.srcObject = null;
  syncCameraViewTransform();
}

async function flipCamera() {
  if (isGenerating) return;
  cameraFacingMode = cameraFacingMode === "environment" ? "user" : "environment";
  cameraHint.textContent = cameraFacingMode === "environment" ? "正在切换到后置摄像头。" : "正在切换到前置摄像头。";
  await startCamera();
}

async function captureFromCamera() {
  if (isGenerating) return;
  if (!cameraStream || cameraFeed.readyState < cameraFeed.HAVE_CURRENT_DATA) {
    await startCamera();
    if (!cameraStream || cameraFeed.readyState < cameraFeed.HAVE_CURRENT_DATA) return;
  }

  const canvas = document.createElement("canvas");
  const outputCanvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1200;
  outputCanvas.width = isLandscapeCapture() ? 1200 : 900;
  outputCanvas.height = isLandscapeCapture() ? 900 : 1200;
  const context = canvas.getContext("2d");
  const outputContext = outputCanvas.getContext("2d");
  if (!context || !outputContext) return;

  const videoWidth = cameraFeed.videoWidth || canvas.width;
  const videoHeight = cameraFeed.videoHeight || canvas.height;
  const sourceRatio = videoWidth / videoHeight;
  const targetRatio = canvas.width / canvas.height;
  let sourceWidth = videoWidth;
  let sourceHeight = videoHeight;
  let sourceX = 0;
  let sourceY = 0;

  if (sourceRatio > targetRatio) {
    sourceWidth = videoHeight * targetRatio;
    sourceX = (videoWidth - sourceWidth) / 2;
  } else {
    sourceHeight = videoWidth / targetRatio;
    sourceY = (videoHeight - sourceHeight) / 2;
  }

  const digitalZoom = cameraUsesHardwareZoom ? 1 : Math.max(1, cameraZoom);
  if (digitalZoom > 1) {
    const zoomedWidth = sourceWidth / digitalZoom;
    const zoomedHeight = sourceHeight / digitalZoom;
    sourceX += (sourceWidth - zoomedWidth) / 2;
    sourceY += (sourceHeight - zoomedHeight) / 2;
    sourceWidth = zoomedWidth;
    sourceHeight = zoomedHeight;
  }

  if (cameraFacingMode === "user") {
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(cameraFeed, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

  if (isLandscapeCapture()) {
    outputContext.translate(outputCanvas.width, 0);
    outputContext.rotate(Math.PI / 2);
    outputContext.drawImage(canvas, 0, 0, canvas.width, canvas.height);
  } else {
    outputContext.drawImage(canvas, 0, 0, outputCanvas.width, outputCanvas.height);
  }

  selectedImageUrl = outputCanvas.toDataURL("image/jpeg", 0.92);
  showSelectedImagePreview(selectedImageUrl);
  cameraHint.textContent = settings.triggerMode === "auto" ? "Buddy 已经开始观察这张照片。" : "照片已就位，按开始生成。";
  if (settings.triggerMode === "auto") await startGenerationFromSelected();
}

async function focusCameraAt(event: PointerEvent) {
  const rect = viewfinder.getBoundingClientRect();
  const x = clamp01((event.clientX - rect.left) / rect.width);
  const y = clamp01((event.clientY - rect.top) / rect.height);
  showFocusReticle(event.clientX - rect.left, event.clientY - rect.top);

  const track = cameraStream?.getVideoTracks()[0];
  if (!track) return;

  try {
    const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
      focusMode?: string[];
      pointsOfInterest?: unknown;
    };
    const advanced: FocusConstraintSet = {};
    if (capabilities.focusMode?.includes("continuous")) advanced.focusMode = "continuous";
    if ("pointsOfInterest" in capabilities) advanced.pointsOfInterest = [{ x, y }];
    if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] });
  } catch (error) {
    cameraDebugMessage.textContent =
      error instanceof Error ? `对焦调试：${error.name} ${error.message}` : "对焦调试：当前浏览器不支持点击对焦。";
  }
}

function showFocusReticle(x: number, y: number) {
  focusReticle.style.left = `${x}px`;
  focusReticle.style.top = `${y}px`;
  focusReticle.classList.remove("is-active");
  void focusReticle.offsetWidth;
  focusReticle.classList.add("is-active");
  softHaptic();
}

function setCameraZoom(nextZoom: number, shouldPulse = true) {
  cameraZoom = Math.max(1, Math.min(3, nextZoom));
  renderCameraZoom();
  void applyCameraZoom();
  if (shouldPulse) softHaptic();
}

async function applyCameraZoom() {
  cameraUsesHardwareZoom = false;
  const track = cameraStream?.getVideoTracks()[0];
  if (track) {
    try {
      const capabilities = track.getCapabilities() as ZoomCapabilities;
      const zoomCapability = capabilities.zoom;
      if (zoomCapability?.min !== undefined && zoomCapability.max !== undefined) {
        const min = zoomCapability.min;
        const max = zoomCapability.max;
        const nextZoom = Math.max(min, Math.min(max, cameraZoom));
        await track.applyConstraints({ advanced: [{ zoom: nextZoom } as FocusConstraintSet] });
        cameraUsesHardwareZoom = Math.abs(nextZoom - cameraZoom) < 0.05;
      }
    } catch {
      cameraUsesHardwareZoom = false;
    }
  }
  syncCameraViewTransform();
}

function renderCameraZoom() {
  cameraZoomRange.value = String(cameraZoom);
  const progress = `${16.667 + ((cameraZoom - 1) / 2) * 66.666}%`;
  cameraZoomStrip.style.setProperty("--zoom-progress", progress);
  cameraZoomStrip.querySelectorAll<HTMLElement>("[data-zoom-label]").forEach((label) => {
    const value = Number(label.dataset.zoomLabel) || 1;
    label.classList.toggle("is-selected", Math.abs(value - cameraZoom) < 0.18);
  });
}

function updateCameraFacingState() {
  document.body.classList.toggle("is-front-camera", cameraFacingMode === "user");
  syncCameraViewTransform();
}

function syncCameraViewTransform() {
  const digitalZoom = cameraUsesHardwareZoom ? 1 : Math.max(1, cameraZoom);
  viewfinder.style.setProperty("--camera-preview-scale", String(digitalZoom));
  viewfinder.style.setProperty("--camera-mirror-scale", cameraFacingMode === "user" ? "-1" : "1");
}

function showSelectedImagePreview(imageUrl: string) {
  cameraPreview.src = imageUrl;
  cameraPreview.hidden = false;
  cameraFeed.hidden = true;
  emptyViewfinder.hidden = true;
  manualStartPanel.hidden = settings.triggerMode === "auto";
  cameraZoomStrip.hidden = true;
}

async function startGenerationFromSelected() {
  if (!selectedImageUrl || isGenerating) return;
  isGenerating = true;
  showGenerating(selectedImageUrl);

  try {
    const record = await generateSnapRoastResult(selectedImageUrl, settings);
    const savedRecord = await saveProductRecord(record);
    records = [savedRecord, ...records.filter((item) => item.id !== savedRecord.id)];
    productRecordsTotal = Math.max(productRecordsTotal, records.length);
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
    productRecordsTotal = Math.max(productRecordsTotal, records.length);
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
  try {
    await deleteProductRecord(current.id);
  } catch {
    usingLocalRecordStore = true;
  }
  records = records.filter((item) => item.id !== current.id);
  productRecordsTotal = Math.max(0, productRecordsTotal - 1);
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
    sharedLayoutSkills
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
  if (!record) {
    recordTime.textContent = "暂无照片";
    recordMode.textContent = "等待生成";
    recordCounter.textContent = "0 / 0";
    regenerateButton.disabled = true;
    deleteRecordButton.disabled = true;
    fixedPrinterSlot.hidden = true;
    renderAlbumSlides();
    resultScroller.scrollTop = 0;
    return;
  }

  resultOriginalImage.src = record.originalImageUrl;
  regenerateButton.disabled = false;
  deleteRecordButton.disabled = false;
  fixedPrinterSlot.hidden = false;
  updateResultMeta(record);
  renderAlbumSlides();
  scrollAlbumToIndex(currentRecordIndex, "auto");
  resultScroller.scrollTop = 0;
}

function updateResultMeta(record: PhotoRecord) {
  resultOriginalImage.src = record.originalImageUrl;
  recordTime.textContent = formatTime(record.createdAt);
  recordMode.textContent = modeLabel(record);
  recordCounter.textContent = `${currentRecordIndex + 1} / ${records.length}`;
}

function renderAlbumSlides() {
  imageCarousel.innerHTML = "";
  ticketCarousel.innerHTML = "";
  ticketLongPreview.innerHTML = "";

  if (records.length === 0) {
    const emptySlide = document.createElement("article");
    emptySlide.className = "album-slide album-combined-slide empty-album-slide";
    const empty = document.createElement("p");
    empty.className = "empty-ticket";
    empty.textContent = "还没有照片结果。返回拍摄页生成第一张吧。";
    emptySlide.append(empty);
    imageCarousel.append(emptySlide);
    return;
  }

  records.forEach((record, index) => {
    const albumSlide = document.createElement("article");
    albumSlide.className = "album-slide album-combined-slide";

    const img = document.createElement("img");
    img.className = "result-original";
    img.src = record.originalImageUrl;
    img.alt = "原始照片";
    img.addEventListener("click", () => {
      currentRecordIndex = index;
      updateResultMeta(record);
      openImageLightbox();
    });

    const fixedMiddleSpace = document.createElement("div");
    fixedMiddleSpace.className = "album-fixed-middle-space";
    fixedMiddleSpace.setAttribute("aria-hidden", "true");
    albumSlide.append(img, fixedMiddleSpace, createTicketBody(record));
    imageCarousel.append(albumSlide);
  });
}

function openDeleteConfirmDialog() {
  if (!records[currentRecordIndex] || !deleteConfirmSheet.hidden) return;
  deleteConfirmBackdrop.hidden = false;
  deleteConfirmSheet.hidden = false;
  cancelDeleteButton.focus();
}

function closeDeleteConfirmDialog() {
  deleteConfirmBackdrop.hidden = true;
  deleteConfirmSheet.hidden = true;
}

function softHaptic() {
  navigator.vibrate?.(8);
}

function createTicketBody(record: PhotoRecord): HTMLElement {
  const body = document.createElement("div");
  body.className = "ticket-long-preview";

  if (record.ticketHtml) {
    const shell = document.createElement("div");
    shell.className = "product-paper";
    shell.innerHTML = createTicketHtmlWithManga(record.ticketHtml, record.sketchImageUrl, record.sketchMode);
    body.append(shell);
  } else if (record.ticketText) {
    const paper = document.createElement("pre");
    paper.className = "product-paper text-paper";
    paper.textContent = record.ticketText;
    body.append(paper);
  } else if (record.sketchImageUrl) {
    const shell = document.createElement("div");
    shell.className = "product-paper";
    shell.innerHTML = createStandaloneMangaTicket(record.sketchImageUrl ?? "");
    body.append(shell);
  }

  if (!record.ticketHtml && !record.ticketText && !record.sketchImageUrl) {
    const empty = document.createElement("p");
    empty.className = "empty-ticket";
    empty.textContent = "这张结果还没有可展示内容。";
    body.append(empty);
  }

  return body;
}

function showCamera() {
  if (records.length) {
    currentRecordIndex = 0;
    scrollAlbumToIndex(0, "auto");
  }
  selectedImageUrl = "";
  cameraPreview.removeAttribute("src");
  cameraPreview.hidden = true;
  manualStartPanel.hidden = true;
  cameraScreen.hidden = false;
  generatingScreen.hidden = true;
  resultScreen.hidden = true;
  playScreenEntrance(cameraScreen, "camera");
  if (cameraStream) {
    cameraFeed.hidden = false;
    cameraZoomStrip.hidden = false;
    void cameraFeed.play();
  } else {
    void startCamera();
  }
}

function showGenerating(imageUrl: string) {
  cameraScreen.hidden = true;
  generatingScreen.hidden = false;
  resultScreen.hidden = true;
  playScreenEntrance(generatingScreen, "generating");
  generatingImage.src = imageUrl;
  window.clearInterval(messageTimer);
  setGenerationStage(1, 3, "正在准备生成……", "Buddy 正在观察照片。");
  messageTimer = window.setInterval(() => {
    funMessageIndex = (funMessageIndex + 1) % funGeneratingMessages.length;
    generatingMessage.textContent = funGeneratingMessages[funMessageIndex];
  }, 1500);
}

function showResult(index: number) {
  currentRecordIndex = records.length ? Math.max(0, Math.min(index, records.length - 1)) : 0;
  cameraScreen.hidden = true;
  generatingScreen.hidden = true;
  resultScreen.hidden = false;
  playScreenEntrance(resultScreen, "result");
  renderCurrentRecord();
}

function playScreenEntrance(screen: HTMLElement, kind: "camera" | "generating" | "result") {
  screen.classList.remove("screen-enter-camera", "screen-enter-generating", "screen-enter-result");
  void screen.offsetWidth;
  screen.classList.add(`screen-enter-${kind}`);
}

function shiftRecord(offset: number) {
  if (records.length <= 1) return;
  const next = (currentRecordIndex + offset + records.length) % records.length;
  currentRecordIndex = next;
  updateResultMeta(records[currentRecordIndex]);
  scrollAlbumToIndex(currentRecordIndex, "smooth");
}

function syncAlbumScroll(source: HTMLDivElement) {
  if (isSyncingAlbum) return;
  updateAlbumMetaFromScroll(source);
  window.clearTimeout(albumSnapTimer);
  albumSnapTimer = window.setTimeout(() => snapAlbumToNearest(source), 110);
}

function updateAlbumMetaFromScroll(source: HTMLDivElement) {
  if (!records.length) return;
  const index = Math.max(0, Math.min(records.length - 1, Math.round(source.scrollLeft / Math.max(1, source.clientWidth))));
  if (index === visibleAlbumIndex) return;
  visibleAlbumIndex = index;
  currentRecordIndex = index;
  updateResultMeta(records[index]);
  void loadMoreProductRecordsIfNeeded(index);
}

function snapAlbumToNearest(source: HTMLDivElement) {
  if (!records.length) return;
  const index = Math.max(0, Math.min(records.length - 1, Math.round(source.scrollLeft / Math.max(1, source.clientWidth))));
  visibleAlbumIndex = index;
  currentRecordIndex = index;
  updateResultMeta(records[index]);
  scrollAlbumToIndex(index, "smooth");
  void loadMoreProductRecordsIfNeeded(index);
}

function scrollAlbumToIndex(index: number, behavior: ScrollBehavior = "smooth") {
  const left = index * imageCarousel.clientWidth;
  visibleAlbumIndex = index;
  isSyncingAlbum = true;
  imageCarousel.scrollTo({ left, behavior });
  window.setTimeout(() => {
    isSyncingAlbum = false;
  }, behavior === "smooth" ? 260 : 0);
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
  if (key === "captureOrientation") {
    settings.captureOrientation = value as CaptureOrientation;
    syncOrientationState();
  }
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
    const payload = await getJson<ProductRecordsResponse>(`/api/product-records?offset=0&limit=${productRecordsPageSize}`);
    const remoteRecords = [...(payload.records ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const localRecords = await readCachedProductRecords();
    const mergedRecords = mergeRecords(localRecords, remoteRecords);
    usingLocalRecordStore = localRecords.length > 0 || remoteRecords.length === 0;
    records = mergedRecords.slice(0, productRecordsPageSize);
    productRecordsTotal = Math.max(payload.total ?? 0, mergedRecords.length);
    if (remoteRecords.length) await writeCachedProductRecords(mergedRecords);
    renderLatestThumb();
    if (!resultScreen.hidden) renderCurrentRecord();
  } catch {
    usingLocalRecordStore = true;
    const localRecords = await readCachedProductRecords();
    records = localRecords.slice(0, productRecordsPageSize);
    productRecordsTotal = localRecords.length;
    renderLatestThumb();
    if (!resultScreen.hidden) renderCurrentRecord();
  }
}

async function loadMoreProductRecordsIfNeeded(index: number) {
  if (isLoadingMoreRecords || records.length >= productRecordsTotal || index < records.length - 2) return;
  isLoadingMoreRecords = true;
  try {
    if (usingLocalRecordStore) {
      const localRecords = await readCachedProductRecords();
      const nextRecords = localRecords.slice(records.length, records.length + productRecordsPageSize);
      records = [...records, ...nextRecords];
      productRecordsTotal = localRecords.length;
      if (!resultScreen.hidden) {
        renderAlbumSlides();
        scrollAlbumToIndex(currentRecordIndex, "auto");
      }
      return;
    }
    const payload = await getJson<ProductRecordsResponse>(
      `/api/product-records?offset=${records.length}&limit=${productRecordsPageSize}`
    );
    const nextRecords = payload.records ?? [];
    productRecordsTotal = payload.total ?? productRecordsTotal;
    const seen = new Set(records.map((record) => record.id));
    records = [...records, ...nextRecords.filter((record) => !seen.has(record.id))].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    renderLatestThumb();
    if (!resultScreen.hidden) {
      renderAlbumSlides();
      scrollAlbumToIndex(currentRecordIndex, "auto");
    }
  } finally {
    isLoadingMoreRecords = false;
  }
}

async function ensureProductRecordsLoaded() {
  productRecordsLoadPromise ??= loadProductRecords();
  await productRecordsLoadPromise;
}

async function saveProductRecord(record: PhotoRecord): Promise<PhotoRecord> {
  try {
    const payload = await postJson<ProductRecordsResponse>("/api/product-records", { record });
    const savedRecord = payload.record ?? record;
    await upsertCachedProductRecord(savedRecord);
    return savedRecord;
  } catch {
    usingLocalRecordStore = true;
    await upsertCachedProductRecord(record);
    return record;
  }
}

async function deleteProductRecord(id: string): Promise<void> {
  await removeCachedProductRecord(id);
  const response = await fetch(`/api/product-records/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("删除记录失败。");
}

async function readCachedProductRecords(): Promise<PhotoRecord[]> {
  const indexedRecords = await readIndexedProductRecords();
  if (indexedRecords.length) return indexedRecords;
  return readLocalProductRecords();
}

async function writeCachedProductRecords(nextRecords: PhotoRecord[]) {
  try {
    await writeIndexedProductRecords(nextRecords);
  } catch {
    writeLocalProductRecords(nextRecords);
  }
}

async function upsertCachedProductRecord(record: PhotoRecord) {
  try {
    await upsertIndexedProductRecord(record);
  } catch {
    const nextRecords = [record, ...readLocalProductRecords().filter((item) => item.id !== record.id)];
    writeLocalProductRecords(nextRecords);
  }
}

async function removeCachedProductRecord(id: string) {
  await writeCachedProductRecords((await readCachedProductRecords()).filter((record) => record.id !== id));
}

async function readIndexedProductRecords(): Promise<PhotoRecord[]> {
  try {
    const database = await openProductRecordsDatabase();
    return await new Promise<PhotoRecord[]>((resolve, reject) => {
      const request = database.transaction(productRecordsStoreName, "readonly").objectStore(productRecordsStoreName).getAll();
      request.addEventListener("success", () => {
        resolve(
          (request.result as PhotoRecord[])
            .filter((record) => record?.id && record.originalImageUrl && record.createdAt)
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        );
      });
      request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB read failed.")));
    });
  } catch {
    return [];
  }
}

async function writeIndexedProductRecords(nextRecords: PhotoRecord[]): Promise<void> {
  const database = await openProductRecordsDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(productRecordsStoreName, "readwrite");
    const store = transaction.objectStore(productRecordsStoreName);
    store.clear();
    nextRecords
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 80)
      .forEach((record) => store.put(record));
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("IndexedDB write failed.")));
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("IndexedDB write aborted.")));
  });
}

async function upsertIndexedProductRecord(record: PhotoRecord): Promise<void> {
  const database = await openProductRecordsDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(productRecordsStoreName, "readwrite");
    transaction.objectStore(productRecordsStoreName).put(record);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("IndexedDB upsert failed.")));
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("IndexedDB upsert aborted.")));
  });
}

function mergeRecords(...recordGroups: PhotoRecord[][]): PhotoRecord[] {
  const byId = new Map<string, PhotoRecord>();
  recordGroups.flat().forEach((record) => {
    if (record?.id) byId.set(record.id, record);
  });
  return Array.from(byId.values()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function openProductRecordsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }
    const request = window.indexedDB.open(productRecordsDbName, 1);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(productRecordsStoreName)) {
        database.createObjectStore(productRecordsStoreName, { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB open failed.")));
  });
}

function readLocalProductRecords(): PhotoRecord[] {
  try {
    const raw = window.localStorage.getItem(localProductRecordsKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PhotoRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((record) => record?.id && record.originalImageUrl && record.createdAt)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

function writeLocalProductRecords(nextRecords: PhotoRecord[]) {
  const sortedRecords = [...nextRecords].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const recordCaps = [24, 12, 6, 3, 1];
  for (const cap of recordCaps) {
    try {
      window.localStorage.setItem(localProductRecordsKey, JSON.stringify(sortedRecords.slice(0, cap)));
      return;
    } catch {
      // Try again with fewer base64-heavy photos.
    }
  }
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

function updateCameraModeFromScroll() {
  const buttons = Array.from(modeStrip.querySelectorAll<HTMLButtonElement>("button[data-value]"));
  if (!buttons.length) return;
  const center = modeStrip.scrollLeft + modeStrip.clientWidth / 2;
  const nearest = buttons.reduce((best, button) => {
    const distance = Math.abs(button.offsetLeft + button.offsetWidth / 2 - center);
    return distance < best.distance ? { button, distance } : best;
  }, { button: buttons[0], distance: Number.POSITIVE_INFINITY }).button;
  const value = nearest.dataset.value as GenerationMode | undefined;
  if (!value || value === settings.generationMode) return;
  settings.generationMode = value;
  renderSettings(false);
}

function snapCameraModeToNearest() {
  const buttons = Array.from(modeStrip.querySelectorAll<HTMLButtonElement>("button[data-value]"));
  if (!buttons.length) return;
  const center = modeStrip.scrollLeft + modeStrip.clientWidth / 2;
  const nearest = buttons.reduce((best, button) => {
    const distance = Math.abs(button.offsetLeft + button.offsetWidth / 2 - center);
    return distance < best.distance ? { button, distance } : best;
  }, { button: buttons[0], distance: Number.POSITIVE_INFINITY }).button;
  const value = nearest.dataset.value;
  if (value && value !== settings.generationMode) {
    settings.generationMode = value as GenerationMode;
    renderSettings(true);
  } else {
    centerSelectedCameraMode();
  }
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isLandscapeCapture(): boolean {
  return settings.captureOrientation === "landscape";
}

function syncOrientationState() {
  document.body.classList.toggle("is-landscape", isLandscapeCapture());
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
renderCameraZoom();
syncCameraViewTransform();
syncOrientationState();
showCamera();
window.setTimeout(centerSelectedCameraMode, 80);
productRecordsLoadPromise = loadProductRecords();
window.addEventListener("resize", syncOrientationState);
