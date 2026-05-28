import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

loadDotEnv(resolve(".env"));

const {
  handleAnalyzeImage,
  handleClassifyLayout,
  handleDebugPrompts,
  handleDebugSkills,
  handleGenerateDoodle,
  handleDeleteProductRecord: handleSupabaseDeleteProductRecord,
  handleListProductRecords: handleSupabaseListProductRecords,
  handleSaveProductRecord: handleSupabaseSaveProductRecord,
  handleRoast,
  handleSupabaseHealth
} = await import("../api/_shared.mjs");

const root = resolve("frontend");
const port = Number(process.env.PORT ?? 5173);
const productDataDir = resolve("local-data");
const productRecordsPath = join(productDataDir, "snap-roast-records.json");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (request.method === "POST" && url.pathname === "/api/analyze-image") return handleAnalyzeImage(request, response);
  if (request.method === "POST" && url.pathname === "/api/classify-layout") return handleClassifyLayout(request, response);
  if (request.method === "POST" && url.pathname === "/api/roast") return handleRoast(request, response);
  if (request.method === "POST" && url.pathname === "/api/generate-doodle") return handleGenerateDoodle(request, response);
  if (request.method === "GET" && url.pathname === "/api/product-records") return handleSupabaseListProductRecords(request, response);
  if (request.method === "POST" && url.pathname === "/api/product-records") return handleSupabaseSaveProductRecord(request, response);
  if (request.method === "DELETE" && url.pathname.startsWith("/api/product-records/")) {
    return handleSupabaseDeleteProductRecord(request, response);
  }
  if (request.method === "GET" && url.pathname === "/api/debug/prompts") return handleDebugPrompts(request, response);
  if (request.method === "GET" && url.pathname === "/api/debug/skills") return handleDebugSkills(request, response);
  if (request.method === "GET" && url.pathname === "/api/supabase-health") return handleSupabaseHealth(request, response);

  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requestedPath));

  if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": mime[extname(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(response);
});

server.listen(port, () => {
  console.log(`Snap Roast Buddy demo: http://localhost:${port}`);
});

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function handleListProductRecords(url, response) {
  const records = readProductRecords();
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const limitParam = Number(url.searchParams.get("limit") ?? 0) || 0;
  const limit = Math.max(0, Math.min(limitParam, 24));
  const page = limit > 0 ? records.slice(offset, offset + limit) : records;
  sendJson(response, 200, { records: page, total: records.length, offset, limit: limit || records.length });
}

async function handleSaveProductRecord(request, response) {
  try {
    const body = await readJsonBody(request);
    const record = body.record;
    if (!record?.id || !record?.originalImageUrl || !record?.createdAt) {
      sendJson(response, 400, { error: "Invalid product record." });
      return;
    }

    const records = readProductRecords();
    const nextRecords = [record, ...records.filter((item) => item.id !== record.id)];
    writeProductRecords(nextRecords);
    sendJson(response, 200, { record });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Failed to save product record." });
  }
}

function handleDeleteProductRecord(id, response) {
  const safeId = decodeURIComponent(id || "");
  const records = readProductRecords();
  const nextRecords = records.filter((item) => item.id !== safeId);
  writeProductRecords(nextRecords);
  sendJson(response, 200, { ok: true, records: nextRecords });
}

function readProductRecords() {
  ensureProductDataDir();
  if (!existsSync(productRecordsPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(productRecordsPath, "utf8"));
    return Array.isArray(parsed?.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function writeProductRecords(records) {
  ensureProductDataDir();
  writeFileSync(productRecordsPath, `${JSON.stringify({ records }, null, 2)}\n`, "utf8");
}

function ensureProductDataDir() {
  mkdirSync(productDataDir, { recursive: true });
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 60 * 1024 * 1024) throw new Error("Request body too large.");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
