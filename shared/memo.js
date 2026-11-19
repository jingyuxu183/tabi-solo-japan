// 备忘整理的共用逻辑：浏览器页面与 Worker 都会用到。
// 构建时会分别拼接进两边，所以这里只写普通函数，不使用 import / export。

// 日文新字体 / 繁体 → 简体。用于比较地名，不用于展示。
const KANJI_PAIRS = "東东宮宫廣广広广島岛嶋岛岡冈長长澤泽沢泽濱滨浜滨沖冲繩绳縄绳鳥鸟愛爱靜静気气氣气徳德児儿兒儿縣县県县區区馬马葉叶賀贺庫库関关關关館馆倉仓鎌镰戸户橋桥須须瀬濑豊丰塩盐軽轻國国會会湯汤溫温門门飛飞諏诹訪访釧钏蘭兰別别見见鶴鹤龍龙竜龙滝泷瀧泷﨑崎髙高櫻樱桜樱楽乐樂乐園园銀银條条蘆芦熱热亀龟龜龟雲云奧奥歳岁勝胜帯带網网渋涩駅站蔦茑場场走走稚稚内内陸陆羽羽後后前前総总武武蔵藏衛卫錦锦糸丝魚鱼塚冢歌歌舞舞伎伎伊伊勢势紀纪淡淡路路姫姬竹竹原原鞆鞆尾尾道道呉吴萩萩備备讃赞岐岐松松阪阪諫谏対对馬马壱壹岐岐与与論论縄绳難难斎斋齋斋嵐岚稲稻閣阁黒黑頓顿環环";
const KANJI_MAP = new Map();
for (let i = 0; i + 1 < KANJI_PAIRS.length; i += 2) if (KANJI_PAIRS[i] !== KANJI_PAIRS[i + 1]) KANJI_MAP.set(KANJI_PAIRS[i], KANJI_PAIRS[i + 1]);

function toSimplified(value) {
  return [...String(value ?? "")].map((char) => KANJI_MAP.get(char) || char).join("");
}

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
  for (const rawLine of memoStripLinks(text).split(/[\n；;]+/)) {
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

// 粘贴的文字里常带小红书或谷歌地图的链接。链接里的内容读不到，也不是地点，先去掉。
function memoStripLinks(text) {
  return String(text || "").replace(/https?:\/\/[^\s，。、；;）)】]+/gi, " ");
}

// ===================== 地理：县的远近、住宿城市、大城市的片区 =====================
// 都是写死的表，不联网、不靠模型。没有坐标，只能判断“同县、相邻、隔一个县”这种粗略的远近。

// 县名统一成不带“都府县”的简体写法：东京、京都、大阪、神奈川、北海道。
function memoPrefKey(value) {
  const text = toSimplified(String(value || "").replace(/\s+/g, ""));
  if (text === "北海道") return text;
  if (/^京都[府市]?$/.test(text)) return "京都";
  return text.length > 2 ? text.replace(/[都府县]$/, "") : text;
}

// 陆地相邻（含常用的跨海大桥与隧道）。北海道与青森之间虽有隧道，但两地相距太远，不算相邻。
const MEMO_PREF_NEIGHBORS = "青森:岩手,秋田;岩手:秋田,宫城;宫城:秋田,山形,福岛;秋田:山形;山形:福岛,新潟;福岛:新潟,群马,栃木,茨城;茨城:栃木,埼玉,千叶;栃木:群马,埼玉;群马:新潟,长野,埼玉;埼玉:长野,山梨,东京,千叶;千叶:东京,神奈川;东京:神奈川,山梨;神奈川:山梨,静冈;新潟:长野,富山;富山:长野,岐阜,石川;石川:岐阜,福井;福井:岐阜,滋贺,京都;山梨:静冈,长野;长野:静冈,爱知,岐阜;岐阜:爱知,三重,滋贺;静冈:爱知;爱知:三重;三重:滋贺,京都,奈良,和歌山;滋贺:京都;京都:奈良,大阪,兵库;大阪:奈良,和歌山,兵库;兵库:冈山,鸟取,德岛;奈良:和歌山;鸟取:冈山,岛根,广岛;岛根:广岛,山口;冈山:广岛,香川;广岛:山口,爱媛;山口:福冈;德岛:香川,爱媛,高知;香川:爱媛;爱媛:高知;福冈:佐贺,熊本,大分;佐贺:长崎;熊本:大分,宫崎,鹿儿岛;大分:宫崎;宫崎:鹿儿岛";
const MEMO_PREF_GRAPH = new Map([["北海道", new Set()], ["冲绳", new Set()]]);
for (const entry of MEMO_PREF_NEIGHBORS.split(";")) {
  const [name, list] = entry.split(":");
  for (const other of list.split(",")) {
    for (const [a, b] of [[name, other], [other, name]]) { if (!MEMO_PREF_GRAPH.has(a)) MEMO_PREF_GRAPH.set(a, new Set()); MEMO_PREF_GRAPH.get(a).add(b); }
  }
}

// 两个县隔了几步：同县 0，相邻 1，隔一个县 2，更远返回 Infinity。
function memoPrefDistance(a, b) {
  const from = memoPrefKey(a);
  const to = memoPrefKey(b);
  if (!MEMO_PREF_GRAPH.has(from) || !MEMO_PREF_GRAPH.has(to)) return Infinity;
  if (from === to) return 0;
  let frontier = [from];
  const seen = new Set(frontier);
  for (let step = 1; step <= 2; step += 1) {
    const next = [];
    for (const name of frontier) for (const other of MEMO_PREF_GRAPH.get(name)) {
      if (other === to) return step;
      if (!seen.has(other)) { seen.add(other); next.push(other); }
    }
    frontier = next;
  }
  return Infinity;
}

// 住宿城市写法 → 所在的县。只收常见的旅游城市和街区；认不出的，编排时不按它分配。
const MEMO_STAY_PLACES = "东京:东京,新宿,涩谷,池袋,上野,浅草,银座,品川,秋叶原,台场,吉祥寺,下北泽,六本木,表参道,原宿,日本桥,押上,中野,羽田;神奈川:横滨,镰仓,箱根,江之岛,藤泽,川崎,小田原;千叶:成田,舞滨;埼玉:川越;栃木:日光,鬼怒川;群马:草津,伊香保;山梨:河口湖,富士河口湖,富士吉田;静冈:热海,伊豆,伊东,修善寺,下田;长野:轻井泽,松本,白马,上高地;岐阜:高山,飞驒高山,白川乡,下吕;爱知:名古屋;石川:金泽;富山:立山;新潟:越后汤泽;京都:宇治,岚山,祇园,天桥立;大阪:难波,梅田,心斋桥,新大阪,天王寺;兵库:神户,姬路,有马,有马温泉,城崎,城崎温泉,淡路岛;和歌山:白滨,高野山;三重:伊势;广岛:宫岛,尾道;冈山:仓敷;岛根:松江,出云;山口:下关;香川:高松,小豆岛,直岛;爱媛:松山,道后;福冈:博多,天神,中洲,北九州,小仓,门司,门司港,太宰府,柳川;佐贺:唐津,嬉野;长崎:佐世保,豪斯登堡;熊本:阿苏,黑川温泉;大分:别府,由布院,汤布院;宫崎:高千穗;鹿儿岛:指宿,屋久岛,雾岛;冲绳:那霸,石垣,石垣岛,宫古岛,恩纳;北海道:札幌,小樽,函馆,旭川,富良野,美瑛,钏路,知床,斜里,网走,带广,登别,洞爷湖,二世古,新千岁;青森:弘前,八户,十和田;岩手:盛冈,平泉;宫城:仙台,松岛;秋田:角馆,田泽湖;山形:银山温泉,藏王;福岛:会津,会津若松";
const MEMO_STAY_MAP = new Map([...MEMO_PREF_GRAPH.keys()].map((name) => [name, name]));
for (const entry of MEMO_STAY_PLACES.split(";")) {
  const [prefecture, list] = entry.split(":");
  for (const place of list.split(",")) MEMO_STAY_MAP.set(place, prefecture);
}

function memoStayPrefecture(value) {
  const text = toSimplified(String(value || "").replace(/\s+/g, ""));
  if (!text) return "";
  for (const candidate of [text, text.replace(/(?:市|区|町|村|站|车站|駅)$/, ""), memoPrefKey(text)]) {
    if (MEMO_STAY_MAP.has(candidate)) return MEMO_STAY_MAP.get(candidate);
  }
  return "";
}

// 大城市只按“市”分组太粗：京都的岚山和伏见稻荷在两个方向。这两个城市再按片区分。
// 片区按街区名或地点名里的关键词认；认不出的仍按整个市算。
const MEMO_CITY_ZONES = {
  京都: "东山:祇园,清水,东山,八坂,二年坂,三年坂,产宁坂,花见小路,河原町,四条,先斗町,锦市场,银阁,哲学之道,南禅寺,平安神宫,冈崎,三条,知恩院,高台寺;西北:岚山,嵯峨,金阁,龙安寺,仁和寺,北野,太秦,西阵;南:伏见,东福寺,京都站,三十三间堂,东寺;北:贵船,鞍马,大原,下鸭,上贺茂,出町柳",
  大阪: "北:梅田,大阪站,中之岛,天满,中崎町,北新地;南:难波,心斋桥,道顿堀,日本桥,黑门,美国村,新世界,天王寺,通天阁,阿倍野,法善寺,千日前;城东:大阪城,森之宫,京桥;湾岸:环球影城,USJ,天保山,海游馆",
};
const MEMO_ZONE_TABLE = Object.fromEntries(Object.entries(MEMO_CITY_ZONES).map(([city, text]) => [city, text.split(";").map((entry) => { const [zone, list] = entry.split(":"); return [zone, list.split(",")]; })]));

function memoCityZone(item) {
  const city = toSimplified(String(item.city || "")).replace(/市$/, "");
  const table = MEMO_ZONE_TABLE[city];
  if (!table) return "";
  for (const text of [item.area, item.name, item.localName]) {
    const value = toSimplified(String(text || ""));
    if (!value) continue;
    for (const [zone, words] of table) if (words.some((word) => value.includes(word))) return zone;
  }
  return "";
}

// ===================== 行程与编排（阶段 2）=====================
// trip: { start: "YYYY-MM-DD" | "", days: 1..14, arrive / leave: "morning" | "afternoon" | "evening", perDay: 3..6, stays: ["东京", "", "京都"] }
// stays 是每晚住的城市，第 i 项是第 i+1 晚；空着表示和前一晚一样。

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
    stays: (Array.isArray(raw?.stays) ? raw.stays : []).slice(0, 13).map((value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 20)),
  };
}

// 每晚实际住哪：空着的沿用前一晚。返回长度为“天数 - 1”的数组。
function memoNights(trip) {
  const nights = [];
  let last = "";
  for (let index = 0; index < Math.max(0, trip.days - 1); index += 1) {
    if (trip.stays[index]) last = trip.stays[index];
    nights.push(last);
  }
  return nights;
}

// 行程里的每一天：key 是具体日期（设了出发日期）或 "day-N"；capacity 是这天最多排几处。
// 到达日和离开日按时段打折：下午到只剩半天，晚上到只够吃顿饭；上午走就不排了。
// stay 是这天落脚的城市：前一晚住的和当晚住的；换城市的那天有两个。
function memoTripDays(rawTrip) {
  const trip = memoNormalizeTrip(rawTrip);
  const start = memoParseIso(trip.start);
  const half = Math.ceil(trip.perDay / 2);
  const nights = memoNights(trip);
  const list = [];
  for (let index = 1; index <= trip.days; index += 1) {
    let capacity = trip.perDay;
    if (index === 1) capacity = Math.min(capacity, { morning: trip.perDay, afternoon: half, evening: 1 }[trip.arrive]);
    if (index === trip.days) capacity = Math.min(capacity, { morning: 0, afternoon: half, evening: trip.perDay }[trip.leave]);
    const stay = [...new Set([nights[index - 2], nights[index - 1]].filter(Boolean))];
    list.push({ key: start ? memoIso(new Date(start.getTime() + (index - 1) * 86400000)) : `day-${index}`, index, capacity, stay });
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

function memoCityKey(item) {
  const zone = memoCityZone(item);
  return `${item.prefecture || ""}|${item.city || item.area || ""}${zone ? `|${zone}` : ""}`;
}

// 这一天住的城市附近（同县、相邻或隔一个县）才排。没写住哪、或写的城市认不出时，不限制。
function memoStayOk(day, item) {
  const prefectures = (day.stay || []).map(memoStayPrefecture).filter(Boolean);
  return !prefectures.length || prefectures.some((prefecture) => memoPrefDistance(prefecture, item.prefecture) <= 2);
}

// 同一天的地点所在的县要相同或相邻：大阪和镰仓不能排在同一天。
function memoNearAll(dayItems, item) {
  return dayItems.every((other) => other.status !== "located" || !other.prefecture || memoPrefDistance(other.prefecture, item.prefecture) <= 1);
}

// 住的城市就是地点所在的城市（“别府”对“别府市”、“新宿”对“新宿区”）。
function memoStayCityMatch(day, item) {
  const city = toSimplified(String(item.city || ""));
  return Boolean(city) && (day.stay || []).some((stay) => { const value = toSimplified(stay).replace(/(?:市|区|站)$/, ""); return value.length >= 2 && city.includes(value); });
}
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
// 两条硬规则：写了住哪时，只排到住处附近的日子；同一天的地点所在的县要相同或相邻。宁可不排，也不硬塞。
function memoArrangeRules(items, days) {
  const dayKeys = new Set(days.map((day) => day.key));
  const fixed = items.filter((item) => item.dayKey && dayKeys.has(item.dayKey));
  const loose = items.filter((item) => !item.dayKey);
  const movable = loose.filter((item) => item.status === "located" && item.prefecture);
  const left = loose.filter((item) => !(item.status === "located" && item.prefecture)).map((item) => ({ id: item.id, reason: "还不知道它在哪，先留在“还没排日期”。" }));
  const state = new Map(days.map((day) => [day.key, { ...day, items: fixed.filter((item) => item.dayKey === day.key), home: "" }]));
  // 每天的“主场县”：先看这天已有的地点，再看这天住在哪。
  for (const day of state.values()) {
    const located = day.items.filter((item) => item.status === "located" && item.prefecture);
    const stayPrefecture = (day.stay || []).map(memoStayPrefecture).filter(Boolean).at(-1) || "";
    day.home = located.length ? memoPrefKey(located[0].prefecture) : stayPrefecture;
  }
  // 再给还空着的天分配“主场县”：地点多的县分到的天数多，每个县至少一天（天数够的话）。
  const byPrefecture = new Map();
  for (const item of movable) byPrefecture.set(memoPrefKey(item.prefecture), (byPrefecture.get(memoPrefKey(item.prefecture)) || 0) + 1);
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
  // 再按“市/区”（京都、大阪再细到片区）成组放进去：优先放到已有同一片的那天，其次是同县的空天。
  const groups = new Map();
  for (const item of movable) groups.set(memoCityKey(item), [...(groups.get(memoCityKey(item)) || []), item]);
  const ordered = [...groups.values()].sort((a, b) => (byPrefecture.get(memoPrefKey(b[0].prefecture)) - byPrefecture.get(memoPrefKey(a[0].prefecture))) || b.length - a.length);
  const assign = {};
  const maxCapacity = Math.max(0, ...days.map((day) => day.capacity));
  for (const group of ordered) {
    const queue = [...group];
    const head = queue[0];
    const prefecture = memoPrefKey(head.prefecture);
    // 一天装得下的一组不拆到两天：宁可留几处没排，也不让同一个区跑两趟。
    const splittable = group.length > maxCapacity;
    let placedOnce = false;
    while (queue.length) {
      if (placedOnce && !splittable) { for (const item of queue) left.push({ id: item.id, reason: `和它同在${item.city || item.prefecture}的地点那天已经排满，先留在“还没排日期”。` }); break; }
      let best = null;
      for (const day of state.values()) {
        const free = day.capacity - day.items.length;
        if (free <= 0 || !memoStayOk(day, head) || !memoNearAll(day.items, head)) continue;
        const sameCity = day.items.some((item) => memoCityKey(item) === memoCityKey(head));
        const otherCities = new Set(day.items.filter((item) => item.status === "located").map(memoCityKey)).size;
        let score = sameCity ? 100 : 0;
        // 已经有别的县的地点时强烈回避；只是预留给别的县、但还空着的天，必要时可以借用。
        if (day.home === prefecture) score += 50; else if (day.home) score -= day.items.length ? 60 : 20;
        if (memoStayCityMatch(day, head)) score += 40;
        // 换城市的那天要赶路，优先用整天待在一个城市的日子。
        if ((day.stay || []).length > 1) score -= 15;
        if (!sameCity) score -= otherCities * 8;
        // 能整组放下的优先，并且挑刚好放得下的那天，把宽裕的日子留给更大的一组。
        if (free >= queue.length) score += 30 - (free - queue.length); else score += free - (splittable ? 0 : 100);
        score -= day.index * 0.01;
        if (!best || score > best.score) best = { day, score };
      }
      if (!best) {
        const nearStay = [...state.values()].some((day) => day.capacity > 0 && memoStayOk(day, head));
        const reason = !nearStay ? "离这几天住的地方都比较远，先留在“还没排日期”。" : [...state.values()].some((day) => day.capacity - day.items.length > 0 && memoStayOk(day, head)) ? "还有空的那几天都排了离它较远的地方，先留在“还没排日期”。" : "行程里的天数排满了，先留在“还没排日期”。";
        for (const item of queue) left.push({ id: item.id, reason });
        break;
      }
      const take = Math.min(best.day.capacity - best.day.items.length, queue.length);
      for (const item of queue.splice(0, take)) { best.day.items.push(item); assign[item.id] = best.day.key; if (!best.day.home) best.day.home = prefecture; }
      placedOnce = true;
    }
  }
  const order = {};
  const reasons = {};
  for (const day of state.values()) { if (!day.items.length) continue; order[day.key] = memoOrderDay(day.items); reasons[day.key] = memoDayReason(day.items); }
  return { assign, order, reasons, left };
}

// 给一份编排打分，数值越小越好。用来比较模型建议和规则版，也用于评测。
// splitCities：同一个市/区被拆到了比必要更多的天；mixedDays：一天里出现多个县；overCapacity：超出每天上限的数量；
// farDays：一天里出现了不相邻的县；offStay：新排入、但离那天住处较远的地点数。
function memoArrangeScore(items, assign, days) {
  const dayKeys = new Set(days.map((day) => day.key));
  const capacity = new Map(days.map((day) => [day.key, day.capacity]));
  const dayByKey = new Map(days.map((day) => [day.key, day]));
  const maxCapacity = Math.max(1, ...days.map((day) => day.capacity));
  const perDay = new Map();
  for (const item of items) {
    const key = assign[item.id] || (dayKeys.has(item.dayKey) ? item.dayKey : "");
    if (!key) continue;
    perDay.set(key, [...(perDay.get(key) || []), item]);
  }
  let mixedDays = 0;
  let farDays = 0;
  let offStay = 0;
  let overCapacity = 0;
  const cityDays = new Map();
  for (const [key, list] of perDay) {
    const located = list.filter((item) => item.status === "located" && item.prefecture);
    if (new Set(located.map((item) => item.prefecture)).size > 1) mixedDays += 1;
    if (located.some((item, index) => !memoNearAll(located.slice(index + 1), item))) farDays += 1;
    offStay += located.filter((item) => assign[item.id] && !memoStayOk(dayByKey.get(key), item)).length;
    overCapacity += Math.max(0, list.filter((item) => assign[item.id]).length + list.filter((item) => !assign[item.id]).length - Math.max(capacity.get(key), list.filter((item) => !assign[item.id]).length));
    for (const item of located) { const entry = cityDays.get(memoCityKey(item)) || { days: new Set(), count: 0 }; entry.days.add(key); entry.count += 1; cityDays.set(memoCityKey(item), entry); }
  }
  let splitCities = 0;
  for (const entry of cityDays.values()) if (entry.days.size > Math.ceil(entry.count / maxCapacity)) splitCities += 1;
  return { splitCities, mixedDays, farDays, offStay, overCapacity, placed: Object.keys(assign).length };
}
