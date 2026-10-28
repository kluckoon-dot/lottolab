#!/usr/bin/env node
/**
 * 보갬이 키워드랩에서 찾아봤는데 저장본에 없던 키워드(또는 3년 그래프가 없던 키워드)를 네이버에 직접 물어 온다 (2026-10-28)
 *
 * 왜
 *   저장본(claude.ai 페이지)은 네이버를 직접 부를 수 없다. 그래서 받아 둔 목록에 한 번도 안 나온 키워드는 찾아도 없다.
 *   페이지가 그런 키워드를 "받아 올 것" 목록(아티팩트 데이터 requests)에 적어 두면, 매일 수집 때 로드가 그 목록을
 *   naver-out/requests.txt 로 옮기고 이 스크립트가 받는다. 다음 저장본부터 그 키워드와 그 연관 목록이 보인다.
 *
 * 무엇을
 *   1. 키워드마다 네이버 키워드도구에 그 키워드 하나를 물어 연관 목록을 naver-out/related-more.ndjson 에 붙인다
 *      (묶음 7 = 찾아본 키워드). 목록 첫머리에 그 키워드 자신이 있으면 "있음", 없으면 "네이버에 없음".
 *   2. 결과를 naver-out/requests-result.json 에 { 키워드: { found, pc, mo, rows, at } } 로 적는다 — 로드가 아티팩트 데이터의 상태를 바꿀 때 읽는다.
 *   3. 3년 추세는 refresh-trend.mjs --extra naver-out/requests.txt --extra-only 가 받는다(매일 수집 bat 이 이어서 부른다).
 *   검색광고 API 만 쓴다.
 *
 * 실행:  node fetch-requests.mjs                 naver-out/requests.txt (한 줄에 하나)
 *        node fetch-requests.mjs --file 경로
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;
const OUTDIR = path.join(ROOT, "naver-out");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const FILE = val("--file") || path.join(OUTDIR, "requests.txt");
const MORE = path.join(OUTDIR, "related-more.ndjson"), RES = path.join(OUTDIR, "requests-result.json");

let list = [];
try { list = fs.readFileSync(FILE, "utf8").replace(/^﻿/, "").split(/\r?\n/).map(x => x.trim()).filter(Boolean); } catch (e) { if (e.code !== "ENOENT") throw e; }
list = [...new Set(list.map(x => x.replace(/\s+/g, "")).filter(x => x && x.length <= 40))];
if (!list.length) { console.error("받아 올 키워드 없음 (" + FILE + ")"); process.exit(0); }

const o = {}; const AL = { naver_ad_api_key: "KEY", naver_ad_secret: "SECRET", naver_ad_customer: "CUSTOMER" };
for (const dir of [...new Set([ROOT, process.cwd(), HERE])]) {
  let raw; try { raw = fs.readFileSync(path.join(dir, "key.txt"), "utf8"); } catch { continue; }
  for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) { if (/^\s*#/.test(line)) continue; const i = line.indexOf("="); if (i < 0) continue; const k = AL[line.slice(0, i).trim().toLowerCase()], v = line.slice(i + 1).trim().replace(/^["']|["']$/g, ""); if (k && v) o[k] = v; }
  if (o.KEY) break;
}
if (!(o.KEY && o.SECRET && o.CUSTOMER)) { console.error("key.txt 에 검색광고 키(A 칸)가 없다."); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function kt(hint) {
  const p = "/keywordstool";
  for (let a = 0; a < 6; a++) {
    try {
      const ts = String(Date.now()), sig = crypto.createHmac("sha256", o.SECRET).update(`${ts}.GET.${p}`).digest("base64");
      const r = await fetch("https://api.searchad.naver.com" + p + "?hintKeywords=" + encodeURIComponent(hint) + "&showDetail=1",
        { headers: { "X-Timestamp": ts, "X-API-KEY": o.KEY, "X-Customer": String(o.CUSTOMER), "X-Signature": sig } });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      if (r.status !== 429 && r.status < 500) return { ok: r.ok, status: r.status, json: j };
    } catch {}
    await sleep(1500 * (a + 1));
  }
  return { ok: false, status: 429 };
}
const num = v => typeof v === "number" ? v : (parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10) || 0);
const masked = v => typeof v === "string" && /</.test(v);
const COMPI = { "낮음": 0, "중간": 1, "높음": 2 };
const norm = s => String(s).replace(/\s+/g, "").toLowerCase();

let res = {}; try { res = JSON.parse(fs.readFileSync(RES, "utf8")); } catch {}
let n = 0, found = 0, fail = 0;
for (const k of list) {
  /* 네이버는 띄어쓰기 없는 힌트를 받는다. 글자 수 상한은 목록 받기(fetch-related-more)와 같게 20자 */
  const r = await kt(k.slice(0, 20));
  const at = new Date().toISOString();
  if (r.ok) {
    const rows = (r.json?.keywordList || []).map(x => [x.relKeyword, num(x.monthlyPcQcCnt), num(x.monthlyMobileQcCnt), +x.plAvgDepth || 0, COMPI[x.compIdx] || 0,
      +x.monthlyAvePcClkCnt || 0, +x.monthlyAveMobileClkCnt || 0, +x.monthlyAvePcCtr || 0, +x.monthlyAveMobileCtr || 0, masked(x.monthlyPcQcCnt) || masked(x.monthlyMobileQcCnt) ? 1 : 0]);
    if (rows.length) fs.appendFileSync(MORE, JSON.stringify({ k, g: 7, at, rows }) + "\n", "utf8");
    const self = rows.find(x => norm(x[0]) === norm(k));
    /* 네이버는 어떤 말이든 묻는 말 자신을 "< 10" 으로라도 돌려준다(10/28 시험: 없는 말도 PC < 10 · MO < 10). 둘 다 < 10 이면 low —
       키워드도구에 그렇게 나오니 자료에는 그대로 담고(화면에 < 10), 3년 추세는 묻지 않는다(데이터랩이 값을 안 준다) */
    const low = !!(self && self[9] && self[1] + self[2] <= 20);
    res[k] = { found: !!self, low, kw: self ? self[0] : k, pc: self ? self[1] : 0, mo: self ? self[2] : 0, rows: rows.length, at };
    if (self) found++;
  } else { fail++; res[k] = { found: false, error: r.status, at }; }
  n++;
  await sleep(150);
}
fs.writeFileSync(RES, JSON.stringify(res), "utf8");
/* 찾아본 키워드는 따로 모아 둔다 — 3년 추세를 한 달에 한 번 새 기간으로 다시 받을 때도 빠지지 않게 (refresh-trend --extra) */
const ALL = path.join(OUTDIR, "requests-all.txt");
let all = []; try { all = fs.readFileSync(ALL, "utf8").split(/\r?\n/).filter(Boolean); } catch {}
fs.writeFileSync(ALL, [...new Set([...all, ...list.filter(k => res[k] && res[k].found && !res[k].low)])].join("\n") + "\n", "utf8");
/* 받은 요청 파일은 .done 으로 돌려 둔다 — 다음 수집 때 같은 것을 또 묻지 않게. 새 요청은 로드가 다시 requests.txt 로 쓴다 */
if (FILE === path.join(OUTDIR, "requests.txt")) { try { fs.renameSync(FILE, FILE + ".done"); } catch {} }
console.error(`찾아본 키워드 ${n}개 · 네이버에 있음 ${found} · 없음 ${n - found - fail} · 실패 ${fail} → ${path.relative(ROOT, RES)}`);
