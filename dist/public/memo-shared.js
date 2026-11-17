// 备忘整理的共用逻辑：浏览器页面与 Worker 都会用到。
// 构建时会分别拼接进两边，所以这里只写普通函数，不使用 import / export。

function memoPad(value) { return String(value).padStart(2, "0"); }

function memoIso(date) { return `${date.getUTCFullYear()}-${memoPad(date.getUTCMonth() + 1)}-${memoPad(date.getUTCDate())}`; }

function memoParseIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null;
}

function memoMakeDate(year, month, day) {
  return memoParseIso(`${year}-${memoPad(month)}-${memoPad(day)}`);
}

const MEMO_CN_DIGITS = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const MEMO_WEEKDAYS = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

// 把“11/20”“11月20日”“20号”“周六”“下周三”“明天”“第2天”解析成 dayKey。
// 返回 { dayKey, matched }：dayKey 是 ISO 日期、"day-2" 这样的行程第几天，或空字符串；matched 是命中的原文片段。
function memoResolveDay(text, todayIso) {
  const source = String(text || "");
  const today = memoParseIso(todayIso) || memoParseIso(memoIso(new Date()));
  const result = (dayKey, matched) => ({ dayKey, matched });
  let match = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/.exec(source);
  if (match) {
    const date = memoMakeDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date) return result(memoIso(date), match[0]);
  }
  match = /第\s*(\d{1,2}|[一二两三四五六七八九十])\s*天/.exec(source) || /\b(?:day|d)\s*(\d{1,2})\b/i.exec(source);
  if (match) {
    const index = MEMO_CN_DIGITS[match[1]] || Number(match[1]);
    if (index >= 1 && index <= 30) return result(`day-${index}`, match[0]);
  }
  match = /(?<![\d.])(\d{1,2})\s*(?:[/.]|月)\s*(\d{1,2})\s*[日号]?(?![\d.:：])/.exec(source);
  if (match) {
    let date = memoMakeDate(today.getUTCFullYear(), Number(match[1]), Number(match[2]));
    // 写的是已经过去一个多月的日期时，按明年理解。
    if (date && date.getTime() < today.getTime() - 45 * 86400000) date = memoMakeDate(today.getUTCFullYear() + 1, Number(match[1]), Number(match[2]));
    if (date) return result(memoIso(date), match[0]);
  }
  match = /(?<![\d.])(\d{1,2})\s*[日号](?!元)/.exec(source);
  if (match) {
    let date = memoMakeDate(today.getUTCFullYear(), today.getUTCMonth() + 1, Number(match[1]));
    if (date && date.getTime() < today.getTime()) {
      const next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
      date = memoMakeDate(next.getUTCFullYear(), next.getUTCMonth() + 1, Number(match[1]));
    }
    if (date) return result(memoIso(date), match[0]);
  }
  match = /(下+)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/.exec(source);
  if (match) {
    const target = MEMO_WEEKDAYS[match[2]];
    const current = today.getUTCDay();
    let offset;
    if (match[1]) {
      // “下周三”：下一个自然周（周一开始）里的周三。
      const toNextMonday = ((8 - current) % 7) || 7;
      offset = toNextMonday + ((target + 6) % 7) + 7 * (match[1].length - 1);
    } else {
      offset = (target - current + 7) % 7;
    }
    return result(memoIso(new Date(today.getTime() + offset * 86400000)), match[0]);
  }
  match = /(今天|明天|后天|大后天)/.exec(source);
  if (match) {
    const offset = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }[match[1]];
    return result(memoIso(new Date(today.getTime() + offset * 86400000)), match[0]);
  }
  return result("", "");
}

function memoResolveSlot(text) {
  const source = String(text || "");
  const rules = [["morning", /(?:早上|上午|早晨|清晨|早起|一早)/], ["afternoon", /(?:下午|中午|午后)/], ["evening", /(?:晚上|傍晚|夜里|夜晚|深夜)/]];
  for (const [slot, pattern] of rules) {
    const match = pattern.exec(source);
    if (match) return { slot, matched: match[0] };
  }
  return { slot: "any", matched: "" };
}

const MEMO_KIND_WORDS = /^(?:咖啡|咖啡店|咖啡馆|拉面|寿司|烧肉|烧鸟|居酒屋|健身房|书店|神社|寺|公园|美术馆|博物馆|酒吧|温泉|古着|古着店|甜品|面包店|食堂|本店)$/;

// AI 不可用时的本地拆分：一行一条，认日期、时段和“名称 + 一句特点”。
function memoLocalParse(text, todayIso) {
  const items = [];
  const notes = [];
  let contextDay = "";
  let contextCity = "";
  for (const rawLine of String(text || "").split(/[\n；;]+/)) {
    let line = rawLine.replace(/^[\s\-•·*＊]+/, "").replace(/^\(?[0-9①-⑩]{1,2}[.、)）]\s*/, "").trim();
    if (!line) continue;
    const day = memoResolveDay(line, todayIso);
    if (day.matched) line = line.replace(day.matched, " ").trim();
    const slot = memoResolveSlot(line);
    // 时段写在开头才当作安排去掉；写在特点里（“晚上去人少”）保留原话。
    if (slot.matched && line.replace(/^[\s，,：:、]+/, "").startsWith(slot.matched)) line = line.replace(slot.matched, " ").trim();
    line = line.replace(/^[\s，,：:、]+|[\s，,、]+$/g, "");
    if (!line) { if (day.dayKey) contextDay = day.dayKey; continue; }
    const heading = /^(.{1,12})[：:]$/.exec(line);
    if (heading) { contextCity = heading[1].trim(); if (day.dayKey) contextDay = day.dayKey; continue; }
    if (/^(?:记得|别忘|要买|买|换|带|订|预约|提醒)/.test(line) && !/(?:店|馆|寺|神社|公园)$/.test(line)) { notes.push(rawLine.trim()); continue; }
    let name = line;
    let note = "";
    const split = /^(.+?)(?:[，,：:]|\s{2,}|\s[-—]\s)(.+)$/.exec(line);
    if (split) { name = split[1].trim(); note = split[2].trim(); }
    else {
      const tokens = line.split(/\s+/);
      let take = 1;
      while (take < tokens.length && ((/^[\x21-\x7e]+$/.test(tokens[take - 1]) && /^[\x21-\x7e]+$/.test(tokens[take])) || MEMO_KIND_WORDS.test(tokens[take]))) take += 1;
      name = tokens.slice(0, take).join(" ");
      note = tokens.slice(take).join(" ");
    }
    for (const part of name.split(/[、]/).map((value) => value.trim()).filter(Boolean)) {
      items.push({ name: part.slice(0, 60), note: note.slice(0, 80), dayKey: day.dayKey || contextDay, slot: slot.slot, kind: "other", cityHint: contextCity, queryJa: "" });
    }
  }
  return { items: items.slice(0, 30), notes: notes.slice(0, 12) };
}

// ===================== 行程与编排（阶段 2）=====================
// trip: { start: "YYYY-MM-DD" | "", days: 1..14, arrive / leave: "morning" | "afternoon" | "evening", perDay: 3..6 }

function memoNormalizeTrip(raw) {
  const days = Number(raw?.days);
  const perDay = Number(raw?.perDay);
  const slot = (value, fallback) => (["morning", "afternoon", "evening"].includes(value) ? value : fallback);
  return {
    start: memoParseIso(raw?.start) ? raw.start : "",
    days: Number.isInteger(days) && days >= 1 && days <= 14 ? days : 0,
    arrive: slot(raw?.arrive, "afternoon"),
    leave: slot(raw?.leave, "morning"),
    perDay: Number.isInteger(perDay) && perDay >= 2 && perDay <= 6 ? perDay : 4,
  };
}

// 行程里的每一天：key 是具体日期（设了出发日期）或 "day-N"；capacity 是这天最多排几处。
// 到达日和离开日按时段打折：下午到只剩半天，晚上到只够吃顿饭；上午走就不排了。
function memoTripDays(rawTrip) {
  const trip = memoNormalizeTrip(rawTrip);
  const start = memoParseIso(trip.start);
  const half = Math.ceil(trip.perDay / 2);
  const list = [];
  for (let index = 1; index <= trip.days; index += 1) {
    let capacity = trip.perDay;
    if (index === 1) capacity = Math.min(capacity, { morning: trip.perDay, afternoon: half, evening: 1 }[trip.arrive]);
    if (index === trip.days) capacity = Math.min(capacity, { morning: 0, afternoon: half, evening: trip.perDay }[trip.leave]);
    list.push({ key: start ? memoIso(new Date(start.getTime() + (index - 1) * 86400000)) : `day-${index}`, index, capacity });
  }
  return list;
}

// 设了出发日期后，把“第 N 天”换成具体日期。
function memoAlignDayKey(rawTrip, dayKey) {
  const match = /^day-(\d+)$/.exec(dayKey || "");
  const start = memoParseIso(rawTrip?.start);
  if (!match || !start) return dayKey || "";
  return memoIso(new Date(start.getTime() + (Number(match[1]) - 1) * 86400000));
}

function memoCityKey(item) { return `${item.prefecture || ""}|${item.city || item.area || ""}`; }
const MEMO_SLOT_RANK = { morning: 0, afternoon: 1, any: 2, evening: 3 };

function memoJoin(names) {
  return names.length <= 2 ? names.join("和") : `${names.slice(0, -1).join("、")}和${names[names.length - 1]}`;
}

// 一天的排列理由：只说位置关系。
function memoDayReason(dayItems) {
  const located = dayItems.filter((item) => item.status === "located");
  if (!located.length) return "";
  const prefectures = [...new Set(located.map((item) => item.prefecture))];
  const cities = [...new Set(located.map((item) => item.city || item.area).filter(Boolean))];
  if (prefectures.length > 1) return `这一天跨了${memoJoin(prefectures)}，路上会花些时间。`;
  if (cities.length <= 1) return located.length > 1 ? `这 ${located.length} 处都在${cities[0] || prefectures[0]}。` : `在${cities[0] || prefectures[0]}。`;
  return `都在${prefectures[0]}：${memoJoin(cities)}。`;
}

// 同一天里的先后：先按时段，再把同一个市/区、同一个街区的挨在一起。
function memoOrderDay(dayItems) {
  return [...dayItems].sort((a, b) => (MEMO_SLOT_RANK[a.slot] ?? 2) - (MEMO_SLOT_RANK[b.slot] ?? 2)
    || memoCityKey(a).localeCompare(memoCityKey(b), "zh")
    || String(a.area || "").localeCompare(String(b.area || ""), "zh")).map((item) => item.id);
}

// 规则编排：不联网也能用，也是模型建议的质量底线。
// 只动“还没排日期、且已查到位置”的条目；已经排了日期的一律不动。
function memoArrangeRules(items, days) {
  const dayKeys = new Set(days.map((day) => day.key));
  const fixed = items.filter((item) => item.dayKey && dayKeys.has(item.dayKey));
  const loose = items.filter((item) => !item.dayKey);
  const movable = loose.filter((item) => item.status === "located" && item.prefecture);
  const left = loose.filter((item) => !(item.status === "located" && item.prefecture)).map((item) => ({ id: item.id, reason: "还不知道它在哪，先留在“还没排日期”。" }));
  const state = new Map(days.map((day) => [day.key, { ...day, items: fixed.filter((item) => item.dayKey === day.key), home: "" }]));
  for (const day of state.values()) {
    const located = day.items.filter((item) => item.status === "located" && item.prefecture);
    if (located.length) day.home = located[0].prefecture;
  }
  // 先给还空着的天分配“主场县”：地点多的县分到的天数多，每个县至少一天（天数够的话）。
  const byPrefecture = new Map();
  for (const item of movable) byPrefecture.set(item.prefecture, (byPrefecture.get(item.prefecture) || 0) + 1);
  const emptyDays = [...state.values()].filter((day) => !day.home && day.capacity > 0);
  const wants = [...byPrefecture.entries()].map(([prefecture, count]) => {
    const homeRoom = [...state.values()].filter((day) => day.home === prefecture).reduce((sum, day) => sum + Math.max(0, day.capacity - day.items.length), 0);
    return { prefecture, need: Math.max(0, count - homeRoom) };
  }).filter((entry) => entry.need > 0).sort((a, b) => b.need - a.need);
  let pool = [...emptyDays].sort((a, b) => b.capacity - a.capacity || a.index - b.index);
  for (const want of wants) { if (!pool.length) break; const day = pool.shift(); day.home = want.prefecture; want.need -= day.capacity; }
  while (pool.length && wants.some((want) => want.need > 0)) {
    const want = wants.filter((entry) => entry.need > 0).sort((a, b) => b.need - a.need)[0];
    const day = pool.shift(); day.home = want.prefecture; want.need -= day.capacity;
  }
  // 再按“市/区”成组放进去：优先放到已有同一个市/区的那天，其次是同县的空天。
  const groups = new Map();
  for (const item of movable) groups.set(memoCityKey(item), [...(groups.get(memoCityKey(item)) || []), item]);
  const ordered = [...groups.values()].sort((a, b) => (byPrefecture.get(b[0].prefecture) - byPrefecture.get(a[0].prefecture)) || b.length - a.length);
  const assign = {};
  const maxCapacity = Math.max(0, ...days.map((day) => day.capacity));
  for (const group of ordered) {
    const queue = [...group];
    // 一天装得下的一组不拆到两天：宁可留几处没排，也不让同一个区跑两趟。
    const splittable = group.length > maxCapacity;
    let placedOnce = false;
    while (queue.length) {
      if (placedOnce && !splittable) { for (const item of queue) left.push({ id: item.id, reason: `和它同在${item.city || item.prefecture}的地点那天已经排满，先留在“还没排日期”。` }); break; }
      let best = null;
      for (const day of state.values()) {
        const free = day.capacity - day.items.length;
        if (free <= 0) continue;
        const sameCity = day.items.some((item) => memoCityKey(item) === memoCityKey(queue[0]));
        const otherCities = new Set(day.items.filter((item) => item.status === "located").map(memoCityKey)).size;
        let score = sameCity ? 100 : 0;
        // 已经有别的县的地点时强烈回避；只是预留给别的县、但还空着的天，必要时可以借用。
        if (day.home === queue[0].prefecture) score += 50; else if (day.home) score -= day.items.length ? 60 : 20;
        if (!sameCity) score -= otherCities * 8;
        // 能整组放下的优先，并且挑刚好放得下的那天，把宽裕的日子留给更大的一组。
        if (free >= queue.length) score += 30 - (free - queue.length); else score += free - (splittable ? 0 : 100);
        score -= day.index * 0.01;
        if (!best || score > best.score) best = { day, score };
      }
      if (!best) { for (const item of queue) left.push({ id: item.id, reason: "行程里的天数排满了，先留在“还没排日期”。" }); break; }
      const take = Math.min(best.day.capacity - best.day.items.length, queue.length);
      for (const item of queue.splice(0, take)) { best.day.items.push(item); assign[item.id] = best.day.key; if (!best.day.home) best.day.home = item.prefecture; }
      placedOnce = true;
    }
  }
  const order = {};
  const reasons = {};
  for (const day of state.values()) { if (!day.items.length) continue; order[day.key] = memoOrderDay(day.items); reasons[day.key] = memoDayReason(day.items); }
  return { assign, order, reasons, left };
}

// 给一份编排打分，数值越小越好。用来比较模型建议和规则版，也用于评测。
// splitCities：同一个市/区被拆到了比必要更多的天；mixedDays：一天里出现多个县；overCapacity：超出每天上限的数量。
function memoArrangeScore(items, assign, days) {
  const dayKeys = new Set(days.map((day) => day.key));
  const capacity = new Map(days.map((day) => [day.key, day.capacity]));
  const maxCapacity = Math.max(1, ...days.map((day) => day.capacity));
  const perDay = new Map();
  for (const item of items) {
    const key = assign[item.id] || (dayKeys.has(item.dayKey) ? item.dayKey : "");
    if (!key) continue;
    perDay.set(key, [...(perDay.get(key) || []), item]);
  }
  let mixedDays = 0;
  let overCapacity = 0;
  const cityDays = new Map();
  for (const [key, list] of perDay) {
    const located = list.filter((item) => item.status === "located" && item.prefecture);
    if (new Set(located.map((item) => item.prefecture)).size > 1) mixedDays += 1;
    overCapacity += Math.max(0, list.filter((item) => assign[item.id]).length + list.filter((item) => !assign[item.id]).length - Math.max(capacity.get(key), list.filter((item) => !assign[item.id]).length));
    for (const item of located) { const entry = cityDays.get(memoCityKey(item)) || { days: new Set(), count: 0 }; entry.days.add(key); entry.count += 1; cityDays.set(memoCityKey(item), entry); }
  }
  let splitCities = 0;
  for (const entry of cityDays.values()) if (entry.days.size > Math.ceil(entry.count / maxCapacity)) splitCities += 1;
  return { splitCities, mixedDays, overCapacity, placed: Object.keys(assign).length };
}
