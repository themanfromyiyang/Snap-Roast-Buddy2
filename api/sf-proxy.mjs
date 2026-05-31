export const config = { runtime: "edge" };

const SF_BASE = process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1";
const SF_KEY = process.env.SILICONFLOW_API_KEY ?? process.env.OPENAI_API_KEY ?? "";

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!SF_KEY) {
    return new Response(JSON.stringify({ error: "Missing SILICONFLOW_API_KEY in environment." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  const url = new URL(req.url);
  const endpoint = url.searchParams.get("endpoint") ?? "";
  if (endpoint !== "chat/completions" && endpoint !== "images/generations") {
    return new Response(JSON.stringify({ error: "Invalid endpoint." }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  const upstreamUrl = `${SF_BASE.replace(/\/+$/, "")}/${endpoint}`;

  // Vercel Edge 在 Hobby plan 上首字节默认 ~25s 超时，超时后整个函数被 kill，
  // 用户只能看到 Vercel 自己的 FUNCTION_INVOCATION_TIMEOUT 错误页，没法判断是
  // SiliconFlow 真没响应还是上游慢。这里主动设 23s abort，超时就返回结构化
  // 错误，把诊断信息留到响应里。
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 23_000);

  const startedAt = Date.now();
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SF_KEY}`,
        "content-type": req.headers.get("content-type") ?? "application/json"
      },
      body: req.body,
      duplex: "half",
      signal: abort.signal
    });
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - startedAt;
    const aborted = err?.name === "AbortError";
    return new Response(JSON.stringify({
      error: aborted
        ? `SiliconFlow ${endpoint} 在 ${elapsed}ms 内未返回首字节，已中止。可能上游过慢或模型不存在。`
        : `SiliconFlow ${endpoint} 调用失败：${err?.message ?? String(err)}`,
      elapsedMs: elapsed,
      upstreamUrl
    }), {
      status: 504,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  clearTimeout(timer);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json"
    }
  });
}
