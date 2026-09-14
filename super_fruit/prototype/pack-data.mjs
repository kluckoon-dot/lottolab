#!/usr/bin/env node
/**
 * 화면에 넣을 수 있게 데이터를 접는다.
 *
 * 왜 필요한가
 *   naver-out/keywords.json  178 MB
 *   naver-out/trend.json     408 MB
 * 대부분이 줄바꿈과 들여쓰기다. 숫자 자체는 훨씬 작다.
 * 그대로는 보낼 수도, 화면에 넣을 수도 없다.
 *
 * 무엇을 하는가
 *   1) 키워드를 배열 한 줄로 접는다          약 90 bytes/키워드
 *   2) 3년 추세 156주를 글자 156개로 접는다   약 170 bytes/키워드
 *      비율 0~100 을 90단계로 눌러 한 주를 한 글자로 만든다. 그래프에선 차이가 안 보인다.
 *   3) 구매층은 천분율 정수 8개로 접는다
 *
 * 키워드는 하나도 버리지 않는다. 접기만 한다.
 *
 * 실행:  node pack-data.mjs                       전부 담는다 (섹션 표시만)
 *        node pack-data.mjs --section 1        과일·채소만
 *        node pack-data.mjs --section 1,2      과일·채소 + 곡물·견과
 */
import fs from "node:fs";
import path from "node:path";

const OUT = "naver-out";
const DST = path.join(OUT, "pack");
const MB = n => (n / 1048576).toFixed(2) + " MB";
const read = f => {
  const full = path.join(OUT, f);
  if (!fs.existsSync(full)) { console.log(`  ${f} 가 없다.`); return null; }
  try { return JSON.parse(fs.readFileSync(full, "utf8")); }
  catch (e) {
    /* 512 MB 를 넘으면 readFileSync 가 문자열을 못 만든다. 삼키면 '파일 없음' 으로 보인다. */
    console.log(`  ${f} 를 통째로 읽지 못했다: ${e.message}`);
    return null;
  }
};
const size = f => { try { return fs.statSync(path.join(OUT, f)).size; } catch { return 0; } };

/* 한 주를 한 글자로. JSON 문자열에서 탈이 나는 " 와 \ 는 뺐다. */
const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^_{|}~";
const enc = v => A[Math.max(0, Math.min(A.length - 1, Math.round((v || 0) / 100 * (A.length - 1))))];

fs.mkdirSync(DST, { recursive: true });
/* 지난번에 만든 조각을 먼저 지운다.
   안 지우면 전에 담은 kw-001 ~ kw-004 가 그대로 남아 폴더가 90 MB 가 된다.
   더 나쁜 건 화면이 옛 조각과 새 조각을 같이 읽어 키워드가 뒤섞인다는 것이다. */
{
  let n = 0;
  for (const f of fs.readdirSync(DST))
    if (/^(kw|trend|shop)[-.].*\.js$/.test(f) || f === "meta.json" || f === "kw.js") {
      fs.unlinkSync(path.join(DST, f)); n++;
    }
  if (n) console.log(`지난번 조각 ${n}개를 지웠다.`);
}
const meta = { builtAt: new Date().toISOString(), alphabet: A };
let total = 0;

/* ── 섹션 ──
   419,049개를 한 화면에 다 넣는 건 무리다. 보갬이 정한 순서대로 자른다.
     1 과일·채소  →  2 곡물·견과·건과  →  3 수산물  →  4 축산물
   그 밖의 카테고리는 나중에 별도 사이트로 뺀다.
   키워드를 버리는 게 아니다. 어느 섹션에 속하는지 표시만 한다.
   한 키워드가 여러 섹션에 속할 수 있다. 어디에도 안 붙으면 0 이다. */
let SEC = null;
try { SEC = JSON.parse(fs.readFileSync("sections.json", "utf8")).sections; } catch {}
let secMatch = () => 0;
if (SEC) {
  const multi = SEC.map(() => new Set()), one = SEC.map(() => []);
  let maxLen = 0;
  SEC.forEach((sec, si) => {
    for (const raw of sec.terms) {
      const w = String(raw).replace(/\s+/g, "");
      if (w.length === 1) one[si].push(w);
      else if (w.length >= 2) { multi[si].add(w); if (w.length > maxLen) maxLen = w.length; }
    }
  });
  /* 비트로 담는다. 1=과일·채소, 2=곡물, 4=수산, 8=축산 */
  secMatch = kw => {
    let m = 0;
    for (let si = 0; si < SEC.length; si++) {
      let hit = false;
      for (let i = 0; i < kw.length && !hit; i++)
        for (let L = 2; L <= Math.min(maxLen, kw.length - i); L++)
          if (multi[si].has(kw.slice(i, i + L))) { hit = true; break; }
      if (!hit)
        for (const c of one[si])
          if (kw === c || kw.slice(-1) === c
              || (kw.slice(0, 1) === c && (kw.length <= 4 || /[0-9A-Za-z]/.test(kw[1])))) { hit = true; break; }
      if (hit) m |= (1 << si);
    }
    return m;
  };
  console.log(`섹션 ${SEC.length}개: ` + SEC.map(x => x.name).join(" · "));
}

/* ── 1. 키워드 ── */
/* keywords.json 도 흘려 읽는다. 566,276개에 252 MB 고 계속 큰다.
   줄이 배열인 새 형식과 객체인 옛 형식을 둘 다 받는다. */
const KW_KEYS = "kw,pc,mo,total,tier,masked,clickPc,clickMo,ctrPc,ctrMo,depth,compIdx,hints,bid,seenAlso".split(",");
async function loadKeywords(file) {
  const out = { meta: {}, rows: [] };
  let fh; try { fh = await fs.promises.open(file, "r"); } catch { return out; }
  const rs = fh.createReadStream({ encoding: "utf8", highWaterMark: 1 << 20 });
  let buf = "", started = false;
  const balanced = from => {
    const open = buf[from], close = open === "[" ? "]" : "}";
    let d = 0, str = false, esc = false;
    for (let i = from; i < buf.length; i++) {
      const c = buf[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { str = !str; continue; }
      if (str) continue;
      if (c === open) d++; else if (c === close) { d--; if (!d) return i; }
    }
    return -1;
  };
  const conv = a => {
    if (!Array.isArray(a)) return a;
    const o = {}; KW_KEYS.forEach((k, i) => { o[k] = a[i]; });
    o.masked = !!o.masked; o.hints = o.hints || [];
    o.bid = o.bid ? { pc: o.bid[0], mo: o.bid[1] } : null;
    return o;
  };
  const drain = () => {
    for (;;) {
      let i = 0;
      while (i < buf.length && /[\s,]/.test(buf[i])) i++;
      if (i >= buf.length) { buf = ""; return; }
      if (buf[i] === "]") { buf = ""; return; }
      if (buf[i] !== "{" && buf[i] !== "[") { buf = buf.slice(i); return; }
      const end = balanced(i);
      if (end < 0) { buf = buf.slice(i); return; }
      out.rows.push(conv(JSON.parse(buf.slice(i, end + 1))));
      buf = buf.slice(end + 1);
    }
  };
  for await (const chunk of rs) {
    buf += chunk;
    if (!started) {
      const a = buf.indexOf('"rows"');
      if (a < 0) { if (buf.length > 8000000) buf = buf.slice(-4000000); continue; }
      const b = buf.indexOf("[", a);
      if (b < 0) continue;
      try { out.meta = JSON.parse(buf.slice(0, a).replace(/,\s*$/, "") + "}"); } catch {}
      buf = buf.slice(b + 1); started = true;
    }
    drain();
  }
  if (started) drain();
  return out;
}
const kwFile = path.join(OUT, "keywords.json");
if (!fs.existsSync(kwFile)) { console.error("naver-out/keywords.json 이 없다."); process.exit(1); }
const kwLoaded = await loadKeywords(kwFile);
const kj = kwLoaded.meta;
const rows = kwLoaded.rows;
if (!rows.length) { console.error("naver-out/keywords.json 에서 줄을 하나도 읽지 못했다."); process.exit(1); }
console.log(`키워드 ${rows.length.toLocaleString()}개  (원본 ${MB(size("keywords.json"))})`);

const num = x => (x == null || x === "" ? 0 : (typeof x === "number" ? x : Number(x) || 0));

/* 수집기가 실제로 쓰는 모양에 맞춘다. 처음엔 내가 이름을 잘못 짚어서
   입찰가·경쟁도·힌트가 전부 0 과 빈 문자열로 나갔다.
     bid      { pc:[1위,2위,3위], mo:[...] }   (bp1 같은 평평한 이름이 아니다)
     compIdx  "낮음" | "중간" | "높음"          (comp 라는 숫자가 아니다)
     hints    ["씨앗", ...]                    (hint 문자열이 아니다) */
const COMP = { "낮음": 0, "중간": 1, "높음": 2 };
const bidOf = (r, dev, i) => { const b = r.bid && r.bid[dev]; return b ? num(b[i]) : 0; };

/* 의도 분류. 옛 수집분 13,662개의 라벨과 대조해 77.7% 일치하는 규칙이다.
   완벽하지 않다. 특히 브랜드성이 약하다(26.6%). 화면에서 칩으로 켜고 끄는 용도라
   이 정도면 쓴다. 어느 것도 삭제하지 않는다. */
const RE_INFO = /효능|레시피|만드는법|만들기|보관법|보관방법|먹는법|손질법|손질방법|맛집|가볼만한곳|증상|좋은음식|좋은차|부작용|칼로리|키우기|재배|심는시기|수확시기|차이|뜻|유래|빨리낫는법|하는법|하는방법|어디|언제|왜/;
const RE_BRAND = /[A-Za-z]{3,}/;
const RE_SHOP = /선물세트|선물|세트|\d+\s*(kg|KG|g|개|박스|팩|입|호|과|봉|병)|가격|시세|도매|소매|판매|구매|주문|배송|특가|할인|최저가|산지직송|택배/;
const intentOf = (kw, secBits) => {
  if (RE_INFO.test(kw)) return 1;
  if (RE_BRAND.test(kw)) return 2;
  if (secBits || RE_SHOP.test(kw)) return 0;
  return 3;
};
const want = (() => {
  const i = process.argv.indexOf("--section");
  if (i < 0 || !SEC) return null;
  const names = process.argv[i + 1].split(",").map(x => x.trim());
  const bits = SEC.reduce((acc, sec, si) =>
    names.includes(sec.id) || names.includes(String(sec.order)) ? acc | (1 << si) : acc, 0);
  if (!bits) { console.error("--section 에 쓸 수 있는 값: " + SEC.map(x => `${x.order}/${x.id}`).join(" ")); process.exit(1); }
  console.log("이 섹션만 담는다: " + SEC.filter((_, si) => bits & (1 << si)).map(x => x.name).join(" · "));
  return bits;
})();

const secCount = new Array(SEC ? SEC.length : 0).fill(0);
let secNone = 0;
const packedAll = rows.map(r => {
  const sec = secMatch(r.kw);
  return [
    r.kw, num(r.pc), num(r.mo), num(r.depth), (COMP[r.compIdx] ?? 0),
    num(r.clickPc), num(r.clickMo), num(r.ctrPc), num(r.ctrMo),
    bidOf(r, "pc", 0), bidOf(r, "pc", 1), bidOf(r, "pc", 2),
    bidOf(r, "mo", 0), bidOf(r, "mo", 1), bidOf(r, "mo", 2),
    r.masked ? 1 : 0, intentOf(r.kw, sec), (r.hints && r.hints[0]) || "", sec
  ];
});
{ /* 제대로 담겼는지 바로 확인한다. 전부 0 이면 또 이름을 잘못 짚은 것이다. */
  const withBid = packedAll.filter(r => r[9] || r[12]).length;
  const withComp = packedAll.filter(r => r[4]).length;
  console.log(`  입찰가 있는 키워드 ${withBid.toLocaleString()} · 경쟁도 있는 키워드 ${withComp.toLocaleString()}`);
  if (!withBid) console.log("  *** 입찰가가 하나도 없다. keywords.json 에 bid 가 안 들어있거나 이름이 또 다르다. 알려줘라. ***");
}
if (SEC) {
  for (const row of packedAll) {
    const m = row[18];
    if (!m) { secNone++; continue; }
    for (let si = 0; si < SEC.length; si++) if (m & (1 << si)) secCount[si]++;
  }
  console.log("  섹션별 키워드 수");
  SEC.forEach((sec, si) => console.log(`    ${sec.order}. ${sec.name.padEnd(12)} ${secCount[si].toLocaleString().padStart(9)}개`));
  console.log(`    ${"어디에도 안 붙음".padEnd(15)} ${secNone.toLocaleString().padStart(9)}개`);
  meta.sections = SEC.map((sec, si) => ({ id: sec.id, name: sec.name, n: secCount[si] }));
  meta.sectionNone = secNone;
}
const packed = want ? packedAll.filter(r => r[18] & want) : packedAll;
if (want) console.log(`  걸러낸 뒤 ${packed.length.toLocaleString()}개를 담는다`);
/* 12 MB 씩 나눠 담는다. 한 파일이 16 MB 를 넘으면 아티팩트가 안 받는다.
   처음엔 추세만 나누고 키워드는 한 파일로 뒀는데, 419,049개가 나오니
   kw.js 가 27 MB 가 됐다. 키워드도 똑같이 나눈다. */
const CAP = 10 * 1048576;   // 실측 103 bytes/키워드. 16 MB 한도에 여유를 둔다
const head = { fetchedAt: kj.fetchedAt || "", calls: kj.calls || 0, failed: (kj.failed || []).length,
  cols: "kw,pc,mo,depth,comp,clickPc,clickMo,ctrPc,ctrMo,bp1,bp2,bp3,bm1,bm2,bm3,masked,intent,hint,sec",
  sections: SEC ? SEC.map(x => ({ id: x.id, name: x.name, naver: x.naver })) : [] };
fs.writeFileSync(path.join(DST, "kw-head.js"), "window.KWHEAD=" + JSON.stringify(head) + ";", "utf8");
total += Buffer.byteLength("window.KWHEAD=" + JSON.stringify(head) + ";");

const kwFiles = [];
let buf = [], bytes = 0, kn = 0;
const flushKw = () => {
  if (!buf.length) return;
  const nm = `kw-${String(kn).padStart(3,"0")}.js`;
  /* push(...arr) 은 인자가 13만 개면 스택이 터진다. concat 으로 붙인다. */
  const js = `window.KWROWS=(window.KWROWS||[]).concat(${JSON.stringify(buf)});`;
  fs.writeFileSync(path.join(DST, nm), js, "utf8");
  kwFiles.push(nm); total += Buffer.byteLength(js);
  console.log(`  → pack/${nm}  ${MB(Buffer.byteLength(js))}  (${buf.length.toLocaleString()}개)`);
  buf = []; bytes = 0; kn++;
};
for (const row of packed) {
  buf.push(row); bytes += 90;
  if (bytes > CAP) flushKw();
}
flushKw();
meta.kwFiles = kwFiles;

/* 검색량이 어떻게 퍼져 있는지 알아야 어디를 자를지 정할 수 있다 */
const vols = packed.map(r => r[1] + r[2]).sort((a,b) => a-b);
const cut = v => vols.length - vols.findIndex(x => x >= v);
meta.volume = { total: vols.length, ge10: cut(10), ge100: cut(100), ge500: cut(500), ge1000: cut(1000), ge5000: cut(5000) };
console.log(`  검색량 분포  월 10↑ ${cut(10).toLocaleString()} · 100↑ ${cut(100).toLocaleString()} · 500↑ ${cut(500).toLocaleString()} · 1,000↑ ${cut(1000).toLocaleString()} · 5,000↑ ${cut(5000).toLocaleString()}`);

/* ── 2. 구매층 ── */
const sj = read("shop.json");
if (sj) {
  const AG = ["10","20","30","40","50","60"], out = {};
  const keepS = new Set(packed.map(r => r[0]));
  for (const [k, v] of Object.entries(sj.data || {})) {
    if (!keepS.has(k)) continue;
    const d = v.device, g = v.gender, a = v.age;
    if (!d || !g || !a) continue;
    const td = Object.values(d).reduce((x,y)=>x+y,0);
    const tg = Object.values(g).reduce((x,y)=>x+y,0);
    const ta = Object.values(a).reduce((x,y)=>x+y,0);
    if (!td || !tg || !ta) continue;
    out[k] = [Math.round((d.mo||0)/td*1000), Math.round((g.f||0)/tg*1000)]
      .concat(AG.map(x => Math.round((a[x]||0)/ta*1000)));
  }
  const js = "window.SHOPDATA=" + JSON.stringify({ category: sj.category, from: sj.startDate, to: sj.endDate, d: out }) + ";";
  fs.writeFileSync(path.join(DST, "shop.js"), js, "utf8");
  meta.shop = Object.keys(out).length; total += Buffer.byteLength(js);
  console.log(`구매층 ${Object.keys(out).length.toLocaleString()}개  (원본 ${MB(size("shop.json"))})  → pack/shop.js  ${MB(Buffer.byteLength(js))}`);
} else console.log("구매층 shop.json 없음 — 건너뛴다");

/* ── 큰 파일 흘려 읽기 ──
   trend.json 이 512.3 MB 였다. Node 가 만들 수 있는 문자열이 512 MB 라
   readFileSync 가 통째로는 못 읽는다. 앞서 이걸 '파일 없음' 으로 찍었던 게 내 잘못이다.
   그래서 data 안의 항목을 하나씩 떼어 읽는다. 메모리에 다 올리지 않는다. */
async function streamTrend(file, onEntry) {
  const rs = fs.createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 });
  let buf = "", started = false, head = null, n = 0;
  const findHead = () => {
    const i = buf.indexOf('"data"');
    if (i < 0) return false;
    const j = buf.indexOf("{", i);
    if (j < 0) return false;
    head = buf.slice(0, i);                       // startDate 등이 들어있는 앞부분
    buf = buf.slice(j + 1); started = true; return true;
  };
  /* 따옴표 안의 [ ] 는 세지 않는다 */
  const balanced = from => {
    let d = 0, str = false, esc = false;
    for (let i = from; i < buf.length; i++) {
      const c = buf[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { str = !str; continue; }
      if (str) continue;
      if (c === "[") d++;
      else if (c === "]") { d--; if (!d) return i; }
    }
    return -1;
  };
  const drain = () => {
    for (;;) {
      let i = 0;
      while (i < buf.length && /[\s,]/.test(buf[i])) i++;
      if (i >= buf.length) { buf = buf.slice(i); return; }
      if (buf[i] === "}") { buf = ""; return; }     // data 끝
      if (buf[i] !== '"') { buf = buf.slice(i); return; }
      let j = i + 1, esc = false;
      while (j < buf.length) { const c = buf[j]; if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') break; j++; }
      if (j >= buf.length) { buf = buf.slice(i); return; }   // 키가 아직 안 끝났다
      const key = JSON.parse(buf.slice(i, j + 1));
      let k = j + 1;
      while (k < buf.length && /[\s:]/.test(buf[k])) k++;
      if (k >= buf.length || buf[k] !== "[") { buf = buf.slice(i); return; }
      const end = balanced(k);
      if (end < 0) { buf = buf.slice(i); return; }            // 배열이 아직 안 끝났다
      onEntry(key, JSON.parse(buf.slice(k, end + 1))); n++;
      buf = buf.slice(end + 1);
    }
  };
  for await (const chunk of rs) {
    buf += chunk;
    if (!started) { if (!findHead()) continue; }
    drain();
  }
  if (started) drain();
  let meta = {};
  try { meta = JSON.parse((head || "{") + "}"); } catch {}
  return { n, meta };
}

/* ── 3. 3년 추세 ── */
const trendPath = path.join(OUT, "trend.json");
if (fs.existsSync(trendPath)) {
  console.log(`3년 추세 (원본 ${MB(size("trend.json"))}) — 흘려 읽는다`);
  const keep = new Set(packed.map(r => r[0]));
  /* 세 가지 모양을 다 받는다.
       옛 형식  [["2023-09-11",75.5], ...]
       객체     [{period,ratio}, ...]
       새 형식  [75.5, 100, ...]     날짜는 맨 위 periods 에 한 번만 있다 */
  const enc1 = arr => (arr || []).map(pt =>
    enc(typeof pt === "number" ? pt : Array.isArray(pt) ? pt[1] : (pt && pt.ratio))).join("");
  let shard = {}, tbytes = 0, n = 0, files = [], kept = 0;
  const flush = () => {
    if (!Object.keys(shard).length) return;
    const nm = `trend-${String(n).padStart(3,"0")}.js`;
    const js = `window.TRENDDATA=window.TRENDDATA||{};Object.assign(window.TRENDDATA,${JSON.stringify(shard)});`;
    fs.writeFileSync(path.join(DST, nm), js, "utf8");
    files.push(nm); total += Buffer.byteLength(js);
    console.log(`  → pack/${nm}  ${MB(Buffer.byteLength(js))}`);
    shard = {}; tbytes = 0; n++;
  };
  const { n: seen, meta: tmeta } = await streamTrend(trendPath, (k, arr) => {
    if (!keep.has(k)) return;
    const v = enc1(arr);
    if (!v) return;
    shard[k] = v; kept++; tbytes += k.length + v.length + 6;
    if (tbytes > CAP) flush();
  });
  flush();
  console.log(`  파일 안 ${seen.toLocaleString()}개 중 ${kept.toLocaleString()}개를 담았다`);
  meta.trend = kept; meta.trendFiles = files;
  meta.trendWeeks = { start: tmeta.startDate, end: tmeta.endDate, unit: tmeta.timeUnit || "week" };
} else console.log("3년 추세 trend.json 없음 — 건너뛴다");

meta.totalBytes = total;
fs.writeFileSync(path.join(DST, "meta.json"), JSON.stringify(meta, null, 1), "utf8");
console.log(`\n합계 ${MB(total)}  →  ${DST}`);
console.log(total > 60 * 1048576
  ? "60 MB 를 넘는다. 이 상태로는 화면 한 장에 다 못 넣는다. 어디를 자를지 정해야 한다."
  : "화면에 넣을 수 있는 크기다. pack 폴더를 통째로 압축해서 보내라.");
