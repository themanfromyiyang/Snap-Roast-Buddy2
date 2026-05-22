import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const siliconFlowApiKey = process.env.SILICONFLOW_API_KEY ?? process.env.OPENAI_API_KEY;
const siliconFlowBaseUrl = process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1";
const siliconFlowModel = process.env.SILICONFLOW_MODEL ?? "Pro/zai-org/GLM-4.7";
const siliconFlowVisionModel = process.env.SILICONFLOW_VISION_MODEL ?? "Pro/moonshotai/Kimi-K2.6";

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
          { role: "system", content: buildClassificationPrompt() },
          { role: "user", content: `照片描述：${photoDescription}` }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "select_roast_layout",
              description: "Select the most suitable thermal receipt layout type for Snap Roast Buddy.",
              parameters: {
                type: "object",
                properties: {
                  layoutType: {
                    type: "string",
                    enum: ["receipt", "big_text", "pixel_expression"],
                    description: "The selected layout type."
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
          { role: "system", content: buildSystemPrompt(mode, roastLevel) },
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

export function handleDebugPrompts(_req, res) {
  return sendJson(res, 200, {
    model: siliconFlowModel,
    visionModel: siliconFlowVisionModel,
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

function buildVisionPrompt() {
  return [
    "请用中文描述这张图片，供“拍立怼 Snap Roast Buddy”生成热敏纸小票。",
    "请重点观察：场景类型、主体、人物/宠物表情、构图、光线、背景、是否糊、是否裁切、有没有明显笑点。",
    "不要评价真实长相、身材、种族、性别、年龄、残障等敏感属性。",
    "输出一段自然语言描述，80 到 160 字，信息密度高一点。"
  ].join("\n");
}

function buildClassificationPrompt() {
  return [
    "你是 Snap Roast Buddy 的排版分类器。",
    "你需要把照片描述分类到三种热敏纸排版之一：",
    "1. receipt：内容丰富、多个点评点、适合照片审判小票。",
    "2. big_text：有一个非常强的单一爆点，适合超大旋转横幅字。",
    "3. pixel_expression：情绪非常明确，比如可爱、尴尬、无语、震惊、浪漫，适合像素表情。",
    "只通过工具 select_roast_layout 返回分类结果。"
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
  const modes = ["auto", "receipt", "big_text", "pixel_expression"];
  const roastLevels = ["gentle", "normal", "spicy"];
  const generationPrompts = modes.flatMap((mode) =>
    roastLevels.map((roastLevel) => ({
      type: "roast",
      mode,
      roastLevel,
      systemPrompt: buildSystemPrompt(mode, roastLevel)
    }))
  );

  return [
    { type: "vision", mode: "image", roastLevel: "-", systemPrompt: buildVisionPrompt() },
    { type: "classification", mode: "auto", roastLevel: "-", systemPrompt: buildClassificationPrompt() },
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
  const allowed = new Set(["receipt", "big_text", "pixel_expression"]);
  const layoutType = allowed.has(value?.layoutType) ? value.layoutType : "receipt";
  return {
    layoutType,
    reason: cleanText(value?.reason) || "已根据照片描述选择排版。",
    confidence: typeof value?.confidence === "number" ? value.confidence : undefined
  };
}

function parseModelPayload(rawContent) {
  const jsonText = rawContent.match(/\{[\s\S]*\}/)?.[0] ?? "";
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      return {
        aiComment: cleanText(parsed.aiComment || rawContent),
        enhancedDescription: cleanText(parsed.enhancedDescription || "")
      };
    } catch {
      // Fall through to plain-text handling.
    }
  }

  return {
    aiComment: cleanText(rawContent),
    enhancedDescription: ""
  };
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
  throw Object.assign(new Error("Missing API key. Set SILICONFLOW_API_KEY in Vercel Environment Variables."), {
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
