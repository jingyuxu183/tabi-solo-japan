// 备忘收件箱真实评测：node scripts/eval-memo.mjs [输出.json]
// 需要 DEEPSEEK_API_KEY 与 TAVILY_API_KEY，会产生真实费用。固定以 2026-11-15（周日）为“今天”。
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const worker = (await import(pathToFileURL(resolve(root, "dist/server/index.js")).href)).default;
const env = { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "", TAVILY_API_KEY: process.env.TAVILY_API_KEY || "" };
if (!env.DEEPSEEK_API_KEY || !env.TAVILY_API_KEY) { console.error("缺少 DEEPSEEK_API_KEY 或 TAVILY_API_KEY"); process.exit(2); }
const TODAY = "2026-11-15";

// items 里每一项：match 用来在整理结果中找到这条（名称包含即可）；其余字段是期望值，省略表示不检查。
// prefecture: null 表示“不应该被标注到日本的某个县”。
const CASES = [
  { id: "p-style", title: "一行一条：日期 + 店名 + 一句特点", text: "11/20 Fuglen 咖啡 澳白好喝\n11/20 下北泽 逛古着\n周六 镰仓 想看海\n周六 晚上 一兰拉面\nteamLab Planets 要提前订票\n浅草寺，晚上去人少\n记得买 Suica", count: 6, notes: 1,
    items: [{ match: "Fuglen", dayKey: "2026-11-20", note: "澳白好喝" }, { match: "下北泽", dayKey: "2026-11-20", prefecture: "东京都" }, { match: "镰仓", dayKey: "2026-11-21", prefecture: "神奈川县" }, { match: "一兰", dayKey: "2026-11-21", slot: "evening", status: ["chain"] }, { match: "teamLab", dayKey: "", prefecture: "东京都" }, { match: "浅草寺", prefecture: "东京都", note: "晚上去人少" }] },
  { id: "headers", title: "日期或城市单独成行", text: "京都：\n伏见稻荷 早上去\n% Arabica 岚山\n周日\n奈良公园\n道顿堀 晚上吃章鱼烧", count: 4,
    items: [{ match: "伏见稻荷", prefecture: "京都府" }, { match: "Arabica", prefecture: "京都府" }, { match: "奈良公园", dayKey: "2026-11-15", prefecture: "奈良县" }, { match: "道顿堀", dayKey: "2026-11-15", prefecture: "大阪府" }] },
  { id: "prose", title: "一整句话里夹着几个地方", text: "想去中目黑逛逛，然后去代官山蔦屋书店，晚上去涩谷sky要提前订，另外听说bills的松饼不错", count: 4,
    items: [{ match: "中目黑", prefecture: "东京都" }, { match: "蔦屋", prefecture: "东京都" }, { match: "sky", prefecture: "东京都" }, { match: "bills" }] },
  { id: "edge", title: "不在日本的店、待办事项、连锁店带城市", text: "baked咖啡 乌鲁瓦图\n买药妆\n梅田蓝天大厦 看夜景\n一兰拉面 涩谷店\n第2天 箱根温泉", count: 4, notes: 1,
    items: [{ match: "baked", prefecture: null }, { match: "梅田蓝天", prefecture: "大阪府", note: "看夜景" }, { match: "一兰", prefecture: "东京都" }, { match: "箱根", dayKey: "day-2", prefecture: "神奈川县" }] },
  { id: "obscure", title: "名气小的店和写错的名字", text: "茶亭羽当\n神保町 逛旧书店\n完全不存在的店XYZ食堂123\n富士山五合目", count: 4,
    items: [{ match: "羽当", prefecture: "东京都" }, { match: "神保町", prefecture: "东京都" }, { match: "XYZ", prefecture: null }, { match: "五合目" }] },
];

async function call(path, body, ip) {
  const response = await worker.fetch(new Request(`http://local${path}`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) }), env, {});
  return { status: response.status, data: await response.json() };
}

async function runCase(item, index) {
  const started = Date.now();
  const failures = [];
  const collected = await call("/api/collect", { text: item.text, today: TODAY }, `memo-${index}`);
  const collectSeconds = (Date.now() - started) / 1000;
  const items = (collected.data.items || []).map((entry, order) => ({ ...entry, id: `e${index}_${order}` }));
  if (collected.status !== 200) failures.push(`整理失败：${collected.data.error}`);
  if (items.length !== item.count) failures.push(`应拆出 ${item.count} 处，实际 ${items.length} 处`);
  if (item.notes !== undefined && (collected.data.notes || []).length !== item.notes) failures.push(`应有 ${item.notes} 条其他备忘，实际 ${(collected.data.notes || []).length} 条`);
  const located = new Map();
  let tokens = collected.data.usage?.total || 0;
  for (let offset = 0; offset < items.length; offset += 6) {
    const result = await call("/api/locate", { items: items.slice(offset, offset + 6) }, `memo-${index}`);
    if (result.status !== 200) failures.push(`核实失败：${result.data.error}`);
    tokens += result.data.usage?.total || 0;
    for (const entry of result.data.results || []) located.set(entry.id, entry);
  }
  const rows = items.map((entry) => ({ ...entry, ...(located.get(entry.id) || { status: "missing" }) }));
  for (const expected of item.items) {
    const row = rows.find((entry) => entry.name.toLowerCase().includes(expected.match.toLowerCase()));
    if (!row) { failures.push(`没有拆出“${expected.match}”`); continue; }
    if (expected.dayKey !== undefined && row.dayKey !== expected.dayKey) failures.push(`“${row.name}”日期应为 ${expected.dayKey || "未排"}，实际 ${row.dayKey || "未排"}`);
    if (expected.slot !== undefined && row.slot !== expected.slot) failures.push(`“${row.name}”时段应为 ${expected.slot}，实际 ${row.slot}`);
    if (expected.note !== undefined && row.note !== expected.note) failures.push(`“${row.name}”特点应原样保留为“${expected.note}”，实际“${row.note}”`);
    if (expected.status && !expected.status.includes(row.status)) failures.push(`“${row.name}”状态应为 ${expected.status.join("/")}，实际 ${row.status}`);
    if (expected.prefecture === null && row.status === "located") failures.push(`“${row.name}”不应被标到 ${row.prefecture}`);
    if (expected.prefecture && row.prefecture !== expected.prefecture) failures.push(`“${row.name}”应在 ${expected.prefecture}，实际 ${row.status === "located" ? row.prefecture : row.status}`);
  }
  return { id: item.id, title: item.title, pass: failures.length === 0, failures, collectSeconds: +collectSeconds.toFixed(1), seconds: +((Date.now() - started) / 1000).toFixed(1), tokens, notes: collected.data.notes || [], rows: rows.map((row) => ({ name: row.name, note: row.note, dayKey: row.dayKey, slot: row.slot, status: row.status, where: [row.prefecture, row.city, row.area].filter(Boolean).join(" "), local: row.localName, summary: row.summary, hosts: (row.sources || []).map((source) => new URL(source.url).hostname) })) };
}

const results = await Promise.all(CASES.map(runCase));
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.title}  (整理 ${r.collectSeconds}s，全部 ${r.seconds}s，${r.tokens} tokens)`);
  for (const failure of r.failures) console.log(`      ← ${failure}`);
  for (const row of r.rows) console.log(`        · ${row.name}｜${row.dayKey || "未排"}${row.slot !== "any" ? " " + row.slot : ""}｜${row.note || "-"}｜${row.status}${row.where ? " " + row.where : ""}｜${row.hosts.join(", ")}`);
  if (r.notes.length) console.log(`        其他备忘：${r.notes.join("；")}`);
}
const passed = results.filter((r) => r.pass).length;
const rows = results.flatMap((r) => r.rows);
console.log(`\n通过 ${passed}/${results.length} 组；共 ${rows.length} 处，其中 ${rows.filter((row) => row.status === "located").length} 处查到位置`);
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify({ passed, total: results.length, results }, null, 2));
process.exitCode = passed === results.length ? 0 : 1;
