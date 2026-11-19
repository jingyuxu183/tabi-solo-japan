import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
// 原来的路线规划页面现在是 classic.html；首页 index.html 改为旅行备忘。
const [html, app, css, home, homeJs, homeCss, shared] = await Promise.all([
  readFile(resolve(root, "web/classic.html"), "utf8"),
  readFile(resolve(root, "web/app.js"), "utf8"),
  readFile(resolve(root, "web/style.css"), "utf8"),
  readFile(resolve(root, "web/index.html"), "utf8"),
  readFile(resolve(root, "web/home.js"), "utf8"),
  readFile(resolve(root, "web/home.css"), "utf8"),
  readFile(resolve(root, "shared/memo.js"), "utf8"),
]);

const routeIndex = html.indexOf('class="planner route-first"');
const discoverIndex = html.indexOf('class="discover"');

assert(routeIndex >= 0, "route-first planner is missing");
assert(discoverIndex > routeIndex, "route must appear before destination discovery");
assert.match(html, /01 \/ CREATE YOUR TRIP/);
assert.match(html, /02 \/ DISCOVER &amp; REFINE/);
assert.match(html, /data-scope="favorites"/);
assert.match(html, /id="route-action-dialog"/);
assert.match(app, /function toggleFavorite\(/);
assert.match(app, /function openRouteAction\(/);
assert.match(app, /function applyRouteAction\(/);
assert.match(app, /tabi-favorites-v1/);
assert.match(css, /\.route-first \.itinerary/);
assert.doesNotMatch(app, /不会自动改变右侧路线/);
assert.doesNotMatch(app, /从左侧加入/);

console.log("Route-first UI structure and refinement controls are present");

// 首页：备忘收件箱
for (const id of ["memo-input", "collect", "memo-body", "copy-text", "edit-dialog", "source-dialog", "notes-box"]) assert.match(home, new RegExp(`id="${id}"`), `首页缺少 #${id}`);
assert.match(home, /data-view="date"/);
assert.match(home, /data-view="area"/);
assert.match(home, /href="classic\.html"/, "首页要保留去参考路线的入口");
assert.match(html, /href="\.\/">回到我的备忘/, "参考路线页要能回到备忘");
assert.ok(home.indexOf("memo-shared.js") < home.indexOf("home.js"), "共用逻辑要先于 home.js 加载");
assert.match(homeJs, /\/api\/collect/);
assert.match(homeJs, /\/api\/locate/);
assert.match(homeJs, /memoLocalParse\(/, "AI 不可用时要有本地拆分兜底");
assert.match(homeJs, /tabi-memo-v1/);
assert.match(homeCss, /\.sign-band/);
assert.doesNotMatch(shared, /^\s*(?:import|export)\s/m, "shared/memo.js 会被直接拼接，不能使用 import/export");
assert.doesNotMatch(homeJs, /\b(?:alert|confirm|prompt)\(/, "不使用浏览器原生弹窗");
assert.match(homeJs, /function moveItem\(/, "备忘条目要能改到别的日子");
assert.match(homeJs, /data-drag/, "按日期视图里的条目可以拖动");
assert.match(homeJs, /addEventListener\("pointerdown"/, "拖动用 Pointer Events 实现，鼠标和触屏都能拖");
assert.match(homeJs, /class="drag-handle"/, "手机上按住把手拖");
assert.doesNotMatch(homeJs, /data-move=|draggable="true"/, "不再用“移到…”下拉和浏览器自带的拖放");
assert.doesNotMatch(homeJs, /item\.slot = target\.slot/, "拖动不改用户的时段");
assert.match(home, /id="day-dialog"/);
assert.match(homeJs, /status === "queued"/, "从参考路线带来的条目要在首页接着查位置");
assert.match(html, /id="to-memo"/, "参考路线页要能把整条路线导入备忘");
assert.match(app, /function importRouteToMemo\(/);
assert.match(app, /function addPlaceToMemo\(/);
assert.match(app, /data-memo=/, "参考路线页的每个地点都能单独记进备忘");
assert.match(app, /tabi-memo-v1/, "两页共用同一份备忘");
for (const id of ["tripbar", "trip-edit", "arrange", "undo-bar", "trip-dialog", "trip-days", "arrange-dialog", "arrange-confirm", "today-tab"]) assert.match(home, new RegExp(`id="${id}"`), `首页缺少 #${id}`);
assert.match(homeJs, /\/api\/arrange/, "一键编排要调用编排接口");
assert.match(homeJs, /memoArrangeRules\(/, "接口不可用时用本地规则编排");
assert.match(homeJs, /function undoArrangement\(/, "编排可以整体撤销");
assert.match(homeJs, /function routeUrl\(/, "每天有连线地图");
assert.match(homeJs, /function alignToTrip\(/, "“第 N 天”要能对应到具体日期");
assert.match(await readFile(resolve(root, "worker/runtime.js"), "utf8"), /pathname === "\/api\/arrange"/);
assert.match(home, /id="trip-stays"/, "行程设置里可以写每晚住哪");
assert.match(homeJs, /stays: currentStayValues\(\)/, "保存行程时带上每晚住哪");
assert.match(homeJs, /data-nearby=/, "每个地点有“附近”");
assert.match(homeJs, /google\.com\/maps\/search/, "附近跳到谷歌地图搜索，不调用接口");
assert.match(home, /id="source-wrong"/, "依据里可以说位置不对");
assert.match(homeJs, /fresh: wrong/, "位置不对时跳过缓存重新查");
assert.match(homeJs, /memoStripLinks\(/, "只贴链接时直接提示");
console.log("Memo home page structure is present");
