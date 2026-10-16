#!/usr/bin/env node
/**
 * pack 폴더 → 화면에 심을 데이터 파일.
 *
 * 섹션 비트를 여기서 다시 계산한다. 수집기 쪽 규칙이 브라우징용으로는 헐거웠다.
 * '롯데시네마' 가 끝의 '마' 한 글자에 걸려 과일·채소로 분류됐다.
 *
 * 네이버 키워드도구가 연관으로 준 키워드는 모두 담는다 (2026-10-16). 섹션에 드는 것은 data-kw.js, 섹션 밖은 data-dict-N.js.
 *
 * 실행:  node build-web.mjs <pack폴더> [출력폴더]
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
/* 폴더 정리 (2026-10-09): 프로그램은 app\ 에, key.txt · naver-out · 넣는곳 은 그 위 폴더에 둔다.
   예전처럼 한 폴더에 다 있어도 그대로 돈다. */
const APPDIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(APPDIR).toLowerCase() === "app" ? path.dirname(APPDIR) : APPDIR;


const PACK = process.argv[2] || path.join(ROOT, "naver-out", "pack");
const OUT  = process.argv[3] || APPDIR;   // 화면 데이터는 화면(keyword-lab.html) 옆에
const MB = n => (n / 1048576).toFixed(2) + " MB";

globalThis.window = {};
for (const f of fs.readdirSync(PACK).filter(x => /^(kw-head|kw-\d+|shop|supply|trend-\d+|click-\d+)\.js$/.test(x)).sort())
  (0, eval)(fs.readFileSync(path.join(PACK, f), "utf8"));
const H = window.KWHEAD, R = window.KWROWS, S = window.SHOPDATA, T = window.TRENDDATA || {}, CK = window.CLICKDATA || {};
const SUP = window.SUPPLYDATA || null;
const META = JSON.parse(fs.readFileSync(path.join(PACK, "meta.json"), "utf8"));
console.log(`읽음  키워드 ${R.length.toLocaleString()} · 추세 ${Object.keys(T).length.toLocaleString()} · 구매층 ${Object.keys(S.d).length.toLocaleString()}`);

/* ── 네이버가 연관으로 준 키워드는 모두 담는다 ──
   보갬 (2026-10-16): "모든 키워드들이 완벽하게 네이버 키워드 도구와 일치해야 한다."
   전에는 섹션 글자 규칙(sections.json)에 걸리는 것만 담아서, 네이버가 사과 목록 9곳에 띄우는 '엔부' 가 화면에 없었다.
   쭈꾸미(월 10만) · 장어 · 맛있는쌀처럼 화면 분류기는 신선식품으로 읽는데 글자 규칙이 놓친 것도 8천 개가 넘었다.
   이제 받아 둔 네이버 목록(품목 씨앗 · 꼬리 키워드 · 키워드별 목록)에 나온 키워드는 전부 담는다.
     섹션   글자 규칙 + (네이버 목록에 나온 키워드라면) 화면 분류기가 신선식품으로 읽는 것
            — 목록에 안 나온 키워드에는 분류기를 쓰지 않는다. 엔비디아주가 → 사과 처럼 엉뚱하게 읽힌다
     자리   섹션에 드는 것은 data-kw.js(황금키워드 표), 섹션 밖은 data-dict-N.js(찾거나 연관 목록에서 볼 때만 읽는다)
     숫자   목록에 같이 온 네이버 값. 화면에 있던 키워드도 목록 쪽이 더 새것이면 그 값으로 바꾼다(새것이 이긴다)
     품목   글자로 못 읽는 키워드는, 그 키워드를 목록에 띄운 씨앗들의 품목이 한 품목으로 모이면(씨앗 5곳 이상 · 80% 이상) 그 품목으로 본다.
            엔부 → 사과 9/9. 섹션에는 넣지 않는다 — 산성 · 케이블카 · 병증 이름도 그렇게 모여서다. 화면의 품목 칸과 연관 단계에만 쓴다 */
const NO = path.join(ROOT, "naver-out");
const rdj = f => { try { return JSON.parse(fs.readFileSync(path.join(NO, f), "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const dayInt = t => { if (!t) return 0; const d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
/* 화면과 같은 분류기 · 의도 규칙 (keyword-lab.html 에서 그대로 꺼낸다) */
const HTML = fs.readFileSync(path.join(APPDIR, "keyword-lab.html"), "utf8").replace(/\r\n/g, "\n");
const c0 = HTML.indexOf("var CAT_VAR="), c1 = HTML.indexOf("/* 줄마다 한 번만 낸다:"), sm = /var SEEDS=(\[[^\n]*\]);/.exec(HTML);
const i0 = HTML.indexOf("var RE_HOWTO_P="), i1 = HTML.indexOf("\n", HTML.indexOf("function intentGuess"));
if (c0 < 0 || c1 < 0 || !sm || i0 < 0 || i1 < 0) { console.error("keyword-lab.html 에서 분류기 · 의도 규칙을 못 찾았다."); process.exit(1); }
const VC = {}; vm.createContext(VC);
vm.runInContext(HTML.slice(c0, c1) + "\n" + HTML.slice(i0, i1) + "\nthis.catMake=catMake;this.CAT_MAP=CAT_MAP;this.intentGuess=intentGuess;", VC);
const CATF = VC.catMake(JSON.parse(sm[1])), CMAP = VC.CAT_MAP, intentGuess = VC.intentGuess;
const nkw = k => String(k).replace(/\s+/g, "").toLowerCase();
const GBIT = { "과일": 1, "채소": 1, "견과류": 2, "쌀/잡곡": 2, "건과류": 2, "수산물": 4, "건어물": 4, "정육": 8, "계란/알류": 8 };
const catBits = kw => { const raw = CATF(nkw(kw)), m = raw && CMAP[raw]; if (!m || m[0].indexOf("신선식품 > ") !== 0) return 0;
  return (GBIT[m[0].slice(7)] || 0) | (m[1] === "과일세트" || m[1] === "축산선물세트" ? 16 : 0); };
const SITEM = new Map();
const seedItem = sd => { if (SITEM.has(sd)) return SITEM.get(sd);
  const raw = CATF(nkw(sd)); let b = CATF.base(); const m0 = raw && CMAP[raw];
  if (!b && m0 && m0[0].indexOf("신선식품") === 0) b = raw;
  const it = b && CMAP[b] && CMAP[b][0].indexOf("신선식품") === 0 ? b : ""; SITEM.set(sd, it); return it; };
/* 받아 둔 목록 */
const LIST = [];
const RR = rdj("related-raw.json"); if (RR) for (const [k, v] of Object.entries(RR.seeds || {})) LIST.push([k, v.at, v.rows]);
const RT = rdj("related-tails.json"); if (RT) for (const [k, v] of Object.entries(RT.seeds || {})) LIST.push([k, v.at, v.rows]);
try {
  const last = new Map();
  for (const line of fs.readFileSync(path.join(NO, "related-more.ndjson"), "utf8").split("\n")) { if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch { continue; }
    const o = last.get(j.k); if (!o || String(j.at) > String(o.at)) last.set(j.k, j); }
  for (const j of last.values()) LIST.push([j.k, j.at, j.rows]);
} catch (e) { if (e.code !== "ENOENT") throw e; }
const NSEED = LIST.length;
/* 목록 밖 키워드를 직접 물은 오늘 값 (fetch-stale.mjs). 씨앗이 아니라 숫자만 — 품목 표에는 안 넣는다 */
try { for (const line of fs.readFileSync(path.join(NO, "related-stats.ndjson"), "utf8").split("\n")) { if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch { continue; } if (j && j.rows) LIST.push(["", j.at, j.rows]); } }
catch (e) { if (e.code !== "ENOENT") throw e; }
const LT = new Map(), VOTE = new Map();   // 키워드 → 가장 새 목록 줄 · 씨앗 품목 표
for (const [sd, at, rows] of LIST) { const it = sd ? seedItem(sd) : "";
  for (const x of rows) { const k = x[0]; const o = LT.get(k); if (!o || String(at) > String(o.at)) LT.set(k, { x, at, seed: sd });
    if (it) { let v = VOTE.get(k); if (!v) VOTE.set(k, v = { items: {}, n: 0 }); v.items[it] = (v.items[it] || 0) + 1; v.n++; } } }
/* 입찰가 · 예상 실적 · 식품 판정 (목록에만 있던 키워드) */
const XB = Object.assign({}, rdj("related-more-extra.json") || {});
for (const [k, v] of Object.entries((RR && RR.extra) || {})) if (!XB[k] || !XB[k].b) XB[k] = v;
const FR = (rdj("fresh.json") || {}).rows || {};
const COMPI = { "낮음": 0, "중간": 1, "높음": 2 };
const BY = new Map(); R.forEach((r, i) => { if (!BY.has(r[0])) BY.set(r[0], i); });
const ADDED = new Set();   // 9월 수집분(pack)에 없고 네이버 목록에서 새로 들인 키워드
let nUpd = 0, nAdd = 0;
for (const [k, o] of LT) {
  const x = o.x, d = dayInt(o.at), i = BY.get(k);
  if (i != null) { const r = R[i];
    if (d > (r[24] || 0)) { for (let q = 1; q <= 8; q++) r[q] = x[q]; r[15] = x[9] ? 1 : 0; r[24] = d; nUpd++; }
    continue; }
  const xb = XB[k] || {}, f = FR[k] || {};
  const row = [k, x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8], ...(xb.b || [0, 0, 0, 0, 0, 0]), x[9] ? 1 : 0, intentGuess(k), o.seed, 0, 0, 0, "",
               ...(xb.m || [0, 0]), d, f.f == null ? -1 : f.f, 0, f.c != null ? f.c : (f.f === 0 ? 0 : -1),
               ...(xb.e && xb.e.length === 10 ? xb.e : [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0])];
  if (f.s && dayInt(f.sAt) > d) { const t = f.s; row[1] = t[0]; row[2] = t[1]; row[15] = t[2] ? 1 : 0; row[5] = t[3]; row[6] = t[4]; row[7] = t[5]; row[8] = t[6]; row[3] = t[7]; row[4] = COMPI[t[8]] ?? row[4]; row[24] = dayInt(f.sAt); }
  if (f.b) for (let q = 0; q < 6; q++) row[9 + q] = f.b[q] || 0;
  if (f.m) { row[22] = f.m[0] || 0; row[23] = f.m[1] || 0; }
  if (f.e && f.e.length === 10) for (let q = 0; q < 10; q++) row[28 + q] = f.e[q];
  R.push(row); BY.set(k, R.length - 1); ADDED.add(k); nAdd++;
}
/* 네이버 이웃 품목 */
const NB = {};
for (const [k, v] of VOTE) { if (v.n < 5 || CATF(nkw(k))) continue;
  let best = "", bc = 0; for (const it in v.items) if (v.items[it] > bc) { bc = v.items[it]; best = it; }
  if (bc / v.n >= 0.8) NB[k] = best; }
console.log(`네이버 목록  씨앗 ${NSEED.toLocaleString()} · 나온 키워드 ${LT.size.toLocaleString()} · 화면 줄 값을 더 새것으로 ${nUpd.toLocaleString()} · 새로 담은 키워드 ${nAdd.toLocaleString()} · 네이버 이웃 품목 ${Object.keys(NB).length.toLocaleString()}`);

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
let notFood = 0; const notFoodTop = []; const SECMOVE = {}, TEXTONLY = [];
for (const r of R) {
  for (let i = 0; i < SEC.length; i++) if (r[18] & (1 << i)) before[i]++;
  /* 섹션: 글자 규칙 + (목록에 나온 키워드라면) 분류기. 분류기가 신선식품 품목을 읽었으면 그 품목의 섹션이 이긴다 —
     글자 규칙은 "곱창" 이 든 곱창김을 축산물에 넣었다. 선물세트(16)는 판매 문맥이라 글자 규칙 쪽을 지킨다 (2026-10-17) */
  const tb = excluded(r[0]) ? 0 : secOf(r[0]), cb = (LT.has(r[0]) || tb) ? catBits(r[0]) : 0;
  /* 네이버 목록에서 새로 들인 키워드는 분류기가 품목을 읽을 때만 (선물세트 16 은 글자 규칙 그대로) */
  const m = cb ? (cb | (tb & 16)) : (ADDED.has(r[0]) ? (tb & 16) : tb);
  if (!cb && ADDED.has(r[0]) && (tb & ~16)) TEXTONLY.push([r[0], (r[1] || 0) + (r[2] || 0)]);
  if (tb && cb && (tb & ~16) !== (cb & ~16)) { const t = (tb & ~16) + "→" + (cb & ~16); const o = SECMOVE[t] || (SECMOVE[t] = { n: 0, ex: [] }); o.n++; if (o.ex.length < 12) o.ex.push(r[0]); }
  if (m && r[25] === 0) { notFood++; if (notFoodTop.length < 400) notFoodTop.push([r[0], (r[1] || 0) + (r[2] || 0)]); r[18] = 0; continue; }
  r[18] = m;
  for (let i = 0; i < SEC.length; i++) if (r[18] & (1 << i)) after[i]++;
}
if (Object.keys(SECMOVE).length) { console.log("분류기 품목을 따라 섹션을 옮긴 것 (1 과일·채소 · 2 곡물 · 4 수산 · 8 축산)");
  for (const [t, o] of Object.entries(SECMOVE).sort((x, y) => y[1].n - x[1].n)) console.log(`  ${t}  ${o.n}개 — ${o.ex.join(", ")}`); }
if (TEXTONLY.length) { TEXTONLY.sort((a, b) => b[1] - a[1]);
  console.log(`글자 규칙에만 걸려 섹션에서 뺀 새 키워드 ${TEXTONLY.length.toLocaleString()}개 (섹션 밖 사전에 남는다) — 예: ` + TEXTONLY.slice(0, 30).map(x => x[0]).join(" · ")); }
console.log("섹션별  (접을 때 → 다시 계산)");
SEC.forEach((s, i) => console.log(`  ${s.name.padEnd(14)} ${before[i].toLocaleString().padStart(8)} → ${after[i].toLocaleString().padStart(8)}`));

if (notFood) {
  notFoodTop.sort((a, b) => b[1] - a[1]);
  console.log(`\n식품 아님으로 뺀 것 ${notFood.toLocaleString()}개 (네이버 쇼핑인사이트 식품 분야 클릭 없음)`);
  console.log("  예: " + notFoodTop.slice(0, 30).map(x => x[0]).join(" · "));
}
const keep = R.filter(r => r[18]);
const set = new Set(keep.map(r => r[0]));
/* 화면 키워드 목록 — 정기 수집이 입찰가 · 예상 실적을 다시 받을 대상 (refresh-naver.mjs --list) */
try { fs.writeFileSync(path.join(NO, "screen-keywords.txt"), keep.map(r => r[0]).join("\n"), "utf8"); } catch {}
console.log(`\n담을 키워드 ${keep.length.toLocaleString()}개`);
/* 섹션 밖이지만 네이버 목록에 나온 키워드 — 찾을 때 · 연관 목록에서 볼 때만 읽는다. 묶음 번호 = 글자 해시 (화면의 dictPart 와 같은 셈) */
const DICT_N = 12, dictPart = k => { let h = 0; const t = String(k).replace(/\s+/g, ""); for (let q = 0; q < t.length; q++) h = (h * 31 + t.charCodeAt(q)) >>> 0; return h % DICT_N; };
const dict = R.filter(r => !r[18] && LT.has(r[0]));
const nb = {}; for (const k in NB) if (set.has(k) || LT.has(k)) nb[k] = NB[k];
console.log(`섹션 밖 · 네이버 목록에 나온 키워드 ${dict.length.toLocaleString()}개 → data-dict-0~${DICT_N - 1}.js`);

fs.mkdirSync(OUT, { recursive: true });
const head = { fetchedAt: H.fetchedAt, freshAt: H.freshAt || "", anchor: H.anchor || null, calls: H.calls, failed: H.failed, cols: H.cols,
               sections: SEC.map(x => ({ id: x.id, name: x.name, naver: x.naver })),
               dictN: DICT_N, dictRows: dict.length, dictAt: new Date().toISOString(), nb };
const w = (f, js) => { fs.writeFileSync(path.join(OUT, f), js, "utf8");
                       console.log(`  → ${f.padEnd(16)} ${MB(Buffer.byteLength(js))}`); };
w("data-head.js", "window.KWHEAD=" + JSON.stringify(head) + ";");
w("data-kw.js",   "window.KWROWS=" + JSON.stringify(keep) + ";");
{ const parts = Array.from({ length: DICT_N }, () => []); for (const r of dict) parts[dictPart(r[0])].push(r);
  let tot = 0; parts.forEach((rows, q) => { const js = "window.KWDICT=window.KWDICT||{};window.KWDICT[" + q + "]=" + JSON.stringify({ at: head.dictAt, rows }) + ";";
    fs.writeFileSync(path.join(OUT, "data-dict-" + q + ".js"), js, "utf8"); tot += Buffer.byteLength(js); });
  console.log(`  → data-dict-0~${DICT_N - 1}.js ${MB(tot)} (${dict.length.toLocaleString()}개)`); }
const sh = {}; for (const [k, v] of Object.entries(S.d)) if (set.has(k)) sh[k] = v;
const shw = {}; for (const [k, v] of Object.entries(S.w || {})) if (set.has(k)) shw[k] = v;
w("data-shop.js", "window.SHOPDATA=" + JSON.stringify({ ...S, d: sh, w: shw }) + ";");
const tr = {}; for (const [k, v] of Object.entries(T)) if (set.has(k)) tr[k] = v;
w("data-trend.js", "window.TRENDDATA=" + JSON.stringify(tr) + ";");
/* 쇼핑 클릭 추세. 새로 받은 추세가 있을 때만 값이 있다. 없어도 빈 파일을 둬서 화면이 404 를 안 맞게 한다 */
const ck = {}; for (const [k, v] of Object.entries(CK)) if (set.has(k)) ck[k] = v;
w("data-click.js", "window.CLICKDATA=" + JSON.stringify(ck) + ";");
w("data-meta.js", "window.TRENDMETA=" + JSON.stringify({ alphabet: META.alphabet, trendWeeks: META.trendWeeks }) + ";");
/* 공급가는 손대지 않고 그대로 넘긴다. 섹션 재계산과 상관없는 자료다. */
if (SUP) w("data-supply.js", "window.SUPPLYDATA=" + JSON.stringify(SUP) + ";");
else console.log("  공급가 없음 — data-supply.js 는 만들지 않는다");
console.log(`\n구매층 ${Object.keys(sh).length.toLocaleString()} · 추세 ${Object.keys(tr).length.toLocaleString()}`);
