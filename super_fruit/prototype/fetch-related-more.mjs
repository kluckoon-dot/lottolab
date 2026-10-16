#!/usr/bin/env node
/**
 * 품목 이름 말고도, 화면의 신선식품 키워드 하나하나에 대해 네이버 키워드도구의 연관 목록을 받아 둔다
 *
 * 왜
 *   build-related.mjs 는 품목 · 품종 이름 442개만 받았다. 그 밖의 키워드(감홍사과 · 홍천사과 …)를 찾으면 화면은
 *   "수집할 때 그 씨앗에서 처음 나온 키워드" 를 보여 줬는데, 그건 네이버 목록의 자투리(다른 씨앗에서 안 나온 것)라서
 *   감홍사과에 멜론 · 미니오이 · 오이피클이 떴다. 네이버에 직접 물으면 감홍사과는 사과 키워드 387개를 준다.
 *   그래서 키워드마다 직접 묻는다 (보갬, 2026-10-12: "대책이 시급하다. 빨리 자료 확보하고 분류해서 해결하자").
 *
 * 무엇을
 *   화면 데이터(data-kw.js)에서 신선식품 칸에 드는 키워드를 급한 순서(과일 → 채소 → 견과 · 쌀/잡곡 · 건과 → 수산 · 건어물 → 정육 · 계란),
 *   그 안에서는 검색 많은 순으로 하나씩 키워드도구에 묻는다. 이미 품목 씨앗으로 받은 것은 건너뛴다.
 *   응답은 naver-out/related-more.ndjson 에 한 줄씩 덧붙인다 (멈추면 이어서 받는다).
 *     { k, g, at, rows:[[kw, pc, mo, depth, comp, clickPc, clickMo, ctrPc, ctrMo, masked], …] }
 *   검색광고 API 만 쓴다. API HUB 한도는 쓰지 않는다.
 *
 * 실행:  node fetch-related-more.mjs                 검색 100 이상 전부
 *        node fetch-related-more.mjs --min 1000      검색 1,000 이상만
 *        node fetch-related-more.mjs --only 1        과일만      --max 500   이번에 500개까지만
 *        node fetch-related-more.mjs --max-age 6     받은 지 6일 넘은 목록은 다시 받는다 (정기 수집용. 기본 30일)
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
const MORE = path.join(OUTDIR, "related-more.ndjson");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const ONLY = val("--only") ? new Set(val("--only").split(",").map(Number)) : null;
const MIN = +(val("--min") || 100), MAX = +(val("--max") || 1e9), MAX_AGE_D = +(val("--max-age") || 30);

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
async function kt(hint) {
  const p = "/keywordstool";
  for (let a = 0; a < 6; a++) {
    calls++;
    try {
      const ts = String(Date.now()), sig = crypto.createHmac("sha256", o.SECRET).update(`${ts}.GET.${p}`).digest("base64");
      const r = await fetch("https://api.searchad.naver.com" + p + "?hintKeywords=" + encodeURIComponent(hint.slice(0, 20)) + "&showDetail=1",
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

/* ── 씨앗 후보: 화면의 신선식품 키워드 (분류는 화면과 같은 코드) ── */
const html = fs.readFileSync(path.join(HERE, "keyword-lab.html"), "utf8").replace(/\r\n/g, "\n");
const a0 = html.indexOf("var CAT_VAR="), b0 = html.indexOf("/* 줄마다 한 번만 낸다:");
const sm = /var SEEDS=(\[[^\n]*\]);/.exec(html);
if (a0 < 0 || b0 < 0 || !sm) { console.error("keyword-lab.html 에서 분류기를 못 찾았다."); process.exit(1); }
const ctx = {}; vm.createContext(ctx); vm.runInContext(html.slice(a0, b0) + "\nthis.catMake=catMake;this.CAT_MAP=CAT_MAP;", ctx);
const cat = ctx.catMake(JSON.parse(sm[1])), MAP = ctx.CAT_MAP;
const GROUP = { "과일": 1, "채소": 2, "견과류": 3, "쌀/잡곡": 3, "건과류": 3, "수산물": 4, "건어물": 4, "정육": 5, "계란/알류": 5 };
const require = createRequire(import.meta.url);
globalThis.window = {}; require(path.join(HERE, "data-kw.js"));
/* 글자로 품목을 못 읽어도 네이버 이웃 품목이 있으면(엔부 → 사과 · build-web.mjs) 씨앗으로 받는다. 그런 키워드는 섹션 밖 사전(data-dict-N.js)에 있다 */
let NBH = {}; const DROWS = [];
try { require(path.join(HERE, "data-head.js")); NBH = (globalThis.window.KWHEAD && globalThis.window.KWHEAD.nb) || {}; } catch {}
for (let q = 0; q < 64; q++) { const f = path.join(HERE, "data-dict-" + q + ".js"); if (!fs.existsSync(f)) break; require(f); for (const r of globalThis.window.KWDICT[q].rows) if (NBH[r[0]]) DROWS.push(r); }
let have = {}; try { require(path.join(HERE, "data-relidx.js")); have = globalThis.window.RELIDX.seeds || {}; } catch {}
/* 받아 둔 것: 씨앗마다 가장 최근 줄만 남긴다(다시 받으면 줄이 쌓인다). 받은 지 오래된 씨앗은 다시 받는다 — 옛 줄은 새 줄이 들어올 때까지 그대로 둔다 */
const done = new Set();
if (fs.existsSync(MORE)) {
  const last = new Map(); let lines = 0;
  for (const line of fs.readFileSync(MORE, "utf8").split("\n")) { if (!line) continue; lines++; const m = /^\{"k":"((?:[^"\\]|\\.)*)","g":\d+,"at":"([^"]+)"/.exec(line); if (m) last.set(m[1], [m[2], line]); }
  if (lines > last.size) { fs.writeFileSync(MORE + ".tmp", [...last.values()].map(x => x[1]).join("\n") + "\n", "utf8"); fs.renameSync(MORE + ".tmp", MORE); console.error(`겹친 줄 ${(lines - last.size).toLocaleString()}개를 정리했다`); }
  for (const [k, v] of last) if (Date.now() - Date.parse(v[0]) < MAX_AGE_D * 86400e3) done.add(JSON.parse('"' + k + '"'));
}
let cand = [];
for (const r of [...globalThis.window.KWROWS, ...DROWS]) {
  const kw = r[0], raw = cat(kw) || NBH[kw] || "", m = raw && MAP[raw]; if (!m || !m[0].startsWith("신선식품 > ")) continue;
  const g = GROUP[m[0].replace("신선식품 > ", "")]; if (!g || (ONLY && !ONLY.has(g))) continue;
  const key = kw.replace(/\s+/g, ""), v = (r[1] || 0) + (r[2] || 0);
  if (v < MIN || (have[key] && have[key] <= 5) || done.has(key)) continue;
  cand.push([key, g, v]);
}
cand.sort((x, y) => x[1] - y[1] || y[2] - x[2]);
cand = cand.slice(0, MAX);
console.error(`받을 씨앗 ${cand.length.toLocaleString()}개 (검색 ${MIN}↑ · 이미 받은 것 ${done.size.toLocaleString()}) · ` + [1, 2, 3, 4, 5].map(g => g + ":" + cand.filter(x => x[1] === g).length).join(" "));

fs.mkdirSync(OUTDIR, { recursive: true });
const t0 = Date.now(); let n = 0, fail = 0, rows = 0;
for (const [k, g] of cand) {
  const r = await kt(k);
  if (r.ok) {
    const list = (r.json?.keywordList || []).map(x => [x.relKeyword, num(x.monthlyPcQcCnt), num(x.monthlyMobileQcCnt), +x.plAvgDepth || 0, COMPI[x.compIdx] || 0,
      +x.monthlyAvePcClkCnt || 0, +x.monthlyAveMobileClkCnt || 0, +x.monthlyAvePcCtr || 0, +x.monthlyAveMobileCtr || 0, masked(x.monthlyPcQcCnt) || masked(x.monthlyMobileQcCnt) ? 1 : 0]);
    fs.appendFileSync(MORE, JSON.stringify({ k, g, at: new Date().toISOString(), rows: list }) + "\n", "utf8"); rows += list.length;
  } else { fail++; if (fail > 30 && fail > n * 0.5) { console.error("실패가 너무 많다. 멈춘다.", r.status); break; } }
  if (++n % 50 === 0) console.error(`  ${n}/${cand.length} · ${((Date.now() - t0) / 60000).toFixed(1)}분 · 줄 ${rows.toLocaleString()} · 실패 ${fail}`);
  await sleep(120);
}
console.error(`끝  ${n}개 · ${((Date.now() - t0) / 60000).toFixed(1)}분 · 호출 ${calls.toLocaleString()} · 줄 ${rows.toLocaleString()} · 실패 ${fail}`);
