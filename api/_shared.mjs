import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const siliconFlowApiKey = process.env.SILICONFLOW_API_KEY ?? process.env.OPENAI_API_KEY;
const siliconFlowBaseUrl = process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1";
const siliconFlowModel = process.env.SILICONFLOW_MODEL ?? "Pro/zai-org/GLM-4.7";
const siliconFlowVisionModel = process.env.SILICONFLOW_VISION_MODEL ?? "Pro/moonshotai/Kimi-K2.6";
const siliconFlowImageEditModel = process.env.SILICONFLOW_IMAGE_EDIT_MODEL ?? "Qwen/Qwen-Image-Edit-2509";
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const supabaseRecordsTable = process.env.SUPABASE_PRODUCT_RECORDS_TABLE ?? "product_records";

const textLayoutTypes = ["receipt", "big_text", "pixel_expression"];

export async function handleAnalyzeImage(req, res) {
  try {
    requireApiKey();
    const body = await readJsonBody(req);
    const imageUrl = cleanText(body.imageUrl || body.imageDataUrl);

    if (!imageUrl) return sendJson(res, 400, { error: "imageUrl or imageDataUrl is required." });

    const completion = await fetch(`${siliconFlowBaseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: siliconFlowVisionModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildVisionPrompt() },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 500
      })
    });

    if (!completion.ok) return sendUpstreamError(res, completion, "SiliconFlow vision request failed.");

    const data = await completion.json();
    const photoDescription = cleanText(data?.choices?.[0]?.message?.content);
    return sendJson(res, 200, { photoDescription, rawContent: photoDescription });
  } catch (error) {
    return sendServerError(res, error);
  }
}

export async function handleClassifyLayout(req, res) {
  try {
    requireApiKey();
    const body = await readJsonBody(req);
    const photoDescription = cleanText(body.photoDescription);

    if (!photoDescription) return sendJson(res, 400, { error: "photoDescription is required." });

    const completion = await fetch(`${siliconFlowBaseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: siliconFlowModel,
        messages: [
          { role: "system", content: buildBalancedClassificationPrompt() },
          { role: "user", content: `照片描述：${photoDescription}` }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "select_roast_layout",
              description: "Select the most suitable text layout type for Snap Roast Buddy.",
              parameters: {
                type: "object",
                properties: {
                  layoutType: {
                    type: "string",
                    enum: textLayoutTypes,
                    description: "The selected text layout type."
                  },
                  reason: {
                    type: "string",
                    description: "A short Chinese reason explaining the choice."
                  },
                  confidence: {
                    type: "number",
                    description: "Confidence from 0 to 1."
                  }
                },
                required: ["layoutType", "reason"]
              }
            }
          }
        ],
        tool_choice: "auto",
        temperature: 0.2
      })
    });

    if (!completion.ok) return sendUpstreamError(res, completion, "SiliconFlow classification request failed.");

    const data = await completion.json();
    return sendJson(res, 200, {
      ...parseClassificationPayload(data),
      rawContent: data?.choices?.[0]?.message ?? null
    });
  } catch (error) {
    return sendServerError(res, error);
  }
}

export async function handleRoast(req, res) {
  try {
    requireApiKey();
    const body = await readJsonBody(req);
    const photoDescription = cleanText(body.photoDescription);
    const mode = cleanText(body.mode || "auto");
    const roastLevel = cleanText(body.roastLevel || "normal");

    if (!photoDescription) return sendJson(res, 400, { error: "photoDescription is required." });

    const completion = await fetch(`${siliconFlowBaseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: siliconFlowModel,
        messages: [
          { role: "system", content: buildCurrentRoastPrompt(mode, roastLevel) },
          { role: "user", content: `照片描述：${photoDescription}` }
        ],
        temperature: roastLevel === "spicy" ? 0.92 : roastLevel === "gentle" ? 0.58 : 0.78
      })
    });

    if (!completion.ok) return sendUpstreamError(res, completion, "SiliconFlow API request failed.");

    const data = await completion.json();
    const rawContent = data?.choices?.[0]?.message?.content ?? "";
    const parsed = parseModelPayload(String(rawContent));

    return sendJson(res, 200, {
      aiComment: parsed.aiComment,
      enhancedDescription: parsed.enhancedDescription || photoDescription,
      rawContent
    });
  } catch (error) {
    return sendServerError(res, error);
  }
}

export async function handleGenerateDoodle(req, res) {
  try {
    requireApiKey();
    const body = await readJsonBody(req);
    const imageUrl = cleanText(body.imageUrl || body.imageDataUrl);

    if (!imageUrl) return sendJson(res, 400, { error: "imageUrl or imageDataUrl is required." });

    const prompt = buildCurrentDoodlePrompt();

    const completion = await fetch(`${siliconFlowBaseUrl}/images/generations`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: siliconFlowImageEditModel,
        prompt,
        num_inference_steps: 20,
        guidance_scale: 4,
        image: imageUrl,
        image2: imageUrl,
        image3: imageUrl
      })
    });

    if (!completion.ok) return sendUpstreamError(res, completion, "SiliconFlow image edit request failed.");

    const data = await completion.json();
    const imageResult = extractGeneratedImage(data);

    return sendJson(res, 200, {
      imageUrl: imageResult.url,
      imageBase64: imageResult.base64,
      prompt,
      rawContent: data
    });
  } catch (error) {
    return sendServerError(res, error);
  }
}

export function handleDebugPrompts(_req, res) {
  return sendJson(res, 200, {
    model: siliconFlowModel,
    visionModel: siliconFlowVisionModel,
    imageEditModel: siliconFlowImageEditModel,
    baseUrl: siliconFlowBaseUrl,
    prompts: buildDebugPrompts()
  });
}

export function handleDebugSkills(_req, res) {
  return sendJson(res, 200, {
    skillDir: "config/layout-skills",
    files: readLayoutSkillFiles()
  });
}

export async function handleSupabaseHealth(_req, res) {
  try {
    requireSupabaseConfig();
    const query = new URLSearchParams({
      select: "id,created_at",
      order: "created_at.desc",
      limit: "1"
    });
    const response = await fetch(`${supabaseRestBaseUrl()}/${supabaseRecordsTable}?${query}`, {
      headers: supabaseHeaders()
    });

    if (!response.ok) return sendSupabaseError(res, response, "Supabase connection failed.");

    const rows = await response.json();
    return sendJson(res, 200, {
      ok: true,
      table: supabaseRecordsTable,
      keyType: describeSupabaseKeyType(),
      sampleCount: Array.isArray(rows) ? rows.length : 0
    });
  } catch (error) {
    return sendServerError(res, error);
  }
}

export async function handleListProductRecords(req, res) {
  try {
    requireSupabaseConfig();
    const url = new URL(req.url ?? "/api/product-records", `https://${req.headers.host ?? "localhost"}`);
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const limitParam = Number(url.searchParams.get("limit") ?? 0) || 0;
    const limit = Math.max(0, Math.min(limitParam || 24, 24));
    const query = new URLSearchParams({
      select: "record",
      order: "created_at.desc",
      offset: String(offset),
      limit: String(limit)
    });
    const response = await fetch(`${supabaseRestBaseUrl()}/${supabaseRecordsTable}?${query}`, {
      headers: supabaseHeaders({ Prefer: "count=exact" })
    });

    if (!response.ok) return sendSupabaseError(res, response, "Failed to list product records.");

    const rows = await response.json();
    const total = parseTotalCount(response.headers.get("content-range"), Array.isArray(rows) ? rows.length : 0);
    return sendJson(res, 200, {
      records: Array.isArray(rows) ? rows.map((row) => row.record).filter(Boolean) : [],
      total,
      offset,
      limit
    });
  } catch (error) {
    return sendServerError(res, error);
  }
}

export async function handleSaveProductRecord(req, res) {
  try {
    requireSupabaseConfig();
    const body = await readJsonBody(req);
    const record = body.record;
    if (!isValidProductRecord(record)) return sendJson(res, 400, { error: "Invalid product record." });

    const response = await fetch(`${supabaseRestBaseUrl()}/${supabaseRecordsTable}?on_conflict=id`, {
      method: "POST",
      headers: supabaseHeaders({
        "content-type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      }),
      body: JSON.stringify([toProductRecordRow(record)])
    });

    if (!response.ok) return sendSupabaseError(res, response, "Failed to save product record.");

    const rows = await response.json();
    return sendJson(res, 200, { record: rows?.[0]?.record ?? record });
  } catch (error) {
    return sendServerError(res, error);
  }
}

export async function handleDeleteProductRecord(req, res) {
  try {
    requireSupabaseConfig();
    const id = cleanText(req.query?.id ?? req.url?.split("/").pop());
    if (!id) return sendJson(res, 400, { error: "Record id is required." });

    const query = new URLSearchParams({ id: `eq.${id}` });
    const response = await fetch(`${supabaseRestBaseUrl()}/${supabaseRecordsTable}?${query}`, {
      method: "DELETE",
      headers: supabaseHeaders({ Prefer: "return=minimal" })
    });

    if (!response.ok) return sendSupabaseError(res, response, "Failed to delete product record.");
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendServerError(res, error);
  }
}

function buildVisionPrompt() {
  return [
    "请用中文描述这张图片，供“拍立怼 Snap Roast Buddy”生成热敏纸小票。",
    "请重点观察：场景类型、主体、人物/宠物表情、构图、光线、背景、是否糊、是否裁切、有没有明显笑点。",
    "不要评价真实长相、身材、种族、性别、年龄、残障等敏感属性。",
    "输出一段自然语言描述，80 到 160 字，信息密度高一点。"
  ].join("\n");
}

function buildBalancedClassificationPrompt() {
  return [
    "你是 Snap Roast Buddy 的文字排版分类器。",
    "你只需要把照片描述分类到三种文字排版之一：receipt、big_text、pixel_expression。",
    "不要返回 pixel_doodle；pixel_doodle 是图片到图片的独立漫画/简笔画编辑模式，不参与照片描述文字分类。",
    "分类目标要尽量均衡，不要把大多数普通照片都分到 big_text 或 pixel_expression。三类在长期样本中的比例应尽量接近。",
    "1. receipt：默认优先项。照片内容丰富、有多个观察点或点评点，适合照片审判小票。多人、自拍、旅行、美食、宠物、室内生活照、背景/光线/构图都有信息时，优先选 receipt。",
    "2. big_text：只有当照片存在一个非常强、非常单一、能一句话概括的爆点时才选择。例如主体几乎消失、脸被明显裁掉、极端过近、极糊、极暗、背景压过主体。普通构图问题不要轻易选 big_text。",
    "3. pixel_expression：只有当照片的情绪非常明确且表情化更有趣时选择。例如明显可爱、尴尬、无语、震惊、浪漫、委屈、呆住。普通可爱或普通尴尬仍可归 receipt。",
    "如果同时满足多个条件，按这个顺序判断：强单点爆梗才 big_text；强情绪才 pixel_expression；其余优先 receipt。",
    "只通过工具 select_roast_layout 返回分类结果。"
  ].join("\n");
}

function buildDoodlePrompt() {
  return [
    "把输入图片改造成适合 58mm 热敏纸打印的像素化可爱漫画线稿。",
    "硬性要求：只能使用黑白二值画面，背景必须是纯白色，图形只能由纯黑色线条和纯黑色块面构成。",
    "不要灰度，不要彩色，不要阴影渐变，不要纸张纹理，不要摄影质感。",
    "风格要求：可爱、简洁、漫画感、像素感、线条清晰、主体突出、背景大幅简化。",
    "输出应像可以直接热敏打印的黑白贴纸线稿。",
    "不要恐怖或攻击性。"
  ].join("\n");
}

function buildCurrentDoodlePrompt() {
  return [
    "把输入图片重新创作成一张适合 58mm 热敏纸小票内嵌展示的黑白漫画贴纸。",
    "重要：不要只是提取原图线稿。请先理解图片主体、动作、情绪和笑点，再重新画成更有趣、更夸张、更可爱的抽象漫画。",
    "画面比例要求：输出构图适合横向小票插画区，接近 3:2 或 4:3，不要沿用原图比例；主体居中，占画面 65% 到 85%。",
    "硬性要求：纯白背景，纯黑线条和纯黑块面，黑白二值；不要灰度、彩色、阴影、渐变、纸张纹理、摄影质感。",
    "风格：简洁漫画、可爱、线条清楚、略带表情包感；可以夸张表情、姿势或小道具，但不要恐怖或攻击性。",
    "背景需要大幅简化，只保留能帮助理解笑点的元素。最终应像可以直接热敏打印的黑白贴纸。"
  ].join("\n");
}

function buildCurrentRoastPrompt(mode, roastLevel) {
  const tone =
    roastLevel === "spicy"
      ? "吐槽可以更有节目效果、更锋利，但不要恶意攻击人。"
      : roastLevel === "gentle"
        ? "语气温柔、可爱，像朋友轻轻调侃。"
        : "语气轻松、有综艺感，像一个嘴很碎但不坏的拍照搭子。";

  const modeGuides = {
    receipt:
      "当前生成 receipt 小票式内容：不要只写摄影建议。要像照片事件报告，可以包含画面剧情、人物状态、氛围判断、梗点、轻建议。2 到 4 句，短句优先。",
    big_text:
      "当前生成 big_text 爆字内容：像综艺字幕、紧急播报或现场通告。必须短、狠、可一眼记住。最多 2 句，优先形成一个梗。",
    pixel_expression:
      "当前生成 pixel_expression 表情内容：像设备被照片刺激后的反应。文案要短，偏情绪、拟人化、表情包语气，最多 2 句。",
    auto:
      "当前是 auto：根据照片描述写一段适合热敏纸的短评价，重点是让纸条有性格，而不是普通摄影点评。"
  };

  return [
    "你是“拍立怼 Snap Roast Buddy”，一个有性格但不恶意的 AI 拍照搭子。",
    "用户会给你一段照片描述，你要输出有趣评价，用于 58mm 热敏纸小票排版。",
    tone,
    modeGuides[mode] ?? modeGuides.auto,
    "评价角度要多样：可以写画面剧情、现场氛围、人物/宠物状态、背景抢戏、表情管理、拍摄时机、社交场面、照片命运，也可以给一点拍摄建议。",
    "不要每次都写“修改后可发”或只评价构图、光线、角度。结论可以是：建议收藏、适合当表情包、适合发群里、需要配文狡辩、建议补拍一张、适合做证据、适合留作黑历史等。",
    "吐槽重点只能放在构图、光线、背景、角度、表情状态、画面戏剧性、拍摄时机、照片氛围，禁止攻击真实长相、身材、种族、性别、年龄、残障等敏感属性。",
    "输出必须是严格 JSON 对象，不要 Markdown，不要代码块，不要在 JSON 前后加解释文字。",
    "JSON 格式：{\"aiComment\":\"用于小票正文的有趣评价，中文，短句，可包含换行\",\"enhancedDescription\":\"保留原始照片事实，并补充你识别出的槽点关键词\"}",
    "aiComment 中不要出现 JSON 花括号、字段名、括号残留或引号残留。"
  ].join("\n");
}

function buildSystemPrompt(mode, roastLevel) {
  const tone =
    roastLevel === "spicy"
      ? "吐槽可以更锋利一点，但仍然不要恶意攻击人。"
      : roastLevel === "gentle"
        ? "语气要温和、可爱，像朋友轻轻调侃。"
        : "语气轻松、有综艺感，像拍照搭子在吐槽。";

  const modeGuides = {
    receipt:
      "当前要生成 receipt 小票式内容：像照片审判报告，适合多点观察。评价可以是 2 到 3 句，包含画面槽点和一点建议。",
    big_text:
      "当前要生成 big_text 横向大字内容：像综艺字幕或紧急播报。评价必须短、狠、适合大字排版，最好 1 到 2 句。",
    pixel_expression:
      "当前要生成 pixel_expression 像素表情内容：像设备被照片刺激后的反应。评价要短，带情绪标签感，最多 2 句。",
    auto:
      "当前模式是 auto：你先判断照片最适合小票审判、爆梗大字还是像素表情，再写一段适合热敏纸打印的短评价。"
  };

  return [
    "你是“拍立怼 Snap Roast Buddy”，一个有性格但不恶意的 AI 拍照搭子。",
    "用户会给你一段照片描述，你要输出有趣评价，用于 58mm 热敏小票排版。",
    tone,
    modeGuides[mode] ?? modeGuides.auto,
    "吐槽重点只能放在构图、光线、背景、角度、表情状态、画面戏剧性、拍摄时机。",
    "禁止攻击长相、身材、种族、性别、年龄、残障等敏感属性。",
    "只输出 JSON，不要 Markdown，不要代码块。",
    'JSON 格式：{"aiComment":"用于小票正文的有趣评价，中文，尽量短句，可包含换行","enhancedDescription":"保留原始照片事实，并补充你识别出的槽点关键词"}'
  ].join("\n");
}

function buildDebugPrompts() {
  const modes = ["auto", ...textLayoutTypes];
  const roastLevels = ["gentle", "normal", "spicy"];
  const generationPrompts = modes.flatMap((mode) =>
    roastLevels.map((roastLevel) => ({
      type: "roast",
      mode,
      roastLevel,
      systemPrompt: buildCurrentRoastPrompt(mode, roastLevel)
    }))
  );

  return [
    { type: "vision", mode: "image", roastLevel: "-", systemPrompt: buildVisionPrompt() },
    { type: "classification", mode: "auto", roastLevel: "-", systemPrompt: buildBalancedClassificationPrompt() },
    { type: "image_edit", mode: "manga", roastLevel: "-", systemPrompt: buildCurrentDoodlePrompt() },
    ...generationPrompts
  ];
}

function parseClassificationPayload(data) {
  const message = data?.choices?.[0]?.message;
  const args = message?.tool_calls?.[0]?.function?.arguments;

  if (args) {
    try {
      return normalizeClassification(JSON.parse(args));
    } catch {
      // Fall through.
    }
  }

  const rawContent = cleanText(message?.content);
  const jsonText = rawContent.match(/\{[\s\S]*\}/)?.[0] ?? "";
  if (jsonText) {
    try {
      return normalizeClassification(JSON.parse(jsonText));
    } catch {
      // Fall through.
    }
  }

  return {
    layoutType: "receipt",
    reason: "模型未返回有效分类，回退到小票式。",
    confidence: 0
  };
}

function normalizeClassification(value) {
  const allowed = new Set(textLayoutTypes);
  const layoutType = allowed.has(value?.layoutType) ? value.layoutType : "receipt";
  return {
    layoutType,
    reason: cleanText(value?.reason) || "已根据照片描述选择输出类型。",
    confidence: typeof value?.confidence === "number" ? value.confidence : undefined
  };
}

function extractGeneratedImage(data) {
  const first = data?.data?.[0] ?? data?.images?.[0] ?? data?.image;
  if (typeof first === "string") return first.startsWith("http") ? { url: first } : { base64: first };
  if (first?.url) return { url: first.url };
  if (first?.b64_json) return { base64: first.b64_json };
  if (first?.base64) return { base64: first.base64 };
  return { url: "" };
}

function isValidProductRecord(record) {
  return Boolean(record?.id && record?.originalImageUrl && record?.createdAt);
}

function toProductRecordRow(record) {
  return {
    id: cleanText(record.id),
    original_image_url: cleanText(record.originalImageUrl),
    created_at: record.createdAt,
    description: cleanText(record.description),
    layout_type: cleanText(record.layoutType),
    generation_mode: cleanText(record.generationMode),
    roast_level: cleanText(record.roastLevel),
    sketch_mode: cleanText(record.sketchMode),
    ticket_html: record.ticketHtml ?? null,
    ticket_text: record.ticketText ?? null,
    sketch_image_url: record.sketchImageUrl ?? null,
    caption: record.caption ?? null,
    record
  };
}

function requireSupabaseConfig() {
  if (supabaseUrl && supabaseServiceRoleKey) return;
  throw Object.assign(new Error("Missing Supabase config. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Environment Variables."), {
    statusCode: 500
  });
}

function supabaseRestBaseUrl() {
  return `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;
}

function supabaseHeaders(extra = {}) {
  const headers = {
    apikey: supabaseServiceRoleKey,
    ...extra
  };
  if (!supabaseServiceRoleKey?.startsWith("sb_secret_")) {
    headers.authorization = `Bearer ${supabaseServiceRoleKey}`;
  }
  return headers;
}

function describeSupabaseKeyType() {
  if (supabaseServiceRoleKey?.startsWith("sb_secret_")) return "secret";
  if (supabaseServiceRoleKey?.startsWith("sb_service_role_")) return "service_role";
  if (supabaseServiceRoleKey?.split(".").length === 3) return "legacy_jwt";
  return "unknown";
}

function parseTotalCount(contentRange, fallback) {
  const total = Number(contentRange?.split("/")?.[1]);
  return Number.isFinite(total) ? total : fallback;
}

async function sendSupabaseError(res, response, message) {
  const detail = await response.text();
  return sendJson(res, response.status, {
    error: message,
    detail: detail.slice(0, 800)
  });
}

function parseModelPayload(rawContent) {
  const jsonText = rawContent.match(/\{[\s\S]*\}/)?.[0] ?? "";
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      return {
        aiComment: sanitizeModelText(parsed.aiComment || rawContent),
        enhancedDescription: sanitizeModelText(parsed.enhancedDescription || "")
      };
    } catch {
      // Fall through to plain-text handling.
    }
  }

  return {
    aiComment: sanitizeModelText(rawContent),
    enhancedDescription: ""
  };
}

function sanitizeModelText(value) {
  let text = cleanText(value);
  text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      text = cleanText(parsed.aiComment || parsed.comment || parsed.text || text);
    } catch {
      text = text.replace(/[{}]/g, "");
    }
  }
  return text
    .replace(/^\s*["']?(aiComment|comment|text|评价|短评)["']?\s*[:：]\s*/i, "")
    .replace(/["'{}]+$/g, "")
    .trim();
}

function readLayoutSkillFiles() {
  const skillDir = resolve("config", "layout-skills");
  if (!existsSync(skillDir)) return [];

  return readdirSync(skillDir)
    .filter((fileName) => statSync(join(skillDir, fileName)).isFile())
    .map((fileName) => {
      const filePath = join(skillDir, fileName);
      return {
        fileName,
        content: readFileSync(filePath, "utf8")
      };
    });
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return req.body ? JSON.parse(req.body) : {};

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function requireApiKey() {
  if (siliconFlowApiKey) return;
  throw Object.assign(new Error("Missing API key. Set SILICONFLOW_API_KEY in Environment Variables."), {
    statusCode: 500
  });
}

function authHeaders() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${siliconFlowApiKey}`
  };
}

async function sendUpstreamError(res, completion, message) {
  const detail = await completion.text();
  return sendJson(res, completion.status, {
    error: message,
    detail: detail.slice(0, 800)
  });
}

function sendServerError(res, error) {
  return sendJson(res, error?.statusCode ?? 500, {
    error: error instanceof Error ? error.message : "Unknown server error."
  });
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
