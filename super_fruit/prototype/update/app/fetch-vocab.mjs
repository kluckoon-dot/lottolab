#!/usr/bin/env node
/**
 * 신선식품 품목 이름 사전(vocab-fresh.json)의 이름을 하나씩 네이버 키워드도구에 직접 묻는다 (2026-10-28)
 *
 * 왜
 *   보갬: "'보말' 같은 키워드는 아이템스카우트와 네이버 키워드도구에 다 있는데 우리 키워드랩에는 없다. 이런 케이스가 1도 있어서는 안 된다."
 *   네이버에 보말을 물으면 월 15,040 인데 연관 목록에는 보말 자기 하나만 준다 — 다른 어떤 키워드의 연관 목록에도 안 나온다.
 *   연관 목록을 따라가서는 영영 닿지 않는 '외딴 키워드' 다. 품목 이름을 우리가 먼저 알고 직접 물어야 잡힌다.
 *
 * 무엇을
 *   사전의 이름마다 키워드도구에 한 번 묻고 그 목록을 naver-out/related-vocab.ndjson 에 { k, g, at, rows } 로 적는다
 *   (g = 묶음 1 과일 · 2 채소 · 3 견과/쌀잡곡/건과 · 4 수산/건어물 · 5 정육/계란 · 6 김치/반찬).
 *   받은 지 --max-age 일(기본 7) 안에 품목 씨앗 · 키워드별 목록 · 이 사전으로 물은 이름은 건너뛴다.
 *   끝나면 naver-out/vocab-result.json 에 이름마다 { found(네이버에 그 이름이 있음), vol, had(우리 자료에 이미 있었음), rows, fresh(우리에게 없던 줄) }.
 *   매일 수집의 2단계가 related-vocab.ndjson 을 related-more.ndjson 에 합친다(--merge).
 *   검색광고 API 만 쓴다.
 *
 * 실행:  node fetch-vocab.mjs              사전 전부 (약 2,800개 · 15분쯤)
 *        node fetch-vocab.mjs --merge      related-vocab.ndjson 을 related-more.ndjson 뒤에 붙이고 비운다
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;
const OUTDIR = path.join(ROOT, "naver-out");
const VOC = path.join(OUTDIR, "related-vocab.ndjson"), MORE = path.join(OUTDIR, "related-more.ndjson"), RES = path.join(OUTDIR, "vocab-result.json");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const MAX_AGE_D = +(val("--max-age") || 7);

if (args.includes("--merge")) {
  let t = ""; try { t = fs.readFileSync(VOC, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const lines = t.split("\n").filter(l => l.trim()).length;
  if (lines) { fs.appendFileSync(MORE, t.endsWith("\n") ? t : t + "\n", "utf8"); fs.writeFileSync(VOC, "", "utf8"); }
  console.error(`품목 사전 목록 ${lines}개를 related-more.ndjson 에 합쳤다`);
  process.exit(0);
}

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
const norm = s => String(s).replace(/\s+/g, "").toUpperCase();
const GRP = { "과일": 1, "채소": 2, "견과류": 3, "쌀/잡곡": 3, "건과류": 3, "수산물": 4, "건어물": 4, "정육": 5, "계란/알류": 5, "김치": 6, "반찬": 6 };

/* 사전 */
const V = JSON.parse(fs.readFileSync(path.join(HERE, "vocab-fresh.json"), "utf8"));
const names = new Map();
for (const [key, list] of Object.entries(V)) { if (key === "_") continue; const g = GRP[key.split("|")[0]]; if (!g) continue;
  for (const w of list) { const k = String(w).replace(/\s+/g, ""); if (k && k.length <= 20 && !names.has(k)) names.set(k, { g, leaf: key }); } }

/* 우리 자료에 이미 있는 키워드 · 최근에 물은 씨앗 */
const require = createRequire(import.meta.url);
globalThis.window = {}; require(path.join(HERE, "data-kw.js")); require(path.join(HERE, "data-head.js"));
const known = new Set(globalThis.window.KWROWS.map(r => norm(r[0])));
for (let q = 0; q < (globalThis.window.KWHEAD.dictN || 0); q++) { require(path.join(HERE, "data-dict-" + q + ".js")); for (const r of globalThis.window.KWDICT[q].rows) known.add(norm(r[0])); }
const asked = new Map();
const mark = (k, at) => { if (!k) return; const o2 = asked.get(k); if (!o2 || at > o2) asked.set(k, at); };
try { const raw = JSON.parse(fs.readFileSync(path.join(OUTDIR, "related-raw.json"), "utf8")); for (const [k, v] of Object.entries(raw.seeds || {})) mark(k, v.at); } catch {}
for (const f of [MORE, VOC]) { try { for (const line of fs.readFileSync(f, "utf8").split("\n")) { const m = /^\{"k":"((?:[^"\\]|\\.)*)","g":\d+,"at":"([^"]+)"/.exec(line); if (m) mark(JSON.parse('"' + m[1] + '"'), m[2]); } } catch {} }
const recent = k => asked.has(k) && Date.now() - Date.parse(asked.get(k)) < MAX_AGE_D * 864e5;

let res = {}; try { res = JSON.parse(fs.readFileSync(RES, "utf8")); } catch {}
const todo = [...names.entries()].filter(([k]) => !recent(k));
console.error(`품목 사전 ${names.size.toLocaleString()}개 · 최근에 물은 것 ${(names.size - todo.length).toLocaleString()} · 물을 것 ${todo.length.toLocaleString()}`);
const t0 = Date.now(); let n = 0, fail = 0;
for (const [k, { g, leaf }] of todo) {
  const r = await kt(k), at = new Date().toISOString();
  if (r.ok) {
    const rows = (r.json?.keywordList || []).map(x => [x.relKeyword, num(x.monthlyPcQcCnt), num(x.monthlyMobileQcCnt), +x.plAvgDepth || 0, COMPI[x.compIdx] || 0,
      +x.monthlyAvePcClkCnt || 0, +x.monthlyAveMobileClkCnt || 0, +x.monthlyAvePcCtr || 0, +x.monthlyAveMobileCtr || 0, masked(x.monthlyPcQcCnt) || masked(x.monthlyMobileQcCnt) ? 1 : 0]);
    if (rows.length) fs.appendFileSync(VOC, JSON.stringify({ k, g, at, rows }) + "\n", "utf8");
    const self = rows.find(x => norm(x[0]) === norm(k));
    res[k] = { g, leaf, found: !!self, vol: self ? self[1] + self[2] : 0, had: known.has(norm(k)), rows: rows.length, fresh: rows.filter(x => !known.has(norm(x[0]))).length, at };
  } else { fail++; res[k] = { g, leaf, error: r.status, at }; }
  if (++n % 200 === 0) { fs.writeFileSync(RES, JSON.stringify(res), "utf8"); console.error(`  ${n}/${todo.length} · ${((Date.now() - t0) / 60000).toFixed(1)}분 · 실패 ${fail}`); }
  await sleep(120);
}
fs.writeFileSync(RES, JSON.stringify(res), "utf8");
const all = Object.entries(res), found = all.filter(([, x]) => x.found), miss = found.filter(([, x]) => !x.had);
console.error(`끝  ${n}개 · ${((Date.now() - t0) / 60000).toFixed(1)}분 · 실패 ${fail}`);
console.error(`네이버에 있는 품목 이름 ${found.length.toLocaleString()} · 그중 우리 자료에 없던 것 ${miss.length.toLocaleString()} · 목록에서 새로 들어오는 줄 ${all.reduce((s, [, x]) => s + (x.fresh || 0), 0).toLocaleString()}`);
console.error("  없던 것 (검색 많은 순): " + miss.sort((a, b) => b[1].vol - a[1].vol).slice(0, 60).map(([k, x]) => `${k}(${x.vol.toLocaleString()})`).join(" · "));
