#!/usr/bin/env node
/**
 * 아이템스카우트 연관키워드 목록을 저장된 화면(claude.ai 페이지)에도 싣는다
 *
 * 왜
 *   연관키워드는 아이템스카우트와 같은 목록이어야 한다 (보갬, 2026-10-11).
 *   그런데 그 목록은 네이버 공식 API 로 다시 만들 수 없다 — 네이버 키워드도구는 씨앗 하나에 연관을 백여 개만 주고
 *   (밤 125개), 아이템스카우트는 여러 장터의 연관 · 자동완성 · 상품명 낱말까지 모아 330개를 보여준다.
 *   같은 목록을 보여줄 길은 하나다: 보갬이 받아 넣는곳\아이템스카우트 에 둔 엑셀의 목록을 그대로 쓰는 것.
 *   PC 에서는 화면이 열릴 때 그 엑셀을 읽어 바로 같은 목록이 된다. 저장된 화면에는 이 스크립트가 실어 준다.
 *
 * 무엇을
 *   naver-out/uploads 에 저장된 아이템스카우트 목록(화면이 엑셀을 읽으며 저장해 둔 것)을 읽고,
 *   목록의 키워드마다 네이버 지금 값(검색수 · 클릭 · 입찰가 · 쇼핑 지수)을 실시간 서버에 물어 app/data-is.js 로 쓴다.
 *   아이템스카우트의 검색수는 낡은 값이라 쓰지 않는다 — 목록과 상품수 · 카테고리 · 분류만 쓴다.
 *
 * 주의  data-is.js 는 아이템스카우트에서 받은 자료다. 공개 저장소에 올리지 않는다 (저장소에는 빈 파일만 둔다).
 *
 * 실행:  "1 키워드랩 열기" 를 켜 둔 채로   node build-islist.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;
const UP = path.join(ROOT, "naver-out", "uploads");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const BASE = "http://127.0.0.1:" + (val("--port") || 8787);
const OUT = val("--out") || path.join(HERE, "data-is.js");
const sleep = ms => new Promise(r => setTimeout(r, ms));

let recs = [];
try { recs = fs.readdirSync(UP).filter(f => f.endsWith(".json")).map(f => JSON.parse(fs.readFileSync(path.join(UP, f), "utf8"))).filter(r => r.kind === "itemscout" && r.rows && r.rows.length); }
catch { console.error("naver-out/uploads 가 없다. 엑셀을 넣는곳\\아이템스카우트 에 두고 '1 키워드랩 열기' 를 한 번 열어라."); process.exit(1); }
if (!recs.length) { fs.writeFileSync(OUT, "window.ISRECS=[];", "utf8"); console.error("아이템스카우트 목록이 없다. 빈 파일을 썼다."); process.exit(0); }
try { const p = await fetch(BASE + "/api/ping"); if (!(await p.json()).keys) throw 0; } catch { console.error("실시간 서버가 꺼져 있다. '1 키워드랩 열기' 를 켜 둔 채로 다시 실행해라."); process.exit(1); }

const COMPI = { "낮음": 0, "중간": 1, "높음": 2 };
const seedOf = r => { const m = /^(.+?)_키워드_itemscout/.exec(r.file || ""); return m ? m[1] : (r.rows[0] || {}).kw || ""; };
recs.sort((a, b) => String(a.at).localeCompare(String(b.at)));
const out = [];
for (const rec of recs) {
  const kws = [...new Set(rec.rows.map(r => r.kw))], nums = {}; let liveAt = "";
  for (let i = 0; i < kws.length; i += 30) {
    const part = kws.slice(i, i + 30);
    let j = null;
    for (let t = 0; t < 3 && !j; t++) {
      try { const r = await fetch(BASE + "/api/multi?kws=" + encodeURIComponent(part.join(","))); const x = await r.json(); if (r.ok) j = x; else await sleep(3000); } catch { await sleep(3000); }
    }
    if (!j) { console.error("  네이버 값을 못 받았다:", part.slice(0, 3).join(","), "…"); continue; }
    liveAt = j.at;
    const by = {}; for (const x of j.related || []) by[x.kw] = x;
    for (const k of part) {
      const f = (j.found || {})[k], x = f && by[f]; if (!x) continue;
      const b = (j.bids || {})[f] || { pc: [], mo: [] }, md = (j.med || {})[f] || [], sh = (j.shop || {})[f];
      nums[k] = [x.pc, x.mo, x.depth, COMPI[x.comp] || 0, x.clickPc, x.clickMo, x.ctrPc, x.ctrMo, x.masked ? 1 : 0,
        b.pc[0] || 0, b.pc[1] || 0, b.pc[2] || 0, b.mo[0] || 0, b.mo[1] || 0, b.mo[2] || 0, md[0] || 0, md[1] || 0, sh == null ? -1 : sh];
    }
    process.stderr.write(`  ${seedOf(rec)}  ${Math.min(i + 30, kws.length)}/${kws.length}\r`);
    await sleep(300);
  }
  const got = Object.keys(nums).length;
  console.error(`${seedOf(rec).padEnd(8)} 목록 ${rec.rows.length}개 · 네이버 지금 값 ${got}개 · 못 찾은 것 ${kws.length - got}개  (${rec.file})`);
  out.push({ kind: "itemscout", id: rec.id, file: rec.file, at: rec.at, seed: seedOf(rec), liveAt,
    rows: rec.rows.map(r => ({ kw: r.kw, cat: r.cat || "", cls: r.cls || "", prod: r.prod == null ? null : r.prod, pc: r.pc || 0, mo: r.mo || 0, ctrPc: r.ctrPc || 0, ctrMo: r.ctrMo || 0, clk: r.clk == null ? null : r.clk, n: nums[r.kw] || null })) });
}
const js = "window.ISRECS=" + JSON.stringify(out) + ";";
fs.writeFileSync(OUT, js, "utf8");
console.error(`→ ${OUT}  ${(Buffer.byteLength(js) / 1024).toFixed(0)} KB · 목록 ${out.length}개`);
