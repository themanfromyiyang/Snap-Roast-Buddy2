const DEVICE_NAME = "SnapPrinter-S3";
const SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E".toLowerCase();
const RX_CHAR_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E".toLowerCase();
const CHUNK_SIZE = 100;
const CHUNK_DELAY_MS = 30;
const PRINT_WIDTH_DOTS = 384;

type BluetoothRemoteGATTCharacteristicLike = {
  writeValue?: (value: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
};

type BluetoothDeviceLike = {
  gatt?: {
    connected?: boolean;
    connect: () => Promise<{
      getPrimaryService: (service: string) => Promise<{
        getCharacteristic: (characteristic: string) => Promise<BluetoothRemoteGATTCharacteristicLike>;
      }>;
    }>;
    disconnect: () => void;
  };
  addEventListener?: (type: string, listener: () => void) => void;
};

let bleDevice: BluetoothDeviceLike | undefined;
let rxCharacteristic: BluetoothRemoteGATTCharacteristicLike | undefined;

export async function connectPrinter() {
  try {
    const bluetooth = getBluetooth();
    bleDevice = (await bluetooth.requestDevice({
      filters: [{ name: DEVICE_NAME }, { namePrefix: "SnapPrinter" }],
      optionalServices: [SERVICE_UUID]
    })) as BluetoothDeviceLike;

    bleDevice.addEventListener?.("gattserverdisconnected", () => {
      rxCharacteristic = undefined;
    });

    const server = await bleDevice.gatt?.connect();
    if (!server) throw new Error("无法连接打印机 GATT 服务。");
    const service = await server.getPrimaryService(SERVICE_UUID);
    rxCharacteristic = await service.getCharacteristic(RX_CHAR_UUID);
    return true;
  } catch (error) {
    rxCharacteristic = undefined;
    throw normalizeBluetoothError(error);
  }
}

export function disconnectPrinter() {
  bleDevice?.gatt?.disconnect();
  rxCharacteristic = undefined;
}

export function isPrinterConnected() {
  return Boolean(rxCharacteristic && bleDevice?.gatt?.connected);
}

export async function sendBytes(bytes: Uint8Array | number[]) {
  if (!rxCharacteristic) throw new Error("未连接打印机。");
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  for (let index = 0; index < data.length; index += CHUNK_SIZE) {
    const chunk = data.slice(index, index + CHUNK_SIZE);
    if (rxCharacteristic.writeValueWithoutResponse) {
      await rxCharacteristic.writeValueWithoutResponse(chunk);
    } else if (rxCharacteristic.writeValue) {
      await rxCharacteristic.writeValue(chunk);
    } else {
      throw new Error("当前蓝牙特征不支持写入。");
    }
    await delay(CHUNK_DELAY_MS);
  }
}

export async function feedDots(n = 80) {
  await sendBytes(new Uint8Array([0x1b, 0x4a, clampByte(n)]));
}

export async function feedLines(n = 4) {
  await sendBytes(new Uint8Array([0x1b, 0x64, clampByte(n)]));
}

export async function printTestText() {
  const encoder = new TextEncoder();
  const init = new Uint8Array([0x1b, 0x40]);
  const text = encoder.encode("Hello ESP32-S3!\nBluetooth print test.\nSnap Roast Buddy\n----------------\n");
  const feed = new Uint8Array([0x1b, 0x64, 4]);
  await sendBytes(concatBytes(init, text, feed));
}

export async function printRasterFromElement(element: HTMLElement) {
  const canvas = await elementToCanvas(element);
  const init = new Uint8Array([0x1b, 0x40]);
  const raster = canvasToEscPosRaster(canvas, 180);
  const feed = new Uint8Array([0x1b, 0x64, 4]);
  await sendBytes(concatBytes(init, raster, feed));
}

export function canvasToEscPosRaster(canvas: HTMLCanvasElement, threshold = 180) {
  const scale = PRINT_WIDTH_DOTS / canvas.width;
  const targetHeight = Math.max(1, Math.round(canvas.height * scale));
  const offscreen = document.createElement("canvas");
  offscreen.width = PRINT_WIDTH_DOTS;
  offscreen.height = targetHeight;

  const context = offscreen.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法创建打印位图画布。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PRINT_WIDTH_DOTS, targetHeight);
  context.drawImage(canvas, 0, 0, PRINT_WIDTH_DOTS, targetHeight);

  const imageData = context.getImageData(0, 0, PRINT_WIDTH_DOTS, targetHeight);
  const pixels = imageData.data;
  const xBytes = PRINT_WIDTH_DOTS / 8;
  const bitmap = new Uint8Array(xBytes * targetHeight);

  for (let y = 0; y < targetHeight; y += 1) {
    for (let xByte = 0; xByte < xBytes; xByte += 1) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const x = xByte * 8 + bit;
        const pixelIndex = (y * PRINT_WIDTH_DOTS + x) * 4;
        const r = pixels[pixelIndex] ?? 255;
        const g = pixels[pixelIndex + 1] ?? 255;
        const b = pixels[pixelIndex + 2] ?? 255;
        const a = pixels[pixelIndex + 3] ?? 255;
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        if (a > 0 && gray < threshold) byte |= 0x80 >> bit;
      }
      bitmap[y * xBytes + xByte] = byte;
    }
  }

  const header = new Uint8Array([0x1d, 0x76, 0x30, 0x00, xBytes & 0xff, (xBytes >> 8) & 0xff, targetHeight & 0xff, (targetHeight >> 8) & 0xff]);
  return concatBytes(header, bitmap);
}

export function concatBytes(...arrays: Uint8Array[]) {
  const total = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

async function elementToCanvas(element: HTMLElement) {
  const existingCanvas = element instanceof HTMLCanvasElement ? element : element.querySelector("canvas");
  if (existingCanvas) {
    const copy = document.createElement("canvas");
    copy.width = existingCanvas.width;
    copy.height = existingCanvas.height;
    const copyContext = copy.getContext("2d");
    if (!copyContext) throw new Error("鏃犳硶鍒涘缓棰勮鎴浘鐢诲竷銆?");
    copyContext.fillStyle = "#ffffff";
    copyContext.fillRect(0, 0, copy.width, copy.height);
    copyContext.drawImage(existingCanvas, 0, 0);
    return copy;
  }

  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(element.scrollWidth || rect.width));
  const height = Math.max(1, Math.ceil(element.scrollHeight || rect.height));
  const clone = element.cloneNode(true) as HTMLElement;
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.width = `${width}px`;
  clone.style.minHeight = `${height}px`;
  clone.style.margin = "0";

  const wrapper = document.createElement("div");
  wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  wrapper.style.width = `${width}px`;
  wrapper.style.minHeight = `${height}px`;
  wrapper.style.background = "#ffffff";
  wrapper.innerHTML = `<style>${collectPageStyles()}</style>`;
  wrapper.append(clone);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(wrapper)}</foreignObject></svg>`;
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建预览截图画布。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(2, 2);
  context.drawImage(image, 0, 0);
  return canvas;
}

function collectPageStyles() {
  return Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n");
      } catch {
        return "";
      }
    })
    .join("\n");
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("预览截图渲染失败。")));
    image.src = src;
  });
}

function getBluetooth() {
  const bluetooth = (navigator as Navigator & {
    bluetooth?: {
      requestDevice: (options: unknown) => Promise<unknown>;
    };
  }).bluetooth;
  if (!bluetooth) throw new Error("当前浏览器不支持 Web Bluetooth。");
  return bluetooth;
}

function normalizeBluetoothError(error: unknown) {
  if (!(error instanceof Error)) return new Error("连接失败。");
  if (error.name === "NotFoundError") {
    return new Error("没有选择到 SnapPrinter-S3。请确认 ESP32 正在广播、没有被 Python 程序占用，并在弹窗中选择 SnapPrinter-S3。");
  }
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return new Error("浏览器阻止了蓝牙访问。请使用 Chrome/Edge，并通过 HTTPS 或本机 localhost 打开页面。");
  }
  if (error.name === "NetworkError") {
    return new Error("蓝牙 GATT 连接失败。请关闭 Python 连接、取消系统已配对后重启 ESP32 再试。");
  }
  if (error.name === "NotSupportedError") {
    return new Error("当前浏览器或设备不支持 Web Bluetooth。");
  }
  return new Error(`${error.name || "BluetoothError"}: ${error.message}`);
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
