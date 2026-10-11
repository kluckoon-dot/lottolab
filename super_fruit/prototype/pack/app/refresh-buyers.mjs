#!/usr/bin/env node
/**
 * 쇼핑 구매층을 저장본에 담는다 — 기기 · 성별 · 연령 · 요일 (네이버 쇼핑인사이트, 식품, 최근 1년)
 *
 * 왜
 *   실시간 서버에서는 고르는 키워드마다 받지만, 저장된 수집본(claude.ai 페이지)에는 9월에 받은 2,200개뿐이라
 *   나머지는 "원본 없음" 으로 나왔다.
 *
 * 어떻게 — 한도가 문제다. 쇼핑인사이트는 한 달 5만 회.
 *   기기·성별·연령 전용 API 는 키워드 하나씩만 받는다(키워드당 3회 → 18,690개면 5.6만 회).
 *   클릭 추세 API(/category/keywords)는 한 번에 5개를 받고 device · gender · ages 로 걸러서 볼 수 있다.
 *   다만 호출마다 따로 100 을 잡으므로 닻(닭가슴살)을 같이 넣는다:
 *       키워드의 PC 클릭 = (키워드 값 ÷ 닻 값)[PC 로 거른 호출] × 닻의 PC 비중
 *   닻의 비중은 전용 API 로 한 번만 받는다. 이렇게 낸 값이 전용 API 와 소수점까지 같다
 *   (청도반시 모바일 76.8 = 76.8 · 여성 54.0 = 54.0, 홍산마늘종자 여성 24.3 = 24.3).
 *   4개 묶음에 10회(PC · 모바일 · 여 · 남 · 10~60대) → 키워드당 2.5회.
 *   요일은 일간 클릭 1년을 요일로 모은다. 모양만 쓰므로 닻 없이 5개씩 → 키워드당 0.2회.
 *
 * 실행:  node refresh-buyers.mjs                    순서: 구매로 이어지는 검색이 큰 키워드부터
 *        node refresh-buyers.mjs --max-calls 9000   이번에 쓸 호출 상한 (기본 9,000). 멈춘 자리에서 이어 받는다
 *        node refresh-buyers.mjs --only weekday     요일만 (싸다)
 * 결과: naver-out/buyers-fresh.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;
const OUTDIR = path.join(ROOT, "naver-out");
const OUT = path.join(OUTDIR, "buyers-fresh.json");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const MAX_CALLS = +(val("--max-calls") || 9000);
const ONLY = val("--only");
const WORKERS = +(val("--workers") || 3);
const CAT = "50000006", ANCHOR = "닭가슴살";

function loadKeys() {
  const AL = { naver_hub_id: "ID", hub_client_id: "ID", clientid: "ID", client_id: "ID", naver_hub_secret: "SECRET", hub_client_secret: "SECRET", clientsecret: "SECRET", client_secret: "SECRET" };
  for (const dir of [...new Set([ROOT, process.cwd(), HERE])]) {
    let raw; try { raw = fs.readFileSync(path.join(dir, "key.txt"), "utf8"); } catch { continue; }
    const o = {};
    for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) { const i = line.indexOf("="); if (i < 0) continue; const k = AL[line.slice(0, i).trim().toLowerCase().replace(/[\s-]/g, "")], v = line.slice(i + 1).trim().replace(/^["']|["']$/g, ""); if (k && v) o[k] = v; }
    if (o.ID) return o;
  }
  return {};
}
const { ID, SECRET } = loadKeys();
if (!(ID && SECRET)) { console.error("key.txt 에 API HUB 키(B 칸)가 없다."); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0, stop = false;
async function hub(p, body) {
  let last = { ok: false, status: 0 };
  for (let a = 0; a < 5; a++) {
    calls++;
    try {
      const r = await fetch("https://naverapihub.apigw.ntruss.com" + p, { method: "POST", body: JSON.stringify(body),
        headers: { "X-NCP-APIGW-API-KEY-ID": ID, "X-NCP-APIGW-API-KEY": SECRET, "Content-Type": "application/json" } });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      last = { ok: r.ok && !!(j && j.results), status: r.status, json: j, text: t.slice(0, 160) };
      if (r.status === 401 || r.status === 403) { stop = true; return last; }
      if (r.status !== 429 && r.status < 500) return last;
    } catch (e) { last = { ok: false, status: "연결실패", text: String(e.message || e) }; }
    await sleep(1500 * (a + 1));
  }
  return last;
}
const ymd = d => d.toISOString().slice(0, 10);
const END = ymd(new Date(Date.now() - 864e5));
const s1 = new Date(END + "T00:00:00Z"); s1.setUTCFullYear(s1.getUTCFullYear() - 1);
const START = ymd(new Date(s1.getTime() + 864e5));
const clean = s => String(s).replace(/[\s&/,·]+/g, "");

/* ── 대상과 순서 ── 구매로 이어지는 검색(검색수 × 구매의도)이 큰 것부터. 화면에서 먼저 보게 되는 순서다 */
let targets;
if (val("--keywords")) targets = val("--keywords").split(",").map(x => x.trim()).filter(Boolean);
else {
  const FR = JSON.parse(fs.readFileSync(path.join(OUTDIR, "fresh.json"), "utf8")).rows;
  const list = fs.readFileSync(path.join(OUTDIR, "section-keywords.txt"), "utf8").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  targets = list.filter(k => FR[k] && FR[k].f === 1 && FR[k].s)
    .map(k => [k, FR[k].c != null ? FR[k].c : 0, FR[k].s[0] + FR[k].s[1]])
    .sort((a, b) => b[1] - a[1] || b[2] - a[2]).map(x => x[0]);
}
targets = [...new Set(targets)].filter(k => k !== ANCHOR && clean(k) && clean(k).length <= 40);

let F = { rule: "d: [모바일‰, 여성‰, 10대‰ … 60대‰] · w: [월‰ … 일‰] · 쇼핑인사이트 식품 최근 1년", d: {}, w: {} };
try { F = JSON.parse(fs.readFileSync(OUT, "utf8")); F.d ||= {}; F.w ||= {}; } catch {}
F.x ||= {};                                    // 실패 횟수. 두 번 실패한 키워드는 건너뛴다
const failed = (g, tag) => { for (const k of g) F.x[tag + k] = (F.x[tag + k] || 0) + 1; };
const dead = (k, tag) => (F.x[tag + k] || 0) >= 2;
const save = () => { F.at = new Date().toISOString(); F.start = START; F.end = END; fs.mkdirSync(OUTDIR, { recursive: true }); fs.writeFileSync(OUT + ".tmp", JSON.stringify(F), "utf8"); fs.renameSync(OUT + ".tmp", OUT); };
const sum = (res, t) => ((res.json?.results || []).find(x => x.title === t)?.data || []).reduce((a, d) => a + (+d.ratio || 0), 0);
const t0 = Date.now();

/* ── 요일 ── 일간 클릭 1년을 요일로 모은다 */
async function doWeekday() {
  const todo = targets.filter(k => !(k in F.w) && !dead(k, "w:"));
  console.error(`요일  ${todo.length.toLocaleString()}개 남음`);
  const groups = []; for (let i = 0; i < todo.length; i += 5) groups.push(todo.slice(i, i + 5));
  let gi = 0, done = 0;
  const worker = async () => {
    while (gi < groups.length && !stop && calls < MAX_CALLS) {
      const g = groups[gi++];
      const r = await hub("/shopping/v1/category/keywords", { startDate: START, endDate: END, timeUnit: "date", category: CAT, keyword: g.map(k => ({ name: k, param: [clean(k)] })) });
      if (!r.ok) { failed(g, "w:"); continue; }
      for (const k of g) {
        const w = [0, 0, 0, 0, 0, 0, 0];
        for (const d of r.json.results.find(x => x.title === k)?.data || []) w[(new Date(d.period + "T00:00:00Z").getUTCDay() + 6) % 7] += +d.ratio || 0;   // 월=0 … 일=6
        const t = w.reduce((a, b) => a + b, 0);
        F.w[k] = t > 0 ? w.map(x => Math.round(x / t * 1000)) : 0;
      }
      done += g.length;
      if (gi % 150 === 0) { save(); console.error(`  요일 ${done.toLocaleString()}/${todo.length.toLocaleString()} · 호출 ${calls}`); }
      await sleep(40);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  save();
}

/* ── 기기 · 성별 · 연령 ── 닻과 함께 거른 호출 10번 */
const AG = ["10", "20", "30", "40", "50", "60"];
async function anchorShares() {
  if (F.anchor && F.anchor.end === END) return F.anchor;
  const one = async dim => { const r = await hub("/shopping/v1/category/keyword/" + dim, { startDate: START, endDate: END, timeUnit: "month", category: CAT, keyword: ANCHOR });
    const s = {}; for (const d of r.json?.results?.[0]?.data || []) s[d.group] = (s[d.group] || 0) + (+d.ratio || 0);
    const T = Object.values(s).reduce((a, b) => a + b, 0); if (!T) throw new Error("닻의 " + dim + " 비중을 못 받았다 " + (r.text || ""));
    return Object.fromEntries(Object.entries(s).map(([g, v]) => [g, v / T])); };
  F.anchor = { kw: ANCHOR, end: END, device: await one("device"), gender: await one("gender"), age: await one("age") };
  save(); return F.anchor;
}
async function doDemo() {
  const A = await anchorShares();
  const todo = targets.filter(k => !(k in F.d) && !dead(k, "d:"));
  console.error(`기기·성별·연령  ${todo.length.toLocaleString()}개 남음 · 닻 ${ANCHOR} 모바일 ${(A.device.mo * 100).toFixed(1)}% · 여성 ${(A.gender.f * 100).toFixed(1)}%`);
  const groups = []; for (let i = 0; i < todo.length; i += 4) groups.push(todo.slice(i, i + 4));
  let gi = 0, done = 0;
  const FILTERS = [["pc", { device: "pc" }, A.device.pc], ["mo", { device: "mo" }, A.device.mo], ["f", { gender: "f" }, A.gender.f], ["m", { gender: "m" }, A.gender.m],
    ...AG.map(a => ["a" + a, { ages: [a] }, A.age[a]])];
  const worker = async () => {
    while (gi < groups.length && !stop && calls + 10 <= MAX_CALLS) {
      const g = groups[gi++];
      const base = { startDate: START, endDate: END, timeUnit: "month", category: CAT, keyword: [{ name: ANCHOR, param: [ANCHOR] }, ...g.map(k => ({ name: k, param: [clean(k)] }))] };
      const v = {}; let bad = false;
      for (const [name, extra, share] of FILTERS) {
        const r = await hub("/shopping/v1/category/keywords", { ...base, ...extra });
        if (!r.ok) { bad = true; break; }
        const a = sum(r, ANCHOR);
        for (const k of g) (v[k] ||= {})[name] = a > 0 ? sum(r, k) / a * (share || 0) : 0;
      }
      if (bad) { failed(g, "d:"); continue; }
      for (const k of g) {
        const x = v[k], td = x.pc + x.mo, tg = x.f + x.m, ta = AG.reduce((s, a) => s + x["a" + a], 0);
        F.d[k] = (td > 0 && tg > 0 && ta > 0) ? [Math.round(x.mo / td * 1000), Math.round(x.f / tg * 1000), ...AG.map(a => Math.round(x["a" + a] / ta * 1000))] : 0;
      }
      done += g.length;
      if (gi % 60 === 0) { save(); console.error(`  구매층 ${done.toLocaleString()}/${todo.length.toLocaleString()} · 호출 ${calls} · ${((Date.now() - t0) / 60000).toFixed(1)}분`); }
      await sleep(30);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  save();
}

console.error(`\n쇼핑 구매층  ${START} ~ ${END} · 대상 ${targets.length.toLocaleString()}개 · 이번 호출 상한 ${MAX_CALLS.toLocaleString()}\n`);
if (ONLY !== "demo") await doWeekday();
if (ONLY !== "weekday" && !stop) await doDemo();
save();
const nd = Object.values(F.d).filter(Boolean).length, nw = Object.values(F.w).filter(Boolean).length;
console.error(`\n끝  ${((Date.now() - t0) / 60000).toFixed(1)}분 · 호출 ${calls.toLocaleString()} · 기기·성별·연령 ${nd.toLocaleString()}개 · 요일 ${nw.toLocaleString()}개` + (stop ? " · API HUB 가 키를 거부해 멈췄다" : calls >= MAX_CALLS - 10 ? " · 호출 상한에 닿아 멈췄다. 다시 실행하면 이어 받는다" : ""));
console.error(`→ ${OUT}`);
