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
 * 실행:  node pack-data.mjs
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

/* ── 1. 키워드 ── */
const kj = read("keywords.json");
if (!kj) { console.error("naver-out/keywords.json 을 못 읽었다."); process.exit(1); }
const rows = kj.rows || [];
console.log(`키워드 ${rows.length.toLocaleString()}개  (원본 ${MB(size("keywords.json"))})`);

const num = x => (x == null || x === "" ? 0 : (typeof x === "number" ? x : Number(x) || 0));
const packed = rows.map(r => [
  r.kw, num(r.pc), num(r.mo), num(r.depth), num(r.comp),
  num(r.clickPc), num(r.clickMo), num(r.ctrPc), num(r.ctrMo),
  num(r.bp1), num(r.bp2), num(r.bp3), num(r.bm1), num(r.bm2), num(r.bm3),
  r.masked ? 1 : 0, num(r.intent), r.hint || ""
]);
const kwJs = "window.KWDATA=" + JSON.stringify({
  fetchedAt: kj.fetchedAt || "", calls: kj.calls || 0, failed: (kj.failed || []).length,
  cols: "kw,pc,mo,depth,comp,clickPc,clickMo,ctrPc,ctrMo,bp1,bp2,bp3,bm1,bm2,bm3,masked,intent,hint",
  rows: packed
}) + ";";
fs.writeFileSync(path.join(DST, "kw.js"), kwJs, "utf8");
meta.keywords = rows.length; total += Buffer.byteLength(kwJs);
console.log(`  → pack/kw.js  ${MB(Buffer.byteLength(kwJs))}`);

/* ── 2. 구매층 ── */
const sj = read("shop.json");
if (sj) {
  const AG = ["10","20","30","40","50","60"], out = {};
  for (const [k, v] of Object.entries(sj.data || {})) {
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
  const keys = Object.keys(src);
  console.log(`3년 추세 ${keys.length.toLocaleString()}개  (원본 ${MB(size("trend.json"))})`);
  const enc1 = arr => (arr || []).map(p => enc(Array.isArray(p) ? p[1] : p.ratio)).join("");
  /* 12 MB 씩 나눠 담는다. 한 파일이 16 MB 를 넘으면 안 된다. */
  const CAP = 12 * 1048576;
  let shard = {}, bytes = 0, n = 0, files = [];
  const flush = () => {
    if (!Object.keys(shard).length) return;
    const nm = `trend-${String(n).padStart(3,"0")}.js`;
    const js = `window.TRENDDATA=window.TRENDDATA||{};Object.assign(window.TRENDDATA,${JSON.stringify(shard)});`;
    fs.writeFileSync(path.join(DST, nm), js, "utf8");
    files.push(nm); total += Buffer.byteLength(js);
    console.log(`  → pack/${nm}  ${MB(Buffer.byteLength(js))}`);
    shard = {}; bytes = 0; n++;
  };
  for (const k of keys) {
    const v = enc1(src[k]);
    if (!v) continue;
    shard[k] = v; bytes += k.length + v.length + 6;
    if (bytes > CAP) flush();
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
