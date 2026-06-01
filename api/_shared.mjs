import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const siliconFlowApiKey = process.env.SILICONFLOW_API_KEY ?? process.env.OPENAI_API_KEY;
const siliconFlowBaseUrl = process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1";
const siliconFlowModel = process.env.SILICONFLOW_MODEL ?? "Pro/zai-org/GLM-4.7";
// classify 和 roast 都走轻量 Air：GLM-4.7 在 Vercel 60s 内基本必 504。
// Air 12B activated 对"三选一"+"短吐槽 JSON"足够。可分别用
// SILICONFLOW_CLASSIFY_MODEL / SILICONFLOW_ROAST_MODEL 覆盖。
const siliconFlowClassifyModel = process.env.SILICONFLOW_CLASSIFY_MODEL ?? "zai-org/GLM-4.5-Air";
const siliconFlowRoastModel = process.env.SILICONFLOW_ROAST_MODEL ?? "zai-org/GLM-4.5-Air";
const siliconFlowVisionModel = process.env.SILICONFLOW_VISION_MODEL ?? "Pro/moonshotai/Kimi-K2.6";
const siliconFlowImageEditModel = process.env.SILICONFLOW_IMAGE_EDIT_MODEL ?? "Qwen/Qwen-Image-Edit-2509";
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? process.env.UPABASE_SERVICE_ROLE_KEY;
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
        max_tokens: 900
      })
    });

    if (!completion.ok) return sendUpstreamError(res, completion, "SiliconFlow vision request failed.");

    const data = await readUpstreamJson(completion, "SiliconFlow image edit returned a non-JSON response.");
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
        model: siliconFlowClassifyModel,
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

    const data = await readUpstreamJson(completion, "SiliconFlow classification returned a non-JSON response.");
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
        model: siliconFlowRoastModel,
        messages: [
          { role: "system", content: buildCurrentRoastPrompt(mode, roastLevel) },
          { role: "user", content: `照片描述：${photoDescription}` }
        ],
        temperature: roastLevel === "spicy" ? 0.92 : roastLevel === "gentle" ? 0.58 : 0.78
      })
    });

    if (!completion.ok) return sendUpstreamError(res, completion, "SiliconFlow API request failed.");

    const data = await readUpstreamJson(completion, "SiliconFlow roast returned a non-JSON response.");
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
        image: imageUrl
      })
    });

    if (!completion.ok) return sendUpstreamError(res, completion, "SiliconFlow image edit request failed.");

    const data = await readUpstreamJson(completion, "SiliconFlow image edit returned a non-JSON response.");
    const imageResult = extractGeneratedImage(data);
    const imageDataUrl = imageResult.base64 ? "" : await downloadImageAsDataUrl(imageResult.url);

    return sendJson(res, 200, {
      imageUrl: imageDataUrl ? "" : imageResult.url,
      imageDataUrl,
      imageBase64: imageResult.base64,
      persistenceWarning: Boolean(imageResult.url && !imageDataUrl),
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
    const view = cleanText(url.searchParams.get("view") || "full");
    const listQuery = new URLSearchParams({
      select: view === "summary" ? "id,created_at,layout_type,generation_mode,roast_level,sketch_mode,caption" : "id,created_at,layout_type,generation_mode,roast_level,sketch_mode,caption,record,original_image_url,ticket_html,ticket_text,sketch_image_url",
      order: "created_at.desc,id.desc",
      offset: String(offset),
      limit: String(limit)
    });
    const countQuery = new URLSearchParams({
      select: "id",
      order: "created_at.desc,id.desc",
      limit: "1"
    });

    const [response, countResponse] = await Promise.all([
      fetch(`${supabaseRestBaseUrl()}/${supabaseRecordsTable}?${listQuery}`, {
        headers: supabaseHeaders({ Prefer: "count=exact" })
      }),
      fetch(`${supabaseRestBaseUrl()}/${supabaseRecordsTable}?${countQuery}`, {
        method: "HEAD",
        headers: supabaseHeaders({ Prefer: "count=exact" })
      })
    ]);

    if (!response.ok) return sendSupabaseError(res, response, "Failed to list product records.");
    if (!countResponse.ok) return sendSupabaseError(res, countResponse, "Failed to count product records.");

    const rows = await response.json();
    const fallbackTotal = Math.max(offset + (Array.isArray(rows) ? rows.length : 0), Array.isArray(rows) ? rows.length : 0);
    const total = parseTotalCount(countResponse.headers.get("content-range"), parseTotalCount(response.headers.get("content-range"), fallbackTotal));
    const records = Array.isArray(rows)
      ? view === "summary"
        ? rows.map((row) => summaryRecordFromRow(row)).filter(Boolean)
        : (await Promise.all(rows.map((row) => normalizeRecordImages(fullRecordFromRow(row))))).filter(Boolean)
      : [];
    return sendJson(res, 200, {
      records,
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
    return sendJson(res, 200, { record: (await normalizeRecordImages(fullRecordFromRow(rows?.[0]))) ?? record });
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
    ...buildReceiptVisionRequirements(),
    "请用中文描述这张图片，供“拍立怼 Snap Roast Buddy”生成热敏纸小票。",
    "先判断最具体的场景，不要泛泛写“生活照”。只有明确有多人社交、餐桌/派对/KTV/合影互动时，才写“聚会/朋友合照”；不要因为画面里有人或室内就默认成聚会。",
    "场景分类必须细化到最具体可判断层级。例如看到厨房就写厨房料理，不要只写室内；看到地铁就写地铁公交，不要只写通勤；看到婚礼就写婚礼庆典，不要只写聚会；看到屏幕截图就写屏幕截图，不要只写文字照片。",
    "请重点观察：主体是谁或是什么、动作/关系、表情/姿态、物品线索、场景道具、构图、光线、背景、是否糊、是否裁切、有没有明显笑点。",
    "描述里请覆盖多个不同维度的线索，不要只集中在构图和背景。",
    "不要评价真实长相、身材、种族、性别、年龄、残障等敏感属性。",
    "输出一段结构清楚的中文描述，220 到 420 字，信息密度高，不要省略维度。"
  ].join("\n");
}

function buildReceiptVisionRequirements() {
  return [
    "为了生成照片审判小票，请尽量提供可核对的具体信息，不要只写笼统印象。",
    ...buildRecognitionCategoryGuide(),
    "描述中请自然包含：画面主角、具体场景、整体氛围、背景或道具、构图、光线、清晰度、一个隐藏剧情式观察。",
    "请明确描述主体在画面中的位置和占比、背景干扰主要位于哪个方向、是否存在裁切问题、视觉重心是否稳定，供构图检测图使用。",
    "必须逐项覆盖这些分析维度：主体识别、主体位置与占比、动作或姿态、表情或情绪、场景类型、空间层次、背景干扰、关键道具、构图稳定、裁切边缘、拍摄角度、清晰度、光线曝光、色彩协调、视觉重心、画面叙事、社交或传播用途、救片难度。",
    "至少列出 10 个彼此不同的照片诊断线索。不要把多个维度重复写成同一个意思；例如主体清晰度、背景干扰度、光线友好度、构图稳定度、色彩协调度、情绪感染力、空间秩序、时机准确度、分享可信度、救片难度。",
    "至少列出 7 个可用于消费明细的具体观察点。每一点都要具体且互不重复，例如背景抢戏、构图随缘、光线将就、主体努力营业、道具存在感过强、边缘裁切、视觉重心偏移、氛围加成。",
    "至少给出 2 条真正可执行的救片建议，例如移动主体、改变拍摄距离、清理某个方向的背景、调整曝光或重新裁切。",
    "描述尽量使用分项短句，并明确区分：事实观察、诊断线索、消费明细候选、救片建议。保留足够信息量，但不要重复同一个判断。",
    "只描述画面中确实存在的事实或可合理判断的摄影问题，不要凭空添加物体、人物关系或场景。"
  ];
}

function buildRecognitionCategoryGuide() {
  return [
    "分类原则：每个维度都优先输出最具体、最贴近画面的类别。下面的类别只是参考词表，不是封闭枚举；如果画面更适合新的类别，请直接使用更准确的新名称，不要硬塞进相近大类。",
    "场景类型参考：单人自拍、镜面自拍、证件照、朋友合照、家庭合照、情侣约会、聚餐饭局、生日派对、婚礼庆典、餐厅、咖啡店、奶茶店、酒吧、厨房、便利店、超市货架、商场、办公室、会议室、教室、图书馆、宿舍、卧室、客厅、浴室、健身房、球场、街道、人行道、地铁、公交、车站、机场、车内、公园、海边、山野、景区、酒店、展览、博物馆、演唱会、剧场、后台、医院诊所、工作室、商拍棚、屏幕截图、文档票据、商品静物、手作过程、宠物日常、夜景、雨天现场。",
    "主体类型参考：单人、多人、儿童、长辈、情侣、朋友、宠物猫、宠物狗、其他动物、食物、饮品、商品、植物、建筑、风景、车辆、电子设备、屏幕内容、票据文档、手工作品、桌面物件、穿搭配饰。主体允许多个，并区分主角与陪衬。",
    "动作姿态参考：站立、坐姿、行走、奔跑、跳跃、回头、对镜拍摄、举杯、进食、摆拍、抓拍、互动、拥抱、合影、工作、学习、运动、等待、发呆、睡觉、展示商品、制作过程、静物陈列。",
    "表情情绪参考：放松、开心、兴奋、得意、可爱、害羞、疑惑、无语、嫌弃、尴尬、疲惫、紧张、惊讶、崩溃、严肃、冷静、松弛、热闹、浪漫、孤独、治愈、混乱。",
    "空间类型参考：开阔、拥挤、纵深明显、背景平坦、近景压迫、主体孤立、多人层叠、桌面密集、货架密集、留白充足、左右失衡、上下失衡、边缘拥堵、前后景分离、视觉中心漂移。",
    "光线类型参考：自然侧光、自然逆光、顶光、窗边光、室内暖光、室内冷光、混合光源、霓虹灯、舞台灯、夜间弱光、过曝高光、阴影压脸、反光干扰、屏幕光、闪光灯直打。",
    "构图类型参考：居中、三分法、对称、引导线、框景、对角线、俯拍、仰拍、平视、近距离特写、广角环境人像、主体偏小、主体贴边、裁切突兀、背景抢戏、视觉重心偏移、层次混乱、留白过多。",
    "用途类型参考：适合朋友圈、适合群聊、适合表情包、适合纪念、适合存档、适合做封面、适合二次裁切、适合补拍、适合当证据、适合商品展示、适合旅行记录、适合做黑历史。",
    "对于场景、主体、动作、情绪、空间、光线、构图、用途八个维度，各自至少选择一个具体类别；必要时可为同一维度输出 2 到 3 个并列类别。"
  ];
}

function buildBalancedClassificationPrompt() {
  return [
    "你是 Snap Roast Buddy 的文字排版分类器。",
    "你只需要把照片描述分类到三种文字排版之一：receipt、big_text、pixel_expression。",
    "不要返回 pixel_doodle；pixel_doodle 是图片到图片的独立漫画/简笔画编辑模式，不参与照片描述文字分类。",
    "分类目标要尽量均衡，不要把大多数普通照片都分到 big_text 或 pixel_expression。三类在长期样本中的比例应尽量接近。",
    "分类时请综合判断这些维度：信息点数量、主体是否明确、主体与背景关系、场景复杂度、构图异常强度、动作或表情强度、情绪是否一眼可识别、道具是否抢戏、是否存在单一传播金句、是否适合远距离观看、是否适合做贴纸、是否值得保留完整诊断。",
    "不要只因为照片有表情就选 pixel_expression，也不要只因为照片有槽点就选 big_text。先判断最适合的实体纸条用途。",
    "1. receipt：默认优先项。照片内容丰富、有多个观察点或点评点，适合照片审判小票。自拍、合照、旅行、美食、宠物、办公室、家居、商场货架、街景通勤、截图、物品/票据、背景/光线/构图都有信息时，优先选 receipt。",
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
    "enhancedDescription 要保留并补全识别结果：画面主角、具体场景、氛围、背景道具、主体位置和占比、动作姿态、表情情绪、背景干扰方向、空间层次、构图、裁切边缘、拍摄角度、视觉重心、光线曝光、色彩协调、清晰度、画面叙事、传播用途、救片难度、隐藏剧情，以及至少 10 个不同维度的照片诊断线索、至少 7 个消费明细候选和至少 2 条可执行建议。",
    "你是“拍立怼 Snap Roast Buddy”，一个有性格但不恶意的 AI 拍照搭子。",
    "用户会给你一段照片描述，你要输出有趣评价，用于 58mm 热敏纸小票排版。",
    tone,
    modeGuides[mode] ?? modeGuides.auto,
    "产品定义：拍立怼 Snap Roast Buddy 会把一次拍照转化为可收藏、可分享、可围观的实体纸条。因此文案要服务这个链路：先指出画面事实/证据，再给出幽默判断，最后带一点可执行建议或分享用途。",
    "评价角度要多样：可以写画面剧情、现场氛围、人物/宠物/物品状态、背景抢戏、表情管理、拍摄时机、场景道具、空间秩序、照片命运，也可以给一点拍摄建议。",
    "不要生成无来源的随机吐槽；每个梗都要能从照片描述里的主体、背景、构图、光线、道具、表情或场景线索找到依据。",
    "先根据照片描述选择一个具体场景标签，不要默认写聚会。除非描述里明确出现派对、饭局、多人合影、KTV、聚餐、朋友互动，否则不要把它叫聚会。",
    "请从这些维度里挑 2 到 4 个组合出新梗：场景身份、主体状态、背景道具、光线天气、构图边缘、动作瞬间、物品荒诞感、社交气氛、拍摄者失误、照片未来用途。",
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
    "产品定义：拍立怼 Snap Roast Buddy 会把照片理解结果转化为实体纸条。文案需要同时包含画面依据、幽默判断和一点可执行建议或分享用途。",
    "先判断具体场景，不要默认写聚会；除非确实是派对/饭局/多人合影/朋友互动。",
    "不要写和照片线索无关的随机段子；吐槽必须能回扣到主体、背景、构图、光线、道具、表情或拍摄时机。",
    "吐槽重点只能放在构图、光线、背景、角度、表情状态、道具物品、空间秩序、画面戏剧性、拍摄时机。",
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

async function downloadImageAsDataUrl(imageUrl) {
  if (!imageUrl || !String(imageUrl).startsWith("http")) return "";
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) return "";
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > 8 * 1024 * 1024) return "";
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return "";
  }
}

async function normalizeRecordImages(record) {
  if (!record) return undefined;
  if (record.sketchImageUrl?.startsWith("http")) {
    const sketchDataUrl = await downloadImageAsDataUrl(record.sketchImageUrl);
    if (sketchDataUrl) {
      record.sketchImageUrl = sketchDataUrl;
    }
  }
  return record;
}

function isValidProductRecord(record) {
  return Boolean(record?.id && record?.originalImageUrl && record?.createdAt);
}

function summaryRecordFromRow(row) {
  if (!row?.id) return undefined;
  return {
    id: cleanText(row.id),
    createdAt: row.created_at,
    layoutType: cleanText(row.layout_type),
    generationMode: cleanText(row.generation_mode),
    roastLevel: cleanText(row.roast_level),
    sketchMode: cleanText(row.sketch_mode),
    caption: row.caption ?? undefined
  };
}

function fullRecordFromRow(row) {
  if (!row) return undefined;
  const record = row.record && typeof row.record === "object" ? row.record : {};
  return {
    ...record,
    id: cleanText(record.id || row.id),
    originalImageUrl: record.originalImageUrl || row.original_image_url,
    createdAt: record.createdAt || row.created_at,
    description: record.description ?? row.description ?? undefined,
    layoutType: cleanText(record.layoutType || row.layout_type),
    generationMode: cleanText(record.generationMode || row.generation_mode),
    roastLevel: cleanText(record.roastLevel || row.roast_level),
    sketchMode: cleanText(record.sketchMode || row.sketch_mode),
    ticketHtml: record.ticketHtml ?? row.ticket_html ?? undefined,
    ticketText: record.ticketText ?? row.ticket_text ?? undefined,
    sketchImageUrl: record.sketchImageUrl ?? row.sketch_image_url ?? undefined,
    sketchGenerationError: record.sketchGenerationError ?? undefined,
    caption: record.caption ?? row.caption ?? undefined
  };
}

function toProductRecordRow(record) {
  const compactRecord = {
    id: cleanText(record.id),
    createdAt: record.createdAt,
    description: cleanText(record.description),
    layoutType: cleanText(record.layoutType),
    generationMode: cleanText(record.generationMode),
    roastLevel: cleanText(record.roastLevel),
    sketchMode: cleanText(record.sketchMode),
    ticketContent: record.ticketContent ?? null,
    sketchGenerationError: cleanText(record.sketchGenerationError),
    caption: record.caption ?? null
  };

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
    record: compactRecord
  };
}

function requireSupabaseConfig() {
  if (supabaseUrl && supabaseServiceRoleKey) return;
  throw Object.assign(new Error("Missing Supabase config. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Environment Variables. If you used UPABASE_SERVICE_ROLE_KEY, rename it to SUPABASE_SERVICE_ROLE_KEY."), {
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

async function readUpstreamJson(response, message) {
  const rawText = await response.text();
  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    throw Object.assign(new Error(`${message} ${rawText.trim().slice(0, 800)}`), {
      statusCode: 502
    });
  }
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
