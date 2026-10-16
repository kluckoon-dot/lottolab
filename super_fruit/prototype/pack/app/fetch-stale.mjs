#!/usr/bin/env node
/**
 * 오늘 받은 네이버 목록에 안 나온 키워드의 숫자를 오늘 값으로 — 다섯 개씩 키워드도구에 그 키워드 그대로 묻는다
 *
 * 왜 (보갬, 2026-10-16: "정기적으로 네이버와 동일한 검색값이 나오도록, 빠짐없이")
 *   네이버 키워드도구 숫자는 최근 30일 값이라 날마다 바뀐다. 매일 목록(fetch-related-more · build-related)을 다시 받으면
 *   목록에 나오는 키워드는 모두 오늘 값이 되지만, 어느 목록에도 안 나오는 키워드(꼬리 키워드로만 찾은 것 · 9월 수집분에만 있는 섹션 키워드)는 남는다.
 *   그런 키워드만 골라 오늘 값으로 채운다.
 *
 * 무엇을
 *   화면(data-kw.js) + 섹션 밖 사전(data-dict-N.js)의 키워드 가운데, 받아 둔 값(목록 · 꼬리 · fresh.json · 이 파일) 중 가장 새것이 오늘 이전인 것.
 *   다섯 개씩 묻고 그 키워드 자신의 줄만 naver-out/related-stats.ndjson 에 적는다 { at, rows:[[kw, pc, mo, depth, comp, clickPc, clickMo, ctrPc, ctrMo, masked], …] }.
 *   build-web.mjs · naver-latest.mjs 가 이 파일도 "가장 새 값" 의 원본으로 읽는다. 검색광고 API 만 쓴다.
 *
 * 실행:  node fetch-stale.mjs            오늘 값이 아닌 것 전부
 *        node fetch-stale.mjs --stat     세어 보기만
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { latestRows } from "./naver-latest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;
const OUTDIR = path.join(ROOT, "naver-out"), FILE = path.join(OUTDIR, "related-stats.ndjson");
const STAT = process.argv.includes("--stat");

/* ── 키 ── */
const o = {}; const AL = { naver_ad_api_key: "KEY", naver_ad_secret: "SECRET", naver_ad_customer: "CUSTOMER" };
for (const dir of [...new Set([ROOT, process.cwd(), HERE])]) {
  let raw; try { raw = fs.readFileSync(path.join(dir, "key.txt"), "utf8"); } catch { continue; }
  for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) { if (/^\s*#/.test(line)) continue; const i = line.indexOf("="); if (i < 0) continue; const k = AL[line.slice(0, i).trim().toLowerCase()], v = line.slice(i + 1).trim().replace(/^["']|["']$/g, ""); if (k && v) o[k] = v; }
  if (o.KEY) break;
}
if (!STAT && !(o.KEY && o.SECRET && o.CUSTOMER)) { console.error("key.txt 에 검색광고 키(A 칸)가 없다."); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function kt(hints) {
  const p = "/keywordstool";
  for (let a = 0; a < 6; a++) {
    try {
      const ts = String(Date.now()), sig = crypto.createHmac("sha256", o.SECRET).update(`${ts}.GET.${p}`).digest("base64");
      const r = await fetch("https://api.searchad.naver.com" + p + "?hintKeywords=" + hints.map(encodeURIComponent).join(",") + "&showDetail=1",
        { headers: { "X-Timestamp": ts, "X-API-KEY": o.KEY, "X-Customer": String(o.CUSTOMER), "X-Signature": sig } });
      const j = await r.json().catch(() => null);
      if (r.status !== 429 && r.status < 500) return { ok: r.ok, status: r.status, json: j };
    } catch {}
    await sleep(1500 * (a + 1));
  }
  return { ok: false, status: 429 };
}
const num = v => typeof v === "number" ? v : (parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10) || 0);
const masked = v => typeof v === "string" && /</.test(v);
const COMPI = { "낮음": 0, "중간": 1, "높음": 2 };
const clean = s => String(s).replace(/\s+/g, "").toUpperCase();
const day = iso => { if (!iso) return 0; const d = new Date(iso); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };

/* ── 이 파일 정리: 키워드마다 가장 새 줄만 ── */
if (fs.existsSync(FILE)) {
  const last = new Map(); let lines = 0;
  for (const line of fs.readFileSync(FILE, "utf8").split("\n")) { if (!line.trim()) continue; lines++; let j; try { j = JSON.parse(line); } catch { continue; }
    for (const x of j.rows || []) { const p = last.get(x[0]); if (!p || String(j.at) > String(p.at)) last.set(x[0], { at: j.at, x }); } }
  const byAt = new Map(); for (const { at, x } of last.values()) { if (!byAt.has(at)) byAt.set(at, []); byAt.get(at).push(x); }
  if (lines > byAt.size) { fs.writeFileSync(FILE + ".tmp", [...byAt].map(([at, rows]) => JSON.stringify({ at, rows })).join("\n") + "\n", "utf8"); fs.renameSync(FILE + ".tmp", FILE); }
}

/* ── 오늘 값이 아닌 키워드 ── */
const require = createRequire(import.meta.url);
globalThis.window = {}; require(path.join(HERE, "data-kw.js")); require(path.join(HERE, "data-head.js"));
const kws = window.KWROWS.map(r => r[0]);
for (let q = 0; q < (window.KWHEAD.dictN || 0); q++) { const f = path.join(HERE, "data-dict-" + q + ".js"); if (!fs.existsSync(f)) break; require(f); for (const r of window.KWDICT[q].rows) kws.push(r[0]); }
let FR = {}; try { FR = JSON.parse(fs.readFileSync(path.join(OUTDIR, "fresh.json"), "utf8")).rows || {}; } catch {}
/* "오늘 값이 아니다" = 가장 새 값이 18시간보다 오래됐다. 달력 날짜로 세면 자정을 넘긴 순간 전날 받은 것이 전부 낡은 것이 돼 버린다(2026-10-17 새벽에 한 번 그랬다) */
const L = latestRows(OUTDIR), OLD = Date.now() - 18 * 3600e3;
const stale = [...new Set(kws)].filter(k => {
  const a = L.get(k), f = FR[k];
  return Math.max(a ? Date.parse(a.at) || 0 : 0, f && f.sAt ? Date.parse(f.sAt) || 0 : 0) < OLD;
});
const askable = stale.filter(k => { const c = k.replace(/\s+/g, ""); return c.length >= 1 && c.length <= 20 && !/[,()]/.test(c); });
console.error(`키워드 ${kws.length.toLocaleString()} 중 18시간 넘은 값(오늘 값이 아닌 것) ${stale.length.toLocaleString()} · 물을 수 있는 것 ${askable.length.toLocaleString()} (호출 ${Math.ceil(askable.length / 5).toLocaleString()}회)`);
if (STAT) process.exit(0);

const t0 = Date.now(); let calls = 0, got = 0, fail = 0;
for (let i = 0; i < askable.length; i += 5) {
  const g = askable.slice(i, i + 5), hints = g.map(k => k.replace(/\s+/g, ""));
  const r = await kt(hints); calls++;
  if (r.ok) {
    const want = new Map(g.map(k => [clean(k), k])), rows = [];
    for (const x of r.json?.keywordList || []) { const k = want.get(clean(x.relKeyword)); if (!k) continue; want.delete(clean(x.relKeyword));
      rows.push([k, num(x.monthlyPcQcCnt), num(x.monthlyMobileQcCnt), +x.plAvgDepth || 0, COMPI[x.compIdx] || 0,
        +x.monthlyAvePcClkCnt || 0, +x.monthlyAveMobileClkCnt || 0, +x.monthlyAvePcCtr || 0, +x.monthlyAveMobileCtr || 0, masked(x.monthlyPcQcCnt) || masked(x.monthlyMobileQcCnt) ? 1 : 0]); }
    if (rows.length) { fs.appendFileSync(FILE, JSON.stringify({ at: new Date().toISOString(), rows }) + "\n", "utf8"); got += rows.length; }
  } else { fail++; if (fail > 30 && fail > calls * 0.5) { console.error("실패가 너무 많다. 멈춘다.", r.status); break; } }
  if (calls % 200 === 0) console.error(`  ${Math.min(i + 5, askable.length).toLocaleString()}/${askable.length.toLocaleString()} · ${((Date.now() - t0) / 60000).toFixed(1)}분 · 받은 값 ${got.toLocaleString()} · 실패 ${fail}`);
  await sleep(120);
}
console.error(`끝  호출 ${calls.toLocaleString()} · ${((Date.now() - t0) / 60000).toFixed(1)}분 · 오늘 값으로 채운 키워드 ${got.toLocaleString()} · 실패 ${fail}`);
