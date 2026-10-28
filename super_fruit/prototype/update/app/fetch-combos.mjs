#!/usr/bin/env node
/**
 * 품목 이름 + 쓰임 · 요리 · 정보 말(손질 · 효능 · 구이 · 조림 · 칼국수 …)을 네이버 키워드도구에 정확히 그 말로 묻는다 (2026-10-28)
 *
 * 왜
 *   fetch-tails.mjs 는 사려는 사람이 치는 말(1kg · 가격 · 국내산 …)만 붙였다. 보갬: "아이템스카우트와 네이버에 있는 키워드는 1도 빠지면 안 된다."
 *   네이버는 연관 목록에 띄우지 않는 조합 키워드가 많다 — 보말은 연관 목록이 자기 하나뿐이라 보말칼국수 · 보말손질은 물어야만 나온다.
 *   검색광고 공식 API 에 "이 키워드의 숫자를 달라" 고 5개씩 묻는다. 크롤링이 아니다.
 *
 * 씨앗   data-relidx.js 의 품목 씨앗(묶음 1~6) + 품목 사전(vocab-result.json)에서 네이버에 있는 이름
 * 결과   naver-out/related-combos.ndjson 에 { at, rows } 한 줄씩 (씨앗 이름 없이 — 값만 쓰는 목록. build-web 이 키워드로 담는다)
 *        naver-out/combos-done.json 에 씨앗마다 물은 날 (--max-age 일 안에 물은 씨앗은 건너뜀, 기본 30)
 *
 * 실행:  node fetch-combos.mjs [--workers 2] [--max-age 30] [--max-calls N]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;
const OUTDIR = path.join(ROOT, "naver-out");
const OUT = path.join(OUTDIR, "related-combos.ndjson"), DONE = path.join(OUTDIR, "combos-done.json");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const WORKERS = +(val("--workers") || 2), MAX_AGE_D = +(val("--max-age") || 30), MAXCALLS = val("--max-calls") != null ? +val("--max-calls") : Infinity;

/* 붙이는 말 — fetch-tails 에 없는 것. 뒤에 붙는 말 · 앞에 붙는 말 */
const TAIL = ["손질", "손질법", "효능", "요리", "레시피", "보관법", "보관", "먹는법", "칼로리", "제철", "구이", "조림", "무침", "볶음", "찜", "탕", "국", "죽",
  "전", "회", "장", "젓", "젓갈", "즙", "청", "가루", "말랭이", "칩", "장아찌", "김치", "샐러드", "스테이크", "밀키트", "칼국수", "라면", "비빔밥", "덮밥", "솥밥",
  "튀김", "냉동", "생물", "활", "자연산", "양식", "선물세트", "세트", "파는곳", "도매", "경매", "공판장", "농장", "철", "원산지", "종류", "부위", "삶는법", "까는법", "고르는법"];
const HEAD = ["제주", "제주도", "국산", "수입", "자연산", "활", "생", "냉동", "손질", "깐", "말린", "건", "반건조", "볶은", "구운", "삶은", "찐", "통", "대"];
/* 산지 머리말은 검색 많은 품목(월 5,000↑)에만 — 바나나 · 쌀 같은 품목에 지역을 다 붙이면 대부분 없는 말이다 */
const REGION = ["통영", "여수", "완도", "남해", "거제", "포항", "영덕", "울진", "강릉", "속초", "목포", "신안", "고흥", "보성", "해남", "진도", "영광", "부안", "태안", "서산",
  "청송", "영주", "안동", "상주", "의성", "성주", "충주", "괴산", "논산", "공주", "부여", "청양", "고창", "나주", "담양", "하동", "산청", "밀양", "청도", "경산", "울릉도", "강화", "이천", "홍천", "평창", "정선", "횡성"];

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

/* 씨앗 */
const require = createRequire(import.meta.url);
globalThis.window = {}; require(path.join(HERE, "data-relidx.js"));
const idx = globalThis.window.RELIDX.seeds || {};
/* 한 글자 품목(귤 · 배 · 감 · 밤 · 쌀 · 김 · 무 · 굴 · 콩 · 꿀 …)도 씨앗이다 — 귤효능 · 배즙 · 밤조림 이 여기서 나온다 (10/28 처음에 빼서 귤효능이 없었다) */
const seeds = new Set(Object.keys(idx).filter(k => idx[k] <= 6 && k.length >= 1 && k.length <= 8 && !/[0-9a-z]/i.test(k)));
try { for (const [k, x] of Object.entries(JSON.parse(fs.readFileSync(path.join(OUTDIR, "vocab-result.json"), "utf8")))) if (x.found && x.vol >= 30 && k.length <= 8) seeds.add(k); } catch {}
const VOL = new Map();
require(path.join(HERE, "data-kw.js")); for (const r of globalThis.window.KWROWS) VOL.set(r[0], (r[1] || 0) + (r[2] || 0));
try { for (const [k, x] of Object.entries(JSON.parse(fs.readFileSync(path.join(OUTDIR, "vocab-result.json"), "utf8")))) if (x.vol && !VOL.has(k)) VOL.set(k, x.vol); } catch {}
let done = {}; try { done = JSON.parse(fs.readFileSync(DONE, "utf8")); } catch {}
const ONLYSEEDS = val("--seeds") ? new Set(val("--seeds").split(",").map(x => x.trim()).filter(Boolean)) : null;   // --seeds 귤,배 → 그 씨앗만 (씨앗 목록에 없어도 묻는다)
if (ONLYSEEDS) for (const k of ONLYSEEDS) seeds.add(k);
const todo = [...seeds].filter(k => (!ONLYSEEDS || ONLYSEEDS.has(k)) && !(done[k] && Date.now() - Date.parse(done[k]) < MAX_AGE_D * 864e5)).sort((a, b) => (VOL.get(b) || 0) - (VOL.get(a) || 0));
/* 묻는 묶음: 씨앗마다 후보를 만들어 5개씩 */
const jobs = [];
for (const k of todo) { const heads = (VOL.get(k) || 0) >= 5000 ? [...HEAD, ...REGION] : HEAD;
  const cand = [...new Set([...TAIL.map(m => k + m), ...heads.map(m => m + k)])].filter(c => c.length <= 20 && c !== k);
  for (let i = 0; i < cand.length; i += 5) jobs.push({ k, g: cand.slice(i, i + 5), last: i + 5 >= cand.length }); }
console.error(`조합 키워드  씨앗 ${seeds.size.toLocaleString()}개 중 물을 것 ${todo.length.toLocaleString()} · 묻는 횟수 약 ${jobs.length.toLocaleString()}회 (${WORKERS}갈래)`);
const t0 = Date.now(); let ji = 0, found = 0, fail = 0, n = 0, stop = false;
const saveDone = () => { fs.writeFileSync(DONE + ".tmp", JSON.stringify(done), "utf8"); fs.renameSync(DONE + ".tmp", DONE); };
async function worker() {
  while (ji < jobs.length && !stop) {
    if (calls >= MAXCALLS) { stop = true; break; }
    const jb = jobs[ji++], want = new Set(jb.g.map(x => x.toUpperCase()));
    const r = await kt(jb.g);
    if (r.ok) {
      const rows = (r.json?.keywordList || []).filter(x => want.has(String(x.relKeyword).replace(/\s+/g, "").toUpperCase()))
        .map(x => [x.relKeyword, num(x.monthlyPcQcCnt), num(x.monthlyMobileQcCnt), +x.plAvgDepth || 0, COMPI[x.compIdx] || 0,
          +x.monthlyAvePcClkCnt || 0, +x.monthlyAveMobileClkCnt || 0, +x.monthlyAvePcCtr || 0, +x.monthlyAveMobileCtr || 0, masked(x.monthlyPcQcCnt) || masked(x.monthlyMobileQcCnt) ? 1 : 0]);
      /* 네이버는 묻는 말을 "< 10" 으로라도 돌려준다 — 검색 30 아래는 담지 않는다 (fetch-tails 와 같은 기준) */
      rows.splice(0, rows.length, ...rows.filter(x => x[1] + x[2] >= 30));
      if (rows.length) { fs.appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), rows }) + "\n", "utf8"); found += rows.length; }
    } else { fail++; if (fail > 50 && fail > n * 0.3) { console.error("실패가 너무 많다. 멈춘다.", r.status); stop = true; } }
    if (jb.last) done[jb.k] = new Date().toISOString();
    if (++n % 500 === 0) { saveDone(); console.error(`  ${n.toLocaleString()}/${jobs.length.toLocaleString()} · ${((Date.now() - t0) / 60000).toFixed(1)}분 · 찾은 키워드 ${found.toLocaleString()} · 실패 ${fail}`); }
    await sleep(100);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
saveDone();
console.error(`끝  ${n.toLocaleString()}회 · ${((Date.now() - t0) / 60000).toFixed(1)}분 · 네이버에 있던 조합 키워드 ${found.toLocaleString()} · 실패 ${fail}`);
