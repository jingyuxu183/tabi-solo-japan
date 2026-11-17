// 后端纯函数的离线测试：不联网、不需要密钥。
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [catalog, shared, runtime] = await Promise.all([readFile(resolve(root, "data/catalog.json"), "utf8"), readFile(resolve(root, "shared/memo.js"), "utf8"), readFile(resolve(root, "worker/runtime.js"), "utf8")]);
const names = ["normalizeGeoName", "regionOfPrefecture", "cityMatches", "targetGeoMatches", "normalizeDiscoveryPlan", "sourceTier", "isReviewSource", "isOfficialSource", "nameGroundedInEvidence", "mustMatchPlace", "collectSearchSources", "requestedCountFromText", "KANJI_MAP", "memoResolveDay", "memoResolveSlot", "memoLocalParse", "normalizeMemoItems", "resolveLocatedItem", "displayPrefecture", "validateLocateInput", "memoNormalizeTrip", "memoTripDays", "memoAlignDayKey", "memoArrangeRules", "memoArrangeScore", "normalizeArrangePlan", "normalizeArrangeItems", "validateArrangeInput", "fillArrangePlan"];
const dir = await mkdtemp(join(tmpdir(), "tabi-test-"));
const file = join(dir, "runtime.mjs");
await writeFile(file, `const ASSETS = {};\nconst CATALOG = ${catalog};\n${shared}\n${runtime}\nexport { ${names.join(", ")} };`);
const t = await import(pathToFileURL(file).href);
let count = 0;
const test = (name, fn) => { try { fn(); count += 1; } catch (error) { console.error(`✗ ${name}`); throw error; } };

const input = { query: "", base: "tokyo", month: 10, interests: [] };
const plan = (query, raw) => t.normalizeDiscoveryPlan({ target: {}, queries: [{ query: "a" }, { query: "b" }], ...raw }, { ...input, query });
const intent = (target, extra = {}) => ({ target: { regions: [], prefectures: [], city: "", named_places: [], ...target }, must_match: [], ...extra });

test("汉字对照表不会把简体字改坏", () => {
  for (const [from, to] of t.KANJI_MAP) assert.notEqual(from, to);
  for (const word of ["广岛", "德岛", "鹿儿岛", "横滨", "东京", "京都", "仙台", "宫城", "冲绳", "镰仓"]) assert.equal(t.normalizeGeoName(word), t.normalizeGeoName(t.normalizeGeoName(word)), word);
});
test("日文写法与中文写法归一后相等", () => {
  for (const [ja, zh] of [["広島県", "广岛县"], ["徳島県", "德岛县"], ["鹿児島県", "鹿儿岛县"], ["横浜市", "横滨"], ["宮城県", "宫城县"], ["沖縄県", "冲绳"], ["東京都", "东京"], ["鎌倉市", "镰仓"], ["愛媛県", "爱媛"], ["滋賀県", "滋贺县"]]) assert.equal(t.normalizeGeoName(ja), t.normalizeGeoName(zh), `${ja} / ${zh}`);
});
test("京都与北海道不被后缀规则截断", () => {
  assert.equal(t.normalizeGeoName("京都"), "京都");
  assert.equal(t.normalizeGeoName("京都府"), "京都");
  assert.equal(t.normalizeGeoName("京都市"), "京都");
  assert.equal(t.normalizeGeoName("北海道"), "北海道");
  assert.equal(t.normalizeGeoName("东京都"), "东京");
});
test("县名可以反推地区", () => {
  assert.equal(t.regionOfPrefecture("広島県"), "中国地方");
  assert.equal(t.regionOfPrefecture("宫城县"), "东北");
  assert.equal(t.regionOfPrefecture("京都府"), "关西");
  assert.equal(t.regionOfPrefecture("不存在县"), "");
});
test("城市允许包含关系，但不同城市不相等", () => {
  assert.ok(t.cityMatches("仙台市青葉区", "仙台"));
  assert.ok(t.cityMatches("大阪市", "大阪"));
  assert.ok(!t.cityMatches("名取市", "仙台"));
  assert.ok(!t.cityMatches("", "仙台"));
});
test("目的地只校验到县：广岛县内的其他城市可以通过", () => {
  const target = intent({ regions: ["中国地方"], prefectures: ["广岛县"], city: "广岛" });
  assert.ok(t.targetGeoMatches({ region: "中国地方", prefecture: "广岛县", city: "竹原市" }, target, false));
  assert.ok(t.targetGeoMatches({ region: "", prefecture: "広島県", city: "福山市" }, target, false), "漏写地区时用县名反推");
  assert.ok(!t.targetGeoMatches({ region: "中国地方", prefecture: "冈山县", city: "仓敷市" }, target, false));
  assert.ok(!t.targetGeoMatches({ region: "九州", prefecture: "福冈县", city: "福冈" }, target, false));
});
test("具体场所校验城市：仙台的店必须在仙台", () => {
  const target = intent({ regions: ["东北"], prefectures: ["宫城县"], city: "仙台" });
  assert.ok(t.targetGeoMatches({ region: "东北", prefecture: "宮城県", city: "仙台市青葉区" }, target, true));
  assert.ok(!t.targetGeoMatches({ region: "东北", prefecture: "宫城县", city: "松岛町" }, target, true));
  assert.ok(!t.targetGeoMatches({ region: "关东", prefecture: "东京都", city: "涩谷区" }, target, true));
});
test("东京的具体场所按都匹配，区名不同也通过", () => {
  const target = intent({ regions: ["关东"], prefectures: ["东京都"], city: "东京" });
  assert.ok(t.targetGeoMatches({ region: "关东", prefecture: "東京都", city: "渋谷区" }, target, true));
  assert.ok(!t.targetGeoMatches({ region: "关东", prefecture: "神奈川县", city: "横滨" }, target, true));
});
test("模型判断优先于关键词", () => {
  assert.equal(plan("想找有寺庙的安静小城", { task_type: "destination_discovery" }).task_type, "destination_discovery");
  assert.equal(plan("九州能看海的小城市，最好有好吃的拉面", { task_type: "destination_discovery" }).task_type, "destination_discovery");
  assert.equal(plan("适合买古着的街区", { task_type: "destination_discovery" }).entity_type, "other");
  assert.equal(plan("推荐三个仙台的牛舌店", { task_type: "place_search", entity_type: "restaurant" }).task_type, "place_search");
});
test("模型没给任务类型时用关键词兜底", () => {
  assert.equal(plan("推荐两家东京咖啡店", {}).task_type, "place_search");
  assert.equal(plan("推荐两家东京咖啡店", {}).entity_type, "cafe");
  assert.equal(plan("九州能看海的小城市", {}).task_type, "destination_discovery");
});
test("找目的地时县市同名的地名按县理解", () => {
  const hiroshima = plan("广岛有什么安静的街区", { task_type: "destination_discovery", target: { regions: ["中国地方"], prefectures: [], city: "广岛" } });
  assert.equal(hiroshima.target.city, "");
  assert.deepEqual(hiroshima.target.prefectures, ["广岛"]);
  const sendai = plan("仙台有哪些老街区", { task_type: "destination_discovery", target: { regions: ["东北"], prefectures: ["宫城县"], city: "仙台" } });
  assert.equal(sendai.target.city, "仙台", "非县名的城市保持不变");
  const cafe = plan("推荐两家广岛咖啡店", { task_type: "place_search", entity_type: "cafe", target: { regions: ["中国地方"], prefectures: ["广岛县"], city: "广岛" } });
  assert.equal(cafe.target.city, "广岛", "找具体场所时保留城市");
});
test("数量以用户原话为准", () => {
  assert.equal(plan("推荐三个仙台的牛舌店", { task_type: "place_search", requested_count: 5 }).requested_count, 3);
  assert.equal(plan("推荐两家东京咖啡店", { task_type: "place_search" }).requested_count, 2);
  assert.equal(plan("九州能看海的小城市", { task_type: "destination_discovery" }).requested_count, 6);
});
test("“一个人”不是结果数量", () => {
  assert.equal(t.requestedCountFromText("德岛适合一个人慢慢逛的地方"), null);
  assert.equal(t.requestedCountFromText("适合一个人吃饭的店，推荐两家"), 2);
  assert.equal(t.requestedCountFromText("推荐3家拉面店"), 3);
  assert.equal(plan("德岛适合一个人慢慢逛的地方", { task_type: "destination_discovery" }).requested_count, 6);
  assert.equal(plan("东京适合一个人去的咖啡店", { task_type: "place_search" }).requested_count, 4);
});
test("来源分级", () => {
  assert.equal(t.sourceTier("https://www.jnto.go.jp/x"), "official");
  assert.equal(t.sourceTier("https://tabelog.com/miyagi/A0401/"), "review");
  assert.equal(t.sourceTier("https://s.tabelog.com/x"), "review");
  assert.equal(t.sourceTier("https://www.yelp.com/biz/x"), "review");
  assert.equal(t.sourceTier("https://rurubu.jp/andmore/article/1"), "media");
  assert.equal(t.sourceTier("https://san-tatsu.jp/articles/1/"), "media");
  assert.equal(t.sourceTier("https://www.rikyu-gyutan.co.jp/"), "other");
  assert.equal(t.isReviewSource("https://www.google.com/search?q=x"), false, "普通搜索页不算评价来源");
  assert.equal(t.isReviewSource("https://www.google.com/maps/place/x"), true);
});
test("搜索结果汇总会屏蔽无关站点并去重", () => {
  const item = (url) => ({ url, title: "标题", content: "摘要" });
  const sources = t.collectSearchSources([{ status: "fulfilled", value: [item("https://rurubu.jp/a"), item("https://www.bilibili.com/video/1"), item("https://hk.finance.yahoo.com/q"), item("https://cn.investing.com/x"), item("https://rurubu.jp/a"), item("https://tabelog.com/b")] }, { status: "rejected", reason: new Error("x") }]);
  assert.deepEqual(sources.map((s) => s.host), ["rurubu.jp", "tabelog.com"]);
  assert.deepEqual(sources.map((s) => s.id), [0, 1]);
  assert.equal(t.collectSearchSources([{ status: "fulfilled", value: [item("https://rurubu.jp/a"), item("https://retty.me/c")] }], { skipUrls: ["https://rurubu.jp/a"] }).length, 1);
});
test("场所名称必须出现在所引用的资料里", () => {
  const sources = [{ title: "仙台の牛たん名店", snippet: "牛たん炭焼 利久 西口本店は仙台駅から徒歩5分。" }, { title: "東京カフェ特集", snippet: "渋谷のおすすめを紹介。" }];
  assert.ok(t.nameGroundedInEvidence({ name: "牛舌炭烧 利久 西口本店", local_name: "牛たん炭焼 利久 西口本店" }, [0], sources));
  assert.ok(t.nameGroundedInEvidence({ name: "利久", local_name: "利久（りきゅう）" }, [0], sources));
  assert.ok(!t.nameGroundedInEvidence({ name: "味太助 本店", local_name: "味太助 本店" }, [0], sources), "资料里没有这家店");
  assert.ok(!t.nameGroundedInEvidence({ name: "Sunny Cafe", local_name: "SUNNY CAFE" }, [1], sources), "只匹配到通用词不算");
});
test("必须匹配的条件会在完整证据里查找", () => {
  const long = "あ".repeat(300);
  const sources = [{ title: "店舗案内", snippet: `${long} 名物は牛たん定食です。` }];
  assert.ok(t.mustMatchPlace({ name: "某店", category: "" }, [0], sources, intent({}, { must_match: ["牛舌"] })), "证据在 80 字之后也要能匹配到");
  assert.ok(!t.mustMatchPlace({ name: "某店", category: "" }, [0], sources, intent({}, { must_match: ["拉面"] })));
});

// ===== 备忘收件箱 =====
const TODAY = "2026-11-15"; // 周日
const day = (text) => t.memoResolveDay(text, TODAY).dayKey;
test("日期：月/日写法", () => {
  assert.equal(day("11/20 baked 咖啡"), "2026-11-20");
  assert.equal(day("11月20日"), "2026-11-20");
  assert.equal(day("11.20"), "2026-11-20");
  assert.equal(day("2026-12-01"), "2026-12-01");
  assert.equal(day("1/3 初诣"), "2027-01-03", "已过去很久的日期按明年理解");
  assert.equal(day("11/10"), "2026-11-10", "刚过去几天的日期不跳到明年");
  assert.equal(day("13/40"), "", "不合法的日期不解析");
});
test("日期：只写几号", () => {
  assert.equal(day("20号 浅草寺"), "2026-11-20");
  assert.equal(day("3号"), "2026-12-03", "本月已过的日子按下个月");
  assert.equal(day("人均3000日元"), "", "金额不是日期");
});
test("日期：星期与相对日期", () => {
  assert.equal(day("周六 一兰"), "2026-11-21");
  assert.equal(day("星期日"), "2026-11-15", "当天也算");
  assert.equal(day("下周三"), "2026-11-18");
  assert.equal(day("下周日"), "2026-11-22");
  assert.equal(day("明天"), "2026-11-16");
  assert.equal(day("后天晚上"), "2026-11-17");
});
test("日期：行程第几天", () => {
  assert.equal(day("第2天 镰仓"), "day-2");
  assert.equal(day("第三天"), "day-3");
  assert.equal(day("Day 4"), "day-4");
  assert.equal(day("没有日期"), "");
});
test("时段只在用户写了的时候才有", () => {
  assert.equal(t.memoResolveSlot("上午 teamLab").slot, "morning");
  assert.equal(t.memoResolveSlot("晚上去人少").slot, "evening");
  assert.equal(t.memoResolveSlot("Fuglen 咖啡").slot, "any");
});
test("本地拆分：名称、特点、日期、时段", () => {
  const { items, notes } = t.memoLocalParse("11/20 Fuglen 咖啡 澳白好喝\n11/21 上午 teamLab Planets\n浅草寺，晚上去人少\n下北泽、吉祥寺\n记得买 Suica", TODAY);
  assert.deepEqual(items.map((item) => item.name), ["Fuglen 咖啡", "teamLab Planets", "浅草寺", "下北泽", "吉祥寺"]);
  assert.equal(items[0].note, "澳白好喝");
  assert.equal(items[0].dayKey, "2026-11-20");
  assert.equal(items[1].slot, "morning");
  assert.equal(items[2].note, "晚上去人少");
  assert.equal(items[3].dayKey, "");
  assert.deepEqual(notes, ["记得买 Suica"]);
});
test("本地拆分：日期或城市单独成行时作用于后面的行", () => {
  const { items } = t.memoLocalParse("周六\n一兰拉面\n中目黑\n京都：\n伏见稻荷", TODAY);
  assert.equal(items[0].dayKey, "2026-11-21");
  assert.equal(items[1].dayKey, "2026-11-21");
  assert.equal(items[2].name, "伏见稻荷");
  assert.equal(items[2].cityHint, "京都");
});
test("整理结果：只保留用户写过的地点", () => {
  const text = "11/20 Fuglen 咖啡 澳白好喝\n一兰拉面";
  const out = t.normalizeMemoItems({ items: [
    { name: "Fuglen 咖啡", note: "澳白好喝", date_text: "11/20", slot: "any", kind: "cafe", query_ja: "フグレン" },
    { name: "一兰拉面", date_text: "", slot: "weird", kind: "nonsense" },
    { name: "东京塔", date_text: "" },
    { name: "Fuglen 咖啡", date_text: "11/20" },
  ], notes: ["x"] }, text, TODAY);
  assert.deepEqual(out.items.map((item) => item.name), ["Fuglen 咖啡", "一兰拉面"]);
  assert.equal(out.dropped, 1, "模型新增的东京塔被去掉");
  assert.equal(out.items[0].dayKey, "2026-11-20");
  assert.equal(out.items[1].slot, "any");
  assert.equal(out.items[1].kind, "other");
});
test("整理结果：模型改写了写法的地点仍然保留", () => {
  const text = "想去中目黑逛逛，然后去代官山蔦屋书店，晚上去涩谷sky要提前订，baked咖啡也不错";
  const out = t.normalizeMemoItems({ items: [{ name: "代官山 茑屋书店" }, { name: "SHIBUYA SKY" }, { name: "Baked 咖啡" }, { name: "中目黑" }, { name: "晴空塔" }, { name: "渋谷スカイ" }] }, text, TODAY);
  assert.deepEqual(out.items.map((item) => item.name), ["代官山 茑屋书店", "SHIBUYA SKY", "Baked 咖啡", "中目黑", "渋谷スカイ"]);
  assert.equal(out.dropped, 1, "用户没写过的晴空塔被去掉");
});
test("整理结果：名称前的日期和时段由规则兜底", () => {
  const text = "周六 晚上 一兰拉面\n11/22 上午 筑地市场 吃早饭\n浅草寺";
  const out = t.normalizeMemoItems({ items: [{ name: "一兰拉面", date_text: "", slot: "any" }, { name: "筑地市场", date_text: "", slot: "any", note: "吃早饭" }, { name: "浅草寺", date_text: "", slot: "any" }] }, text, TODAY);
  assert.deepEqual(out.items.map((item) => [item.dayKey, item.slot]), [["2026-11-21", "evening"], ["2026-11-22", "morning"], ["", "any"]]);
});
test("整理结果：长段落里时段只认名称前紧挨的那一小句", () => {
  const text = "Day1 下午去明治神宫，然后逛表参道，晚上在新宿思出横丁吃烧鸟🍢 Day2 早起去筑地场外市场吃海鲜，之后去银座，傍晚上东京塔看夜景。";
  const parsed = { items: ["明治神宫", "表参道", "新宿思出横丁", "筑地场外市场", "银座", "东京塔"].map((name) => ({ name, slot: "afternoon", date_text: "" })) };
  const rows = Object.fromEntries(t.normalizeMemoItems(parsed, text, "2026-11-15").items.map((item) => [item.name, item]));
  assert.equal(rows["明治神宫"].slot, "afternoon");
  assert.equal(rows["表参道"].slot, "any", "模型顺延的时段不采用");
  assert.equal(rows["新宿思出横丁"].slot, "evening");
  assert.equal(rows["筑地场外市场"].slot, "morning");
  assert.equal(rows["银座"].slot, "any");
  assert.equal(rows["东京塔"].slot, "evening");
  assert.equal(rows["明治神宫"].dayKey, "day-1");
  assert.equal(rows["筑地场外市场"].dayKey, "day-2", "取离名称最近的日期，而不是段落里的第一个");
  assert.equal(rows["东京塔"].dayKey, "day-2");
});
test("整理结果：同一行的日期不顺延，单独成行的日期才顺延", () => {
  const inline = "11/20 Fuglen 咖啡 澳白好喝\n11/21 镰仓 想看海\n浅草寺 晚上去人少\n银座 muji";
  const carried = { items: ["Fuglen 咖啡", "镰仓", "浅草寺", "银座 muji"].map((name) => ({ name, date_text: name.startsWith("Fuglen") ? "11/20" : "11/21" })) };
  assert.deepEqual(t.normalizeMemoItems(carried, inline, "2026-11-15").items.map((item) => item.dayKey), ["2026-11-20", "2026-11-21", "", ""], "模型把 11/21 顺延到后两行时要纠正");
  const header = "11/22\nKOFFEE MAMEYA\n晚上 一兰拉面\n周六：\n镰仓";
  const none = { items: ["KOFFEE MAMEYA", "一兰拉面", "镰仓"].map((name) => ({ name, date_text: "" })) };
  assert.deepEqual(t.normalizeMemoItems(none, header, "2026-11-15").items.map((item) => item.dayKey), ["2026-11-22", "2026-11-22", "2026-11-21"], "单独成行的日期作用于后面的行，模型漏填也能补上");
});
test("县名展示", () => {
  assert.equal(t.displayPrefecture("東京都"), "东京都");
  assert.equal(t.displayPrefecture("京都"), "京都府");
  assert.equal(t.displayPrefecture("宮城県"), "宫城县");
  assert.equal(t.displayPrefecture("北海道"), "北海道");
  assert.equal(t.displayPrefecture("巴厘岛"), "");
});
test("核实结果：有证据才标注位置，否则原样保留", () => {
  const sources = [
    { id: 0, item: "a", title: "FUGLEN TOKYO", url: "https://tabelog.com/tokyo/x", host: "tabelog.com", snippet: "FUGLEN TOKYO（フグレン トウキョウ）は渋谷区富ヶ谷にあるカフェ。" },
    { id: 1, item: "b", title: "別の店", url: "https://example.jp/y", host: "example.jp", snippet: "まったく関係のない内容。" },
  ];
  const located = t.resolveLocatedItem({ id: "a", name: "Fuglen 咖啡", kind: "cafe" }, { found: true, in_japan: true, local_name: "FUGLEN TOKYO", prefecture: "東京都", city: "渋谷区", area: "富ヶ谷", kind: "cafe", summary: "挪威咖啡店的东京店", source_refs: [0] }, sources);
  assert.equal(located.status, "located");
  assert.equal(located.prefecture, "东京都");
  assert.equal(located.region, "关东");
  assert.equal(located.city, "涩谷区", "展示用简体写法");
  assert.equal(located.verificationStatus, "multi_source");
  assert.equal(t.resolveLocatedItem({ id: "a", name: "Fuglen 咖啡" }, { found: true, local_name: "FUGLEN TOKYO", prefecture: "东京都", source_refs: [1] }, sources).status, "unverified", "引用了别的条目的资料");
  assert.equal(t.resolveLocatedItem({ id: "b", name: "某某食堂" }, { found: true, local_name: "某某食堂", prefecture: "东京都", source_refs: [1] }, sources).status, "unverified", "资料里没有这个名称");
  assert.equal(t.resolveLocatedItem({ id: "a", name: "Fuglen 咖啡" }, { found: true, in_japan: false, source_refs: [0] }, sources).status, "outside_japan");
  assert.equal(t.resolveLocatedItem({ id: "a", name: "Fuglen 咖啡" }, { found: false, in_japan: false, source_refs: [] }, sources).status, "unverified", "没有资料时不能说它在国外");
  assert.equal(t.resolveLocatedItem({ id: "a", name: "Fuglen 咖啡" }, { found: true, chain: true, local_name: "FUGLEN", prefecture: "", source_refs: [0] }, sources).status, "chain");
  assert.equal(t.resolveLocatedItem({ id: "c", name: "没有资料的店" }, { found: true, prefecture: "东京都" }, sources).status, "unverified");
});
test("核实请求的输入校验", () => {
  assert.equal(t.validateLocateInput({ items: [{ id: "a", name: "x" }] }), null);
  assert.ok(t.validateLocateInput({ items: [] }));
  assert.ok(t.validateLocateInput({ items: Array.from({ length: 7 }, (_, i) => ({ id: `i${i}`, name: "x" })) }));
  assert.ok(t.validateLocateInput({ items: [{ id: "a", name: "x" }, { id: "a", name: "y" }] }));
});
// ---------- 阶段 2：行程与编排 ----------
const P = (id, prefecture, city, area, extra = {}) => ({ id, name: id, status: "located", prefecture, city, area, kind: "other", slot: "any", dayKey: "", ...extra });
test("行程：每天的上限按到达和离开的时段打折", () => {
  const days = t.memoTripDays({ start: "2026-11-20", days: 4, arrive: "afternoon", leave: "morning", perDay: 4 });
  assert.deepEqual(days.map((day) => [day.key, day.capacity]), [["2026-11-20", 2], ["2026-11-21", 4], ["2026-11-22", 4], ["2026-11-23", 0]]);
  assert.deepEqual(t.memoTripDays({ days: 2, arrive: "evening", leave: "evening", perDay: 3 }).map((day) => [day.key, day.capacity]), [["day-1", 1], ["day-2", 3]]);
  assert.deepEqual(t.memoTripDays({ days: 0 }), []);
  assert.equal(t.memoNormalizeTrip({ days: 99, perDay: 40, start: "2026-02-30" }).days, 0, "不合理的天数不接受");
  assert.equal(t.memoNormalizeTrip({ days: 3, start: "2026-02-30" }).start, "", "不存在的日期不接受");
});
test("行程：设了出发日期后“第 N 天”换成具体日期", () => {
  assert.equal(t.memoAlignDayKey({ start: "2026-11-20" }, "day-3"), "2026-11-22");
  assert.equal(t.memoAlignDayKey({ start: "" }, "day-3"), "day-3");
  assert.equal(t.memoAlignDayKey({ start: "2026-11-20" }, "2026-12-01"), "2026-12-01");
  assert.equal(t.memoAlignDayKey({ start: "2026-11-20" }, ""), "");
});
test("规则编排：同区同天、不同县分开、已定日期的不动、位置未知的不排", () => {
  const items = [P("a1", "东京都", "涩谷区", "原宿"), P("a2", "东京都", "涩谷区", "表参道"), P("b1", "东京都", "台东区", "浅草", { dayKey: "day-2", slot: "evening" }), P("b2", "东京都", "台东区", "上野"), P("k1", "神奈川县", "镰仓市", "长谷"), P("k2", "神奈川县", "镰仓市", "雪之下"), { id: "x", name: "一兰", status: "chain", slot: "any", dayKey: "" }];
  const days = t.memoTripDays({ days: 4, arrive: "morning", leave: "evening", perDay: 4 });
  const plan = t.memoArrangeRules(items, days);
  assert.equal(plan.assign.a1, plan.assign.a2);
  assert.equal(plan.assign.b2, "day-2", "新地点排到已有同区安排的那天");
  assert.equal(plan.assign.b1, undefined, "已定日期的不出现在改动里");
  assert.equal(plan.assign.k1, plan.assign.k2);
  assert.notEqual(plan.assign.k1, plan.assign.a1);
  assert.notEqual(plan.assign.k1, "day-2");
  assert.deepEqual(plan.left.map((entry) => entry.id), ["x"]);
  assert.equal(plan.order["day-2"].at(-1), "b1", "晚上的排在当天最后");
  assert.deepEqual(t.memoArrangeScore(items, plan.assign, days), { splitCities: 0, mixedDays: 0, overCapacity: 0, placed: 5 });
});
test("规则编排：排不下时不超上限，也不把同一个区拆到两天", () => {
  const items = [P("a1", "东京都", "新宿区", ""), P("a2", "东京都", "新宿区", ""), P("a3", "东京都", "新宿区", ""), P("b1", "东京都", "中央区", ""), P("b2", "东京都", "中央区", ""), P("c1", "东京都", "世田谷区", ""), P("c2", "东京都", "世田谷区", "")];
  const days = t.memoTripDays({ days: 3, arrive: "evening", leave: "afternoon", perDay: 3 });
  const plan = t.memoArrangeRules(items, days);
  const score = t.memoArrangeScore(items, plan.assign, days);
  assert.equal(score.overCapacity, 0);
  assert.equal(score.splitCities, 0);
  assert.equal(plan.assign.b1, plan.assign.b2);
  assert.equal(Object.keys(plan.assign).length + plan.left.length, items.length, "每一处要么排进去，要么说明没排");
});
test("模型编排的校验：超出余量的部分、动了已定日期、编造的 id 都不采用", () => {
  const items = [P("a1", "东京都", "涩谷区", ""), P("a2", "东京都", "涩谷区", ""), P("f1", "东京都", "台东区", "", { dayKey: "day-1", slot: "evening" }), P("f2", "东京都", "台东区", "", { dayKey: "day-1" }), { id: "x", name: "未知", status: "other", slot: "any", dayKey: "" }];
  const days = t.memoTripDays({ days: 2, arrive: "morning", leave: "evening", perDay: 3 });
  assert.deepEqual(t.normalizeArrangePlan({ days: [{ key: "day-1", order: ["a1", "a2", "f1", "f2"] }] }, items, days).assign, { a1: "day-1" }, "第 1 天只剩 1 个余量却塞了 2 处：只采用第一处");
  const plan = t.normalizeArrangePlan({ days: [{ key: "day-1", order: ["f1", "f2"], reason: "台东区" }, { key: "day-2", order: ["a1", "ghost", "a2", "f1", "x"], reason: "都在涩谷区" }, { key: "day-9", order: ["a1"] }] }, items, days);
  assert.deepEqual(plan.assign, { a1: "day-2", a2: "day-2" }, "只接受未排且已定位的条目；已定日期、位置未知、编造的 id 都忽略");
  assert.deepEqual(plan.order["day-1"], ["f2", "f1"], "晚上的仍然排在最后");
  assert.deepEqual(plan.order["day-2"], ["a1", "a2"]);
  assert.deepEqual(plan.left.map((entry) => entry.id), ["x"]);
});
test("模型把大组放到排不下的到达日时，按容量把各组重新对到合适的日子", () => {
  const items = [P("s1", "东京都", "涩谷区", ""), P("s2", "东京都", "涩谷区", ""), P("s3", "东京都", "涩谷区", ""), P("m1", "东京都", "武藏野市", ""), P("m2", "东京都", "武藏野市", ""), P("t1", "东京都", "台东区", "", { dayKey: "2026-11-21" }), P("t2", "东京都", "台东区", "")];
  const days = t.memoTripDays({ start: "2026-11-20", days: 4, arrive: "afternoon", leave: "morning", perDay: 4 });
  const plan = t.normalizeArrangePlan({ days: [{ key: "2026-11-20", order: ["s1", "s2", "s3"], reason: "都在涩谷区" }, { key: "2026-11-21", order: ["t2", "t1"], reason: "都在台东区" }, { key: "2026-11-22", order: ["m1", "m2"], reason: "都在武藏野市" }] }, items, days);
  assert.equal(plan.assign.s1, "2026-11-22", "3 处的涩谷组换到排得下的那天");
  assert.equal(plan.assign.s3, "2026-11-22");
  assert.equal(plan.assign.m1, "2026-11-20", "2 处的武藏野组换到只剩 2 个余量的到达日");
  assert.equal(plan.assign.t2, "2026-11-21", "有已定地点的那天不参与调换");
  assert.equal(plan.left.length, 0);
  assert.equal(t.memoArrangeScore(items, plan.assign, days).overCapacity, 0);
});
test("模型漏排的地点由规则补上，已排好的不动", () => {
  const items = [P("a1", "东京都", "涩谷区", ""), P("a2", "东京都", "涩谷区", ""), P("b1", "东京都", "台东区", ""), P("k1", "神奈川县", "镰仓市", "")];
  const days = t.memoTripDays({ days: 3, arrive: "morning", leave: "evening", perDay: 3 });
  const plan = t.normalizeArrangePlan({ days: [{ key: "day-1", order: ["a1"], reason: "涩谷" }, { key: "day-2", order: ["b1"], reason: "台东" }] }, items, days);
  const filled = t.fillArrangePlan(plan, items, days);
  assert.equal(filled.assign.a1, "day-1");
  assert.equal(filled.assign.a2, "day-1", "补进同一个区所在的那天");
  assert.equal(filled.assign.b1, "day-2");
  assert.equal(filled.assign.k1, "day-3", "另一个县补到空着的那天");
  assert.deepEqual(filled.order["day-1"], ["a1", "a2"]);
  assert.equal(filled.left.length, 0);
});
test("编排请求的输入校验", () => {
  assert.equal(t.validateArrangeInput({ trip: { days: 3 }, items: [{ id: "a", name: "某处" }] }), null);
  assert.ok(t.validateArrangeInput({ trip: {}, items: [{ id: "a", name: "某处" }] }), "没设天数");
  assert.ok(t.validateArrangeInput({ trip: { days: 3 }, items: [] }));
  assert.ok(t.validateArrangeInput({ trip: { days: 3 }, items: Array.from({ length: 41 }, (_, i) => ({ id: `i${i}`, name: "x" })) }));
  const normalized = t.normalizeArrangeItems([{ id: "a", name: "某处", status: "located", prefecture: "火星县", city: "x", dayKey: "day-2" }, { id: "a", name: "重复" }], { start: "2026-11-20" });
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].status, "other", "不是日本的县就当作位置未知");
  assert.equal(normalized[0].dayKey, "2026-11-21");
});
console.log(`Backend unit tests passed (${count})`);
