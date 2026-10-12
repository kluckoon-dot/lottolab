#!/usr/bin/env node
/**
 * 꼬리 키워드 찾기 — 품목 이름에 흔한 말(1kg · 가격 · 국내산 · 햇 …)을 붙여 네이버에 직접 묻는다
 *
 * 왜
 *   네이버 키워드도구의 "연관" 은 씨앗마다 수십~수백 개만 준다. 아이템스카우트의 밤 목록과 맞대 보니(docs/26)
 *   네이버가 밤에 준 밤 키워드 56개는 전부 아이템스카우트에도 있었지만, 거꾸로 아이템스카우트에만 있는 밤 키워드가 74개였다 —
 *   밤1kg · 밤시세 · 국내산밤 · 특대밤 · 26년햇밤 … 이 말들은 네이버에 실제 검색량이 있는데 연관 목록으로는 나오지 않는다.
 *   우리 수집 원본 56만 개에도 없었다. 연관을 따라가서는 닿지 않는 키워드다.
 *   그래서 품목 · 품종 이름마다 꼬리말 · 머리말을 붙인 후보를 만들어 키워드도구에 정확히 그 말로 묻고, 검색량이 있는 것만 적는다.
 *   크롤링이 아니다 — 검색광고 공식 API 에 "이 키워드의 숫자를 달라" 고 묻는 것이다.
 *
 * 결과   naver-out/related-tails.json   { seeds: { 씨앗: { at, rows:[[kw, pc, mo, depth, comp, clickPc, clickMo, ctrPc, ctrMo, masked], …] } } }
 *        build-related.mjs 가 이 꼬리 키워드를 품목 씨앗의 목록 뒤에 붙인다 (화면에서는 "꼬리 키워드" 라고 적는다).
 *
 * 실행:  node fetch-tails.mjs               품목 씨앗 전부 (약 440개 · 30분쯤)
 *        node fetch-tails.mjs --only 1      과일만       --max-age 14   14일 안에 물은 씨앗은 건너뜀(기본)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;
const OUTDIR = path.join(ROOT, "naver-out"), OUT = path.join(OUTDIR, "related-tails.json");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const ONLY = val("--only") ? new Set(val("--only").split(",").map(Number)) : null;
const MAX_AGE_D = +(val("--max-age") || 14), MINVOL = +(val("--min") || 30);

/* 사려는 사람이 치는 말만. 효능 · 보관법 같은 정보 꼬리는 넣지 않는다(구매의도가 없어 화면에서 어차피 걸러진다) */
const TAIL = ["1kg", "2kg", "3kg", "5kg", "10kg", "20kg", "500g", "가격", "시세", "도매", "직거래", "판매", "파는곳", "구매", "주문", "택배", "산지직송",
  "선물세트", "선물", "세트", "박스", "추천", "특대", "특", "대", "왕특", "소포장", "대용량", "가격10kg", "가격5kg"];
const HEAD = ["햇", "26년", "26년햇", "국내산", "국산", "유기농", "무농약", "친환경", "못난이", "가정용", "선물용", "제수용", "냉동", "생", "깐", "손질", "꿀", "토종", "제철", "특대", "왕특", "산지직송", "프리미엄", "명품"];

const o = {}; const AL = { naver_ad_api_key: "KEY", naver_ad_secret: "SECRET", naver_ad_customer: "CUSTOMER" };
for (const dir of [...new Set([ROOT, process.cwd(), HERE])]) {
  let raw; try { raw = fs.readFileSync(path.join(dir, "key.txt"), "utf8"); } catch { continue; }
  for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) { if (/^\s*#/.test(line)) continue; const i = line.indexOf("="); if (i < 0) continue; const k = AL[line.slice(0, i).trim().toLowerCase()], v = line.slice(i + 1).trim().replace(/^["']|["']$/g, ""); if (k && v) o[k] = v; }
  if (o.KEY) break;
}
if (!(o.KEY && o.SECRET && o.CUSTOMER)) { console.error("key.txt 에 검색광고 키(A 칸)가 없다."); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;
async function kt(hints) {
  const p = "/keywordstool";
  for (let a = 0; a < 6; a++) {
    calls++;
    try {
      const ts = String(Date.now()), sig = crypto.createHmac("sha256", o.SECRET).update(`${ts}.GET.${p}`).digest("base64");
      const r = await fetch("https://api.searchad.naver.com" + p + "?hintKeywords=" + encodeURIComponent(hints.join(",")) + "&showDetail=1",
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

/* 씨앗 = 품목 · 품종 이름 (build-related.mjs 가 받은 것, 묶음 1~5) */
const require = createRequire(import.meta.url);
globalThis.window = {}; require(path.join(HERE, "data-relidx.js"));
const idx = globalThis.window.RELIDX.seeds || {};
let seeds = Object.keys(idx).filter(k => idx[k] <= 5 && (!ONLY || ONLY.has(idx[k])) && k.length <= 8 && !/[0-9a-z]/i.test(k)).sort((x, y) => idx[x] - idx[y]);
let T = { rule: "품목 이름에 꼬리말 · 머리말을 붙여 정확히 그 말로 물은 것. rows = [kw, pc, mo, depth, comp, clickPc, clickMo, ctrPc, ctrMo, masked]", seeds: {} };
try { T = JSON.parse(fs.readFileSync(OUT, "utf8")); T.seeds ||= {}; } catch {}
const save = () => { fs.mkdirSync(OUTDIR, { recursive: true }); fs.writeFileSync(OUT + ".tmp", JSON.stringify(T), "utf8"); fs.renameSync(OUT + ".tmp", OUT); };
const todo = seeds.filter(k => !(T.seeds[k] && (Date.now() - Date.parse(T.seeds[k].at)) < MAX_AGE_D * 86400e3));
console.error(`품목 씨앗 ${seeds.length}개 중 물을 것 ${todo.length}개 · 씨앗마다 후보 ${TAIL.length + HEAD.length}개`);
const t0 = Date.now(); let n = 0, found = 0;
for (const k of todo) {
  const cand = [...new Set([...TAIL.map(m => k + m), ...HEAD.map(m => m + k)])].filter(c => c.length <= 20), rows = [];
  for (let i = 0; i < cand.length; i += 5) {
    const g = cand.slice(i, i + 5), want = new Set(g.map(x => x.toUpperCase()));
    const r = await kt(g);
    if (r.ok) for (const x of r.json?.keywordList || []) {
      if (!want.has(String(x.relKeyword).toUpperCase())) continue;
      const pc = num(x.monthlyPcQcCnt), mo = num(x.monthlyMobileQcCnt), mp = masked(x.monthlyPcQcCnt), mm = masked(x.monthlyMobileQcCnt), mk = mp || mm ? 1 : 0;
      /* "< 10" 으로 가려진 쪽은 0 으로 보고 센다. 양쪽 다 가려진 말은 검색이 사실상 없는 것이다 */
      if ((mp ? 0 : pc) + (mm ? 0 : mo) < MINVOL) continue;
      rows.push([x.relKeyword, pc, mo, +x.plAvgDepth || 0, COMPI[x.compIdx] || 0, +x.monthlyAvePcClkCnt || 0, +x.monthlyAveMobileClkCnt || 0, +x.monthlyAvePcCtr || 0, +x.monthlyAveMobileCtr || 0, mk]);
    }
    await sleep(110);
  }
  rows.sort((a, b) => (b[1] + b[2]) - (a[1] + a[2]));
  T.seeds[k] = { at: new Date().toISOString(), rows }; found += rows.length;
  if (++n % 10 === 0) { save(); console.error(`  ${n}/${todo.length} · ${((Date.now() - t0) / 60000).toFixed(1)}분 · 찾은 꼬리 ${found.toLocaleString()}`); }
}
save();
console.error(`끝  ${n}개 · ${((Date.now() - t0) / 60000).toFixed(1)}분 · 호출 ${calls.toLocaleString()} · 찾은 꼬리 ${found.toLocaleString()}`);
