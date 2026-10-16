// 네이버 키워드도구 숫자가 언제 바뀌는가 — 같은 키워드 60개를 30분마다 물어 적는다 (검색광고 API 만 · 한 번에 12회 호출)
//   node probe-naver.mjs <수집기 폴더> [몇 시간] [간격 분]
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { createRequire } from "node:module";
const root = process.argv[2], HOURS = +(process.argv[3] || 26), EVERY = +(process.argv[4] || 30);
const OUT = path.join(root, "naver-out", "probe.ndjson"), PICK = path.join(root, "naver-out", "probe-keywords.json");
const o = {}; const AL = { naver_ad_api_key: "KEY", naver_ad_secret: "SECRET", naver_ad_customer: "CUSTOMER" };
for (const line of fs.readFileSync(path.join(root, "key.txt"), "utf8").replace(/^﻿/, "").split(/\r?\n/)) { if (/^\s*#/.test(line)) continue; const i = line.indexOf("="); if (i < 0) continue; const k = AL[line.slice(0, i).trim().toLowerCase()], v = line.slice(i + 1).trim().replace(/^["']|["']$/g, ""); if (k && v) o[k] = v; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function kt(hints) {
  const p = "/keywordstool";
  for (let a = 0; a < 5; a++) {
    try { const ts = String(Date.now()), sig = crypto.createHmac("sha256", o.SECRET).update(`${ts}.GET.${p}`).digest("base64");
      const r = await fetch("https://api.searchad.naver.com" + p + "?hintKeywords=" + hints.map(encodeURIComponent).join(",") + "&showDetail=1", { headers: { "X-Timestamp": ts, "X-API-KEY": o.KEY, "X-Customer": String(o.CUSTOMER), "X-Signature": sig } });
      const j = await r.json().catch(() => null); if (r.status !== 429 && r.status < 500) return j; } catch {}
    await sleep(2000 * (a + 1)); }
  return null;
}
const num = v => typeof v === "number" ? v : (parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10) || 0);
/* 표본: 검색량 구간마다 고르게 60개 (가림값 · 괄호 · 띄어쓰기 든 것은 뺀다). 한 번 고르면 파일로 남겨 같은 것을 계속 묻는다 */
let pick;
try { pick = JSON.parse(fs.readFileSync(PICK, "utf8")); } catch {
  const require = createRequire(import.meta.url); globalThis.window = {}; require(path.join(root, "app", "data-kw.js"));
  const ok = window.KWROWS.filter(r => !r[15] && /^[가-힣A-Za-z0-9]+$/.test(r[0]) && r[0].length <= 18).sort((a, b) => (b[1] + b[2]) - (a[1] + a[2]));
  const bands = [[100000, 1e12], [10000, 100000], [1000, 10000], [100, 1000], [10, 100]]; pick = [];
  for (const [lo, hi] of bands) { const g = ok.filter(r => r[1] + r[2] >= lo && r[1] + r[2] < hi); const step = Math.max(1, Math.floor(g.length / 12)); for (let i = 0; i < g.length && pick.filter(x => x.b === lo).length < 12; i += step) pick.push({ k: g[i][0], b: lo }); }
  fs.writeFileSync(PICK, JSON.stringify(pick), "utf8");
}
const kws = pick.map(x => x.k), end = Date.now() + HOURS * 3600e3;
console.error(`표본 ${kws.length}개 · ${EVERY}분마다 · ${HOURS}시간`);
while (Date.now() < end) {
  const t0 = new Date(), got = {};
  for (let i = 0; i < kws.length; i += 5) { const g = kws.slice(i, i + 5); const j = await kt(g);
    for (const x of (j && j.keywordList) || []) if (g.includes(x.relKeyword)) got[x.relKeyword] = [num(x.monthlyPcQcCnt), num(x.monthlyMobileQcCnt), +x.monthlyAvePcClkCnt || 0, +x.monthlyAveMobileClkCnt || 0, +x.plAvgDepth || 0];
    await sleep(400); }
  fs.appendFileSync(OUT, JSON.stringify({ t: t0.toISOString(), n: Object.keys(got).length, v: got }) + "\n", "utf8");
  console.error(t0.toLocaleString("ko-KR"), "받음", Object.keys(got).length);
  const next = Math.ceil(Date.now() / (EVERY * 60e3)) * EVERY * 60e3;   // 정각 · 30분에 맞춘다
  await sleep(Math.max(5000, next - Date.now()));
}
console.error("끝");
