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
const read = f => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")); } catch { return null; } };
const size = f => { try { return fs.statSync(path.join(OUT, f)).size; } catch { return 0; } };

/* 한 주를 한 글자로. JSON 문자열에서 탈이 나는 " 와 \ 는 뺐다. */
const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^_{|}~";
const enc = v => A[Math.max(0, Math.min(A.length - 1, Math.round((v || 0) / 100 * (A.length - 1))))];

fs.mkdirSync(DST, { recursive: true });
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
          if (kw === c || kw.slice(-1) === c || (kw.slice(0, 1) === c && kw.length <= 4)) { hit = true; break; }
      if (hit) m |= (1 << si);
    }
    return m;
  };
  console.log(`섹션 ${SEC.length}개: ` + SEC.map(x => x.name).join(" · "));
}

/* ── 1. 키워드 ── */
const kj = read("keywords.json");
if (!kj) { console.error("naver-out/keywords.json 을 못 읽었다."); process.exit(1); }
const rows = kj.rows || [];
console.log(`키워드 ${rows.length.toLocaleString()}개  (원본 ${MB(size("keywords.json"))})`);

const num = x => (x == null || x === "" ? 0 : (typeof x === "number" ? x : Number(x) || 0));
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
const packedAll = rows.map(r => [
  r.kw, num(r.pc), num(r.mo), num(r.depth), num(r.comp),
  num(r.clickPc), num(r.clickMo), num(r.ctrPc), num(r.ctrMo),
  num(r.bp1), num(r.bp2), num(r.bp3), num(r.bm1), num(r.bm2), num(r.bm3),
  r.masked ? 1 : 0, num(r.intent), r.hint || "", secMatch(r.kw)
]);
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

/* ── 3. 3년 추세 ── */
const tj = read("trend.json");
if (tj) {
  const src = tj.data || {};
  const keep = new Set(packed.map(r => r[0]));
  const keys = Object.keys(src).filter(k => keep.has(k));
  console.log(`3년 추세 ${keys.length.toLocaleString()}개  (원본 ${MB(size("trend.json"))})`);
  const enc1 = arr => (arr || []).map(p => enc(Array.isArray(p) ? p[1] : p.ratio)).join("");
  let shard = {}, tbytes = 0, n = 0, files = [];
  const flush = () => {
    if (!Object.keys(shard).length) return;
    const nm = `trend-${String(n).padStart(3,"0")}.js`;
    const js = `window.TRENDDATA=window.TRENDDATA||{};Object.assign(window.TRENDDATA,${JSON.stringify(shard)});`;
    fs.writeFileSync(path.join(DST, nm), js, "utf8");
    files.push(nm); total += Buffer.byteLength(js);
    console.log(`  → pack/${nm}  ${MB(Buffer.byteLength(js))}`);
    shard = {}; tbytes = 0; n++;
  };
  for (const k of keys) {
    const v = enc1(src[k]);
    if (!v) continue;
    shard[k] = v; tbytes += k.length + v.length + 6;
    if (tbytes > CAP) flush();
  }
  flush();
  meta.trend = keys.length; meta.trendFiles = files;
  meta.trendWeeks = { start: tj.startDate, end: tj.endDate, unit: tj.timeUnit || "week" };
} else console.log("3년 추세 trend.json 없음 — 건너뛴다");

meta.totalBytes = total;
fs.writeFileSync(path.join(DST, "meta.json"), JSON.stringify(meta, null, 1), "utf8");
console.log(`\n합계 ${MB(total)}  →  ${DST}`);
console.log(total > 60 * 1048576
  ? "60 MB 를 넘는다. 이 상태로는 화면 한 장에 다 못 넣는다. 어디를 자를지 정해야 한다."
  : "화면에 넣을 수 있는 크기다. pack 폴더를 통째로 압축해서 보내라.");
