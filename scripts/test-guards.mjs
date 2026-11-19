// 公开部署保护的离线测试：限流、每日联网额度、每日 AI 次数、位置缓存。
// 用假的搜索与模型响应，不联网、不需要密钥、不消耗任何额度。
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const worker = (await import(pathToFileURL(resolve(root, "dist/server/index.js")).href)).default;

console.error = () => {}; // 测试里会故意制造故障，不需要打印它们的日志
const calls = { tavily: 0, deepseek: 0 };
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  if (String(url).includes("tavily")) {
    calls.tavily += 1;
    const name = body.query.split(" ")[0];
    return new Response(JSON.stringify({ results: [{ title: `${name} 店舗案内`, url: `https://example.jp/${encodeURIComponent(name)}`, content: `${name} は東京都渋谷区にあります。` }] }), { status: 200 });
  }
  calls.deepseek += 1;
  const user = JSON.parse(body.messages[1].content);
  // 只有查位置的测试需要像样的模型回答；其他接口拿到空结果即可。
  if (!Array.isArray(user.items)) return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  const results = user.items.map((item) => ({ id: item.id, found: true, in_japan: true, chain: false, local_name: item.name, prefecture: "东京都", city: "涩谷区", area: "原宿", kind: "cafe", summary: "测试用的店", source_refs: user.evidence.filter((entry) => entry.item === item.id).map((entry) => entry.id).slice(0, 1) }));
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ results }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
};

function fakeKv() {
  const store = new Map();
  return { store, async get(key, type) { const value = store.get(key); return value === undefined ? null : type === "json" ? JSON.parse(value) : value; }, async put(key, value) { store.set(key, String(value)); } };
}
let ip = 0;
async function locate(env, items, sameIp = null) {
  const response = await worker.fetch(new Request("http://local/api/locate", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": sameIp || `10.0.0.${(ip += 1)}` }, body: JSON.stringify({ items }) }), { DEEPSEEK_API_KEY: "x", TAVILY_API_KEY: "y", ...env }, {});
  return { status: response.status, data: await response.json() };
}
async function post(path, body, env) {
  const response = await worker.fetch(new Request(`http://local${path}`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `10.1.0.${(ip += 1)}` }, body: JSON.stringify(body) }), { DEEPSEEK_API_KEY: "x", TAVILY_API_KEY: "y", ...env }, {});
  return { status: response.status, data: await response.json() };
}
const todayKey = () => new Date().toISOString().slice(0, 10);
const item = (id, name, cityHint = "") => ({ id, name, note: "", kind: "cafe", cityHint, queryJa: "" });
let count = 0;
const test = async (name, fn) => { try { await fn(); count += 1; } catch (error) { console.error(`✗ ${name}`); throw error; } };

await test("位置缓存：查过的地点第二次不再联网", async () => {
  const env = { TABI_KV: fakeKv() };
  calls.tavily = 0; calls.deepseek = 0;
  const first = await locate(env, [item("a", "甲咖啡"), item("b", "乙咖啡", "涩谷")]);
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.results.map((r) => r.status), ["located", "located"]);
  assert.equal(calls.tavily, 2);
  const second = await locate(env, [item("x1", "甲咖啡"), item("x2", "乙咖啡", "涩谷")]);
  assert.equal(calls.tavily, 2, "第二次不应再搜索");
  assert.equal(calls.deepseek, 1, "第二次也不应再调用模型");
  assert.equal(second.data.cachedCount, 2);
  assert.deepEqual(second.data.results.map((r) => [r.id, r.status, r.city]), [["x1", "located", "涩谷区"], ["x2", "located", "涩谷区"]], "缓存结果要换成这次请求的 id");
  const mixed = await locate(env, [item("y1", "甲咖啡"), item("y2", "丙咖啡")]);
  assert.equal(calls.tavily, 3, "只为没查过的那一处联网");
  assert.deepEqual(mixed.data.results.map((r) => r.id), ["y1", "y2"], "结果顺序与请求一致");
  const other = await locate(env, [item("z", "乙咖啡", "新宿")]);
  assert.equal(calls.tavily, 4, "同名但城市不同，算另一个地点");
  assert.equal(other.status, 200);
});
await test("每日联网额度：超出后不再搜索，并给出明确提示", async () => {
  const env = { TABI_KV: fakeKv(), DAILY_SEARCH_LIMIT: "3" };
  calls.tavily = 0;
  assert.equal((await locate(env, [item("a", "店一"), item("b", "店二")])).status, 200);
  const blocked = await locate(env, [item("c", "店三"), item("d", "店四")]);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.code, "SEARCH_BUDGET");
  assert.equal(calls.tavily, 2, "超出额度的请求不应发出任何搜索");
  assert.equal((await locate(env, [item("e", "店五")])).status, 200, "还在额度内的小请求仍然可以");
  assert.equal((await locate(env, [item("f", "店一")])).status, 200, "已缓存的地点不占额度");
  assert.equal(calls.tavily, 3);
});
await test("限流绑定：平台判定超限时返回 429，且不联网", async () => {
  calls.tavily = 0;
  const denied = await locate({ API_LIMITER: { limit: async () => ({ success: false }) } }, [item("a", "某店")]);
  assert.equal(denied.status, 429);
  assert.equal(calls.tavily, 0);
  const allowed = await locate({ API_LIMITER: { limit: async () => ({ success: true }) } }, [item("a", "某店")]);
  assert.equal(allowed.status, 200);
  const broken = await locate({ API_LIMITER: { limit: async () => { throw new Error("down"); } } }, [item("a", "某店")]);
  assert.equal(broken.status, 200, "限流服务出故障时不拦正常请求");
});
await test("没有任何绑定时（本地或 Codex Sites）行为不变", async () => {
  calls.tavily = 0;
  assert.equal((await locate({}, [item("a", "某店")])).status, 200);
  assert.equal((await locate({}, [item("a", "某店")])).status, 200);
  assert.equal(calls.tavily, 2, "没有 KV 就没有缓存");
});
await test("进程内限流仍然生效：同一个 IP 一分钟内超过 12 次被拦", async () => {
  let last;
  for (let index = 0; index < 13; index += 1) last = await locate({}, [item("a", "某店")], "10.9.9.9");
  assert.equal(last.status, 429);
});
await test("每日 AI 次数：用完后整理请求不再调用模型，页面会改用本地规则", async () => {
  const env = { TABI_KV: fakeKv(), DAILY_AI_LIMIT: "1" };
  calls.deepseek = 0;
  const first = await post("/api/collect", { text: "浅草寺" }, env);
  assert.notEqual(first.status, 429);
  assert.equal(calls.deepseek, 1);
  const blocked = await post("/api/collect", { text: "浅草寺" }, env);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.code, "AI_BUDGET");
  assert.equal(calls.deepseek, 1, "超出次数的请求不应调用模型");
});
await test("每日 AI 次数：用完后编排直接用规则版", async () => {
  const kv = fakeKv();
  kv.store.set(`ai:${todayKey()}`, "1");
  calls.deepseek = 0;
  const result = await post("/api/arrange", { trip: { days: 2, arrive: "morning", leave: "evening" }, items: [{ id: "a", name: "浅草寺", status: "located", prefecture: "东京都", city: "台东区" }] }, { TABI_KV: kv, DAILY_AI_LIMIT: "1" });
  assert.equal(result.status, 200);
  assert.equal(result.data.source, "rules");
  assert.equal(calls.deepseek, 0);
});
await test("每日 AI 次数：不够时查位置也不消耗搜索额度", async () => {
  const kv = fakeKv();
  kv.store.set(`ai:${todayKey()}`, "1");
  calls.tavily = 0; calls.deepseek = 0;
  const blocked = await locate({ TABI_KV: kv, DAILY_AI_LIMIT: "1" }, [item("a", "某店")]);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.code, "AI_BUDGET");
  assert.equal(calls.tavily, 0);
  assert.equal(calls.deepseek, 0);
  assert.equal(kv.store.get(`searches:${todayKey()}`), undefined, "没有扣搜索额度");
});
await test("参考路线接口也受限流保护", async () => {
  calls.deepseek = 0;
  const denied = await post("/api/plan", {}, { API_LIMITER: { limit: async () => ({ success: false }) } });
  assert.equal(denied.status, 429);
  assert.equal(calls.deepseek, 0);
});
await test("联网寻找：搜索额度不够一次完整寻找时，不再调用模型规划", async () => {
  calls.tavily = 0; calls.deepseek = 0;
  const blocked = await post("/api/discover", { base: "tokyo", month: 0, pace: "easy", scope: "all", interests: [], query: "仙台 牛舌", excludeIds: [], excludeNames: [] }, { TABI_KV: fakeKv(), DAILY_SEARCH_LIMIT: "4" });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.code, "SEARCH_BUDGET");
  assert.equal(calls.deepseek, 0);
  assert.equal(calls.tavily, 0);
});
console.log(`Deploy guard tests passed (${count})`);
