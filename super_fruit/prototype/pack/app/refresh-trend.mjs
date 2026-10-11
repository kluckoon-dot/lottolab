#!/usr/bin/env node
/**
 * 화면 키워드의 3년 주간 추세를 다시 받는다 — 검색수 추세와 쇼핑 클릭 추세
 *
 * 왜
 *   저장된 추세(trend.json)는 9월 14일에서 끝나고 검색 추세뿐이다. 그래서 실시간 서버 없이 여는 화면
 *   (claude.ai 페이지)에서는 종합차트의 "클릭량" 이 꺼져 있고, 검색수 곡선도 한 달 전에서 멈춰 있었다.
 *
 * 받는 것 (NAVER API HUB, 한 번에 키워드 5개 · 주간 · 157주)
 *   검색어트렌드   /search-trend/v1/search                검색 상대지수
 *   쇼핑인사이트   /shopping/v1/category/keywords (식품)   쇼핑 클릭 상대지수
 *
 * 네이버는 한 번에 넣은 키워드들 중 제일 큰 값을 100 으로 둔 상대값을 준다.
 * 추세는 모양만 쓰므로 키워드마다 자기 최고점을 100 으로 다시 맞춰 한 주를 한 글자로 접는다 (pack-data.mjs 와 같은 90단계).
 * 마지막 주가 덜 차면 곡선 끝이 꺾여 보이므로 지난 일요일까지만 받는다.
 *
 * 실행:  node refresh-trend.mjs            화면 목록 중 식품 판정을 통과한 것 전부
 *        node refresh-trend.mjs --keywords 청도반시,밤
 * 멈춰도 다시 실행하면 남은 것만 받는다. 결과: naver-out/trend-fresh.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;
const OUTDIR = path.join(ROOT, "naver-out");
const OUT = path.join(OUTDIR, "trend-fresh.json");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const WORKERS = +(val("--workers") || 3);
const CAT = "50000006";
const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^_{|}~";

function loadKeys() {
  const AL = { naver_hub_id: "ID", hub_client_id: "ID", clientid: "ID", client_id: "ID", 허브id: "ID", naver_hub_secret: "SECRET", hub_client_secret: "SECRET", clientsecret: "SECRET", client_secret: "SECRET" };
  for (const dir of [...new Set([ROOT, process.cwd(), HERE])]) {
    let raw; try { raw = fs.readFileSync(path.join(dir, "key.txt"), "utf8"); } catch { continue; }
    const o = {};
    for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) {
      const i = line.indexOf("="); if (i < 0) continue;
      const k = AL[line.slice(0, i).trim().toLowerCase().replace(/[\s-]/g, "")], v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (k && v) o[k] = v;
    }
    if (o.ID) return o;
  }
  return {};
}
const { ID, SECRET } = loadKeys();
if (!(ID && SECRET)) { console.error("key.txt 에 API HUB 키(B 칸)가 없다."); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function hub(p, body) {
  let last = { ok: false, status: 0 };
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch("https://naverapihub.apigw.ntruss.com" + p, { method: "POST", body: JSON.stringify(body),
        headers: { "X-NCP-APIGW-API-KEY-ID": ID, "X-NCP-APIGW-API-KEY": SECRET, "Content-Type": "application/json" } });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      last = { ok: r.ok && !!(j && j.results), status: r.status, json: j, text: t.slice(0, 140) };
      if (r.status !== 429 && r.status < 500) return last;
    } catch (e) { last = { ok: false, status: "연결실패", text: String(e.message || e) }; }
    await sleep(1500 * (a + 1));
  }
  return last;
}

/* ── 기간: 지난 일요일까지 157주 ── */
const ymd = d => d.toISOString().slice(0, 10);
const today = new Date(); const u = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
const dow = u.getUTCDay();                                   // 0 = 일요일
const lastSun = new Date(u.getTime() - (dow === 0 ? 7 : dow) * 864e5);
const WEEKS = 157;
const start = new Date(lastSun.getTime() - (WEEKS * 7 - 1) * 864e5);   // 월요일
const periods = Array.from({ length: WEEKS }, (_, i) => ymd(new Date(start.getTime() + i * 7 * 864e5)));
const pidx = new Map(periods.map((p, i) => [p, i]));
const START = ymd(start), END = ymd(lastSun);

/* ── 대상 ── */
const clean = s => String(s).replace(/[\s&/,·]+/g, "");
let targets;
if (val("--keywords")) targets = val("--keywords").split(",").map(x => x.trim()).filter(Boolean);
else {
  const list = fs.readFileSync(path.join(OUTDIR, "section-keywords.txt"), "utf8").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  let food = null; try { food = JSON.parse(fs.readFileSync(path.join(OUTDIR, "fresh.json"), "utf8")).rows; } catch {}
  /* 식품 쇼핑 클릭이 없는 키워드는 화면에 안 나온다. 받지 않는다 */
  targets = food ? list.filter(k => food[k] && food[k].f === 1) : list;
}
targets = [...new Set(targets)].filter(k => clean(k) && clean(k).length <= 40);

let F = { start: START, end: END, unit: "week", periods, search: {}, click: {} };
try { const p = JSON.parse(fs.readFileSync(OUT, "utf8")); if (p.start === START && p.end === END) F = p; else console.error(`기간이 바뀌었다 (${p.start}~${p.end} → ${START}~${END}). 처음부터 다시 받는다.`); } catch {}
const todo = targets.filter(k => !(k in F.search));
console.error(`\n3년 주간 추세  ${START} ~ ${END} (${WEEKS}주) · 대상 ${targets.length.toLocaleString()}개 · 남은 것 ${todo.length.toLocaleString()}개\n`);

const encode = data => {
  const v = new Array(WEEKS).fill(0); let mx = 0;
  for (const d of data || []) { const i = pidx.get(d.period); if (i != null) { v[i] = +d.ratio || 0; if (v[i] > mx) mx = v[i]; } }
  if (!(mx > 0)) return "";
  return v.map(x => A[Math.round(x / mx * (A.length - 1))]).join("");
};
const save = () => { F.at = new Date().toISOString(); fs.mkdirSync(OUTDIR, { recursive: true }); fs.writeFileSync(OUT + ".tmp", JSON.stringify(F), "utf8"); fs.renameSync(OUT + ".tmp", OUT); };

const groups = []; for (let i = 0; i < todo.length; i += 5) groups.push(todo.slice(i, i + 5));
let gi = 0, done = 0, calls = 0, fails = 0, stop = false; const t0 = Date.now();
async function worker() {
  while (gi < groups.length && !stop) {
    const g = groups[gi++];
    const [s, c] = await Promise.all([
      hub("/search-trend/v1/search", { startDate: START, endDate: END, timeUnit: "week", keywordGroups: g.map(k => ({ groupName: k, keywords: [clean(k)] })) }),
      hub("/shopping/v1/category/keywords", { startDate: START, endDate: END, timeUnit: "week", category: CAT, keyword: g.map(k => ({ name: k, param: [clean(k)] })) })
    ]);
    calls += 2;
    if (s.status === 401 || s.status === 403 || c.status === 401 || c.status === 403) { console.error("API HUB 가 키를 거부했다 " + (s.text || c.text)); stop = true; break; }
    if (!s.ok && !c.ok) { fails++; if (fails <= 3) console.error("  실패", g.join(","), s.status, c.status, s.text || c.text); continue; }
    for (const k of g) {
      F.search[k] = s.ok ? encode(s.json.results.find(x => x.title === k)?.data) : "";
      F.click[k] = c.ok ? encode(c.json.results.find(x => x.title === k)?.data) : "";
    }
    done += g.length;
    if (gi % 100 === 0) { save(); console.error(`  ${done.toLocaleString()}/${todo.length.toLocaleString()} · 호출 ${calls} · ${((Date.now() - t0) / 60000).toFixed(1)}분`); }
    await sleep(40);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
save();
const ns = Object.values(F.search).filter(Boolean).length, nc = Object.values(F.click).filter(Boolean).length;
console.error(`\n끝  ${((Date.now() - t0) / 60000).toFixed(1)}분 · 호출 ${calls.toLocaleString()} · 검색 추세 ${ns.toLocaleString()}개 · 클릭 추세 ${nc.toLocaleString()}개 · 실패 묶음 ${fails}`);
console.error(`→ ${OUT}`);
