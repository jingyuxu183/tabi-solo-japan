// 编排评测：node scripts/eval-arrange.mjs [轮数] [输出.json]
// 用带标准答案的备忘检验 /api/arrange。设置了 DEEPSEEK_API_KEY 时评测模型建议（会产生费用），否则只评测规则版。
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const worker = (await import(pathToFileURL(resolve(root, "dist/server/index.js")).href)).default;
const rounds = Number(process.argv[2]) || 1;
const L = (id, prefecture, city, area, extra = {}) => ({ id, name: id, status: "located", prefecture, city, area, kind: "other", slot: "any", dayKey: "", ...extra });

// together：应该排在同一天的两处；apart：不应该排在同一天的两处。
const CASES = [
  {
    id: "tokyo-6days", title: "东京 6 天，带镰仓一日游和一处已定日期",
    trip: { start: "2026-11-20", days: 6, arrive: "afternoon", leave: "morning", perDay: 4 },
    items: [L("KOFFEE MAMEYA", "东京都", "涩谷区", "表参道"), L("GOLD'S GYM 原宿", "东京都", "涩谷区", "原宿"), L("Fuglen", "东京都", "涩谷区", "富谷"), L("根津美术馆", "东京都", "港区", "南青山"),
      L("浅草寺", "东京都", "台东区", "浅草", { dayKey: "2026-11-22", slot: "evening" }), L("合羽桥道具街", "东京都", "台东区", "合羽桥"), L("上野公园", "东京都", "台东区", "上野"), L("东京晴空塔", "东京都", "墨田区", "押上"),
      L("吉祥寺口琴横丁", "东京都", "武藏野市", "吉祥寺"), L("井之头公园", "东京都", "武藏野市", "吉祥寺"), L("镰仓大佛", "神奈川县", "镰仓市", "长谷"), L("鹤冈八幡宫", "神奈川县", "镰仓市", "雪之下"), L("江之岛", "神奈川县", "藤泽市", "江之岛"),
      { id: "一兰拉面", name: "一兰拉面", status: "chain", kind: "restaurant", slot: "evening", dayKey: "" }],
    together: [["KOFFEE MAMEYA", "GOLD'S GYM 原宿"], ["KOFFEE MAMEYA", "Fuglen"], ["合羽桥道具街", "浅草寺"], ["上野公园", "浅草寺"], ["吉祥寺口琴横丁", "井之头公园"], ["镰仓大佛", "鹤冈八幡宫"], ["镰仓大佛", "江之岛"], ["KOFFEE MAMEYA", "根津美术馆"], ["东京晴空塔", "浅草寺"]],
    softFrom: 7, // 从第 8 对开始是“相邻的区”，规则版不保证，用来看模型是否更懂地理
    apart: [["镰仓大佛", "KOFFEE MAMEYA"], ["镰仓大佛", "浅草寺"], ["江之岛", "井之头公园"]],
    fixed: { 浅草寺: "2026-11-22" }, mustLeave: ["一兰拉面"],
  },
  {
    id: "kansai-4days", title: "关西 4 天，京都地点多于一天的上限",
    trip: { start: "", days: 4, arrive: "morning", leave: "evening", perDay: 4 },
    items: [L("伏见稻荷大社", "京都府", "京都市", "伏见"), L("清水寺", "京都府", "京都市", "东山"), L("祇园", "京都府", "京都市", "祇园"), L("岚山竹林", "京都府", "京都市", "岚山"), L("% Arabica 岚山", "京都府", "京都市", "岚山"),
      L("奈良公园", "奈良县", "奈良市", "奈良公园"), L("东大寺", "奈良县", "奈良市", "杂司町"), L("道顿堀", "大阪府", "大阪市", "道顿堀"), L("黑门市场", "大阪府", "大阪市", "日本桥"), L("通天阁", "大阪府", "大阪市", "新世界")],
    together: [["奈良公园", "东大寺"], ["道顿堀", "黑门市场"], ["道顿堀", "通天阁"], ["岚山竹林", "% Arabica 岚山"], ["清水寺", "祇园"]],
    softFrom: 3,
    apart: [["奈良公园", "道顿堀"], ["奈良公园", "清水寺"], ["道顿堀", "伏见稻荷大社"]],
    fixed: {}, mustLeave: [],
  },
  {
    id: "too-many", title: "3 天、每天最多 3 处，地点比能排的多",
    trip: { start: "2026-12-01", days: 3, arrive: "evening", leave: "afternoon", perDay: 3 },
    items: [L("A1", "东京都", "新宿区", "新宿"), L("A2", "东京都", "新宿区", "新宿"), L("A3", "东京都", "新宿区", "神乐坂"), L("B1", "东京都", "中央区", "银座"), L("B2", "东京都", "中央区", "筑地"), L("C1", "东京都", "世田谷区", "下北泽"), L("C2", "东京都", "世田谷区", "三轩茶屋"), L("D1", "神奈川县", "横滨市", "港未来"), L("D2", "神奈川县", "横滨市", "中华街")],
    together: [["B1", "B2"]], softFrom: 9, apart: [], fixed: {}, mustLeave: [], expectLeft: 3,
  },
];

async function runCase(item, round) {
  const started = Date.now();
  const response = await worker.fetch(new Request("http://local/api/arrange", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `arr-${item.id}-${round}` }, body: JSON.stringify({ trip: item.trip, items: item.items }) }), { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "" }, {});
  const data = await response.json();
  const dayOf = (id) => data.assign?.[id] || item.items.find((entry) => entry.id === id)?.dayKey || "";
  const capacity = new Map((data.days || []).map((day) => [day.key, day.capacity]));
  const counts = new Map();
  for (const entry of item.items) { const key = dayOf(entry.id); if (key) counts.set(key, (counts.get(key) || 0) + 1); }
  const failures = [];
  if (response.status !== 200) failures.push(`HTTP ${response.status} ${data.error || ""}`);
  for (const [id, day] of Object.entries(item.fixed)) if (data.assign?.[id] || dayOf(id) !== day) failures.push(`已定日期的「${id}」被改动`);
  for (const [key, count] of counts) if (count > capacity.get(key)) failures.push(`${key} 排了 ${count} 处，超过上限 ${capacity.get(key)}`);
  for (const id of item.mustLeave) if (data.assign?.[id]) failures.push(`位置未知的「${id}」不应被排进某一天`);
  const hard = item.together.slice(0, item.softFrom);
  const soft = item.together.slice(item.softFrom);
  for (const [a, b] of hard) if (dayOf(a) && dayOf(b) && dayOf(a) !== dayOf(b)) failures.push(`「${a}」和「${b}」同一个市/区却不在同一天`);
  for (const [a, b] of item.apart) if (dayOf(a) && dayOf(a) === dayOf(b)) failures.push(`「${a}」和「${b}」不该在同一天`);
  if (item.expectLeft !== undefined && (data.left || []).length !== item.expectLeft) failures.push(`应有 ${item.expectLeft} 处排不下，实际 ${(data.left || []).length}`);
  const softHit = soft.filter(([a, b]) => dayOf(a) && dayOf(a) === dayOf(b)).length;
  return { id: item.id, title: item.title, round, pass: !failures.length, failures, source: data.source, seconds: +((Date.now() - started) / 1000).toFixed(1), tokens: data.usage?.total ?? null, softHit, softTotal: soft.length,
    days: (data.days || []).map((day) => ({ key: day.key, capacity: day.capacity, order: data.order?.[day.key] || [], reason: data.reasons?.[day.key] || "" })), left: data.left || [] };
}

const results = [];
for (let round = 1; round <= rounds; round += 1) results.push(...await Promise.all(CASES.map((item) => runCase(item, round))));
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.title}  [第 ${r.round} 轮｜${r.source === "model" ? "模型建议" : "规则版"}｜${r.seconds}s｜${r.tokens ?? "-"} tokens｜相邻区同日 ${r.softHit}/${r.softTotal}]`);
  for (const failure of r.failures) console.log(`      ← ${failure}`);
  if (r.round === 1) { for (const day of r.days) console.log(`      ${day.key}（上限 ${day.capacity}）：${day.order.join("、") || "—"}${day.reason ? `  ｜${day.reason}` : ""}`); if (r.left.length) console.log(`      没排：${r.left.map((entry) => entry.id).join("、")}`); }
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n通过 ${passed}/${results.length}；采用模型建议 ${results.filter((r) => r.source === "model").length} 次，退回规则版 ${results.filter((r) => r.source !== "model").length} 次`);
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify({ passed, total: results.length, results }, null, 2));
process.exitCode = passed === results.length ? 0 : 1;
