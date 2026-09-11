#!/usr/bin/env node
/**
 * 네이버 검색광고 API 수집기
 *
 * ─────────────────────────────────────────────────────────────
 *  원칙 : 키워드에는 옳고 그름이 없다
 *
 *  "샤인머스캣"과 "샤인머스켓"은 서로 다른 시장이다.
 *  맞춤법이 맞는 쪽만 남기거나, 검색량이 큰 쪽으로 합치거나,
 *  검색량이 적다고 지표 수집을 건너뛰는 일을 하지 않는다.
 *
 *  수집된 모든 키워드는 예외 없이 같은 대접을 받는다.
 *  월검색수 · 클릭수 · CTR · 경쟁도 · 1~3위 입찰가(PC/모바일) 전부.
 * ─────────────────────────────────────────────────────────────
 *
 * 실행
 *   node fetch-naver.mjs --probe                    연결 확인
 *   node fetch-naver.mjs --from supply-calendar.json --limit 40
 *   node fetch-naver.mjs --from supply-calendar.json          전체
 *   node fetch-naver.mjs --resume                   중단된 지점부터 이어서
 *
 * 결과 : naver-out/keywords.json
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

const HOST = process.env.NAVER_AD_HOST || "https://api.searchad.naver.com";
const OUTDIR = "naver-out";
const OUT = path.join(OUTDIR, "keywords.json");

/* ── 키 읽기 ── */
const ALIAS = {
  naver_ad_api_key:"KEY", 액세스라이선스:"KEY", 라이선스:"KEY", apikey:"KEY", api_key:"KEY",
  naver_ad_secret:"SECRET", 비밀키:"SECRET", secret:"SECRET", secretkey:"SECRET",
  naver_ad_customer:"CUSTOMER", 고객id:"CUSTOMER", 고객아이디:"CUSTOMER",
  customerid:"CUSTOMER", customer_id:"CUSTOMER", customer:"CUSTOMER"
};
function loadKeyFile() {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  for (const name of ["key.txt", ".env"]) {
    let raw; try { raw = readFileSync(path.join(here, name), "utf8"); } catch { continue; }
    const out = {};
    for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("//")) continue;
      const i = t.indexOf("="); if (i < 0) continue;
      const k = t.slice(0, i).trim().toLowerCase().replace(/[\s-]/g, "");
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (ALIAS[k] && v && !/여기에|붙여넣|paste|<|>/.test(v)) out[ALIAS[k]] = v;
    }
    if (Object.keys(out).length) return out;
  }
  return {};
}
const FK = loadKeyFile();
const KEY = process.env.NAVER_AD_API_KEY || FK.KEY;
const SECRET = process.env.NAVER_AD_SECRET || FK.SECRET;
const CUSTOMER = process.env.NAVER_AD_CUSTOMER || FK.CUSTOMER;

/* ── 호출 ── */
function headers(method, urlPath) {
  const ts = Date.now().toString();
  const sig = crypto.createHmac("sha256", SECRET).update(`${ts}.${method}.${urlPath}`).digest("base64");
  return { "X-Timestamp": ts, "X-API-KEY": KEY, "X-Customer": String(CUSTOMER),
           "X-Signature": sig, "Content-Type": "application/json; charset=UTF-8" };
}
async function call(method, urlPath, { query, body } = {}) {
  const qs = query ? "?" + new URLSearchParams(query) : "";
  try {
    const res = await fetch(HOST + urlPath + qs, { method, headers: headers(method, urlPath),
      body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) { return { ok: false, status: "연결실패", json: null, text: String(e.message || e) }; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function safe(t) { let s = String(t ?? ""); for (const v of [KEY, SECRET, CUSTOMER]) if (v && String(v).length >= 6) s = s.split(v).join("<가림>"); return s; }
function explain(status, body) {
  const b = String(body || "");
  if (status === 403 && /not in allowlist/i.test(b)) return "네트워크 차단.";
  if (status === 403 && /auth-failed|Auth Failed/i.test(b)) return "네이버가 키를 거부했다.";
  if (status === 401) return "인증 실패.";
  if (status === 429) return "호출 한도 초과.";
  if (status === 400) return "요청 형식 오류.";
  return "";
}

/* ── 엔드포인트 (2026-09-11 실응답으로 확정) ── */
const BID_PATH = "/estimate/average-position-bid/keyword";
const keywordTool = hint => call("GET", "/keywordstool", { query: { hintKeywords: hint, showDetail: "1" } });

function num(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = parseInt(v.replace(/[^\d]/g, ""), 10); return isNaN(n) ? 0 : n; }
  return 0;
}
/* 네이버는 검색량이 적으면 "< 10" 같은 문자열을 준다. 숫자로 바꾸되 가려진 값이었음을 남긴다. */
function normalize(row) {
  const pcRaw = row.monthlyPcQcCnt, moRaw = row.monthlyMobileQcCnt;
  const pc = num(pcRaw), mo = num(moRaw);
  return {
    kw: row.relKeyword, pc, mo, total: pc + mo, tier: null,
    masked: typeof pcRaw === "string" || typeof moRaw === "string",
    moShare: pc + mo ? mo / (pc + mo) : 0,
    clickPc: Number(row.monthlyAvePcClkCnt) || 0, clickMo: Number(row.monthlyAveMobileClkCnt) || 0,
    ctrPc: Number(row.monthlyAvePcCtr) || 0, ctrMo: Number(row.monthlyAveMobileCtr) || 0,
    depth: num(row.plAvgDepth), compIdx: row.compIdx || null,
    hints: [], bid: null, fetchedAt: new Date().toISOString()
  };
}

/* ── 입찰가 : 한 번에 여러 키워드를 받아주는지 실제로 확인한다 ── */
let BID_MODE = null;            // "batch" | "single"
let BATCH_SIZE = 10;
function bidBody(keywords, device) {
  const items = [];
  for (const k of keywords) for (const p of [1, 2, 3]) items.push({ key: k, position: p });
  return { device, keywordplus: false, key: keywords[0], items };
}
function readBids(json) {
  const out = {};
  for (const e of (json?.estimate || [])) {
    (out[e.keyword] ||= {})[e.position] = e.bid;
  }
  return out;
}
async function detectBidMode(sample) {
  if (sample.length < 2) { BID_MODE = "single"; return; }
  const probe = sample.slice(0, Math.min(5, sample.length));
  const r = await call("POST", BID_PATH, { body: bidBody(probe, "PC") });
  if (r.ok) {
    const got = Object.keys(readBids(r.json));
    if (got.length >= probe.length) {
      BID_MODE = "batch";
      console.error(`  입찰가 묶음 조회 지원됨 (한 번에 ${BATCH_SIZE}개). 호출 수가 ${BATCH_SIZE}분의 1로 줄어든다.`);
      return;
    }
    console.error(`  묶음 요청은 받았지만 ${got.length}/${probe.length}개만 돌아왔다. 하나씩 조회한다.`);
  } else {
    console.error(`  묶음 조회 미지원 (HTTP ${r.status}). 하나씩 조회한다.`);
  }
  BID_MODE = "single";
}
/* 반환: { 키워드: {pc:[1위,2위,3위], mo:[...]}, ... }  ·  실패한 키워드는 담기지 않는다 */
async function fetchBids(keywords) {
  const groups = BID_MODE === "batch"
    ? Array.from({ length: Math.ceil(keywords.length / BATCH_SIZE) }, (_, i) => keywords.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE))
    : keywords.map(k => [k]);
  const out = {}; let limitHit = false;
  for (const g of groups) {
    const pc = await call("POST", BID_PATH, { body: bidBody(g, "PC") });
    await sleep(340);
    const mo = await call("POST", BID_PATH, { body: bidBody(g, "MOBILE") });
    await sleep(340);
    if (pc.status === 429 || mo.status === 429) { limitHit = true; break; }
    if (!pc.ok || !mo.ok) continue;
    const P = readBids(pc.json), M = readBids(mo.json);
    for (const k of g) {
      if (!P[k] && !M[k]) continue;
      out[k] = { pc: [P[k]?.[1] ?? null, P[k]?.[2] ?? null, P[k]?.[3] ?? null],
                 mo: [M[k]?.[1] ?? null, M[k]?.[2] ?? null, M[k]?.[3] ?? null] };
    }
  }
  return { out, limitHit, calls: groups.length * 2 };
}

/* ── 진단 ── */
function shapeReport() {
  const shape = v => { const t = String(v ?? "");
    return { len: t.length, head: t.slice(0, 4),
      cls: /^\d+$/.test(t) ? "숫자만" : /\s/.test(t) ? "공백·줄바꿈 섞임 ← 의심"
         : /^[A-Za-z0-9+/=]+$/.test(t) ? "영문+숫자(+/=)" : "기타 문자 포함" }; };
  const k = shape(KEY), s = shape(SECRET), c = shape(CUSTOMER);
  console.log("── 키 모양 점검 (값은 보여주지 않는다)");
  console.log(`  액세스라이선스  길이 ${k.len}  앞 4글자 ${k.head}  ${k.cls}`);
  console.log(`  비밀키          길이 ${s.len}  ${s.cls}`);
  console.log(`  고객ID          길이 ${c.len}  ${c.cls}\n`);
}
async function diagnose(kw) {
  const P = "/keywordstool", QS = "?hintKeywords=" + encodeURIComponent(kw) + "&showDetail=1";
  const variants = [
    { name: "표준 (시각.METHOD.경로)", msg: ts => `${ts}.GET.${P}` },
    { name: "경로에 쿼리까지 포함",     msg: ts => `${ts}.GET.${P}${QS}` },
    { name: "메서드 소문자",            msg: ts => `${ts}.get.${P}` }];
  const creds = [{ name: "입력한 그대로", api: KEY, sec: SECRET }, { name: "두 값 맞바꿈", api: SECRET, sec: KEY }];
  let hit = null;
  for (const c of creds) for (const v of variants) {
    const ts = Date.now().toString();
    const sig = crypto.createHmac("sha256", c.sec).update(v.msg(ts)).digest("base64");
    let st = "??";
    try {
      const res = await fetch(HOST + P + QS, { headers: { "X-Timestamp": ts, "X-API-KEY": c.api,
        "X-Customer": String(CUSTOMER), "X-Signature": sig, "Content-Type": "application/json; charset=UTF-8" } });
      st = res.status; if (res.ok && !hit) hit = { cred: c.name, variant: v.name };
    } catch { st = "연결실패"; }
    console.log(`   ${st === 200 ? "OK  " : "실패"}  ${c.name} / ${v.name}  → ${st}`);
    await sleep(250);
  }
  console.log("");
  if (hit) {
    console.log(`*** 통하는 조합 : ${hit.cred} / ${hit.variant} ***`);
    if (hit.cred === "두 값 맞바꿈") console.log("    → key.txt 에서 두 값의 위치를 맞바꾸고 저장해라.");
    if (hit.variant !== "표준 (시각.METHOD.경로)") console.log("    → 서명 방식 문제다. 이 결과를 보내주면 고쳐서 보낸다.");
    return true;
  }
  console.log("여섯 조합 전부 실패. 서명 문제가 아니라 키 값 문제다.");
  console.log("  1. 고객ID  검색광고 우측 상단 [내 정보] 옆 숫자다");
  console.log("  2. 키 쌍   액세스라이선스와 비밀키는 같이 발급된 한 쌍이어야 한다");
  console.log("  3. 재발급  비밀키는 발급 때 한 번만 보인다\n");
  return false;
}

/* ── 본체 ── */
async function main() {
  const args = process.argv.slice(2);
  const has = f => args.includes(f);
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

  if (parseInt(process.versions.node, 10) < 18) { console.error(`Node ${process.versions.node} 은 너무 낮다. 18 이상 필요.`); process.exit(1); }
  if (!KEY || !SECRET || !CUSTOMER) {
    const m = []; if (!KEY) m.push("액세스라이선스"); if (!SECRET) m.push("비밀키"); if (!CUSTOMER) m.push("고객ID");
    console.error(`\n키가 없다: ${m.join(" / ")}`);
    console.error("같은 폴더의 key.txt 를 메모장으로 열어 = 뒤에 값을 붙여넣고 저장해라.\n");
    process.exit(1);
  }
  console.error(`키 확인 완료. 고객ID ${String(CUSTOMER).slice(0, 3)}***`);

  /* 씨앗 없이 목록을 통째로 받을 수 있는지 확인한다.
     404 면 그런 통로가 없는 것이고, 400 이면 통로는 있는데 요청이 틀린 것이다.
     이 둘을 가르는 게 이 모드의 목적이다. */
  if (has("--raw")) {
    console.log("=== 씨앗 없이 받을 수 있는 통로가 있는지 확인한다 ===\n");
    console.log("읽는 법");
    console.log("  200  된다");
    console.log("  400  통로는 있다. 요청 형식만 맞추면 된다   ← 이게 나오면 좋은 신호");
    console.log("  404  그런 통로가 없다");
    console.log("  403  권한이 없다\n");
    const tries = [
      ["힌트 없이 전체 요청",        "GET", "/keywordstool", { showDetail: "1" }],
      ["업종(biztpId)으로 조회",     "GET", "/keywordstool", { biztpId: "1", showDetail: "1" }],
      ["사이트(siteId)로 조회",      "GET", "/keywordstool", { siteId: "1", showDetail: "1" }],
      ["시즌이슈(event)로 조회",     "GET", "/keywordstool", { event: "1", showDetail: "1" }],
      ["업종 목록",                  "GET", "/ncc/bizmoney", null],
      ["관리 키워드 목록",           "GET", "/ncc/keywords", null],
      ["광고그룹 목록",              "GET", "/ncc/adgroups", null],
      ["캠페인 목록",                "GET", "/ncc/campaigns", null]
    ];
    for (const [name, method, p, q] of tries) {
      const r = await call(method, p, q ? { query: q } : {});
      console.log(`  ${String(r.status).padEnd(6)} ${name.padEnd(24)} ${p}`);
      const body = safe(r.text).replace(/\s+/g, " ").slice(0, 220);
      if (body) console.log(`         ${body}`);
      await sleep(300);
    }
    console.log("\n이 출력을 보내주면 씨앗 없이 갈 수 있는지 확정한다.");
    return;
  }

  if (has("--probe")) {
    shapeReport();
    const kw = "샤인머스캣";
    console.log(`=== /keywordstool · "${kw}" ===`);
    const r = await keywordTool(kw);
    console.log("HTTP", r.status, explain(r.status, r.text));
    console.log(safe(r.text).slice(0, 1400));
    if (r.status === 403 && /auth|Auth/i.test(r.text)) {
      console.log("\n=== 인증 실패 자동 진단 ===\n"); await diagnose(kw); return;
    }
    for (const d of ["PC", "MOBILE"]) {
      const b = await call("POST", BID_PATH, { body: bidBody([kw], d) });
      console.log(`\n── 순위별 입찰가 / ${d} → HTTP ${b.status} ${explain(b.status, b.text)}`);
      console.log(safe(b.text).slice(0, 600));
      await sleep(300);
    }
    console.log("\n이 출력을 그대로 붙여주면 된다.");
    return;
  }

  /* 시드 — 단계 순서대로 처리한다 */
  let plan = [];
  if (val("--keywords-file")) plan = [{ tier: 1, name: "직접 지정",
      seeds: (await fs.readFile(val("--keywords-file"), "utf8")).split(/\r?\n/).map(x => x.trim()).filter(Boolean) }];
  else if (val("--keywords")) plan = [{ tier: 1, name: "직접 지정", seeds: val("--keywords").split(",").map(x => x.trim()) }];
  else {
    const f = val("--seeds") || "seeds.json";
    try { plan = JSON.parse(await fs.readFile(f, "utf8")).tiers; }
    catch { console.error(`${f} 을 읽지 못했다. 같은 폴더에 있는지 확인해라.`); process.exit(1); }
  }
  const maxTier = parseInt(val("--tier") || "99", 10);
  plan = plan.filter(t => t.tier <= maxTier);
  const limit = parseInt(val("--limit") || "0", 10);
  if (limit > 0) { let n = limit; plan = plan.map(t => { const take = Math.max(0, Math.min(n, t.seeds.length)); n -= take; return { ...t, seeds: t.seeds.slice(0, take) }; }).filter(t => t.seeds.length); }
  const maxCalls = parseInt(val("--max-calls") || "0", 10);
  if (val("--batch-size")) BATCH_SIZE = Math.max(1, parseInt(val("--batch-size"), 10));
  const hints = plan.flatMap(t => t.seeds);

  /* 이어하기 */
  await fs.mkdir(OUTDIR, { recursive: true });
  const byKw = new Map(); const failed = []; const doneHints = new Set();
  let calls = 0, started = new Date().toISOString();
  try {
    const prev = JSON.parse(await fs.readFile(OUT, "utf8"));
    for (const r of prev.rows || []) byKw.set(r.kw, r);
    (prev.doneHints || []).forEach(h => doneHints.add(h));
    started = prev.startedAt || started;
    console.error(`이어하기: 키워드 ${byKw.size}개 · 끝난 품종 ${doneHints.size}개를 불러왔다.`);
  } catch {}

  const save = async phase => {
    const rows = [...byKw.values()].sort((a, b) => b.total - a.total);
    await fs.writeFile(OUT, JSON.stringify({
      startedAt: started, savedAt: new Date().toISOString(), phase,
      rule: "키워드는 합치거나 버리지 않는다. 철자가 다르면 다른 시장이다.",
      bidMode: BID_MODE, hints: hints.length, doneHints: [...doneHints],
      calls, keywords: rows.length, withBid: rows.filter(r => r.bid).length,
      byTier: [1,2,3,4].map(t => ({ tier: t, keywords: rows.filter(r => r.tier === t).length,
                                    withBid: rows.filter(r => r.tier === t && r.bid).length })),
      failed, rows
    }, null, 1), "utf8");
  };

  /* 1단계 — 연관 키워드. 철자가 다르면 다른 키워드로 전부 남긴다 */
  console.error("");
  plan.forEach(t => console.error(`  ${t.tier}단계  ${t.name.padEnd(12)} 시드 ${t.seeds.length}개`));
  const snowRounds = parseInt(val("--snowball") ?? "2", 10);
  const snowTop = parseInt(val("--snowball-top") || "300", 10);
  if (snowRounds > 0) console.error(`  눈덩이 확장 ${snowRounds}바퀴 · 바퀴당 상위 ${snowTop}개`);
  if (maxCalls) console.error(`  호출 상한 ${maxCalls.toLocaleString()}회`);
  let stop = false, budget = false;

  /* 힌트 하나를 넣고 연관 키워드를 거둔다. 반환값은 계속 진행해도 되는지 여부 */
  async function runHint(hint, tier, label) {
    if (maxCalls && calls >= maxCalls) { budget = true; return false; }
    const r = await keywordTool(hint); calls++;
    if (!r.ok) {
      failed.push({ phase: "keywords", tier, hint, status: r.status, note: explain(r.status, r.text) });
      console.error(`  ${label} ${hint} → 실패 ${r.status} ${explain(r.status, r.text)}`);
      if (r.status === 429) { stop = true; return false; }
      doneHints.add(hint);
      return true;
    }
    for (const row of (r.json?.keywordList || [])) {
      const m = normalize(row); if (!m.kw) continue;
      const prev = byKw.get(m.kw);
      if (!prev) { m.hints = [hint]; m.tier = tier; byKw.set(m.kw, m); }
      else {
        if (!prev.hints.includes(hint)) prev.hints.push(hint);
        if (prev.tier == null || tier < prev.tier) prev.tier = tier;
        if (prev.total !== m.total) (prev.seenAlso ||= []).push({ hint, total: m.total, at: m.fetchedAt });
      }
    }
    doneHints.add(hint);
    return true;
  }

  for (const t of plan) {
    const todo = t.seeds.filter(h => !doneHints.has(h));
    if (todo.length) {
      console.error(`\n${t.tier}단계  ${t.name}  —  시드 ${todo.length}개` + (todo.length < t.seeds.length ? ` (${t.seeds.length - todo.length}개는 이미 끝남)` : ""));
      for (let i = 0; i < todo.length; i++) {
        if (!await runHint(todo[i], t.tier, `[${i + 1}/${todo.length}]`)) break;
        if ((i + 1) % 10 === 0 || i === todo.length - 1)
          console.error(`  [${i + 1}/${todo.length}] ${todo[i]} → 누적 ${byKw.size.toLocaleString()}개`);
        if ((i + 1) % 20 === 0) await save("keywords");
        await sleep(350);
      }
      await save("keywords");
    } else console.error(`\n${t.tier}단계 ${t.name} — 시드는 이미 끝남`);
    if (stop || budget) break;

    /* 눈덩이 확장 — 찾아낸 키워드를 다시 힌트로 넣는다.
       시드 목록을 손으로 완벽하게 적는 건 불가능하다. 빠진 가지는 이걸로 메운다. */
    for (let round = 1; round <= snowRounds; round++) {
      const pool = [...byKw.values()]
        .filter(k => k.tier === t.tier && !doneHints.has(k.kw))
        .sort((a, b) => b.total - a.total)
        .slice(0, snowTop)
        .map(k => k.kw);
      if (!pool.length) break;
      const before = byKw.size;
      console.error(`\n${t.tier}단계  눈덩이 ${round}바퀴  —  ${pool.length}개를 다시 힌트로`);
      for (let i = 0; i < pool.length; i++) {
        if (!await runHint(pool[i], t.tier, `[${i + 1}/${pool.length}]`)) break;
        if ((i + 1) % 25 === 0 || i === pool.length - 1)
          console.error(`  [${i + 1}/${pool.length}] → 누적 ${byKw.size.toLocaleString()}개 (+${(byKw.size - before).toLocaleString()})`);
        if ((i + 1) % 20 === 0) await save("keywords");
        await sleep(350);
      }
      await save("keywords");
      console.error(`  ${round}바퀴로 새로 찾은 키워드 ${(byKw.size - before).toLocaleString()}개`);
      if (stop || budget) break;
    }
    if (stop || budget) break;
  }
  console.error(`\n1단계 끝. 고유 키워드 ${byKw.size.toLocaleString()}개`);

  /* 2단계 — 입찰가. 검색량과 무관하게 전부 받는다 */
  if (!stop && !budget && !has("--no-bids")) {
    const need = [...byKw.values()].filter(k => !k.bid)
      .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || b.total - a.total)
      .map(k => k.kw);
    if (need.length) {
      console.error(`\n2단계  입찰가 수집 — 남은 ${need.length.toLocaleString()}개`);
      console.error("  검색량과 무관하게 전부 받는다. 앞 단계 키워드부터 먼저 받는다.");
      if (!BID_MODE) await detectBidMode(need);
      const per = BID_MODE === "batch" ? BATCH_SIZE : 1;
      console.error(`  예상 ${Math.ceil(need.length / per / 60 * 0.7)}분 내외. 중간중간 저장된다.\n`);
      const chunk = per * 25;
      for (let i = 0; i < need.length; i += chunk) {
        const part = need.slice(i, i + chunk);
        const { out, limitHit, calls: c } = await fetchBids(part);
        calls += c;
        for (const [k, b] of Object.entries(out)) { const row = byKw.get(k); if (row) row.bid = b; }
        const got = [...byKw.values()].filter(r => r.bid).length;
        console.error(`  ${Math.min(i + chunk, need.length)}/${need.length} 처리 · 입찰가 확보 ${got}개`);
        await save("bids");
        if (limitHit) { console.error("  한도 도달. 저장하고 멈춘다. 다시 실행하면 이어서 받는다."); stop = true; break; }
        if (maxCalls && calls >= maxCalls) { console.error("  호출 상한에 닿았다. 저장하고 멈춘다."); stop = true; break; }
      }
    }
  }

  await save(stop ? "중단됨" : "done");
  const rows = [...byKw.values()];
  console.error(`\n완료  호출 ${calls}회 · 키워드 ${rows.length}개 · 입찰가 ${rows.filter(r => r.bid).length}개 · 실패 ${failed.length}건`);
  console.error(`→ ${OUT}`);
  if (rows.some(r => r.masked)) console.error(`검색량이 "< 10" 으로 가려진 키워드도 그대로 담았다 (masked 표시).`);
  const bt = [1,2,3,4].map(t => rows.filter(r => r.tier === t).length);
  console.error(`  단계별  1단계 ${bt[0].toLocaleString()} · 2단계 ${bt[1].toLocaleString()} · 3단계 ${bt[2].toLocaleString()} · 4단계 ${bt[3].toLocaleString()}`);
  if (stop || budget) console.error("\n중단됐다. 2-collect.bat 을 다시 실행하면 이어서 채운다. 처음부터 하지 않는다.");
}
main().catch(e => { console.error(e); process.exit(1); });
