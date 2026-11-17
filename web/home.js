// 首页：旅行备忘。
// 流程：写下文字 → /api/collect 拆成条目（立即显示）→ /api/locate 分批核实位置（逐步补上）。
// AI 不可用时用 memo-shared.js 里的本地规则拆分，条目照样能记、能排日期。

const STORAGE_KEY = "tabi-memo-v1";
const LOCATE_BATCH = 6;
const KIND_LABELS = { restaurant: "餐厅", cafe: "咖啡店", bar: "酒吧", shop: "商店", attraction: "景点", museum: "博物馆", temple: "寺社", park: "公园", onsen: "温泉", gym: "健身房", hotel: "住宿", area: "地区", other: "" };
const SLOT_LABELS = { morning: "上午", afternoon: "下午", evening: "晚上", any: "" };
// 没写时段的排在下午之后、晚上之前：晚上的安排留在一天的最后更符合阅读习惯。
const SLOT_ORDER = { morning: 0, afternoon: 1, any: 2, evening: 3 };
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
// 每个地区一种线路色，用在站名牌和位置圆点上。
const REGION_ORDER = ["北海道", "东北", "关东", "中部", "关西", "中国地方", "四国", "九州", "冲绳"];
const REGION_COLORS = { 北海道: "#2b8fa8", 东北: "#3d8b4f", 关东: "#d9632b", 中部: "#2f6fb5", 关西: "#b0396b", 中国地方: "#8a6a2f", 四国: "#6a56a8", 九州: "#b8433a", 冲绳: "#1f9c8e" };
const SAMPLE = "11/20 Fuglen 咖啡 澳白好喝\n11/20 下北泽 逛古着\n周六 镰仓 想看海\n周六 晚上 一兰拉面\nteamLab Planets 要提前订票\n浅草寺，晚上去人少\n记得买 Suica";

const ARRIVE_LABELS = { morning: "上午到", afternoon: "下午到", evening: "晚上到" };
const LEAVE_LABELS = { morning: "上午走", afternoon: "下午走", evening: "晚上走" };

const state = { items: [], notes: [], view: "date", editingId: null, trip: memoNormalizeTrip({}), undo: null, proposal: null };
let idCounter = 0;

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const foldName = (value) => String(value || "").toLowerCase().replace(/[\s・·　\-—_.,，。]/g, "");
const newId = () => `m${Date.now().toString(36)}${(idCounter += 1).toString(36)}`;

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function setStatus(message, isError = false) {
  const status = $("#compose-status");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

// ---------- 保存与读取 ----------
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items, notes: state.notes, view: state.view, trip: state.trip })); } catch { /* 浏览器不让存时，备忘仍留在当前页面 */ }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return;
    // queued 是从参考路线页加进来、还没查位置的条目，打开首页时会接着查。
    state.items = (Array.isArray(saved.items) ? saved.items : []).filter((item) => item?.id && item?.name).map((item) => ({ ...item, status: item.status === "pending" ? "failed" : item.status }));
    state.notes = (Array.isArray(saved.notes) ? saved.notes : []).filter((note) => note?.id && note?.text);
    state.view = ["area", "today"].includes(saved.view) ? saved.view : "date";
    state.trip = memoNormalizeTrip(saved.trip);
    alignToTrip();
  } catch { /* 存的内容读不出来就从空白开始 */ }
}

// ---------- 行程 ----------
function tripDays() { return state.trip.days ? memoTripDays(state.trip) : []; }

// 设了出发日期后，把“第 N 天”的条目换成具体日期（参考路线导入的就是“第 N 天”）。
function alignToTrip() {
  if (!state.trip.start) return;
  for (const item of state.items) item.dayKey = memoAlignDayKey(state.trip, item.dayKey);
}

function tripSummary() {
  const trip = state.trip;
  if (!trip.days) return "设置出发日期和天数";
  const start = memoParseIso(trip.start);
  return [start ? `${start.getUTCMonth() + 1}/${start.getUTCDate()} 出发` : "出发日期未定", `${trip.days} 天`, ARRIVE_LABELS[trip.arrive], LEAVE_LABELS[trip.leave], `每天最多 ${trip.perDay} 处`].join(" · ");
}

function openTrip() {
  const trip = state.trip;
  $("#trip-start").value = trip.start;
  $("#trip-days").value = trip.days || "";
  $("#trip-arrive").value = trip.arrive;
  $("#trip-leave").value = trip.leave;
  $("#trip-per-day").value = String(trip.perDay);
  $("#trip-dialog").showModal();
}

function saveTrip(event) {
  event.preventDefault();
  const next = memoNormalizeTrip({ start: $("#trip-start").value, days: Number($("#trip-days").value), arrive: $("#trip-arrive").value, leave: $("#trip-leave").value, perDay: Number($("#trip-per-day").value) });
  if (!next.days) { $("#trip-days").focus(); return; }
  state.trip = next;
  alignToTrip();
  $("#trip-dialog").close();
  update();
  showToast("行程已保存");
  if (saveTrip.thenArrange) { saveTrip.thenArrange = false; arrange(); }
}

// ---------- 展示用的小工具 ----------
function dayLabel(dayKey) {
  const label = dayLabelBase(dayKey);
  const tripDay = tripDays().find((day) => day.key === dayKey);
  if (tripDay && label.num) label.trip = `第 ${tripDay.index} 天`;
  if (dayKey && dayKey === todayIso()) label.today = true;
  return label;
}

function dayLabelBase(dayKey) {
  if (!dayKey) return { text: "还没排日期", loose: true };
  const trip = /^day-(\d+)$/.exec(dayKey);
  if (trip) return { text: `第 ${trip[1]} 天` };
  const date = memoParseIso(dayKey);
  if (!date) return { text: dayKey };
  const sameYear = date.getUTCFullYear() === new Date().getFullYear();
  return { num: `${sameYear ? "" : `${date.getUTCFullYear()}/`}${date.getUTCMonth() + 1}/${date.getUTCDate()}`, week: WEEKDAYS[date.getUTCDay()], spoken: `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${WEEKDAYS[date.getUTCDay()]}` };
}

function daySortValue(dayKey) {
  if (!dayKey) return "9";
  return /^day-/.test(dayKey) ? `5${dayKey.replace("day-", "").padStart(3, "0")}` : `1${dayKey}`;
}

function placeText(item, withPrefecture = true) {
  if (item.status !== "located") return "";
  const main = [withPrefecture ? item.prefecture : "", item.city].filter(Boolean).join(" ");
  return main ? main + (item.area ? ` / ${item.area}` : "") : (item.area || item.prefecture);
}

// 当天路线：把这一天查到位置的地点按显示顺序连起来，在地图里能看到真实的路程和时间。
function routeUrl(items) {
  const stops = items.filter((item) => item.status === "located").map((item) => [item.localName || item.name, item.city, item.prefecture].filter(Boolean).join(" "));
  return stops.length >= 2 ? `https://www.google.com/maps/dir/${stops.slice(0, 9).map(encodeURIComponent).join("/")}` : "";
}

function mapUrl(item) {
  const query = [item.localName || item.name, item.area, item.city || item.cityHint, item.prefecture || "日本"].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// “移到哪一天”的下拉：触屏设备拖不了，用它一步完成同样的事。
function moveOptions(item) {
  const days = [...new Set([...tripDays().map((day) => day.key), ...state.items.map((entry) => entry.dayKey || "").filter(Boolean)])].sort((a, b) => daySortValue(a).localeCompare(daySortValue(b)));
  const options = days.filter((dayKey) => dayKey !== item.dayKey).map((dayKey) => { const label = dayLabel(dayKey); return `<option value="${escapeHtml(dayKey)}">${escapeHtml(label.spoken || label.text)}</option>`; });
  if (item.dayKey) options.push('<option value="__none">还没排日期</option>');
  options.push('<option value="__pick">选个日期…</option>');
  return `<option value="">移到…</option>${options.join("")}`;
}

function whereHtml(item, { showDay }) {
  const parts = [];
  if (item.status === "located") parts.push(`<span class="place" style="--line:${REGION_COLORS[item.region] || "#8a979b"}">${escapeHtml(placeText(item, !showDay))}</span>`);
  else if (item.status === "pending" || item.status === "queued") parts.push('<span class="pending">正在查它在哪</span>');
  else if (item.status === "chain") parts.push("<span>连锁店，有多家分店。写上城市能查到具体哪一家</span>");
  else if (item.status === "outside_japan") parts.push("<span>看起来不在日本，先原样留着</span>");
  else if (item.status === "unverified") parts.push("<span>没查到可靠资料，先按你写的留着</span>");
  else parts.push(`<span>还没查位置</span><button class="linkish" type="button" data-relocate="${item.id}">现在查</button>`);
  if (KIND_LABELS[item.kind]) parts.push(`<span class="tag">${KIND_LABELS[item.kind]}</span>`);
  if (SLOT_LABELS[item.slot]) parts.push(`<span class="tag is-time">${SLOT_LABELS[item.slot]}</span>`);
  if (showDay && item.dayKey) { const label = dayLabel(item.dayKey); parts.push(`<span class="tag is-time">${escapeHtml(label.num ? `${label.num} ${label.week}` : label.text)}</span>`); }
  if (item.sources?.length) parts.push(`<button class="linkish" type="button" data-source="${item.id}">依据</button>`);
  return parts.join("");
}

function itemHtml(item, options) {
  return `<li class="item ${item.done ? "is-done" : ""}" data-id="${item.id}" ${options.draggable ? 'draggable="true"' : ""}>
    <label class="tick"><input type="checkbox" data-done="${item.id}" ${item.done ? "checked" : ""}><span class="sr">去过了：${escapeHtml(item.name)}</span></label>
    <div class="item-main">
      <div><span class="item-name">${escapeHtml(item.name)}</span>${item.localName && foldName(item.localName) !== foldName(item.name) ? `<span class="item-local">${escapeHtml(item.localName)}</span>` : ""}</div>
      ${item.note ? `<p class="item-note">${escapeHtml(item.note)}</p>` : ""}
      <p class="item-where">${whereHtml(item, options)}</p>
    </div>
    <div class="item-side">
      <a class="mini" href="${mapUrl(item)}" target="_blank" rel="noreferrer">地图</a>
      <select class="mini move" data-move="${item.id}" aria-label="把${escapeHtml(item.name)}移到哪一天">${moveOptions(item)}</select>
      <button class="mini" type="button" data-edit="${item.id}">修改</button>
    </div>
  </li>`;
}

function joinNames(names) {
  return names.length <= 2 ? names.join("和") : `${names.slice(0, -1).join("、")}和${names[names.length - 1]}`;
}

// ---------- 两种排列 ----------
function groupByDay() {
  const groups = new Map();
  // 行程里的每一天都列出来，空的也列：这样可以直接把地点拖进还没安排的日子。
  for (const day of tripDays()) groups.set(day.key, []);
  for (const item of state.items) {
    if (!groups.has(item.dayKey || "")) groups.set(item.dayKey || "", []);
    groups.get(item.dayKey || "").push(item);
  }
  for (const items of groups.values()) items.sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
  return groups;
}

// 一天里和别的地点不在同一个市/区、而另一天正好有同区安排的那一处：建议挪过去。
function daySuggestion(dayKey, items, groups) {
  const located = items.filter((item) => item.status === "located" && item.prefecture);
  if (located.length < 2) return null;
  for (const item of located) {
    if (located.some((other) => other !== item && memoCityKey(other) === memoCityKey(item))) continue;
    for (const [otherKey, others] of groups) {
      if (!otherKey || otherKey === dayKey) continue;
      if (others.some((other) => other.status === "located" && memoCityKey(other) === memoCityKey(item))) return { item, targetKey: otherKey };
    }
  }
  return null;
}

function dayNotes(dayKey, items, groups) {
  if (!dayKey) return "";
  const notes = [];
  // 同一天跨了几个县，是最容易排不过来的情况，直接指出来。
  const prefectures = [...new Set(items.filter((item) => item.status === "located").map((item) => item.prefecture))];
  const cities = [...new Set(items.filter((item) => item.status === "located" && item.city).map((item) => `${item.prefecture}${item.city}`))];
  if (prefectures.length > 1) notes.push(`<p class="group-note is-warn">这一天跨了${joinNames(prefectures)}，留意路上花的时间。</p>`);
  else if (cities.length > 2) notes.push(`<p class="group-note">这一天要去 ${cities.length} 个不同的区域。</p>`);
  const tripDay = tripDays().find((day) => day.key === dayKey);
  if (tripDay && items.length > tripDay.capacity) {
    const why = tripDay.capacity < state.trip.perDay ? (tripDay.index === 1 ? `到达日（${ARRIVE_LABELS[state.trip.arrive]}）` : `离开日（${LEAVE_LABELS[state.trip.leave]}）`) + `大约只排得下 ${tripDay.capacity} 处` : `你设的是每天最多 ${tripDay.capacity} 处`;
    notes.push(`<p class="group-note is-warn">这天排了 ${items.length} 处，${why}，可能有点赶。</p>`);
  }
  const suggestion = daySuggestion(dayKey, items, groups);
  if (suggestion) notes.push(`<p class="group-note">${escapeHtml(suggestion.item.name)}在${escapeHtml(suggestion.item.city || suggestion.item.prefecture)}，${escapeHtml(describeDay(suggestion.targetKey))}也有那一带的安排。<button class="linkish" type="button" data-suggest="${suggestion.item.id}" data-target="${escapeHtml(suggestion.targetKey)}">挪过去</button></p>`);
  return notes.join("");
}

function renderByDate(onlyKey = null) {
  const groups = groupByDay();
  const html = [...groups.entries()].filter(([dayKey]) => onlyKey === null || dayKey === onlyKey).sort((a, b) => daySortValue(a[0]).localeCompare(daySortValue(b[0]))).map(([dayKey, items]) => {
    const label = dayLabel(dayKey);
    const head = label.num
      ? `<span class="daymark-num">${label.num}</span><span class="daymark-week">${label.week}</span>`
      : `<span class="daymark-text">${escapeHtml(label.text)}</span>`;
    const chips = `${label.today ? '<span class="daymark-chip is-today">今天</span>' : ""}${label.trip ? `<span class="daymark-chip">${label.trip}</span>` : ""}`;
    const route = dayKey ? routeUrl(items) : "";
    const list = items.length ? items.map((item) => itemHtml(item, { showDay: false, draggable: true })).join("") : '<li class="empty-day">这天还没安排，可以把地点拖到这里。</li>';
    return `<section class="group" data-day="${escapeHtml(dayKey)}">
      <header class="daymark ${label.loose ? "is-loose" : ""}">${head}${chips}<span class="daymark-count">${route ? `<a class="route-link" href="${route}" target="_blank" rel="noreferrer">当天路线地图</a>` : ""}${items.length} 处</span></header>
      ${dayNotes(dayKey, items, groups)}
      <ul class="group-list">${list}</ul>
    </section>`;
  }).join("");
  return html + (onlyKey === null ? '<div class="newday" data-day="__new">拖到这里，另排一天</div>' : "");
}

// ---------- 一键编排 ----------
function arrangePayload() {
  return state.items.map((item) => ({ id: item.id, name: item.name, status: item.status, prefecture: item.prefecture || "", city: item.city || "", area: item.area || "", kind: item.kind, slot: item.slot, dayKey: item.dayKey || "" }));
}

async function arrange() {
  if (!state.trip.days) { saveTrip.thenArrange = true; openTrip(); return; }
  if (!state.items.some((item) => !item.dayKey)) { showToast("所有地点都已经排了日期"); return; }
  const button = $("#arrange");
  button.disabled = true;
  button.textContent = "正在排";
  let plan;
  try {
    plan = await postJson("/api/arrange", { trip: state.trip, items: arrangePayload() });
  } catch {
    // 接口不可用时用同一套本地规则：同一个市/区的放一天。
    const days = memoTripDays(state.trip);
    plan = { ...memoArrangeRules(arrangePayload(), days), source: "local", days };
  }
  button.disabled = false;
  button.textContent = "帮我排一下";
  state.proposal = plan;
  const byId = new Map(state.items.map((item) => [item.id, item]));
  const placed = Object.keys(plan.assign || {}).length;
  const dayHtml = (plan.days || []).filter((day) => (plan.order?.[day.key] || []).length).map((day) => {
    const label = dayLabel(day.key);
    const rows = plan.order[day.key].map((id) => byId.get(id)).filter(Boolean).map((item) => `<li class="${plan.assign[item.id] ? "is-new" : ""}"><span class="plan-name">${escapeHtml(item.name)}</span><span class="plan-where">${escapeHtml(placeText(item) || "")}${SLOT_LABELS[item.slot] ? ` · ${SLOT_LABELS[item.slot]}` : ""}</span>${plan.assign[item.id] ? '<span class="plan-flag">新排入</span>' : '<span class="plan-flag is-kept">原有</span>'}</li>`).join("");
    return `<section class="plan-day"><h3>${escapeHtml(label.spoken || label.text)}${label.trip ? `<span>${label.trip}</span>` : ""}</h3>${plan.reasons?.[day.key] ? `<p class="plan-reason">${escapeHtml(plan.reasons[day.key])}</p>` : ""}<ul>${rows}</ul></section>`;
  }).join("");
  const left = (plan.left || []).map((entry) => ({ item: byId.get(entry.id), reason: entry.reason })).filter((entry) => entry.item);
  const leftHtml = left.length ? `<section class="plan-day is-left"><h3>先不排的 ${left.length} 处</h3><ul>${left.map((entry) => `<li><span class="plan-name">${escapeHtml(entry.item.name)}</span><span class="plan-where">${escapeHtml(entry.reason)}</span></li>`).join("")}</ul></section>` : "";
  $("#arrange-title").textContent = placed ? `建议这样排（新排入 ${placed} 处）` : "这次没有可以排进去的地点";
  $("#arrange-content").innerHTML = (placed ? dayHtml : "") + leftHtml;
  $("#arrange-source").textContent = plan.source === "model" ? "由模型按位置远近给出建议，并经过校验：不改动你已经定好日期的地点，不超过每天的上限。" : "按规则排的：同一个市或区的放在同一天，不同县的分开。";
  $("#arrange-confirm").hidden = !placed;
  $("#arrange-dialog").showModal();
}

function applyArrangement() {
  const plan = state.proposal;
  if (!plan) return;
  state.undo = { items: JSON.stringify(state.items), count: Object.keys(plan.assign).length };
  const rank = new Map();
  for (const ids of Object.values(plan.order || {})) ids.forEach((id, index) => rank.set(id, index));
  for (const item of state.items) if (plan.assign[item.id]) item.dayKey = plan.assign[item.id];
  // 同一天里按建议的先后排；没涉及的条目保持原来的相对位置。
  state.items = state.items.map((item, index) => ({ item, index })).sort((a, b) => (rank.has(a.item.id) ? rank.get(a.item.id) : 1000 + a.index) - (rank.has(b.item.id) ? rank.get(b.item.id) : 1000 + b.index)).map((entry) => entry.item);
  state.proposal = null;
  state.view = "date";
  $("#arrange-dialog").close();
  update();
}

function undoArrangement() {
  if (!state.undo) return;
  try { state.items = JSON.parse(state.undo.items); } catch { /* 快照坏了就保持现状 */ }
  state.undo = null;
  update();
  showToast("已恢复到编排之前");
}

// ---------- 拖动改日期 ----------
function describeDay(dayKey) {
  const label = dayLabel(dayKey);
  return label.spoken || label.text;
}

// 把一条备忘放到某一天；beforeId 有值时插到那一条前面，并跟随它的时段，这样落点就是看到的位置。
function moveItem(id, dayKey, beforeId = null) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item || beforeId === id) return;
  const target = beforeId ? state.items.find((entry) => entry.id === beforeId) : null;
  const changedDay = (item.dayKey || "") !== (dayKey || "");
  item.dayKey = dayKey || "";
  state.items = state.items.filter((entry) => entry.id !== id);
  if (target) {
    item.slot = target.slot;
    state.items.splice(state.items.indexOf(target), 0, item);
  } else state.items.push(item);
  update();
  if (changedDay) showToast(dayKey ? `已移到 ${describeDay(dayKey)}` : "已放回“还没排日期”");
}

let draggingId = null;
let pendingNewDayId = null;
function clearDropMarks() { document.querySelectorAll(".is-drop, .is-drop-before").forEach((node) => node.classList.remove("is-drop", "is-drop-before")); }
function bindDrag() {
  const body = $("#memo-body");
  body.addEventListener("dragstart", (event) => {
    const row = event.target.closest?.(".item[draggable]");
    if (!row) return;
    draggingId = row.dataset.id;
    event.dataTransfer.setData("text/plain", draggingId);
    event.dataTransfer.effectAllowed = "move";
    document.body.classList.add("is-dragging");
    row.classList.add("is-dragged");
  });
  body.addEventListener("dragend", () => { draggingId = null; document.body.classList.remove("is-dragging"); clearDropMarks(); document.querySelectorAll(".is-dragged").forEach((node) => node.classList.remove("is-dragged")); });
  body.addEventListener("dragover", (event) => {
    if (!draggingId) return;
    const zone = event.target.closest?.("[data-day]");
    if (!zone) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearDropMarks();
    zone.classList.add("is-drop");
    const row = event.target.closest(".item");
    if (row && row.dataset.id !== draggingId) row.classList.add("is-drop-before");
  });
  body.addEventListener("drop", (event) => {
    const zone = event.target.closest?.("[data-day]");
    const id = draggingId || event.dataTransfer.getData("text/plain");
    if (!zone || !id) return;
    event.preventDefault();
    const row = event.target.closest(".item");
    clearDropMarks();
    if (zone.dataset.day === "__new") { openNewDay(id); return; }
    moveItem(id, zone.dataset.day, row && row.dataset.id !== id ? row.dataset.id : null);
  });
}

function openNewDay(id) {
  pendingNewDayId = id;
  const item = state.items.find((entry) => entry.id === id);
  $("#day-title").textContent = item ? `把“${item.name}”排到哪一天？` : "排到哪一天？";
  $("#day-input").value = memoParseIso(item?.dayKey) ? item.dayKey : "";
  $("#day-dialog").showModal();
}

function renderByArea() {
  const groups = new Map();
  for (const item of state.items) {
    const located = item.status === "located";
    const key = located ? item.prefecture : "";
    if (!groups.has(key)) groups.set(key, { located, region: located ? item.region : "", prefecture: key, items: [] });
    groups.get(key).items.push(item);
  }
  const rank = (group) => (group.located ? REGION_ORDER.indexOf(group.region) : 99);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.items.length - a.items.length).map((group) => {
    group.items.sort((a, b) => (a.city || "").localeCompare(b.city || "", "zh") || daySortValue(a.dayKey).localeCompare(daySortValue(b.dayKey)) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
    // 同一个市或区里的几处分散在不同日子（或还没排）时，提示可以并到一天。
    const notes = [];
    const cities = new Map();
    for (const item of group.items) if (group.located && item.city) cities.set(item.city, [...(cities.get(item.city) || []), item]);
    for (const [city, items] of cities) {
      if (items.length > 1 && new Set(items.map((item) => item.dayKey || "")).size > 1) notes.push(`${joinNames(items.map((item) => item.name))}都在${city}，可以排在同一天。`);
    }
    return `<section class="group">
      <header class="sign" style="--line:${REGION_COLORS[group.region] || "#8a979b"}"><div class="sign-name">${escapeHtml(group.located ? group.prefecture : "还没查到位置")}</div><div class="sign-band"><span>${escapeHtml(group.located ? group.region : "查到后会归到对应的地区")}</span><span>${group.items.length} 处</span></div></header>
      ${notes.map((note) => `<p class="group-note">${escapeHtml(note)}</p>`).join("")}
      <ul class="group-list">${group.items.map((item) => itemHtml(item, { showDay: true })).join("")}</ul>
    </section>`;
  }).join("");
}

function render() {
  const body = $("#memo-body");
  const total = state.items.length;
  const hasToday = state.items.some((item) => item.dayKey === todayIso());
  if (state.view === "today" && !hasToday) state.view = "date";
  $("#today-tab").hidden = !hasToday;
  $("#tripbar").hidden = !total;
  $("#trip-edit").textContent = tripSummary();
  $("#arrange").hidden = !state.items.some((item) => !item.dayKey);
  $("#undo-bar").hidden = !state.undo;
  if (state.undo) $("#undo-text").textContent = `已按建议排好 ${state.undo.count} 处。`;
  body.classList.toggle("is-today-view", state.view === "today");
  if (!total) {
    body.innerHTML = `<div class="empty"><strong>备忘还是空的</strong>写下第一个想去的地方，它会出现在这里。还没有想法的话，可以先去<a href="classic.html">参考路线</a>里挑几个地方带回来。${window.TABI_MEMO_EXAMPLE ? '<p><button class="linkish" type="button" id="load-example">看一个整理好的例子</button></p>' : ""}</div>`;
    $("#memo-summary").textContent = "";
  } else {
    body.innerHTML = state.view === "area" ? renderByArea() : state.view === "today" ? renderByDate(todayIso()) : renderByDate();
    const located = state.items.filter((item) => item.status === "located").length;
    const loose = state.items.filter((item) => !item.dayKey).length;
    $("#memo-summary").textContent = `共 ${total} 处，${located} 处已查到位置${loose ? `，${loose} 处还没排日期` : ""}`;
  }
  document.querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === state.view)));
  $("#copy-text").hidden = !total && !state.notes.length;
  $("#clear-all").hidden = !total && !state.notes.length;
  $("#notes-box").hidden = !state.notes.length;
  $("#notes-list").innerHTML = state.notes.map((note) => `<li><span>${escapeHtml(note.text)}</span><button class="linkish" type="button" data-remove-note="${note.id}">删除</button></li>`).join("");
}

function update() { persist(); render(); }

// ---------- 整理与核实 ----------
function addCollected(collected) {
  const added = [];
  let duplicates = 0;
  for (const raw of collected.items || []) {
    if (state.items.some((item) => foldName(item.name) === foldName(raw.name) && (item.dayKey || "") === (raw.dayKey || ""))) { duplicates += 1; continue; }
    const item = { id: newId(), name: raw.name, note: raw.note || "", dayKey: raw.dayKey || "", slot: SLOT_LABELS[raw.slot] !== undefined ? raw.slot : "any", kind: KIND_LABELS[raw.kind] !== undefined ? raw.kind : "other", cityHint: raw.cityHint || "", queryJa: raw.queryJa || "", status: "pending", done: false, createdAt: Date.now() };
    state.items.push(item);
    added.push(item);
  }
  for (const text of collected.notes || []) {
    if (!state.notes.some((note) => note.text === text)) state.notes.push({ id: newId(), text });
  }
  return { added, duplicates };
}

async function postJson(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let data = null;
  try { data = await response.json(); } catch { /* 静态托管没有接口时会拿到网页而不是 JSON */ }
  if (!response.ok || !data) { const error = new Error(data?.error || "服务暂时不可用"); error.code = data?.code || `HTTP_${response.status}`; throw error; }
  return data;
}

async function locate(ids) {
  const targets = state.items.filter((item) => ids.includes(item.id));
  if (!targets.length) return;
  for (const item of targets) item.status = "pending";
  update();
  const batches = [];
  for (let index = 0; index < targets.length; index += LOCATE_BATCH) batches.push(targets.slice(index, index + LOCATE_BATCH));
  await Promise.all(batches.map(async (batch) => {
    try {
      const data = await postJson("/api/locate", { items: batch.map((item) => ({ id: item.id, name: item.name, note: item.note, kind: item.kind, cityHint: item.cityHint, queryJa: item.queryJa })) });
      for (const result of data.results || []) {
        const item = state.items.find((entry) => entry.id === result.id);
        if (!item) continue;
        Object.assign(item, { status: result.status, localName: result.localName || "", prefecture: result.prefecture || "", city: result.city || "", area: result.area || "", region: result.region || "", summary: result.summary || "", chain: result.chain === true, sources: result.sources || [], verificationStatus: result.verificationStatus || "verify" });
        if (result.kind && KIND_LABELS[result.kind] !== undefined && result.kind !== "other") item.kind = result.kind;
      }
      for (const item of batch) if (item.status === "pending") item.status = "unverified";
    } catch (error) {
      for (const item of batch) if (item.status === "pending") item.status = "failed";
      if (error.code === "SEARCH_BUDGET") locate.budgetMessage = error.message;
    }
    update();
  }));
}

async function collect(event) {
  event.preventDefault();
  const input = $("#memo-input");
  const text = input.value.trim();
  if (!text) { setStatus("先写下想去的地方。", true); input.focus(); return; }
  const button = $("#collect");
  button.disabled = true;
  button.textContent = "正在整理";
  setStatus("正在把这段文字拆成一条条备忘。");
  let collected;
  let online = true;
  try {
    collected = await postJson("/api/collect", { text, today: todayIso() });
  } catch (error) {
    if (error.code === "NO_ITEMS") { setStatus(error.message, true); button.disabled = false; button.textContent = "整理进备忘"; return; }
    // 接口不可用时退回本地规则：能拆分、能认日期，但查不了位置。
    online = false;
    collected = memoLocalParse(text, todayIso());
  }
  const { added, duplicates } = addCollected(collected);
  if (!online) for (const item of added) item.status = "offline";
  button.disabled = false;
  button.textContent = "整理进备忘";
  if (!added.length && !(collected.notes || []).length) {
    setStatus(duplicates ? "这些地方已经在备忘里了。" : "没有认出地点，可以一行写一个试试。", !duplicates);
    update();
    return;
  }
  input.value = "";
  updateCount();
  const extra = [duplicates ? `${duplicates} 处已经在备忘里` : "", collected.truncated ? "一次最多整理 12 处，剩下的请再贴一次" : ""].filter(Boolean).join("；");
  setStatus(online ? `记下了 ${added.length} 处，正在查它们各在哪里。${extra}` : `AI 暂时用不了，先按行记下了 ${added.length} 处；位置等能联网时再查。${extra}`);
  update();
  if (online && added.length) {
    await locate(added.map((item) => item.id));
    const located = added.filter((item) => item.status === "located").length;
    setStatus(locate.budgetMessage ? `记下了 ${added.length} 处。${locate.budgetMessage}` : `记下了 ${added.length} 处，其中 ${located} 处查到了位置。${extra}`);
    locate.budgetMessage = "";
  }
}

// 载入内置示例：让第一次打开的人不用输入、也不用联网就能看到整理后的样子。
function loadExample() {
  const example = window.TABI_MEMO_EXAMPLE;
  if (!example) return;
  const today = memoParseIso(todayIso());
  state.items = example.items.map((raw) => ({ ...raw, id: newId(), dayKey: Number.isInteger(raw.dayOffset) ? memoIso(new Date(today.getTime() + raw.dayOffset * 86400000)) : "", queryJa: "", done: false, createdAt: Date.now() }));
  state.notes = example.notes.map((text) => ({ id: newId(), text }));
  update();
  setStatus("这是一份示例备忘，可以随便改；想从头开始就点“清空”。");
}

// ---------- 修改、依据、复制 ----------
function openEdit(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  state.editingId = id;
  $("#edit-name").value = item.name;
  $("#edit-note").value = item.note || "";
  $("#edit-city").value = item.cityHint || "";
  $("#edit-date").value = memoParseIso(item.dayKey) ? item.dayKey : "";
  $("#edit-slot").value = item.slot || "any";
  const trip = /^day-(\d+)$/.exec(item.dayKey || "");
  $("#edit-day-hint").textContent = trip ? `现在排在第 ${trip[1]} 天。选一个日期会改成具体的那一天。` : "";
  $("#edit-dialog").showModal();
}

function saveEdit(event) {
  event.preventDefault();
  const item = state.items.find((entry) => entry.id === state.editingId);
  if (!item) return $("#edit-dialog").close();
  const name = $("#edit-name").value.trim();
  if (!name) return;
  const city = $("#edit-city").value.trim();
  // 改了名称或补了城市，都需要重新查一次位置。
  const renamed = foldName(name) !== foldName(item.name) || city !== (item.cityHint || "");
  item.name = name;
  item.cityHint = city;
  item.note = $("#edit-note").value.trim();
  const date = $("#edit-date").value;
  if (date) item.dayKey = date;
  else if (memoParseIso(item.dayKey)) item.dayKey = "";
  item.slot = $("#edit-slot").value;
  $("#edit-dialog").close();
  if (renamed) { Object.assign(item, { queryJa: "", localName: "", prefecture: "", city: "", area: "", region: "", sources: [] }); locate([item.id]); }
  else update();
  showToast("已保存");
}

function openSource(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const trust = item.verificationStatus === "official" ? "有官方资料" : item.verificationStatus === "multi_source" ? "有评价平台或多个来源" : "只有一个来源，出发前再确认一下";
  $("#source-title").textContent = item.localName || item.name;
  $("#source-content").innerHTML = `${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}<p>${escapeHtml(placeText(item) || "位置未确认")}</p><p class="field-hint">${trust}。营业时间、是否要预约请以店家最新信息为准。</p><ul>${(item.sources || []).map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a></li>`).join("")}</ul>`;
  $("#source-dialog").showModal();
}

function memoAsText() {
  const lines = ["日本旅行备忘"];
  const groups = new Map();
  for (const item of state.items) { if (!groups.has(item.dayKey || "")) groups.set(item.dayKey || "", []); groups.get(item.dayKey || "").push(item); }
  for (const [dayKey, items] of [...groups.entries()].sort((a, b) => daySortValue(a[0]).localeCompare(daySortValue(b[0])))) {
    const label = dayLabel(dayKey);
    lines.push("", label.spoken || label.text);
    for (const item of items.sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot])) {
      const where = placeText(item);
      lines.push(`${item.done ? "✓" : "□"} ${SLOT_LABELS[item.slot] ? `${SLOT_LABELS[item.slot]} ` : ""}${item.name}${where ? `（${where}）` : ""}${item.note ? ` ${item.note}` : ""}`);
    }
  }
  if (state.notes.length) lines.push("", "其他备忘", ...state.notes.map((note) => `· ${note.text}`));
  return lines.join("\n");
}

async function copyText() {
  const text = memoAsText();
  try { await navigator.clipboard.writeText(text); showToast("已复制"); }
  catch { $("#copy-area").value = text; $("#copy-dialog").showModal(); $("#copy-area").select(); }
}

function updateCount() {
  const length = $("#memo-input").value.length;
  $("#char-count").textContent = length > 900 ? `${length}/1200` : "";
}

// ---------- 事件 ----------
$("#compose-form").addEventListener("submit", collect);
$("#memo-input").addEventListener("input", updateCount);
$("#fill-sample").addEventListener("click", () => { $("#memo-input").value = SAMPLE; updateCount(); $("#memo-input").focus(); });
$("#copy-text").addEventListener("click", copyText);
$("#clear-all").addEventListener("click", () => $("#clear-dialog").showModal());
$("#clear-confirm").addEventListener("click", () => { state.items = []; state.notes = []; state.undo = null; $("#clear-dialog").close(); update(); setStatus(""); showToast("已清空"); });
$("#trip-edit").addEventListener("click", openTrip);
$("#trip-form").addEventListener("submit", saveTrip);
$("#arrange").addEventListener("click", arrange);
$("#arrange-confirm").addEventListener("click", applyArrangement);
$("#undo").addEventListener("click", undoArrangement);
$("#edit-form").addEventListener("submit", saveEdit);
$("#edit-clear-date").addEventListener("click", () => {
  const item = state.items.find((entry) => entry.id === state.editingId);
  if (item) { item.dayKey = ""; update(); showToast("已取消日期"); }
  $("#edit-dialog").close();
});
$("#edit-delete").addEventListener("click", () => {
  state.items = state.items.filter((entry) => entry.id !== state.editingId);
  $("#edit-dialog").close();
  update();
  showToast("已删除");
});
document.addEventListener("click", (event) => {
  const target = event.target.closest("#load-example,[data-view],[data-edit],[data-source],[data-relocate],[data-remove-note],[data-suggest],[data-close]");
  if (!target) return;
  if (target.id === "load-example") loadExample();
  else if (target.dataset.suggest) moveItem(target.dataset.suggest, target.dataset.target);
  else if (target.dataset.view) { state.view = target.dataset.view; update(); }
  else if (target.dataset.edit) openEdit(target.dataset.edit);
  else if (target.dataset.source) openSource(target.dataset.source);
  else if (target.dataset.relocate) locate([target.dataset.relocate]);
  else if (target.dataset.removeNote) { state.notes = state.notes.filter((note) => note.id !== target.dataset.removeNote); update(); }
  else if (target.hasAttribute("data-close")) target.closest("dialog").close();
});
document.addEventListener("change", (event) => {
  const moveId = event.target.dataset?.move;
  if (moveId) {
    const value = event.target.value;
    event.target.value = "";
    if (value === "__pick") openNewDay(moveId);
    else if (value === "__none") moveItem(moveId, "");
    else if (value) moveItem(moveId, value);
    return;
  }
  const id = event.target.dataset?.done;
  if (!id) return;
  const item = state.items.find((entry) => entry.id === id);
  if (item) { item.done = event.target.checked; update(); }
});
document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));

$("#day-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const date = $("#day-input").value;
  if (!date || !pendingNewDayId) return;
  $("#day-dialog").close();
  moveItem(pendingNewDayId, date);
  pendingNewDayId = null;
});

// 打开或回到首页时：读出备忘，并接着查从参考路线页带过来的条目。
function boot() {
  restore();
  render();
  const queued = state.items.filter((item) => item.status === "queued").map((item) => item.id);
  if (queued.length) { setStatus(`从参考路线带来了 ${queued.length} 处，正在查它们各在哪里。`); locate(queued).then(() => setStatus(`从参考路线带来的 ${queued.length} 处已经整理好。`)); }
}
bindDrag();
boot();
window.addEventListener("pageshow", (event) => { if (event.persisted) boot(); });
