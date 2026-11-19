// 本地运行 TABI Worker：npm run dev（可用 PORT 指定端口，默认 8787）
// 密钥从环境变量读取：DEEPSEEK_API_KEY、TAVILY_API_KEY（可不填，前端会走规则兜底）
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const workerPath = resolve(fileURLToPath(new URL("../dist/server/index.js", import.meta.url)));
const port = Number(process.env.PORT || 8787);
const worker = (await import(pathToFileURL(workerPath).href)).default;
// 内存版 KV：让本地也有“查过的地点不重复查”和每日额度。重启后清空。
const memory = new Map();
const TABI_KV = {
  async get(key, type) { const value = memory.get(key); return value === undefined ? null : type === "json" ? JSON.parse(value) : value; },
  async put(key, value) { memory.set(key, String(value)); },
};
const env = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "",
  TAVILY_API_KEY: process.env.TAVILY_API_KEY || "",
  DAILY_SEARCH_LIMIT: process.env.DAILY_SEARCH_LIMIT || "",
  DAILY_AI_LIMIT: process.env.DAILY_AI_LIMIT || "",
  TABI_KV,
};

http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    });
    const response = await worker.fetch(request, env, { waitUntil() {}, passThroughOnException() {} });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(String(err?.stack || err));
  }
}).listen(port, () => console.log(`TABI running at http://localhost:${port}`));
