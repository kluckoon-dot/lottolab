#!/usr/bin/env node
/**
 * pack 폴더 → 화면에 심을 데이터 파일.
 *
 * 섹션 비트를 여기서 다시 계산한다. 수집기 쪽 규칙이 브라우징용으로는 헐거웠다.
 * '롯데시네마' 가 끝의 '마' 한 글자에 걸려 과일·채소로 분류됐다.
 *
 * 실행:  node build-web.mjs <pack폴더> [출력폴더]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/* 폴더 정리 (2026-10-09): 프로그램은 app\ 에, key.txt · naver-out · 넣는곳 은 그 위 폴더에 둔다.
   예전처럼 한 폴더에 다 있어도 그대로 돈다. */
const APPDIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(APPDIR).toLowerCase() === "app" ? path.dirname(APPDIR) : APPDIR;


const PACK = process.argv[2] || path.join(ROOT, "naver-out", "pack");
const OUT  = process.argv[3] || APPDIR;   // 화면 데이터는 화면(keyword-lab.html) 옆에
const MB = n => (n / 1048576).toFixed(2) + " MB";

globalThis.window = {};
for (const f of fs.readdirSync(PACK).filter(x => /^(kw-head|kw-\d+|shop|supply|trend-\d+)\.js$/.test(x)).sort())
  (0, eval)(fs.readFileSync(path.join(PACK, f), "utf8"));
const H = window.KWHEAD, R = window.KWROWS, S = window.SHOPDATA, T = window.TRENDDATA || {};
const SUP = window.SUPPLYDATA || null;
const META = JSON.parse(fs.readFileSync(path.join(PACK, "meta.json"), "utf8"));
console.log(`읽음  키워드 ${R.length.toLocaleString()} · 추세 ${Object.keys(T).length.toLocaleString()} · 구매층 ${Object.keys(S.d).length.toLocaleString()}`);

/* ── 섹션 다시 계산 ──
   한 글자 낱말을 어디까지 인정할지가 관건이다. 넓게 잡으면 롯데시네마가 과일이 되고
   좁게 잡으면 나주배·공주밤·제주귤이 빠진다. 실제 키워드로 맞춘 선은 이렇다.
     그 자체                 배 · 귤 · 밤
     세 글자 이하의 앞 또는 끝   나주배 · 공주밤 · 제주귤 · 풋귤 · 햇배
     앞인데 바로 뒤가 숫자·영문  쌀10KG · 쌀20KG
   롯데시네마(5자)와 포포나무(4자)는 이 선에서 걸러진다. */
const SJ = JSON.parse(fs.readFileSync(path.join(APPDIR, "sections.json"), "utf8"));
const SEC = SJ.sections;
/* 품목 글자를 물고 있지만 품목이 아닌 것들. 실제 수집분 상위를 훑어 뽑았다. */
const EXC = SJ.exclude || [];
const excluded = kw => EXC.some(e => kw.indexOf(e) >= 0);
const multi = SEC.map(() => new Set()), one = SEC.map(() => []);
let MX = 0;
SEC.forEach((sec, i) => { for (const t of sec.terms) {
  const w = String(t).replace(/\s+/g, "");
  if (w.length === 1) one[i].push(w);
  else if (w.length >= 2) { multi[i].add(w); if (w.length > MX) MX = w.length; }
} });
function secOf(kw) {
  if (excluded(kw)) return 0;
  let m = 0;
  for (let si = 0; si < SEC.length; si++) {
    let hit = false;
    for (let i = 0; i < kw.length && !hit; i++)
      for (let L = 2; L <= Math.min(MX, kw.length - i); L++)
        if (multi[si].has(kw.slice(i, i + L))) { hit = true; break; }
    if (!hit) for (const c of one[si]) {
      if (kw === c) { hit = true; break; }
      if (kw.length <= 3 && (kw[0] === c || kw[kw.length - 1] === c)) { hit = true; break; }
      if (kw[0] === c && /[0-9A-Za-z]/.test(kw[1] || "")) { hit = true; break; }
    }
    if (hit) m |= (1 << si);
  }
  return m;
}
const before = SEC.map(() => 0), after = SEC.map(() => 0);
/* 글자로만 나누면 식품 아닌 것이 끼어든다 (독감 · 배게 · 남여주CC · 앞치마 · 추석연휴).
   refresh-naver.mjs 가 네이버 쇼핑인사이트 식품 분야에서 클릭이 있는지 재둔 값(r[25])으로 거른다.
   0 = 식품 분야 쇼핑 클릭 없음 → 화면 섹션에서 뺀다. 원본 keywords.json 에는 그대로 남는다.
   -1 = 아직 모름 → 글자 규칙대로 둔다. */
let notFood = 0; const notFoodTop = [];
for (const r of R) {
  for (let i = 0; i < SEC.length; i++) if (r[18] & (1 << i)) before[i]++;
  const m = secOf(r[0]);
  if (m && r[25] === 0) { notFood++; if (notFoodTop.length < 400) notFoodTop.push([r[0], (r[1] || 0) + (r[2] || 0)]); r[18] = 0; continue; }
  r[18] = m;
  for (let i = 0; i < SEC.length; i++) if (r[18] & (1 << i)) after[i]++;
}
console.log("섹션별  (접을 때 → 다시 계산)");
SEC.forEach((s, i) => console.log(`  ${s.name.padEnd(14)} ${before[i].toLocaleString().padStart(8)} → ${after[i].toLocaleString().padStart(8)}`));

if (notFood) {
  notFoodTop.sort((a, b) => b[1] - a[1]);
  console.log(`\n식품 아님으로 뺀 것 ${notFood.toLocaleString()}개 (네이버 쇼핑인사이트 식품 분야 클릭 없음)`);
  console.log("  예: " + notFoodTop.slice(0, 30).map(x => x[0]).join(" · "));
}
const keep = R.filter(r => r[18]);
const set = new Set(keep.map(r => r[0]));
console.log(`\n담을 키워드 ${keep.length.toLocaleString()}개`);

fs.mkdirSync(OUT, { recursive: true });
const head = { fetchedAt: H.fetchedAt, freshAt: H.freshAt || "", calls: H.calls, failed: H.failed, cols: H.cols,
               sections: SEC.map(x => ({ id: x.id, name: x.name, naver: x.naver })) };
const w = (f, js) => { fs.writeFileSync(path.join(OUT, f), js, "utf8");
                       console.log(`  → ${f.padEnd(16)} ${MB(Buffer.byteLength(js))}`); };
w("data-head.js", "window.KWHEAD=" + JSON.stringify(head) + ";");
w("data-kw.js",   "window.KWROWS=" + JSON.stringify(keep) + ";");
const sh = {}; for (const [k, v] of Object.entries(S.d)) if (set.has(k)) sh[k] = v;
w("data-shop.js", "window.SHOPDATA=" + JSON.stringify({ ...S, d: sh }) + ";");
const tr = {}; for (const [k, v] of Object.entries(T)) if (set.has(k)) tr[k] = v;
w("data-trend.js", "window.TRENDDATA=" + JSON.stringify(tr) + ";");
w("data-meta.js", "window.TRENDMETA=" + JSON.stringify({ alphabet: META.alphabet, trendWeeks: META.trendWeeks }) + ";");
/* 공급가는 손대지 않고 그대로 넘긴다. 섹션 재계산과 상관없는 자료다. */
if (SUP) w("data-supply.js", "window.SUPPLYDATA=" + JSON.stringify(SUP) + ";");
else console.log("  공급가 없음 — data-supply.js 는 만들지 않는다");
console.log(`\n구매층 ${Object.keys(sh).length.toLocaleString()} · 추세 ${Object.keys(tr).length.toLocaleString()}`);
