#!/usr/bin/env node
/**
 * 화면 키워드를 오늘 값으로 다시 받는다 — 최신값 층(naver-out/fresh.json)
 *
 * 왜 따로 두나
 *   keywords.json 은 9월 11~14일에 받은 것이고, 같은 키워드를 다시 받아도 첫 값을 지켰다
 *   (새 값은 seenAlso 에만 적었다). 배선물세트가 9/11 4,430 으로 남고 9/14 의 6,200 은 묻혔다.
 *   그래서 화면이 아이템스카우트·네이버 키워드도구와 날짜부터 어긋났다.
 *   원본은 그대로 두고, 그 위에 "언제 받은 값인지" 가 붙은 최신값을 덮는다. 새것이 이긴다.
 *
 * 받는 것 (전부 네이버 공식 API)
 *   stats  검색광고 /keywordstool              검색수 PC·모바일 · 클릭수 · 클릭률 · 광고 깊이 · 경쟁정도
 *   bids   /estimate/average-position-bid      1~3위 평균 입찰가 PC·모바일
 *   med    /estimate/median-bid (MONTH)        중간 입찰가 PC·모바일 — 아이템스카우트 "광고 단가" 후보
 *   food   API HUB 쇼핑인사이트 (식품 50000006)  식품 분야에서 쇼핑 클릭이 있는가
 *          롯데시네마 · 룰루레몬 · 멜론티켓 은 "없음", 청도반시 · 레몬 은 "있음" 으로 갈린다.
 *          글자로 섹션을 나누다 끼어든 식품 아닌 키워드를 네이버 기준으로 걸러낸다.
 *
 * 실행 (수집기 폴더에서)
 *   node refresh-naver.mjs                          화면 목록 전부, 네 가지 다
 *   node refresh-naver.mjs --steps stats,med        고른 것만
 *   node refresh-naver.mjs --keywords 청도반시,나주배
 *   node refresh-naver.mjs --list 목록.txt
 *   node refresh-naver.mjs --max-age 6              6시간 안에 받은 것은 건너뛴다 (기본 12)
 * 멈춰도 다시 실행하면 남은 것만 받는다.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;   // 폴더 정리: 데이터·키는 app 위
const OUTDIR = path.join(ROOT, "naver-out");
const OUT = path.join(OUTDIR, "fresh.json");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const STEPS = new Set((val("--steps") || "stats,bids,med,food").split(","));
const MAX_AGE_H = +(val("--max-age") || 12);
const LIMIT = +(val("--limit") || 0);

/* ── 키 ── live-server.mjs 와 같은 규칙 */
const ALIAS = {
  naver_ad_api_key: "KEY", 액세스라이선스: "KEY", 라이선스: "KEY", apikey: "KEY", api_key: "KEY",
  naver_ad_secret: "SECRET", 비밀키: "SECRET", secret: "SECRET", secretkey: "SECRET",
  naver_ad_customer: "CUSTOMER", 고객id: "CUSTOMER", 고객아이디: "CUSTOMER", customerid: "CUSTOMER", customer_id: "CUSTOMER", customer: "CUSTOMER",
  naver_hub_id: "HUB_ID", hub_client_id: "HUB_ID", clientid: "HUB_ID", client_id: "HUB_ID", 허브id: "HUB_ID", 허브아이디: "HUB_ID",
  naver_hub_secret: "HUB_SECRET", hub_client_secret: "HUB_SECRET", clientsecret: "HUB_SECRET", client_secret: "HUB_SECRET", 허브시크릿: "HUB_SECRET"
};
function loadKeys() {
  for (const dir of [...new Set([ROOT, process.cwd(), HERE])]) for (const name of ["key.txt", ".env"]) {
    let raw; try { raw = fs.readFileSync(path.join(dir, name), "utf8"); } catch { continue; }
    const out = {};
    for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) {
      const t = line.trim(); if (!t || t.startsWith("#") || t.startsWith("//")) continue;
      const i = t.indexOf("="); if (i < 0) continue;
      const k = t.slice(0, i).trim().toLowerCase().replace(/[\s-]/g, "");
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (ALIAS[k] && v && !/여기에|붙여넣|paste|<|>/.test(v)) out[ALIAS[k]] = v;
    }
    if (Object.keys(out).length) return out;
  }
  return {};
}
const FK = loadKeys();
const KEY = FK.KEY, SECRET = FK.SECRET, CUSTOMER = FK.CUSTOMER, HUB_ID = FK.HUB_ID, HUB_SECRET = FK.HUB_SECRET;
const safe = t => { let s = String(t ?? ""); for (const v of [KEY, SECRET, CUSTOMER, HUB_ID, HUB_SECRET]) if (v && String(v).length >= 6) s = s.split(v).join("<가림>"); return s; };
if (!(KEY && SECRET && CUSTOMER)) { console.error("key.txt 에 검색광고 키가 없다."); process.exit(1); }
if (STEPS.has("food") && !(HUB_ID && HUB_SECRET)) { console.error("API HUB 키가 없어 food 는 건너뛴다."); STEPS.delete("food"); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function ad(method, p, { qs = "", body } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ts = Date.now().toString();
    const sig = crypto.createHmac("sha256", SECRET).update(`${ts}.${method}.${p}`).digest("base64");
    try {
      const r = await fetch("https://api.searchad.naver.com" + p + qs, { method, body: body ? JSON.stringify(body) : undefined,
        headers: { "X-Timestamp": ts, "X-API-KEY": KEY, "X-Customer": String(CUSTOMER), "X-Signature": sig, "Content-Type": "application/json; charset=UTF-8" } });
      const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      return { ok: r.ok, status: r.status, json, text };
    } catch (e) { await sleep(2000 * (attempt + 1)); }
  }
  return { ok: false, status: "재시도 실패", json: null, text: "" };
}
async function hub(p, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch("https://naverapihub.apigw.ntruss.com" + p, { method: "POST", body: JSON.stringify(body),
        headers: { "X-NCP-APIGW-API-KEY-ID": HUB_ID, "X-NCP-APIGW-API-KEY": HUB_SECRET, "Content-Type": "application/json" } });
      const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      return { ok: r.ok && !(json && (json.errorCode || json.errorMessage)), status: r.status, json, text };
    } catch (e) { await sleep(2000 * (attempt + 1)); }
  }
  return { ok: false, status: "재시도 실패", json: null, text: "" };
}

const num = v => typeof v === "number" ? v : (parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10) || 0);
const masked = v => typeof v === "string" && /</.test(v);
/* 힌트에는 공백·& · / 가 들어가면 400 이 난다. 네이버는 띄어쓰기를 지운 키워드로 돌려준다. */
const clean = s => String(s).replace(/\([^)]*\)/g, "").replace(/[\s&/,·]+/g, "").toUpperCase();

/* ── 대상 ── */
let targets;
if (val("--keywords")) targets = val("--keywords").split(",").map(x => x.trim()).filter(Boolean);
else {
  const f = val("--list") || path.join(OUTDIR, "section-keywords.txt");
  try { targets = fs.readFileSync(f, "utf8").split(/\r?\n/).map(x => x.trim()).filter(Boolean); }
  catch { console.error(f + " 을 못 읽었다. 16b-pack-sections.bat 을 먼저 돌리거나 --keywords 로 줘라."); process.exit(1); }
}
targets = [...new Set(targets)];
if (LIMIT) targets = targets.slice(0, LIMIT);

/* ── 최신값 층 ── */
let F = { rule: "같은 키워드를 다시 받으면 새 값이 이긴다. 값마다 받은 시각을 남긴다.", rows: {} };
try { F = JSON.parse(fs.readFileSync(OUT, "utf8")); F.rows ||= {}; } catch {}
F.startedAt = new Date().toISOString();
const row = k => (F.rows[k] ||= {});
const fresh = (k, field) => { const r = F.rows[k]; return r && r[field] && (Date.now() - Date.parse(r[field])) < MAX_AGE_H * 3600e3; };
let dirty = 0;
function save(force) {
  if (!force && dirty < 200) return;
  F.savedAt = new Date().toISOString();
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(OUT + ".tmp", JSON.stringify(F), "utf8");
  fs.renameSync(OUT + ".tmp", OUT);
  dirty = 0;
}
const stat = { calls: 0, statsHit: 0, statsMiss: 0, bids: 0, med: 0, food: 0, foodNo: 0, fail: [] };

/* 1. 검색수·클릭 — 5개씩. 돌아온 줄 중 대상에 있는 것은 전부 같은 시각으로 갱신한다 */
async function doStats() {
  const byClean = new Map();
  for (const k of targets) { const c = clean(k); if (!byClean.has(c)) byClean.set(c, []); byClean.get(c).push(k); }
  const todo = () => targets.filter(k => !fresh(k, "sAt") && !(F.rows[k] && F.rows[k].sMissAt && fresh(k, "sMissAt")));
  let list = todo();
  console.error(`검색수·클릭  ${list.length.toLocaleString()}개 남음`);
  let i = 0;
  while (i < list.length) {
    const group = [];
    while (group.length < 5 && i < list.length) { const k = list[i++]; if (!fresh(k, "sAt") && clean(k) && clean(k).length <= 40) group.push(k); }
    if (!group.length) continue;
    const hints = [...new Set(group.map(clean))];
    const call = hs => ad("GET", "/keywordstool", { qs: "?hintKeywords=" + hs.map(encodeURIComponent).join(",") + "&showDetail=1" });
    let r = await call(hints);
    stat.calls++;
    const at = new Date().toISOString();
    let rows = r.ok ? (r.json?.keywordList || []) : null;
    if (!r.ok && r.status === 400 && hints.length > 1) {
      /* 묶음 중 하나가 400 을 부르면 묶음 전체가 실패한다. 하나씩 다시 부른다 */
      rows = [];
      for (const h of hints) { const one = await call([h]); stat.calls++; if (one.ok) rows.push(...(one.json?.keywordList || [])); await sleep(120); }
    } else if (!r.ok) stat.fail.push({ step: "stats", kws: group, status: r.status, text: safe(r.text).slice(0, 120) });
    for (const x of rows || []) {
      const ks = byClean.get(clean(x.relKeyword)); if (!ks) continue;
      for (const k of ks) {
        const o = row(k);
        o.s = [num(x.monthlyPcQcCnt), num(x.monthlyMobileQcCnt), masked(x.monthlyPcQcCnt) || masked(x.monthlyMobileQcCnt) ? 1 : 0,
               +x.monthlyAvePcClkCnt || 0, +x.monthlyAveMobileClkCnt || 0, +x.monthlyAvePcCtr || 0, +x.monthlyAveMobileCtr || 0,
               num(x.plAvgDepth), x.compIdx || ""];
        o.sAt = at; delete o.sMissAt; dirty++; stat.statsHit++;
      }
    }
    if (rows) for (const k of group) if (!fresh(k, "sAt")) { row(k).sMissAt = at; dirty++; stat.statsMiss++; }
    if (stat.calls % 100 === 0) console.error(`  호출 ${stat.calls} · 갱신 ${stat.statsHit.toLocaleString()} · 못 받음 ${stat.statsMiss} · 진행 ${Math.min(i, list.length).toLocaleString()}/${list.length.toLocaleString()}`);
    save();
    await sleep(120);
  }
  save(true);
}

/* 2. 1~3위 입찰가 — 50개씩, PC·모바일 */
async function doBids() {
  const list = targets.filter(k => !fresh(k, "bAt"));
  console.error(`1~3위 입찰가  ${list.length.toLocaleString()}개`);
  for (let i = 0; i < list.length; i += 50) {
    const g = list.slice(i, i + 50);
    const got = {};
    for (const device of ["PC", "MOBILE"]) {
      const items = g.flatMap(k => [1, 2, 3].map(p => ({ key: clean(k), position: p })));
      const r = await ad("POST", "/estimate/average-position-bid/keyword", { body: { device, items } });
      stat.calls++;
      if (!r.ok) { stat.fail.push({ step: "bids", n: g.length, status: r.status, text: safe(r.text).slice(0, 120) }); continue; }
      for (const e of r.json?.estimate || []) ((got[clean(e.keyword)] ||= { PC: [null, null, null], MOBILE: [null, null, null] })[device])[e.position - 1] = e.bid;
      await sleep(80);
    }
    const at = new Date().toISOString();
    for (const k of g) { const b = got[clean(k)]; if (!b) continue; const o = row(k); o.b = [...b.PC, ...b.MOBILE]; o.bAt = at; dirty++; stat.bids++; }
    if ((i / 50) % 40 === 0) console.error(`  입찰가 ${Math.min(i + 50, list.length).toLocaleString()}/${list.length.toLocaleString()}`);
    save();
  }
  save(true);
}

/* 3. 중간 입찰가 — 200개씩, PC·모바일, 최근 한 달 */
async function doMed() {
  const list = targets.filter(k => !fresh(k, "mAt"));
  console.error(`중간 입찰가  ${list.length.toLocaleString()}개`);
  for (let i = 0; i < list.length; i += 200) {
    const g = list.slice(i, i + 200);
    const got = {};
    for (const device of ["PC", "MOBILE"]) {
      const r = await ad("POST", "/estimate/median-bid/keyword", { body: { device, period: "MONTH", items: g.map(clean) } });
      stat.calls++;
      if (!r.ok) { stat.fail.push({ step: "med", n: g.length, status: r.status, text: safe(r.text).slice(0, 120) }); continue; }
      for (const e of r.json?.estimate || []) (got[clean(e.keyword || e.key)] ||= {})[device] = e.bid;
      await sleep(80);
    }
    const at = new Date().toISOString();
    for (const k of g) { const m = got[clean(k)]; if (!m) continue; const o = row(k); o.m = [m.PC ?? null, m.MOBILE ?? null]; o.mAt = at; dirty++; stat.med++; }
    save();
  }
  save(true);
}

/* 4. 식품 쇼핑 클릭 — API HUB 쇼핑인사이트, 5개씩. 최근 한 달 클릭이 한 번이라도 잡히면 1 */
async function doFood() {
  const list = targets.filter(k => !fresh(k, "fAt") || F.rows[k].f == null);
  const end = new Date(Date.now() - 864e5), start = new Date(Date.now() - 31 * 864e5);
  const ymd = d => d.toISOString().slice(0, 10);
  console.error(`식품 쇼핑 클릭  ${list.length.toLocaleString()}개 (API HUB 월 한도 안에서)`);
  for (let i = 0; i < list.length; i += 5) {
    const g = list.slice(i, i + 5);
    const r = await hub("/shopping/v1/category/keywords", { startDate: ymd(start), endDate: ymd(end), timeUnit: "month", category: "50000006",
      keyword: g.map(k => ({ name: k, param: [clean(k)] })) });
    stat.calls++;
    if (!r.ok) { stat.fail.push({ step: "food", kws: g, status: r.status, text: safe(r.text).slice(0, 120) }); if (r.status === 429 || r.status === 401 || r.status === 403) break; continue; }
    const at = new Date().toISOString();
    for (const res of r.json?.results || []) {
      const k = res.title; if (!g.includes(k)) continue;
      const hit = (res.data || []).some(d => +d.ratio > 0);
      const o = row(k); o.f = hit ? 1 : 0; o.fAt = at; dirty++; stat.food++; if (!hit) stat.foodNo++;
    }
    if ((i / 5) % 400 === 0) console.error(`  식품 ${Math.min(i + 5, list.length).toLocaleString()}/${list.length.toLocaleString()} · 식품 아님 ${stat.foodNo}`);
    save();
    await sleep(60);
  }
  save(true);
}

console.error(`\n대상 ${targets.length.toLocaleString()}개 · 단계 ${[...STEPS].join(", ")} · ${MAX_AGE_H}시간 안에 받은 값은 건너뜀\n`);
const t0 = Date.now();
/* 검색광고 쪽(stats → bids → med)은 한 줄로, HUB(food)는 옆줄로 같이 돈다 */
await Promise.all([
  (async () => { if (STEPS.has("stats")) await doStats(); if (STEPS.has("med")) await doMed(); if (STEPS.has("bids")) await doBids(); })(),
  (async () => { if (STEPS.has("food")) await doFood(); })()
]);
save(true);
const n = Object.keys(F.rows).length;
console.error(`\n끝  ${((Date.now() - t0) / 60000).toFixed(1)}분 · 호출 ${stat.calls.toLocaleString()} · 검색수 갱신 ${stat.statsHit.toLocaleString()} · 못 받음 ${stat.statsMiss} · 입찰가 ${stat.bids.toLocaleString()} · 중간입찰가 ${stat.med.toLocaleString()} · 식품판정 ${stat.food.toLocaleString()} (식품 아님 ${stat.foodNo}) · 실패 ${stat.fail.length}`);
if (stat.fail.length) console.error("  실패 예: " + JSON.stringify(stat.fail.slice(0, 3)));
console.error(`→ ${OUT}  (${n.toLocaleString()}개)`);
