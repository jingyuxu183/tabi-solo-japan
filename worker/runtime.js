const BASES = new Set(["tokyo", "osaka"]);
const PACES = new Set(["easy", "explore"]);
const INTERESTS = new Set(Object.keys(CATALOG.interests));
const TIME_SLOTS = new Set(["morning", "afternoon", "evening", "any"]);
const DISCOVERY_RATE = new Map();
const JAPAN_REGIONS = new Set(["北海道", "东北", "关东", "中部", "关西", "中国地方", "四国", "九州", "冲绳"]);
const DISCOVERY_ROLES = new Set(["current_base", "day_trip", "new_base"]);
const DISCOVERY_TASKS = new Set(["destination_discovery", "place_search"]);
const PLACE_ENTITY_TYPES = new Set(["restaurant", "cafe", "shop", "attraction", "museum", "university", "temple", "other"]);
const PLACE_IDS = Object.fromEntries(Object.entries(CATALOG.bases).map(([base, data]) => [base, new Set(data.places.map((place) => place.id))]));
const PLACE_CONTEXT = Object.fromEntries(Object.entries(CATALOG.bases).map(([base, data]) => [base, data.places.map((place) => ({
  id: place.id,
  name: place.name,
  scope: place.scope === "near" ? "周边" : "市内",
  interests: place.tags,
  bestMonths: place.months,
  duration: place.duration,
  travelTime: place.time,
  summary: place.desc,
  highlights: place.highlights,
  tradeoff: place.trade,
}))]));

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function cleanText(value, max = 160) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function cleanList(value, maxItems = 5, maxLength = 100) {
  return Array.isArray(value) ? value.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems) : [];
}

function normalizeSlot(value) {
  return TIME_SLOTS.has(value) ? value : "any";
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch { return ""; }
}

function normalizeName(value) {
  return cleanText(value, 80).toLowerCase().replace(/[\s・·\-—_.,，。()（）]/g, "");
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

function isOfficialSource(urlValue) {
  try {
    const host = new URL(urlValue).hostname.toLowerCase();
    return host.endsWith(".go.jp") || host.endsWith(".lg.jp") || host.endsWith(".or.jp") || ["japan.travel", "www.japan.travel", "www.gotokyo.org", "gotokyo.org", "osaka-info.jp", "www.osaka-info.jp", "kyoto.travel", "www.kyoto.travel", "feel-kobe.jp", "www.feel-kobe.jp", "visitnara.jp", "www.visitnara.jp"].includes(host);
  } catch { return false; }
}

function normalizePlannerDiscovered(value, base) {
  if (!Array.isArray(value)) return [];
  const places = [];
  for (const raw of value.slice(0, 12)) {
    const id = cleanText(raw?.id, 80);
    const name = cleanText(raw?.name, 70);
    const sources = Array.isArray(raw?.sources) ? raw.sources.map((item) => ({ title: cleanText(item?.title, 120), url: safeUrl(item?.url) })).filter((item) => item.title && item.url).slice(0, 3) : [];
    if (!id.startsWith(`discover_${base}_`) || !name || !sources.length) continue;
    places.push({ id, name, scope: raw?.scope === "near" ? "near" : "city", tags: Array.isArray(raw?.tags) ? raw.tags.filter((tag) => INTERESTS.has(tag)).slice(0, 6) : [], months: Array.isArray(raw?.months) ? raw.months.filter((month) => Number.isInteger(month) && month >= 1 && month <= 12).slice(0, 12) : [], desc: cleanText(raw?.desc, 220), trade: cleanText(raw?.trade, 180), time: cleanText(raw?.time, 100), duration: cleanText(raw?.duration, 50), highlights: cleanList(raw?.highlights, 4, 80), sources });
  }
  return places;
}

function validateInput(value, allowedIds) {
  if (!value || typeof value !== "object") return "请求内容无效";
  if (!BASES.has(value.base)) return "出发城市无效";
  if (!Number.isInteger(value.month) || value.month < 0 || value.month > 12) return "月份无效";
  if (!Number.isInteger(value.days) || value.days < 4 || value.days > 8) return "天数无效";
  if (!PACES.has(value.pace)) return "节奏无效";
  if (value.mode !== undefined && value.mode !== "custom" && value.mode !== "classic") return "生成模式无效";
  if (!Array.isArray(value.interests) || value.interests.some((x) => !INTERESTS.has(x))) return "兴趣无效";
  if (!Array.isArray(value.selected) || value.selected.some((x) => !allowedIds.has(x))) return "候选地点无效";
  if (!Array.isArray(value.visited) || value.visited.some((x) => !allowedIds.has(x))) return "去过的地点无效";
  if (typeof value.note !== "string" || value.note.length > 500) return "补充要求过长";
  return null;
}

async function generateTrip(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.DEEPSEEK_API_KEY) return json({ error: "AI 服务尚未配置" }, 503);
  let input;
  try { input = await request.json(); } catch { return json({ error: "请求格式无效" }, 400); }
  const discoveredCandidates = normalizePlannerDiscovered(input.discovered, input.base);
  const allowedIds = new Set([...(PLACE_IDS[input.base] || []), ...discoveredCandidates.map((place) => place.id)]);
  const validationError = validateInput(input, allowedIds);
  if (validationError) return json({ error: validationError }, 400);

  const mode = input.mode === "classic" ? "classic" : "custom";
  const modeInstruction = mode === "classic"
    ? `本次是“一键参考路线”模式。用户不会逐项挑选地点，也不需要填写补充要求。请根据住宿基地、月份、旅行天数、节奏和兴趣，直接生成一条完整、经典、第一次看到就能参考的路线。第 2 天到倒数第 2 天都要有安排；经典地点与用户兴趣要平衡，同一天的停靠点应在地理上便于串联。可以补充最多 4 个候选库外地点。`
    : `本次是“自定义路线”模式。优先满足 selected 和 note 中用户点名的地点、日期、时段与限制；可以补充最多 2 个候选库外地点。`;
  const system = `你是面向中国大陆自由行用户的“日本独旅决策与路线助手”，同时承担三种职责：
1. 需求理解：从自然语言中识别用户明确点名的必去地点、旅行偏好和限制；
2. 目的地发现：以已验证候选库为骨架，必要时补充少量库外地点；
3. 路线编排：说明为什么这样串联，并诚实写出取舍和待确认事项。

规则：
- 用户明确写出的“第几天、上午、下午、晚上”是硬约束，优先级最高，必须原样保留。绝不能把用户指定在同一天的多个地点拆到不同天。
- 一天可以包含 1 至 4 个 stops。用户没有指定时，仍以每天一个主要区域为原则；用户明确指定多个地点在同一天时，按其时间顺序编排，并在必要时提醒行程偏紧，但不要擅自改天。
- 用户点名的地点必须收录到 places，source_type 写 user_requested。若用户指定了日期或时段，同时填写 requested_day 与 requested_slot；没有指定则填 null 和 any。
- candidates 是经过编辑整理的已验证候选。安排这些地点时，days[].stops[].place_ref 直接使用候选 ID，不要把它们重复写进 places。
- 库外地点的 source_type 写 ai_suggested；只在它们能明显改善路线或回应用户兴趣时添加，不要为了显得丰富而硬加。
- 你没有联网能力。对库外地点不得编造精确票价、班次、开放时间、活动日期、花期或所需分钟数；verification_note 必须提示需要出发前联网核实的具体信息。
- 首日固定抵达，最后一天固定返程；days 只安排第 2 天到倒数第 2 天。轻松节奏最多一个周边日，探索节奏最多两个周边日。
- 避免 visited，除非同时在 selected；优先保留 selected。
- 名称应具体且可识别。例如用户说“东京大学”，写“东京大学・本乡校区”，不要只写“大学”。
- 用简洁自然的中文，推荐必须有理由，也要提示取舍。

${modeInstruction}

只输出以下 JSON，不要使用 Markdown：
{
  "overview":"这条路线的主线与取舍",
  "interpreted":{"must_include":["用户点名地点"],"preferences":["偏好"],"constraints":["限制"]},
  "places":[{"ref":"custom_1","name":"库外地点名","area":"所在街区或城市","scope":"city 或 near","source_type":"user_requested 或 ai_suggested","requested_day":3,"requested_slot":"morning 或 afternoon 或 evening 或 any","reason":"为什么加入","verification_note":"需要核实什么"}],
  "days":[{"day":2,"theme":"当天路线主题","stops":[{"place_ref":"候选ID或custom_1","time_slot":"morning 或 afternoon 或 evening 或 any","reason":"安排理由"}]}],
  "alternatives":[{"name":"备选地点","reason":"适合何种取舍"}],
  "cautions":["提醒"]
}`;
  const user = JSON.stringify({
    base: input.base === "tokyo" ? "东京" : "大阪",
    month: input.month || "未确定",
    days: input.days,
    pace: input.pace === "easy" ? "轻松" : "探索周边",
    interests: input.interests,
    selected: input.selected,
    visited: input.visited,
    note: input.note.trim() || "无",
    mode,
    candidates: [...PLACE_CONTEXT[input.base], ...discoveredCandidates.map((place) => ({ id: place.id, name: place.name, scope: place.scope === "near" ? "周边" : "市内", interests: place.tags, bestMonths: place.months, duration: place.duration, travelTime: place.time, summary: place.desc, highlights: place.highlights, tradeoff: place.trade, evidence: place.sources }))],
  });

  let response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-flash",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 2000,
        temperature: 0.35,
      }),
    });
  } catch { return json({ error: "暂时无法连接 AI 服务" }, 502); }
  if (!response.ok) {
    const detail = await response.text();
    console.error("DeepSeek API error", response.status, detail.slice(0, 300));
    return json({ error: "AI 服务暂时不可用", code: response.status }, 502);
  }

  try {
    const result = await response.json();
    const parsed = JSON.parse(result.choices?.[0]?.message?.content || "{}");
    const allowed = allowedIds;
    const customPlaces = [];
    const refMap = new Map();
    let aiSuggestedCount = 0;
    const aiSuggestedLimit = mode === "classic" ? 4 : 2;
    if (Array.isArray(parsed.places)) {
      for (const raw of parsed.places.slice(0, 8)) {
        const name = cleanText(raw?.name, 70);
        const sourceType = raw?.source_type === "user_requested" ? "user_requested" : "ai_suggested";
        if (!name || (sourceType === "ai_suggested" && aiSuggestedCount >= aiSuggestedLimit) || customPlaces.length >= 8) continue;
        if (sourceType === "ai_suggested") aiSuggestedCount += 1;
        const id = `custom_${customPlaces.length + 1}`;
        const originalRef = cleanText(raw?.ref, 40);
        if (originalRef) refMap.set(originalRef, id);
        refMap.set(name, id);
        customPlaces.push({
          id,
          name,
          area: cleanText(raw?.area, 70) || "具体区域待确认",
          scope: raw?.scope === "near" ? "near" : "city",
          sourceType,
          requestedDay: Number.isInteger(Number(raw?.requested_day)) && Number(raw.requested_day) >= 2 && Number(raw.requested_day) <= input.days - 1 ? Number(raw.requested_day) : null,
          requestedSlot: normalizeSlot(raw?.requested_slot),
          reason: cleanText(raw?.reason, 180),
          verificationNote: cleanText(raw?.verification_note, 180) || "这是库外地点，请在出发前联网核实开放、交通与预约信息。",
        });
      }
    }
    const used = new Set();
    const dayMap = new Map();
    if (Array.isArray(parsed.days)) {
      for (const rawDay of parsed.days.slice(0, input.days - 2)) {
        const day = rawDay?.day;
        if (!Number.isInteger(day) || day < 2 || day > input.days - 1) continue;
        const entry = dayMap.get(day) || { day, theme: cleanText(rawDay?.theme, 80), stops: [] };
        const rawStops = Array.isArray(rawDay?.stops) ? rawDay.stops : [rawDay];
        for (const rawStop of rawStops.slice(0, 4)) {
          const rawRef = cleanText(rawStop?.place_ref ?? rawStop?.id, 70);
          const id = allowed.has(rawRef) ? rawRef : refMap.get(rawRef);
          if (!id || used.has(id) || entry.stops.length >= 4) continue;
          entry.stops.push({ id, slot: normalizeSlot(rawStop?.time_slot), reason: cleanText(rawStop?.reason, 160) });
          used.add(id);
        }
        if (entry.stops.length) dayMap.set(day, entry);
      }
    }
    const customById = new Map(customPlaces.map((place) => [place.id, place]));
    const requestedPlaces = customPlaces.filter((place) => place.sourceType === "user_requested");
    for (const place of requestedPlaces) {
      if (place.requestedDay) {
        for (const entry of dayMap.values()) entry.stops = entry.stops.filter((stop) => stop.id !== place.id);
        used.delete(place.id);
      }
      if (used.has(place.id)) continue;
      const possibleDays = Array.from({ length: input.days - 2 }, (_, index) => index + 2);
      const targetDay = place.requestedDay || possibleDays.sort((a, b) => (dayMap.get(a)?.stops.length || 0) - (dayMap.get(b)?.stops.length || 0))[0];
      const entry = dayMap.get(targetDay) || { day: targetDay, theme: "按你的指定安排", stops: [] };
      if (entry.stops.length >= 4) {
        const replaceIndex = entry.stops.findIndex((stop) => customById.get(stop.id)?.sourceType === "ai_suggested");
        if (replaceIndex >= 0) {
          used.delete(entry.stops[replaceIndex].id);
          entry.stops.splice(replaceIndex, 1);
        }
      }
      if (entry.stops.length < 4) {
        entry.stops.push({ id: place.id, slot: place.requestedSlot, reason: place.reason || "优先安排你明确点名的地点。" });
        used.add(place.id);
        dayMap.set(targetDay, entry);
      }
    }
    const slotOrder = { morning: 0, afternoon: 1, evening: 2, any: 3 };
    const days = [...dayMap.values()].filter((entry) => entry.stops.length).sort((a, b) => a.day - b.day).map((entry) => ({
      ...entry,
      stops: entry.stops.sort((a, b) => slotOrder[a.slot] - slotOrder[b.slot]),
    }));
    if (!days.length) throw new Error("empty plan");
    const usedCustom = new Set(days.flatMap((item) => item.stops.map((stop) => stop.id)).filter((id) => id?.startsWith("custom_")));
    const places = customPlaces.filter((place) => usedCustom.has(place.id) || place.sourceType === "user_requested");
    const interpreted = parsed.interpreted && typeof parsed.interpreted === "object" ? parsed.interpreted : {};
    const alternatives = Array.isArray(parsed.alternatives) ? parsed.alternatives.map((item) => ({
      name: cleanText(typeof item === "string" ? item : item?.name, 70),
      reason: cleanText(typeof item === "string" ? "" : item?.reason, 120),
    })).filter((item) => item.name).slice(0, 3) : [];
    return json({
      overview: cleanText(parsed.overview, 220) || "已按你的偏好生成路线",
      interpreted: {
        mustInclude: cleanList(interpreted.must_include, 5, 70),
        preferences: cleanList(interpreted.preferences, 5, 80),
        constraints: cleanList(interpreted.constraints, 5, 80),
      },
      places,
      days,
      alternatives,
      cautions: cleanList(parsed.cautions, 4, 180),
      usage: result.usage ? { input: result.usage.prompt_tokens, output: result.usage.completion_tokens } : null,
      model: "deepseek-flash",
      mode,
    });
  } catch (error) {
    console.error("Invalid model response", error);
    return json({ error: "AI 返回的路线无法读取" }, 502);
  }
}

function validateDiscovery