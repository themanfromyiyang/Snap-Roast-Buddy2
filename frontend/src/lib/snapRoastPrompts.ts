export type RoastMode = "auto" | "receipt" | "big_text" | "pixel_expression";
export type RoastLevel = "gentle" | "normal" | "spicy";

export function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

export function buildCurrentRoastPrompt(mode: string, roastLevel: string): string {
  const tone =
    roastLevel === "spicy"
      ? "吐槽可以更有节目效果、更锋利，但不要恶意攻击人。"
      : roastLevel === "gentle"
        ? "语气温柔、可爱，像朋友轻轻调侃。"
        : "语气轻松、有综艺感，像一个嘴很碎但不坏的拍照搭子。";

  const modeGuides: Record<string, string> = {
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
    "你是\"拍立怼 Snap Roast Buddy\"，一个有性格但不恶意的 AI 拍照搭子。",
    "用户会给你一段照片描述，你要输出有趣评价，用于 58mm 热敏纸小票排版。",
    tone,
    modeGuides[mode] ?? modeGuides.auto,
    "评价角度要多样：可以写画面剧情、现场氛围、人物/宠物状态、背景抢戏、表情管理、拍摄时机、社交场面、照片命运，也可以给一点拍摄建议。",
    "不要每次都写\"修改后可发\"或只评价构图、光线、角度。结论可以是：建议收藏、适合当表情包、适合发群里、需要配文狡辩、建议补拍一张、适合做证据、适合留作黑历史等。",
    "吐槽重点只能放在构图、光线、背景、角度、表情状态、画面戏剧性、拍摄时机、照片氛围，禁止攻击真实长相、身材、种族、性别、年龄、残障等敏感属性。",
    "输出必须是严格 JSON 对象，不要 Markdown，不要代码块，不要在 JSON 前后加解释文字。",
    "JSON 格式：{\"aiComment\":\"用于小票正文的有趣评价，中文，短句，可包含换行\",\"enhancedDescription\":\"保留原始照片事实，并补充你识别出的槽点关键词\"}",
    "aiComment 中不要出现 JSON 花括号、字段名、括号残留或引号残留。"
  ].join("\n");
}

export function buildCurrentDoodlePrompt(): string {
  return [
    "把输入图片重新创作成一张适合 58mm 热敏纸小票内嵌展示的黑白漫画贴纸。",
    "重要：不要只是提取原图线稿。请先理解图片主体、动作、情绪和笑点，再重新画成更有趣、更夸张、更可爱的抽象漫画。",
    "画面比例要求：输出构图适合横向小票插画区，接近 3:2 或 4:3，不要沿用原图比例；主体居中，占画面 65% 到 85%。",
    "硬性要求：纯白背景，纯黑线条和纯黑块面，黑白二值；不要灰度、彩色、阴影、渐变、纸张纹理、摄影质感。",
    "风格：简洁漫画、可爱、线条清楚、略带表情包感；可以夸张表情、姿势或小道具，但不要恐怖或攻击性。",
    "背景需要大幅简化，只保留能帮助理解笑点的元素。最终应像可以直接热敏打印的黑白贴纸。"
  ].join("\n");
}

function sanitizeModelText(value: unknown): string {
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

export interface ParsedRoastPayload {
  aiComment: string;
  enhancedDescription: string;
}

export function parseModelPayload(rawContent: string): ParsedRoastPayload {
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

export interface ExtractedImage {
  url?: string;
  base64?: string;
}

export function extractGeneratedImage(data: any): ExtractedImage {
  const first = data?.data?.[0] ?? data?.images?.[0] ?? data?.image;
  if (typeof first === "string") return first.startsWith("http") ? { url: first } : { base64: first };
  if (first?.url) return { url: first.url };
  if (first?.b64_json) return { base64: first.b64_json };
  if (first?.base64) return { base64: first.base64 };
  return {};
}

export async function downloadImageAsDataUrl(url: string): Promise<string> {
  if (!url || !url.startsWith("http")) return "";
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return "";
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}
