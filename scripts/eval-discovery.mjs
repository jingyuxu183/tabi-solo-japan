// 联网发现真实评测：node scripts/eval-discovery.mjs [输出.json]
// 需要环境变量 DEEPSEEK_API_KEY 与 TAVILY_API_KEY。会产生真实的模型与搜索费用。
// 直接调用 dist/server/index.js 的 fetch，不需要先启动服务。
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const worker = (await import(pathToFileURL(resolve(root, "dist/server/index.js")).href)).default;
const env = { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "", TAVILY_API_KEY: process.env.TAVILY_API_KEY || "" };
if (!env.DEEPSEEK_API_KEY || !env.TAVILY_API_KEY) { console.error("缺少 DEEPSEEK_API_KEY 或 TAVILY_API_KEY"); process.exit(2); }

const JUNK = /(bilibili|finance\.yahoo|investing\.com|youtube|chiebukuro)/;
const all = (places, test) => places.length > 0 && places.every(test);
const has = (value, word) => String(value || "").includes(word);
// expect(result) 返回 null 表示通过，否则返回未通过原因。
const CASES = [
  { id: "sendai-gyutan", query: "推荐三个仙台的牛舌店", readme: true, expect: (r) => r.task !== "place_search" ? "任务类型应为具体场所" : r.places.length !== 3 ? `应返回 3 家，实际 ${r.places.length}` : !all(r.places, (p) => has(p.city, "仙台")) ? "存在非仙台结果" : null },
  { id: "tokyo-cafe", query: "推荐两家东京咖啡店", readme: true, expect: (r) => r.places.length !== 2 ? `应返回 2 家，实际 ${r.places.length}` : !all(r.places, (p) => p.routeAction === "add_to_trip") ? "应可加入当前东京路线" : null },
  { id: "kyushu-sea", query: "九州能看海的小城市", readme: true, expect: (r) => r.task !== "destination_discovery" ? "任务类型应为目的地" : r.places.length < 4 ? `应至少 4 个，实际 ${r.places.length}` : !all(r.places, (p) => p.region === "九州") ? "存在非九州结果" : null },
  { id: "north", query: "想去北边", readme: true, expect: (r) => r.clarify ? null : r.places.length < 4 ? `应澄清或至少 4 个，实际 ${r.places.length}` : null },
  { id: "osaka-cafe", query: "推荐两家大阪咖啡店", expect: (r) => r.places.length !== 2 ? `应返回 2 家，实际 ${r.places.length}` : !all(r.places, (p) => has(p.prefecture, "大阪")) ? "存在非大阪结果" : null },
  { id: "temple-town", query: "想找有寺庙的安静小城", expect: (r) => r.task !== "destination_discovery" ? "被误判为找具体场所" : r.places.length < 3 ? `应至少 3 个，实际 ${r.places.length}` : null },
  { id: "kyushu-sea-ramen", query: "九州能看海的小城市，最好有好吃的拉面", expect: (r) => r.task !== "destination_discovery" ? "被误判为找具体场所" : r.places.length < 3 ? `应至少 3 个，实际 ${r.places.length}` : !all(r.places, (p) => p.region === "九州") ? "存在非九州结果" : null },
  { id: "hiroshima-quiet", query: "广岛有什么安静的街区", expect: (r) => r.places.length < 3 ? `应至少 3 个，实际 ${r.places.length}` : !all(r.places, (p) => has(p.prefecture, "广岛")) ? "存在非广岛结果" : null },
  { id: "tokushima-solo", query: "德岛适合一个人慢慢逛的地方", expect: (r) => r.places.length < 3 ? `应至少 3 个，实际 ${r.places.length}` : !all(r.places, (p) => has(p.prefecture, "德岛")) ? "存在非德岛结果" : null },
  // 以下两条是留出题：修复时不针对它们调整，用来检查改动是否只是迎合上面的查询。
  { id: "kyoto-matcha", query: "京都的抹茶甜品店推荐两家", heldOut: true, expect: (r) => r.task !== "place_search" ? "任务类型应为具体场所" : r.places.length !== 2 ? `应返回 2 家，实际 ${r.places.length}` : !all(r.places, (p) => has(p.prefecture, "京都")) ? "存在非京都结果" : null },
  { id: "kanazawa-area", query: "金泽有哪些适合散步的老街区", heldOut: true, expect: (r) => r.task !== "destination_discovery" ? "任务类型应为目的地" : r.places.length < 2 ? `应至少 2 个，实际 ${r.places.length}` : !all(r.places, (p) => has(p.prefecture, "石川")) ? "存在非石川县结果" : null },
];

async function runCase(item, index) {
  const body = { base: "tokyo", month: 10, pace: "explore", scope: "all", interests: ["street", "shopping", "nature"], query: item.query, excludeIds: [], excludeNames: [] };
  const started = Date.now();
  let status = 0, data = {};
  try {
    const response = await worker.fetch(new Request("http://local/api/discover", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `eval-${index}` }, body: JSON.stringify(body) }), env, {});
    status = response.status; data = await response.json();
  } catch (error) { data = { error: String(error?.message || error) }; }
  const places = Array.isArray(data.places) ? data.places : [];
  const result = { task: data.intent?.task_type || null, clarify: data.needsClarification === true, places };
  let failure = item.expect(result);
  const junk = places.flatMap((p) => p.sources || []).filter((s) => JUNK.test(s.url));
  if (!failure && junk.length) failure = "结果引用了无关站点";
  return { id: item.id, query: item.query, readme: !!item.readme, heldOut: !!item.heldOut, pass: !failure, failure, status, seconds: +((Date.now() - started) / 1000).toFixed(1), tokens: data.usage?.total ?? null, task: result.task, target: data.intent?.target || null, mustMatch: data.intent?.must_match || null, error: data.error || null, filterStats: data.filterStats || null,
    places: places.map((p) => ({ name: p.name, local: p.localName, prefecture: p.prefecture, city: p.city, status: p.verificationStatus, action: p.routeAction, hosts: (p.sources || []).map((s) => new URL(s.url).hostname) })) };
}

const results = [];
for (let i = 0; i < CASES.length; i += 3) results.push(...await Promise.all(CASES.slice(i, i + 3).map((item, offset) => runCase(item, i + offset))));
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.query}${r.heldOut ? "  [留出题]" : ""}  (${r.seconds}s, ${r.tokens ?? "-"} tokens)${r.failure ? `  ← ${r.failure}${r.error ? `；接口提示：${r.error}` : ""}` : ""}`);
  for (const p of r.places) console.log(`        · ${p.name}｜${p.prefecture}/${p.city}｜${p.status}｜${p.hosts.join(", ")}`);
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n通过 ${passed}/${results.length}；README 回归场景 ${results.filter((r) => r.readme && r.pass).length}/${results.filter((r) => r.readme).length}；平均耗时 ${(results.reduce((s, r) => s + r.seconds, 0) / results.length).toFixed(1)}s`);
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify({ passed, total: results.length, results }, null, 2));
process.exitCode = passed === results.length ? 0 : 1;
