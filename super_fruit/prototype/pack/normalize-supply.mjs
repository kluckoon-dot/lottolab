/* ── 공급사 상품명을 표준형으로 접는다 ──
 *
 * 공급사마다 같은 물건을 다르게 적는다.
 *   "[특가] 홍옥사과 2kg 6~7과 대과 가정용"
 *   "홍옥 2KG (8과내외) 특大"
 *   "사과(홍옥) 2키로 중대과 주스용"
 *
 * 보갬의 지적이 핵심이다. "대과" 라는 낱말은 믿을 게 못 된다.
 * 2kg/6과를 대과라 부르는 곳과 2kg/8과를 대과라 부르는 곳이 같이 있다.
 * 그래서 낱말이 아니라 숫자로 잰다.
 *
 *   g/과  = 중량 ÷ 과수      ← 진짜 크기. 이것만이 공급사를 가로질러 비교된다
 *   원/kg = 공급가 ÷ 중량    ← 진짜 단가
 *
 * 등급 낱말은 버리지 않고 따로 적어둔다. 참고는 되지만 판정에는 안 쓴다.
 */

/* ── 중량 ── */
const W_UNITS = [
  [/(\d+(?:[.,]\d+)?)\s*(?:kg|KG|Kg|㎏|키로|킬로|킬로그램)/, 1],
  [/(\d+(?:[.,]\d+)?)\s*(?:g|G|그램|g단위)(?![a-zA-Z])/, 0.001],
  [/(\d+(?:[.,]\d+)?)\s*(?:t|T|톤)/, 1000]
];
export function weightKg(s) {
  const t = String(s || "");
  /* 5kg x 2박스 같은 표기는 곱한다 */
  const mult = t.match(/(\d+(?:[.,]\d+)?)\s*(?:kg|KG|㎏|키로)\s*[xX*×]\s*(\d+)/);
  if (mult) return round3(parseFloat(mult[1].replace(",", ".")) * parseInt(mult[2], 10));
  for (const [re, f] of W_UNITS) {
    const m = t.match(re);
    if (m) {
      const v = parseFloat(m[1].replace(",", ".")) * f;
      /* 5000g 를 5kg 로. 0.1kg 미만이나 100kg 초과는 중량이 아니라 딴 숫자일 것이다. */
      if (v >= 0.1 && v <= 100) return round3(v);
    }
  }
  return null;
}

/* ── 과수 · 입수 ──
   "6~7과", "8과내외", "10입", "12개입", "약 9과" 를 모두 읽는다.
   범위면 가운데 값을 쓰고, 범위였다는 사실을 따로 남긴다. */
export function countOf(s) {
  const t = String(s || "");
  const range = t.match(/(\d+)\s*[~\-–]\s*(\d+)\s*(?:과|입|개|알|봉|송이|미|마리|구)(?!월)/);
  if (range) {
    const a = +range[1], b = +range[2];
    if (a > 0 && b > 0 && b < 200) return { n: (a + b) / 2, lo: a, hi: b, approx: true };
  }
  const one = t.match(/(?:약\s*)?(\d+)\s*(?:과|입|개|알|봉|송이|미|마리|구)(?!월)/);
  if (one) {
    const n = +one[1];
    if (n > 0 && n < 200) return { n, lo: n, hi: n, approx: /내외|약|정도|±/.test(t) };
  }
  return null;
}

/* ── 등급 낱말 ──
   판정에는 안 쓴다. 공급사가 뭐라고 불렀는지만 남긴다.
   같은 "대과" 가 공급사마다 다른 크기라는 게 이 프로젝트의 출발점이다. */
/* 순서가 곧 우선순위다. 긴 낱말을 먼저 봐야 "중대과" 가 "대" 로 잡히지 않는다.
   한 번 당했다: 중대과 → 대. */
const GRADE_WORDS = [
  ["특대", /특대|특\s*大|왕과|점보|자이언트|XL/i],
  ["중대", /중대|중\s*대/],
  ["대",   /대\s*과|大|라지|L\s*사이즈|(?<![A-Za-z])L(?![A-Za-z])/],
  ["중소", /중소|중\s*소/],
  ["중",   /중\s*과|中|미디움|미디엄|M\s*사이즈|(?<![A-Za-z])M(?![A-Za-z])/],
  ["소",   /소\s*과|小|스몰|S\s*사이즈|(?<![A-Za-z])S(?![A-Za-z])/],
  ["혼합", /혼합|믹스|랜덤|사이즈\s*랜덤|모듬|모둠/]
];
const USE_WORDS = [
  ["선물",  /선물|기프트|명절|추석|설\s*용|프리미엄|고급/],
  ["가정",  /가정용|가정|집에서|실속|알뜰|생활/],
  ["주스",  /주스|쥬스|착즙|즙용|가공용|스무디/],
  ["업소",  /업소|식자재|대량|벌크|납품/],
  ["못난이", /못난이|흠과|흠집|파지|비품|B품|b급|로스|훼손|낙과/]
];
const pick = (t, table) => { for (const [k, re] of table) if (re.test(t)) return k; return null; };
export const gradeWord = t => pick(String(t || ""), GRADE_WORDS);
export const useWord   = t => pick(String(t || ""), USE_WORDS);

/* ── 상품명에서 품목 뽑기 ──
   대괄호 광고문구, 배송 문구, 숫자 덩어리를 걷어내고 품목 사전과 맞춘다. */
const NOISE = [
  /\[[^\]]*\]/g, /\([^)]*\)/g, /【[^】]*】/g,
  /무료\s*배송|당일\s*발송|산지\s*직송|직배송|택배|아이스박스|스티로폼|박스포장|정품|국산|수입산|친환경|무농약|유기농|GAP|HACCP/g,
  /특가|할인|세일|초특가|땡처리|한정|이벤트|신상|추천|인기|베스트|NEW|HOT/gi,
  /\d+(?:[.,]\d+)?\s*(?:kg|KG|㎏|키로|킬로|g|G|그램|t|톤)/g,
  /\d+\s*[~\-–]?\s*\d*\s*(?:과|입|개|알|봉|송이|미|마리|구)(?!월)/g,
  /\d+\s*[xX*×]\s*\d+/g
];
export function cleanName(s) {
  let t = " " + String(s || "") + " ";
  for (const re of NOISE) t = t.replace(re, " ");
  /* 등급·용도 낱말은 정규식으로 통째로 지운다.
     낱말만 잘라내면 "업소용" 에서 "용" 이, "특대" 에서 꼬리가 남았다. */
  for (const [, re] of GRADE_WORDS.concat(USE_WORDS))
    t = t.replace(new RegExp(re.source + "\\s*용?", "g" + (re.flags.includes("i") ? "i" : "")), " ");
  t = t.replace(/[★☆◆◇■□▶▷※@#$%^&*=<>{}"'`]+/g, " ");
  return t.replace(/[\/·,~\-–_+:|]+/g, " ").replace(/\s+/g, " ").trim();
}

/* 품목 사전은 바깥에서 넣는다. sections.json 의 terms 를 그대로 쓴다. */
/* 품종 사전이 있으면 그것을 먼저 본다.
   공급사는 "홍옥" 이라 쓰고 우리 키워드 사전에는 "홍옥사과" 만 있다.
   varieties.json 이 그 둘을 이어준다. */
export function makeMatcher(terms, varieties) {
  const VAR = varieties || {};
  const varKeys = Object.keys(VAR).sort((a, b) => b.length - a.length);
  const inner = makeTermMatcher(terms);
  return function match(raw) {
    const kw = cleanName(raw).replace(/\s+/g, "");
    /* 여러 개가 걸리면 긴 것이 이기고, 길이가 같으면 품종이 기준품목을 이긴다.
       "홍옥사과" 에서 홍옥(품종)과 사과(기준)가 둘 다 두 글자라 사과가 먼저 잡혔었다. */
    let best = null;
    for (const v of varKeys) {
      if (!kw.includes(v)) continue;
      const isVariety = VAR[v] !== v;
      if (!best || v.length > best.v.length || (v.length === best.v.length && isVariety && !best.isVariety))
        best = { v, isVariety };
      if (best.v.length > v.length) break;   // 길이 내림차순이므로 더 볼 것이 없다
    }
    if (best) return { item: VAR[best.v], variety: best.v, all: [VAR[best.v], best.v] };
    const t = inner(raw);
    return t ? { item: t.item, variety: null, all: t.all } : null;
  };
}

function makeTermMatcher(terms) {
  const multi = new Set(), one = [];
  let max = 0;
  for (const t of terms) {
    const w = String(t).replace(/\s+/g, "");
    if (!w) continue;
    if (w.length === 1) one.push(w);
    else { multi.add(w); if (w.length > max) max = w.length; }
  }
  /* 긴 이름이 먼저 걸려야 한다. 홍로사과를 사과로 접으면 품종이 날아간다. */
  return function matchTerms(raw) {
    const kw = cleanName(raw).replace(/\s+/g, "");
    const hits = [];
    for (let i = 0; i < kw.length; i++)
      for (let L = Math.min(max, kw.length - i); L >= 2; L--) {
        const p = kw.slice(i, i + L);
        if (multi.has(p)) { hits.push(p); i += L - 1; break; }
      }
    if (!hits.length)
      for (const c of one) if (kw === c || kw.endsWith(c) || (kw.startsWith(c) && kw.length <= 4)) { hits.push(c); break; }
    if (!hits.length) return null;
    hits.sort((a, b) => b.length - a.length);
    return { item: hits[0], all: [...new Set(hits)] };
  };
}

const round3 = n => Math.round(n * 1000) / 1000;
const num = v => {
  const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return isFinite(n) ? n : null;
};

/* ── 한 줄을 표준형으로 ── */
export function normalize(row, match) {
  const name = String(row.name || "");
  const full = name + " " + String(row.option || "");
  const kg = weightKg(full);
  const cnt = countOf(full);
  const price = num(row.price);
  const m = match ? match(name) : null;
  const gPer = (kg && cnt) ? Math.round(kg * 1000 / cnt.n) : null;
  const wonKg = (kg && price) ? Math.round(price / kg) : null;
  return {
    supplier: row.supplier || "",
    raw: name,
    option: row.option || "",
    item: m ? m.item : null,
    variety: m ? (m.variety || null) : null,
    itemAll: m ? m.all : [],
    kg, count: cnt ? cnt.n : null, countApprox: cnt ? cnt.approx : false,
    countLo: cnt ? cnt.lo : null, countHi: cnt ? cnt.hi : null,
    gradeWord: gradeWord(full), use: useWord(full),
    price, ship: num(row.ship),
    /* 비교 열쇠. 달력이 태추단감과 대봉감을 둘 다 "감" 으로 묶어두는데,
       파는 사람에게 그 둘은 다른 물건이다. 품종이 있으면 품종으로 묶는다. */
    key: m ? (m.variety || m.item) : null,
    gPer, wonKg,
    wonEach: (price && cnt) ? Math.round(price / cnt.n) : null
  };
}

/* ── 크기대 ──
   낱말이 아니라 g/과 로 다시 매긴다. 품목마다 기준이 다르므로
   그 품목에 실제로 나온 매물들의 분포로 자른다. 공급사가 뭐라 부르든 상관없다. */
export function sizeBands(rows) {
  const by = {};
  for (const r of rows) if (r.item && r.gPer) (by[r.item] || (by[r.item] = [])).push(r.gPer);
  const cuts = {};
  for (const [item, arr] of Object.entries(by)) {
    if (arr.length < 4) continue;
    const s = arr.slice().sort((a, b) => a - b);
    const q = p => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    cuts[item] = [q(0.25), q(0.5), q(0.75)];
  }
  return cuts;
}
export function bandOf(r, cuts) {
  if (!r.item || !r.gPer) return null;
  const c = cuts[r.item];
  if (!c) return null;
  return r.gPer >= c[2] ? "특대" : r.gPer >= c[1] ? "대" : r.gPer >= c[0] ? "중" : "소";
}
