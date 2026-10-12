#!/usr/bin/env node
/**
 * 저장된 화면(claude.ai 페이지)에도 네이버 키워드도구의 연관 목록을 그대로 싣는다 — 신선식품 품목부터
 *
 * 왜
 *   연관키워드는 네이버 키워드도구가 주는 목록으로 보기로 했다(보갬, 2026-10-11).
 *   PC 실시간에서는 찾을 때마다 네이버에 물으니 그대로 나온다. 저장된 화면에는 수집할 때 그 씨앗에서 나온
 *   식품 키워드만 있어서 밤이 32개로 보였다(네이버는 125개를 준다).
 *
 * 무엇을
 *   신선식품 품목 · 품종 이름을 씨앗으로 하나씩 키워드도구에 묻고(씨앗 하나에 한 번), 돌아온 목록을 순서 그대로 적는다.
 *   급한 순서: 1 과일 → 2 채소 → 3 견과 · 쌀/잡곡 · 건과 → 4 수산물 · 건어물 → 5 정육 · 계란
 *   화면 데이터에 없는 키워드는 검색수 · 클릭 · 클릭률(같은 응답) + 1~3 · 5위 입찰가 + 예상 실적을 받아 같이 싣는다.
 *   쇼핑 클릭 지수는 fresh.json 에 있으면 그 값, 없으면 모름(-1)으로 둔다 — HUB 한도를 여기에 쓰지 않는다.
 *
 * 결과 (app\)   data-relidx.js      씨앗 → 묶음 번호
 *               data-rel-1.js … 5   묶음마다: 키워드 이름표 · 씨앗별 목록(이름표 번호) · 화면에 없는 키워드의 숫자
 *   화면은 씨앗을 찾을 때 그 묶음 파일만 읽는다.
 *
 * 실행:  node build-related.mjs            멈추면 이어서 받는다 (naver-out/related-raw.json)
 *        node build-related.mjs --only 1   한 묶음만
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;
const OUTDIR = path.join(ROOT, "naver-out");
const RAW = path.join(OUTDIR, "related-raw.json");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const ONLY = val("--only") ? new Set(val("--only").split(",").map(Number)) : null;
const MAX_AGE_H = +(val("--max-age") || 72);

/* ── 키 ── */
const o = {}; const AL = { naver_ad_api_key: "KEY", naver_ad_secret: "SECRET", naver_ad_customer: "CUSTOMER" };
for (const dir of [...new Set([ROOT, process.cwd(), HERE])]) {
  let raw; try { raw = fs.readFileSync(path.join(dir, "key.txt"), "utf8"); } catch { continue; }
  for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) { if (/^\s*#/.test(line)) continue; const i = line.indexOf("="); if (i < 0) continue; const k = AL[line.slice(0, i).trim().toLowerCase()], v = line.slice(i + 1).trim().replace(/^["']|["']$/g, ""); if (k && v) o[k] = v; }
  if (o.KEY) break;
}
if (!(o.KEY && o.SECRET && o.CUSTOMER)) { console.error("key.txt 에 검색광고 키(A 칸)가 없다."); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;
async function ad(method, p, { qs, body } = {}) {
  for (let a = 0; a < 5; a++) {
    calls++;
    try {
      const ts = String(Date.now()), sig = crypto.createHmac("sha256", o.SECRET).update(`${ts}.${method}.${p}`).digest("base64");
      const r = await fetch("https://api.searchad.naver.com" + p + (qs || ""), { method, headers: { "X-Timestamp": ts, "X-API-KEY": o.KEY, "X-Customer": String(o.CUSTOMER), "X-Signature": sig, "Content-Type": "application/json; charset=UTF-8" }, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      if (r.status !== 429 && r.status < 500) return { ok: r.ok, status: r.status, json: j, text: t.slice(0, 160) };
    } catch {}
    await sleep(1500 * (a + 1));
  }
  return { ok: false, status: 429 };
}
const num = v => typeof v === "number" ? v : (parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10) || 0);
const masked = v => typeof v === "string" && /</.test(v);
const clean = s => String(s).replace(/\([^)]*\)/g, "").replace(/[\s&/,·]+/g, "");
const COMPI = { "낮음": 0, "중간": 1, "높음": 2 };

/* ── 씨앗: 화면의 신선식품 분류표에서 품목 · 품종 이름을 뽑는다 ── */
const html = fs.readFileSync(path.join(HERE, "keyword-lab.html"), "utf8").replace(/\r\n/g, "\n");
const a0 = html.indexOf("var CAT_VAR="), b0 = html.indexOf("/* 김치는 종류가 곧 네이버 끝 칸이다");
if (a0 < 0 || b0 < 0) { console.error("keyword-lab.html 에서 분류표를 못 찾았다."); process.exit(1); }
const ctx = {}; vm.createContext(ctx); vm.runInContext(html.slice(a0, b0) + "\nthis.CAT_FRESH=CAT_FRESH;this.CAT_VAR=CAT_VAR;this.CAT_MAP=CAT_MAP;", ctx);
const GROUP = { "과일": 1, "채소": 2, "견과류": 3, "쌀/잡곡": 3, "건과류": 3, "수산물": 4, "건어물": 4, "정육": 5, "계란/알류": 5 };
const GNAME = { 1: "과일", 2: "채소", 3: "견과 · 쌀/잡곡 · 건과", 4: "수산물 · 건어물", 5: "정육 · 계란" };
const HEAD = { 1: ["과일"], 2: ["채소", "야채"], 3: ["견과류", "쌀", "잡곡", "건과일"], 4: ["수산물", "해산물", "생선", "건어물"], 5: ["소고기", "한우", "돼지고기", "닭고기", "계란", "달걀"] };
const seedG = new Map();
const addSeed = (k, g) => { if (String(k).includes("/")) return; k = clean(k); if (!k || (/^기타|류$|세트$/.test(k) && k.length > 3)) return; if (!seedG.has(k)) seedG.set(k, g); };
for (const g of [1, 2, 3, 4, 5]) {
  for (const h of HEAD[g]) addSeed(h, g);
  for (const [grp, leaf, items] of ctx.CAT_FRESH) { if (GROUP[grp] !== g) continue;
    for (const part of leaf.split("/")) if (!/^기타|류$/.test(part)) addSeed(part, g);
    for (const it of items.split(" ")) addSeed(it, g); }
  /* 품종 · 부위 이름 (부사 · 샤인머스캣 · 살치살 …) */
  for (const [k, v] of Object.entries(ctx.CAT_VAR)) { const m = ctx.CAT_MAP[v]; if (m && GROUP[m[0].replace("신선식품 > ", "")] === g) addSeed(k, g); }
}
let seeds = [...seedG.entries()].filter(([, g]) => !ONLY || ONLY.has(g));
console.error(`씨앗 ${seeds.length}개 · ` + [1, 2, 3, 4, 5].map(g => GNAME[g] + " " + seeds.filter(x => x[1] === g).length).join(" · "));

/* ── 1. 씨앗마다 키워드도구 ── */
let R = { rule: "씨앗 하나에 한 번 물은 응답 그대로. rows = [kw, pc, mo, depth, comp, clickPc, clickMo, ctrPc, ctrMo, masked]", seeds: {} };
try { R = JSON.parse(fs.readFileSync(RAW, "utf8")); R.seeds ||= {}; } catch {}
const saveRaw = () => { fs.mkdirSync(OUTDIR, { recursive: true }); fs.writeFileSync(RAW + ".tmp", JSON.stringify(R), "utf8"); fs.renameSync(RAW + ".tmp", RAW); };
const freshSeed = k => R.seeds[k] && (Date.now() - Date.parse(R.seeds[k].at)) < MAX_AGE_H * 3600e3;
let done = 0; const t0 = Date.now(), todo = seeds.filter(([k]) => !freshSeed(k));
console.error(`키워드도구 연관  ${todo.length}개 씨앗을 묻는다`);
for (const [k] of todo) {
  const r = await ad("GET", "/keywordstool", { qs: "?hintKeywords=" + encodeURIComponent(k.slice(0, 20)) + "&showDetail=1" });
  if (r.ok) R.seeds[k] = { at: new Date().toISOString(), rows: (r.json?.keywordList || []).map(x => [x.relKeyword, num(x.monthlyPcQcCnt), num(x.monthlyMobileQcCnt), +x.plAvgDepth || 0, COMPI[x.compIdx] || 0,
    +x.monthlyAvePcClkCnt || 0, +x.monthlyAveMobileClkCnt || 0, +x.monthlyAvePcCtr || 0, +x.monthlyAveMobileCtr || 0, masked(x.monthlyPcQcCnt) || masked(x.monthlyMobileQcCnt) ? 1 : 0]) };
  else R.seeds[k] = { at: new Date().toISOString(), rows: [], err: r.status };
  if (++done % 40 === 0) { saveRaw(); console.error(`  ${done}/${todo.length} · ${((Date.now() - t0) / 60000).toFixed(1)}분`); }
  await sleep(160);
}
saveRaw();

/* ── 2. 화면에 없는 키워드: 입찰가 · 예상 실적 ── */
const require = createRequire(import.meta.url);
globalThis.window = {}; require(path.join(HERE, "data-kw.js")); const SCREEN = new Set(globalThis.window.KWROWS.map(r => r[0]));
let FR = {}; try { FR = JSON.parse(fs.readFileSync(path.join(OUTDIR, "fresh.json"), "utf8")).rows || {}; } catch {}
R.extra ||= {};                                  // kw → { st:[…], b:[pc1,pc2,pc3,mo1,mo2,mo3], m:[pc5,mo5], e:[…10], at }
/* 꼬리 키워드 (fetch-tails.mjs): 품목 이름에 1kg · 가격 · 국내산 … 을 붙여 직접 물어 찾은 것. 연관 목록 뒤에 붙인다 */
let TAILS = {}; try { TAILS = JSON.parse(fs.readFileSync(path.join(OUTDIR, "related-tails.json"), "utf8")).seeds || {}; } catch {}
const stat = {}; for (const [k] of seeds) { for (const row of (R.seeds[k]?.rows || [])) if (!SCREEN.has(row[0])) stat[row[0]] = row;
  for (const row of (TAILS[k]?.rows || [])) if (!SCREEN.has(row[0]) && !stat[row[0]]) stat[row[0]] = row; }
const exList = Object.keys(stat);
for (const k of exList) (R.extra[k] ||= {}).st = stat[k].slice(1);
const needB = exList.filter(k => !R.extra[k].b);
console.error(`화면에 없는 키워드 ${exList.length.toLocaleString()}개 · 입찰가 받을 것 ${needB.length.toLocaleString()}개`);
for (let i = 0; i < needB.length; i += 50) {
  const g = needB.slice(i, i + 50), got = {};
  for (const device of ["PC", "MOBILE"]) {
    const items = g.flatMap(k => [1, 2, 3, 5].map(p => ({ key: clean(k).toUpperCase(), position: p })));
    const r = await ad("POST", "/estimate/average-position-bid/keyword", { body: { device, items } });
    if (r.ok) for (const e of r.json?.estimate || []) ((got[String(e.keyword).toUpperCase()] ||= { PC: [0, 0, 0, 0, 0], MOBILE: [0, 0, 0, 0, 0] })[device])[e.position - 1] = e.bid || 0;
    await sleep(70);
  }
  for (const k of g) { const b = got[clean(k).toUpperCase()]; R.extra[k].b = b ? [...b.PC.slice(0, 3), ...b.MOBILE.slice(0, 3)] : [0, 0, 0, 0, 0, 0]; R.extra[k].m = b ? [b.PC[4], b.MOBILE[4]] : [0, 0]; }
  if ((i / 50) % 40 === 0) { saveRaw(); console.error(`  입찰가 ${Math.min(i + 50, needB.length).toLocaleString()}/${needB.length.toLocaleString()}`); }
}
saveRaw();
const needE = exList.filter(k => !R.extra[k].e && R.extra[k].b && (R.extra[k].b[5] || R.extra[k].b[2]));
console.error(`예상 실적 받을 것 ${needE.length.toLocaleString()}개`);
const bidOf = v => +v > 0 ? Math.max(70, Math.round(+v / 10) * 10) : 0;
for (let i = 0; i < needE.length; i += 50) {
  const g = needE.slice(i, i + 50), items = [], seen = new Set();
  const add = (k, device, bid) => { if (!bid) return; const id = clean(k).toUpperCase() + "|" + device + "|" + bid; if (seen.has(id)) return; seen.add(id); items.push({ device, keywordplus: false, keyword: clean(k).toUpperCase(), bid }); };
  for (const k of g) { const b = R.extra[k].b; add(k, "MOBILE", bidOf(b[5])); add(k, "PC", bidOf(b[2])); add(k, "MOBILE", bidOf(b[3])); add(k, "PC", bidOf(b[0])); }
  const r = items.length ? await ad("POST", "/estimate/performance-bulk", { body: { items } }) : { ok: false };
  const got = {}; if (r.ok) for (const e of r.json?.items || []) got[String(e.keyword).toUpperCase() + "|" + e.device + "|" + e.bid] = e;
  for (const k of g) { const b = R.extra[k].b, pick = (device, v) => got[clean(k).toUpperCase() + "|" + device + "|" + bidOf(v)] || null, n = (x, f) => x ? Math.round(+x[f] || 0) : 0;
    const m3 = pick("MOBILE", b[5]), p3 = pick("PC", b[2]), m1 = pick("MOBILE", b[3]), p1 = pick("PC", b[0]);
    R.extra[k].e = (m3 || p3 || m1 || p1) ? [n(m3, "clicks"), n(m3, "cost"), n(m3, "impressions"), n(p3, "clicks"), n(p3, "cost"), n(p3, "impressions"), n(m1, "clicks"), n(m1, "cost"), n(p1, "clicks"), n(p1, "cost")] : [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
  if ((i / 50) % 40 === 0) saveRaw();
  await sleep(60);
}
saveRaw();

/* ── 3. 묶음 파일로 ── */
const day = new Date().toISOString();
const idx = {}; let total = 0, bytes = 0, tailN = 0;
for (const g of [1, 2, 3, 4, 5]) {
  const mine = [...seedG.entries()].filter(x => x[1] === g && R.seeds[x[0]] && R.seeds[x[0]].rows.length > 1);
  if (!mine.length) continue;
  const names = [], nidx = new Map(), ref = k => { let i = nidx.get(k); if (i == null) { i = names.length; names.push(k); nidx.set(k, i); } return i; };
  const lists = {}, extra = {}, tails = {};
  const putExtra = kw => { if (SCREEN.has(kw) || extra[nidx.get(kw)]) return; const x = R.extra[kw]; if (!x) return;
    const f = FR[kw], shop = f ? (f.c != null ? f.c : f.f === 0 ? 0 : -1) : -1;
    extra[nidx.get(kw)] = [...x.st.slice(0, 8), ...(x.b || [0, 0, 0, 0, 0, 0]), x.st[8] || 0, ...(x.m || [0, 0]), shop, ...(x.e || [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0])]; };
  for (const [k] of mine) {
    lists[k] = R.seeds[k].rows.map(row => ref(row[0])); idx[k] = g; total += lists[k].length;
    for (const row of R.seeds[k].rows) putExtra(row[0]);
    /* 네이버 목록에 없던 꼬리 키워드만 뒤에 붙인다 */
    const have = new Set(lists[k]), tl = [];
    for (const row of (TAILS[k]?.rows || [])) { const i = ref(row[0]); if (have.has(i)) continue; have.add(i); tl.push(i); putExtra(row[0]); }
    if (tl.length) { tails[k] = tl; tailN += tl.length; }
  }
  /* extra 한 줄 = [pc, mo, depth, comp, clickPc, clickMo, ctrPc, ctrMo, bp1, bp2, bp3, bm1, bm2, bm3, masked, ad5pc, ad5mo, shop, 예상실적 10칸] */
  const js = `window.RELPART=window.RELPART||{};window.RELPART[${g}]=${JSON.stringify({ at: day, name: GNAME[g], names, lists, extra, tails })};`;
  fs.writeFileSync(path.join(HERE, `data-rel-${g}.js`), js, "utf8"); bytes += Buffer.byteLength(js);
  console.error(`  data-rel-${g}.js  ${GNAME[g].padEnd(16)} 씨앗 ${String(mine.length).padStart(4)} · 키워드 ${names.length.toLocaleString().padStart(7)} · 화면에 없던 것 ${Object.keys(extra).length.toLocaleString().padStart(7)} · ${(Buffer.byteLength(js) / 1048576).toFixed(2)} MB`);
}
/* 키워드별 목록(build-related-more.mjs · 묶음 6 이상)은 그대로 둔다 */
try { globalThis.window = {}; require(path.join(HERE, "data-relidx.js")); const old = globalThis.window.RELIDX.seeds || {}; for (const k in old) if (old[k] > 5 && !idx[k]) idx[k] = old[k]; } catch {}
fs.writeFileSync(path.join(HERE, "data-relidx.js"), "window.RELIDX=" + JSON.stringify({ at: day, seeds: idx }) + ";", "utf8");
console.error(`끝  ${((Date.now() - t0) / 60000).toFixed(1)}분 · 호출 ${calls.toLocaleString()} · 씨앗 ${Object.keys(idx).length} · 목록 줄 ${total.toLocaleString()} · 꼬리 키워드 ${tailN.toLocaleString()} · 합 ${(bytes / 1048576).toFixed(1)} MB`);
