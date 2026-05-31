const siliconFlowApiKey = process.env.SILICONFLOW_API_KEY ?? process.env.OPENAI_API_KEY;
const siliconFlowBaseUrl = process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1";
const siliconFlowModel = process.env.SILICONFLOW_MODEL ?? "Pro/zai-org/GLM-4.5-Air";
const siliconFlowImageEditModel = process.env.SILICONFLOW_IMAGE_EDIT_MODEL ?? "Qwen/Qwen-Image-Edit-2509";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (!siliconFlowApiKey) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Missing SILICONFLOW_API_KEY in environment." }));
    return;
  }
  res.statusCode = 200;
  res.end(JSON.stringify({
    key: siliconFlowApiKey,
    baseUrl: siliconFlowBaseUrl,
    models: {
      chat: siliconFlowModel,
      imageEdit: siliconFlowImageEditModel
    }
  }));
}
