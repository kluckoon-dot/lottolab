#!/usr/bin/env node
/**
 * fetch-related-more.mjs 가 받아 둔 키워드별 네이버 연관 목록을 저장된 화면용 묶음 파일로 만든다
 *
 * 규칙
 *   - 목록에서 **씨앗과 품목이 같거나(1) 묶음이 같은(2) 키워드만** 싣는다 (감홍사과 → 사과 키워드 + 다른 과일. 미니오이 · 오이피클은 뺀다).
 *     네이버가 준 순서는 그대로. 화면은 기본으로 같은 품목(1)만 보여 주고 단추로 묶음(2)까지 넓힌다.
 *     네이버가 준 전체 개수는 tot 에 적어 둔다 — 화면이 "387개 중 302개를 실었다" 라고 말할 수 있게.
 *     품목 이름 씨앗(build-related.mjs 의 442개 · 묶음 1~5)은 전부 실려 있으니 "전부" 는 거기서 본다.
 *   - 같은 품목인지는 화면과 같은 분류기로 본다 (keyword-lab.html 에서 그대로 꺼내 쓴다. 아래 tierOf 는 화면의 relTierOf 와 같은 규칙).
 *   - 화면 데이터에 없는 키워드는 응답에 든 검색수 · 클릭 · 클릭률에 입찰가 · 예상 실적을 받아 붙인다 (검색 --min-bid 이상만, 기본 50).
 *   - 묶음 번호는 과일 101~ · 채소 201~ · 견과 · 쌀/잡곡 · 건과 301~ · 수산 401~ · 정육 501~.
 *     같은 품목 씨앗끼리 붙여 한 파일이 너무 커지지 않게 자른다. 화면은 씨앗을 찾을 때 그 파일만 읽는다.
 *     번호를 묶음별로 따로 매기는 까닭: 과일을 다 받아 올린 뒤 채소를 더 받아도 과일 파일은 그대로여야 한다 (브라우저에 남은 옛 파일과 어긋나지 않게).
 *
 * 결과 (app\)   data-rel-101.js …    { at, name, names, lists, extra, tot }
 *               data-relidx.js       씨앗 → 묶음 번호 (1~5 는 그대로 두고 그 밖을 다시 쓴다)
 *
 * 실행:  node build-related-more.mjs              입찰가 · 예상 실적까지 받고 만든다
 *        node build-related-more.mjs --no-fetch   지금 가진 것만으로 만든다
 *        node build-related-more.mjs --stat       세어 보기만
 *        node build-related-more.mjs --groups 1   과일만 (다 받은 묶음만 먼저 올릴 때)
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
const MORE = path.join(OUTDIR, "related-more.ndjson"), XC = path.join(OUTDIR, "related-more-extra.json");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const NOFETCH = args.includes("--no-fetch"), STAT = args.includes("--stat");
const MINBID = +(val("--min-bid") || 50), PART_MAX = +(val("--part") || 1200000), FIRST = 6;
const GROUPS = val("--groups") ? new Set(val("--groups").split(",").map(Number)) : null;

/* ── 분류기 (화면과 같은 코드) ── */
const html = fs.readFileSync(path.join(HERE, "keyword-lab.html"), "utf8").replace(/\r\n/g, "\n");
const a0 = html.indexOf("var CAT_VAR="), b0 = html.indexOf("/* 줄마다 한 번만 낸다:");
const sm = /var SEEDS=(\[[^\n]*\]);/.exec(html);
if (a0 < 0 || b0 < 0 || !sm) { console.error("keyword-lab.html 에서 분류기를 못 찾았다."); process.exit(1); }
const ctx = {}; vm.createContext(ctx); vm.runInContext(html.slice(a0, b0) + "\nthis.catMake=catMake;this.CAT_MAP=CAT_MAP;", ctx);
const cat = ctx.catMake(JSON.parse(sm[1])), MAP = ctx.CAT_MAP;
if (typeof cat.base !== "function") { console.error("keyword-lab.html 의 분류기가 옛것이다 (품목을 알려 주는 base 가 없다)."); process.exit(1); }
const norm = k => String(k).replace(/\s+/g, "").toLowerCase();
const INFO = new Map();
function info(kw) {
  let c = INFO.get(kw); if (c) return c;
  const raw = cat(kw); let b = cat.base(), m;
  if (!b && raw && (m = MAP[raw]) && m[0].indexOf("신선식품") === 0) b = raw;
  m = b ? MAP[b] : (raw ? MAP[raw] : null);
  c = { item: b || "", grp: m ? m[0] : "", raw: raw || "" }; INFO.set(kw, c); return c;
}
/* 화면의 relTierOf 와 같은 규칙: 1 같은 품목 · 2 같은 묶음 · 3 그 밖. 씨앗이 묶음 이름이면(과일선물세트) 그 묶음 전부가 1 */
const REL_GEN = { "과일": 1, "채소": 1, "야채": 1, "농산물": 1, "수산물": 1, "해산물": 1, "생선": 1, "건어물": 1, "축산물": 1, "정육": 1, "고기": 1, "잡곡": 1, "견과류": 1, "건과일": 1 };
function tierOf(seed, S, kw) {
  if (!S.item && !S.raw) return 1;
  if (kw === seed || (seed.length >= 2 && kw.indexOf(seed) >= 0)) return 1;
  const K = info(kw);
  if (S.item) {
    if (K.item === S.item) return 1;
    if (S.item.length >= 2 && kw.indexOf(S.item) >= 0 && !(K.item && K.grp.indexOf("신선식품") === 0)) return 1;   // 고구마말랭이
    return S.grp && K.grp === S.grp ? (REL_GEN[S.item] ? 1 : 2) : 3;
  }
  return K.raw === S.raw ? 1 : 3;
}

/* ── 받아 둔 목록 ── */
if (!fs.existsSync(MORE)) { console.error("받아 둔 목록이 없다. 먼저 node fetch-related-more.mjs"); process.exit(1); }
const seedsRaw = new Map();
for (const line of fs.readFileSync(MORE, "utf8").split("\n")) { if (!line) continue; let j; try { j = JSON.parse(line); } catch { continue; } if (j && j.k && j.rows) seedsRaw.set(j.k, j); }
const require = createRequire(import.meta.url);
globalThis.window = {}; require(path.join(HERE, "data-kw.js"));
const SCREEN = new Map(globalThis.window.KWROWS.map(r => [r[0], (r[1] || 0) + (r[2] || 0)]));
let oldIdx = {}; try { require(path.join(HERE, "data-relidx.js")); oldIdx = globalThis.window.RELIDX.seeds || {}; } catch {}
let FR = {}; try { FR = JSON.parse(fs.readFileSync(path.join(OUTDIR, "fresh.json"), "utf8")).rows || {}; } catch {}
/* 입찰가 · 예상 실적: 전에 받은 것(related-raw.json 의 extra)과 이번에 받는 것 */
let X = {}; try { X = JSON.parse(fs.readFileSync(XC, "utf8")); } catch {}
try { const old = JSON.parse(fs.readFileSync(path.join(OUTDIR, "related-raw.json"), "utf8")).extra || {}; for (const k in old) if (!X[k] && old[k].b) X[k] = { b: old[k].b, m: old[k].m, e: old[k].e }; } catch {}
const saveX = () => { fs.writeFileSync(XC + ".tmp", JSON.stringify(X), "utf8"); fs.renameSync(XC + ".tmp", XC); };

/* ── 1. 같은 품목만 고른다 ── */
const kept = [], stat = new Map(); let rowsAll = 0, rowsKept = 0, rowsSame = 0, dropNoItem = 0, dropShort = 0;
for (const [k, j] of seedsRaw) {
  if (oldIdx[k] && oldIdx[k] < FIRST) continue;                    // 품목 씨앗으로 이미 전부 실려 있다
  if (GROUPS && !GROUPS.has(j.g)) continue;
  const seed = norm(k), S = info(seed);
  if (!S.item && !S.raw) { dropNoItem++; continue; }
  const list = []; const seen = new Set(); let same = 0;
  for (const row of j.rows) { const name = row[0]; if (seen.has(name)) continue; seen.add(name);
    const tr = tierOf(seed, S, norm(name)); if (tr > 2) continue;
    if (tr === 1) same++;
    list.push(name); if (!SCREEN.has(name) && !stat.has(name)) stat.set(name, row); }
  rowsAll += j.rows.length;
  if (same < 2) { dropShort++; continue; }
  rowsKept += list.length; rowsSame += same;
  kept.push({ k, g: j.g, item: S.item || S.raw, vol: SCREEN.get(k) || 0, list, tot: j.rows.length, at: j.at });
}
const newKw = [...stat.keys()];
console.error(`씨앗 ${seedsRaw.size.toLocaleString()} → 싣는 것 ${kept.length.toLocaleString()} (품목을 못 읽음 ${dropNoItem} · 같은 품목이 저 혼자 ${dropShort})`);
console.error(`목록 줄 ${rowsAll.toLocaleString()} → 싣는 줄 ${rowsKept.toLocaleString()} (${(rowsKept / Math.max(1, rowsAll) * 100).toFixed(0)}% · 같은 품목 ${rowsSame.toLocaleString()}) · 화면에 없던 키워드 ${newKw.length.toLocaleString()}`);
const big = newKw.filter(k => (stat.get(k)[1] + stat.get(k)[2]) >= MINBID);
console.error(`  그중 검색 ${MINBID}↑ ${big.length.toLocaleString()} · 입찰가 가진 것 ${big.filter(k => X[k] && X[k].b).length.toLocaleString()}`);
if (STAT) process.exit(0);

/* ── 2. 화면에 없던 키워드의 입찰가 · 예상 실적 ── */
if (!NOFETCH) {
  const o = {}; const AL = { naver_ad_api_key: "KEY", naver_ad_secret: "SECRET", naver_ad_customer: "CUSTOMER" };
  for (const dir of [...new Set([ROOT, process.cwd(), HERE])]) {
    let raw; try { raw = fs.readFileSync(path.join(dir, "key.txt"), "utf8"); } catch { continue; }
    for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) { if (/^\s*#/.test(line)) continue; const i = line.indexOf("="); if (i < 0) continue; const k = AL[line.slice(0, i).trim().toLowerCase()], v = line.slice(i + 1).trim().replace(/^["']|["']$/g, ""); if (k && v) o[k] = v; }
    if (o.KEY) break;
  }
  if (!(o.KEY && o.SECRET && o.CUSTOMER)) { console.error("key.txt 에 검색광고 키(A 칸)가 없다."); process.exit(1); }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function ad(method, p, body) {
    for (let a = 0; a < 5; a++) {
      try {
        const ts = String(Date.now()), sig = crypto.createHmac("sha256", o.SECRET).update(`${ts}.${method}.${p}`).digest("base64");
        const r = await fetch("https://api.searchad.naver.com" + p, { method, headers: { "X-Timestamp": ts, "X-API-KEY": o.KEY, "X-Customer": String(o.CUSTOMER), "X-Signature": sig, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) });
        const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
        if (r.status !== 429 && r.status < 500) return { ok: r.ok, json: j };
      } catch {}
      await sleep(1500 * (a + 1));
    }
    return { ok: false };
  }
  const clean = s => String(s).replace(/\([^)]*\)/g, "").replace(/[\s&/,·]+/g, "");
  const t0 = Date.now();
  const needB = big.filter(k => !(X[k] && X[k].b));
  console.error(`입찰가 받을 것 ${needB.length.toLocaleString()}개`);
  for (let i = 0; i < needB.length; i += 50) {
    const g = needB.slice(i, i + 50), got = {};
    for (const device of ["PC", "MOBILE"]) {
      const items = g.flatMap(k => [1, 2, 3, 5].map(p => ({ key: clean(k).toUpperCase(), position: p })));
      const r = await ad("POST", "/estimate/average-position-bid/keyword", { device, items });
      if (r.ok) for (const e of r.json?.estimate || []) ((got[String(e.keyword).toUpperCase()] ||= { PC: [0, 0, 0, 0, 0], MOBILE: [0, 0, 0, 0, 0] })[device])[e.position - 1] = e.bid || 0;
      await sleep(70);
    }
    for (const k of g) { const b = got[clean(k).toUpperCase()]; X[k] = { b: b ? [...b.PC.slice(0, 3), ...b.MOBILE.slice(0, 3)] : [0, 0, 0, 0, 0, 0], m: b ? [b.PC[4], b.MOBILE[4]] : [0, 0] }; }
    if ((i / 50) % 40 === 0) { saveX(); console.error(`  입찰가 ${Math.min(i + 50, needB.length).toLocaleString()}/${needB.length.toLocaleString()} · ${((Date.now() - t0) / 60000).toFixed(1)}분`); }
  }
  saveX();
  const needE = big.filter(k => X[k] && X[k].b && !X[k].e && (X[k].b[5] || X[k].b[2]));
  console.error(`예상 실적 받을 것 ${needE.length.toLocaleString()}개`);
  const bidOf = v => +v > 0 ? Math.max(70, Math.round(+v / 10) * 10) : 0;
  for (let i = 0; i < needE.length; i += 50) {
    const g = needE.slice(i, i + 50), items = [], seen = new Set();
    const add = (k, device, bid) => { if (!bid) return; const id = clean(k).toUpperCase() + "|" + device + "|" + bid; if (seen.has(id)) return; seen.add(id); items.push({ device, keywordplus: false, keyword: clean(k).toUpperCase(), bid }); };
    for (const k of g) { const b = X[k].b; add(k, "MOBILE", bidOf(b[5])); add(k, "PC", bidOf(b[2])); add(k, "MOBILE", bidOf(b[3])); add(k, "PC", bidOf(b[0])); }
    const r = items.length ? await ad("POST", "/estimate/performance-bulk", { items }) : { ok: false };
    const got = {}; if (r.ok) for (const e of r.json?.items || []) got[String(e.keyword).toUpperCase() + "|" + e.device + "|" + e.bid] = e;
    for (const k of g) { const b = X[k].b, pick = (device, v) => got[clean(k).toUpperCase() + "|" + device + "|" + bidOf(v)] || null, n = (x, f) => x ? Math.round(+x[f] || 0) : 0;
      const m3 = pick("MOBILE", b[5]), p3 = pick("PC", b[2]), m1 = pick("MOBILE", b[3]), p1 = pick("PC", b[0]);
      X[k].e = (m3 || p3 || m1 || p1) ? [n(m3, "clicks"), n(m3, "cost"), n(m3, "impressions"), n(p3, "clicks"), n(p3, "cost"), n(p3, "impressions"), n(m1, "clicks"), n(m1, "cost"), n(p1, "clicks"), n(p1, "cost")] : [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
    if ((i / 50) % 40 === 0) { saveX(); console.error(`  예상 실적 ${Math.min(i + 50, needE.length).toLocaleString()}/${needE.length.toLocaleString()}`); }
    await sleep(60);
  }
  saveX();
}

/* ── 3. 묶음 파일 ── */
const GNAME = { 1: "과일", 2: "채소", 3: "견과 · 쌀/잡곡 · 건과", 4: "수산물 · 건어물", 5: "정육 · 계란" };
kept.sort((x, y) => x.g - y.g || (x.item < y.item ? -1 : x.item > y.item ? 1 : 0) || y.vol - x.vol);
const extraRow = name => { const st = stat.get(name), x = X[name] || {}, f = FR[name], shop = f ? (f.c != null ? f.c : f.f === 0 ? 0 : -1) : -1;
  /* [pc, mo, depth, comp, clickPc, clickMo, ctrPc, ctrMo, bp1, bp2, bp3, bm1, bm2, bm3, masked, ad5pc, ad5mo, shop, 예상실적 10칸] */
  return [...st.slice(1, 9), ...(x.b || [0, 0, 0, 0, 0, 0]), st[9] || 0, ...(x.m || [0, 0]), shop, ...(x.e || [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0])]; };
const day = new Date().toISOString(), idx = {}; for (const k in oldIdx) if (oldIdx[k] < FIRST) idx[k] = oldIdx[k];
let part = null, bytes = 0, files = 0; const seq = {}, wrote = new Set();
const open = g => { seq[g] = (seq[g] || 0) + 1; part = { n: g * 100 + seq[g], g, names: [], nidx: new Map(), lists: {}, extra: {}, tot: {}, size: 0, items: new Set() }; };
const flush = () => { if (!part || !Object.keys(part.lists).length) return;
  const js = `window.RELPART=window.RELPART||{};window.RELPART[${part.n}]=${JSON.stringify({ at: day, name: GNAME[part.g] + " · " + [...part.items].slice(0, 4).join(" · ") + (part.items.size > 4 ? " 외" : ""), names: part.names, lists: part.lists, extra: part.extra, tot: part.tot })};`;
  fs.writeFileSync(path.join(HERE, `data-rel-${part.n}.js`), js, "utf8"); bytes += Buffer.byteLength(js); files++; wrote.add(part.n); };
for (const s of kept) {
  /* 이 씨앗을 넣으면 얼마나 늘어나는가 */
  let add = s.k.length * 2 + 30; const fresh = [];
  for (const name of s.list) { if (!part || !part.nidx.has(name)) { fresh.push(name); add += name.length * 3 + 3 + (SCREEN.has(name) ? 0 : 110); } add += 6; }
  if (!part || part.g !== s.g || (part.size + add > PART_MAX && Object.keys(part.lists).length)) { flush(); open(s.g); }
  const ref = name => { let i = part.nidx.get(name); if (i == null) { i = part.names.length; part.names.push(name); part.nidx.set(name, i); if (!SCREEN.has(name)) part.extra[i] = extraRow(name); } return i; };
  part.lists[s.k] = s.list.map(ref); part.tot[s.k] = s.tot; part.size += add; part.items.add(s.item); idx[s.k] = part.n;
}
flush();
/* 지난번에 더 많았던 묶음 파일은 지운다 */
for (const f of fs.readdirSync(HERE)) { const m = /^data-rel-(\d+)\.js$/.exec(f); if (m && +m[1] >= FIRST && !wrote.has(+m[1])) fs.unlinkSync(path.join(HERE, f)); }
fs.writeFileSync(path.join(HERE, "data-relidx.js"), "window.RELIDX=" + JSON.stringify({ at: day, seeds: idx }) + ";", "utf8");
console.error(`끝  묶음 ${files}개 (${[...wrote].sort((x, y) => x - y).join(" ")}) · ${(bytes / 1048576).toFixed(1)} MB · 씨앗 ${Object.keys(idx).length.toLocaleString()} (품목 ${Object.values(idx).filter(v => v < FIRST).length} + 키워드 ${kept.length.toLocaleString()})`);
