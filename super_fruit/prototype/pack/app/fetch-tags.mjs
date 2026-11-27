#!/usr/bin/env node
/**
 * 태그사전 확인 — 네이버 커머스API (2026-11-27, 보갬 "키워드랩에서 후보로 지정해주는것이 실제로 네이버에 적용되지 않는 태그들이 많아서")
 *
 * 왜
 *   스마트스토어는 네이버 태그사전에 있는 태그만 검색에 반영한다. 키워드랩 태그 후보(상품명 만들기)는 검색광고 키워드를
 *   그대로 써서 사전에 없는 말(절임배추가격 · 농협절임배추)과 사전과 다른 표기(10KG ↔ 사전 10kg)가 섞였다.
 *   11/27 절임배추 10개를 넣어 3개만 반영됐다. 같은 12개를 이 API 로 미리 보면 12개 모두 맞는다(사전 표기로 쓰면).
 *
 * 무엇을 묻나 (커머스API 2.91.0)
 *   GET /v2/tags/recommend-tags?keyword=…  → [{code, text}]  사전에서 그 말로 '시작하는' 태그. 20개까지만 준다.
 *       대소문자 · 띄어쓰기는 가리지 않는다(절임배추10KG → 절임배추10kg).
 *       20개보다 적게 오면 그 말로 시작하는 사전 태그는 그게 전부다 → 그 말로 시작하는 키워드는 묻지 않아도 판정된다.
 *   GET /v2/tags/restricted-tags?tags=a,b,…(50개까지) → [{tag, restricted}]  제한 태그(네이버 · 쿠팡 · 세일 · 남의 상표 · 샤인머스캣 …)
 *   요청량: 초당 2번(버스트 4). 그래서 0.51초에 한 번만 부른다.
 *
 * 차례
 *   1 품목 이름(sections.json terms) — 짧은 말이라 한 번에 많은 키워드가 판정된다
 *   2 섹션 키워드, 검색 많은 것부터
 *   3 섹션 밖 사전 키워드(검색 300 이상), 검색 많은 것부터
 *   4 사전에 있는 태그 중 키워드인 것의 제한 여부(50개씩)
 *   이미 판정된 것은 묻지 않는다. 물은 지 --max-age 일이 지난 것은 다시 묻는다(새로 생긴 사전 태그).
 *
 * 쓰는 것
 *   ../naver-out/tags-dict.json   물은 결과 전부 (다음 회차가 이어받는다 — 멈춰도 된다)
 *   data-tags.js                  화면이 쓰는 것: window.KWTAGS = { at, has, full, part, rx }
 *     has  사전 태그(사전 표기)     full  20개 미만으로 온 말(그 말로 시작하는 사전 태그는 has 에 다 있다)
 *     part 20개 꽉 차게 온 말(그 말 자신이 has 에 없으면 사전에 없다)     rx  제한 태그
 *
 * 실행:  node fetch-tags.mjs [--max-calls 7000] [--max-age 30] [--verify 40] [--build-only]
 * 키:    ../key.txt 의 NAVER_COMMERCE_ID · NAVER_COMMERCE_SECRET (값은 어디에도 찍지 않는다). 없으면 그냥 넘어간다.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(HERE);
const OUTDIR = path.join(ROOT, "naver-out"), CACHE = path.join(OUTDIR, "tags-dict.json"), PAGE = path.join(HERE, "data-tags.js");
const require = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const MAX_CALLS = arg("--max-calls", 7000), MAX_AGE = arg("--max-age", 30), VERIFY = arg("--verify", 0);
const BUILD_ONLY = process.argv.includes("--build-only");
const CAP = 20, GAP = 510, API = "https://api.commerce.naver.com/external";
const norm = s => String(s).replace(/\s+/g, "").toLowerCase();
const today = new Date().toISOString().slice(0, 10), DAY = 864e5;
const old = at => !at || (Date.now() - Date.parse(at)) / DAY > MAX_AGE;

/* ── 결과 저장소 ── */
let C = { v: 1, q: {}, rs: {} };
try { C = Object.assign(C, JSON.parse(fs.readFileSync(CACHE, "utf8"))); } catch {}
const save = () => { fs.mkdirSync(OUTDIR, { recursive: true }); const t = CACHE + ".tmp"; fs.writeFileSync(t, JSON.stringify(C), "utf8"); fs.renameSync(t, CACHE); };

/* 사전 태그 모음 · 판정 */
let HAS = new Map();
const rebuildHas = () => { HAS = new Map(); for (const k in C.q) for (const t of C.q[k].r) HAS.set(norm(t), t); };
rebuildHas();
/* k 가 판정됐나: 직접 물었거나, k 의 앞부분 가운데 20개 미만으로 온 말이 있다 */
function known(k) {
  const x = C.q[k]; if (x && !old(x.at)) return true;
  for (let n = k.length - 1; n >= 1; n--) { const p = C.q[k.slice(0, n)]; if (p && p.r.length < CAP && !old(p.at)) return true; }
  return false;
}
function state(k) {
  if (HAS.has(k)) return "in";
  if (C.q[k]) return "out";
  for (let n = k.length - 1; n >= 1; n--) { const p = C.q[k.slice(0, n)]; if (p && p.r.length < CAP) return "out"; }
  return "?";
}

/* ── 키워드 ── */
globalThis.window = {};
require(path.join(HERE, "data-kw.js")); require(path.join(HERE, "data-head.js"));
const vol = r => (+r[1] || 0) + (+r[2] || 0);
const secRows = window.KWROWS.map(r => [norm(r[0]), vol(r)]).sort((a, b) => b[1] - a[1]);
const SEC = new Set(secRows.map(r => r[0]));
const dictRows = [];
for (let q = 0; q < (window.KWHEAD.dictN || 0); q++) {
  const f = path.join(HERE, "data-dict-" + q + ".js"); if (!fs.existsSync(f)) break;
  require(f); for (const r of window.KWDICT[q].rows) { const v = vol(r); if (v >= 300) { const k = norm(r[0]); if (!SEC.has(k)) dictRows.push([k, v]); } }
  delete window.KWDICT[q];
}
dictRows.sort((a, b) => b[1] - a[1]);
const sec = JSON.parse(fs.readFileSync(path.join(HERE, "sections.json"), "utf8"));
const terms = [...new Set(sec.sections.flatMap(s => s.terms || []).map(norm).filter(k => k && !/[()]/.test(k)))].sort((a, b) => a.length - b.length);
const ok = k => k.length >= 1 && k.length <= 40 && !/[,()]/.test(k);

function writePage() {
  const full = [], part = [];
  for (const k in C.q) (C.q[k].r.length < CAP ? full : part).push(k);
  const rx = Object.keys(C.rs).filter(t => C.rs[t].x);
  const body = { at: new Date().toISOString(), has: [...HAS.values()], full, part, rx };
  const t = PAGE + ".tmp"; fs.writeFileSync(t, "window.KWTAGS=" + JSON.stringify(body) + ";\n", "utf8"); fs.renameSync(t, PAGE);
  const cnt = rows => { let a = 0, i = 0; for (const [k] of rows) { const s = state(k); if (s !== "?") a++; if (s === "in") i++; } return [a, i]; };
  const [sa, si] = cnt(secRows), [da, di] = cnt(dictRows);
  console.log(`  태그사전: 물은 말 ${Object.keys(C.q).length.toLocaleString()} · 사전 태그 ${HAS.size.toLocaleString()} · 제한 태그 ${rx.length.toLocaleString()} · data-tags.js ${(fs.statSync(PAGE).size / 1048576).toFixed(1)} MB`);
  console.log(`  태그사전 판정: 섹션 키워드 ${sa.toLocaleString()} / ${secRows.length.toLocaleString()} (사전에 있음 ${si.toLocaleString()}) · 섹션 밖 300↑ ${da.toLocaleString()} / ${dictRows.length.toLocaleString()} (있음 ${di.toLocaleString()})`);
}
if (BUILD_ONLY) { writePage(); process.exit(0); }

/* ── 키 · 토큰 ── */
const KEYS = {};
for (const dir of [...new Set([ROOT, HERE])]) {
  let raw; try { raw = fs.readFileSync(path.join(dir, "key.txt"), "utf8"); } catch { continue; }
  for (const ln of raw.replace(/^﻿/, "").split(/\r?\n/)) { if (ln.trim().startsWith("#")) continue; const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(ln); if (m && m[2]) KEYS[m[1].toUpperCase()] = m[2]; }
  if (KEYS.NAVER_COMMERCE_ID) break;
}
if (!KEYS.NAVER_COMMERCE_ID || !KEYS.NAVER_COMMERCE_SECRET) {
  console.log("  커머스API 키(key.txt C 칸)가 없어 태그사전은 건너뛴다. 지난번 결과로 화면 파일만 만든다.");
  writePage(); process.exit(0);
}
const bcrypt = require(path.join(HERE, "vendor/bcryptjs/bcrypt.js"));
let TOKEN = null;
async function token() {
  const ts = Date.now() - 3000, id = KEYS.NAVER_COMMERCE_ID;
  const sig = Buffer.from(bcrypt.hashSync(`${id}_${ts}`, KEYS.NAVER_COMMERCE_SECRET), "utf8").toString("base64");
  const r = await fetch(API + "/v1/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, timestamp: String(ts), client_secret_sign: sig, grant_type: "client_credentials", type: "SELF" }) });
  const j = await r.json().catch(() => null);
  if (r.status !== 200 || !j || !j.access_token) throw new Error(`토큰 실패 ${r.status} ${j ? (j.code || "") + " " + (j.message || "") : ""}`);
  TOKEN = j.access_token;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0, last = 0;
const STOP = new Error("stop");
async function get(u) {
  for (let a = 0; a < 6; a++) {
    const w = last + GAP - Date.now(); if (w > 0) await sleep(w); last = Date.now();
    let r, j = null;
    try { r = await fetch(API + u, { headers: { authorization: "Bearer " + TOKEN } }); calls++; j = await r.json().catch(() => null); }
    catch (e) { console.log(`  연결 오류 ${e.cause ? e.cause.code || e.message : e.message} — 다시`); await sleep(3000); continue; }
    if (r.status === 200) return j;
    const code = j && j.code;
    if (r.status === 401 && code === "GW.AUTHN") { await token(); continue; }
    if (r.status === 429) { await sleep(1500 * (a + 1)); continue; }
    if (r.status >= 500) { await sleep(3000); continue; }
    if (r.status === 403) { console.log(`  [!] 403 ${code || ""} ${j && j.message || ""} — ${code === "GW.IP_NOT_ALLOWED" ? "이 PC 의 IP 가 애플리케이션 'API 호출 IP' 에 없다" : "애플리케이션 'API 그룹' 에 상품 권한이 있는지 볼 것"}`); throw STOP; }
    console.log(`  ${r.status} ${code || ""} ${j && j.message || ""} : ${decodeURIComponent(u).slice(0, 80)}`); return null;
  }
  console.log("  [!] 여러 번 다시 해도 안 된다 — 여기서 멈추고 다음 회차가 이어받는다"); throw STOP;
}
async function ask(k) {
  const j = await get(`/v2/tags/recommend-tags?keyword=${encodeURIComponent(k)}`);
  if (!Array.isArray(j)) return;
  C.q[k] = { at: today, r: j.map(x => String(x.text)) };
  for (const t of C.q[k].r) HAS.set(norm(t), t);
}

const t0 = Date.now();
try {
  await token();
  /* 검증: 앞부분으로 판정된 키워드 몇 개를 직접 물어 맞는지 본다 (--verify N) */
  if (VERIFY) {
    const pick = secRows.filter(([k]) => ok(k) && !C.q[k] && state(k) !== "?").slice(0, VERIFY * 5).filter((_, i) => i % 5 === 0);
    let same = 0; const diff = [];
    for (const [k] of pick) { const s0 = state(k); const j = await get(`/v2/tags/recommend-tags?keyword=${encodeURIComponent(k)}`); if (!Array.isArray(j)) continue;
      const s1 = j.some(x => norm(x.text) === k) ? "in" : "out"; if (s0 === s1) same++; else diff.push(`${k} 앞부분판정 ${s0} · 직접 ${s1}`); }
    console.log(`  검증: 앞부분으로 판정한 ${pick.length}개 중 직접 물어도 같은 것 ${same}개`); diff.forEach(d => console.log("    다름 " + d));
  }
  const stages = [["품목 이름", terms.map(k => [k, 0])], ["섹션 키워드", secRows], ["섹션 밖 사전(검색 300 이상)", dictRows]];
  let n0 = 0;
  for (const [label, rows] of stages) {
    let asked = 0;
    for (const [k] of rows) {
      if (calls >= MAX_CALLS) break;
      if (!ok(k) || known(k)) continue;
      await ask(k); asked++;
      if (++n0 % 300 === 0) { save(); console.log(`  … ${label} ${asked.toLocaleString()}번 물음 (전체 ${calls.toLocaleString()}번 · ${((Date.now() - t0) / 60000).toFixed(0)}분)`); }
    }
    console.log(`  ${label}: ${asked.toLocaleString()}번 물음`);
    save();
  }
  /* 제한 태그: 사전 태그 가운데 키워드(섹션 · 300↑)인 것 + 사전에 없는 섹션 키워드 중 검색 1,000 이상
     (샤인머스캣처럼 제한 태그라 사전 목록에 안 나오는 것 — 화면에 "제한 태그" 로 이유를 적는다) */
  const want = [], wantSet = new Set();
  const add = t => { if (!wantSet.has(t) && !(t in C.rs && !old(C.rs[t].at))) { wantSet.add(t); want.push(t); } };
  for (const [k] of secRows.concat(dictRows)) { const t = HAS.get(k); if (t) add(t); }
  for (const [k, v] of secRows) if (v >= 1000 && ok(k) && !HAS.has(k) && state(k) === "out") add(k);
  let rsN = 0;
  for (let i = 0; i < want.length && calls < MAX_CALLS; i += 50) {
    const part = want.slice(i, i + 50), j = await get(`/v2/tags/restricted-tags?tags=${encodeURIComponent(part.join(","))}`);
    if (!Array.isArray(j)) continue;
    const back = new Map(j.map(x => [norm(x.tag), !!x.restricted]));
    for (const t of part) if (back.has(norm(t))) C.rs[t] = { at: today, x: back.get(norm(t)) };
    rsN += part.length;
  }
  console.log(`  제한 태그: ${rsN.toLocaleString()}개 확인 (남은 것 ${Math.max(0, want.length - rsN).toLocaleString()})`);
} catch (e) {
  if (e !== STOP) console.log("  [!] " + e.message);
}
save(); rebuildHas(); writePage();
console.log(`  호출 ${calls.toLocaleString()}번 · ${((Date.now() - t0) / 60000).toFixed(1)}분${calls >= MAX_CALLS ? ` (하루 상한 ${MAX_CALLS.toLocaleString()} — 나머지는 다음 회차)` : ""}`);
