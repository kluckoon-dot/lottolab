#!/usr/bin/env node
/**
 * 아이템스카우트 연관키워드 엑셀 ↔ 지금 네이버 값, 열마다 맞대보기
 *
 * 목적: "네이버를 기준으로 아이템스카우트와 같은 조건·같은 값" 을 숫자로 증명한다.
 *       아이템스카우트를 내려받은 그 시각에 네이버를 같이 부른다. 날짜가 다르면 비교가 안 된다
 *       (9월 수집본이 어긋났던 이유가 계산이 아니라 날짜였다 — docs/12).
 *
 * 맞대는 열
 *   PC검색 · 모바일검색 · 총검색수          ↔ 검색광고 /keywordstool monthlyPc/MobileQcCnt
 *   평균클릭수                             ↔ monthlyAvePcClkCnt + monthlyAveMobileClkCnt
 *   PC클릭률 · 모바일클릭률                 ↔ monthlyAvePcCtr · monthlyAveMobileCtr
 *   PC광고단가 · 모바일광고단가             ↔ 후보 셋: 중간 입찰가(median-bid) · 순위 입찰가 1~5위 · 노출 최소 입찰가
 *                                          어느 것이 맞는지 표본으로 가린다
 *   경쟁강도                               = 상품수 ÷ 총검색수 (아이템스카우트 값으로 다시 계산해 맞는지)
 *   클릭경쟁률                             = 상품수 ÷ 평균클릭수
 *   클릭대비광고비                          = 광고단가 ÷ 평균클릭수 (? 표본으로 확인)
 *
 * 실행 (수집기 폴더에서):  node compare-itemscout.mjs 아이템스카우트파일.xlsx [더.xlsx ...]
 * 결과: 화면 요약 + naver-out/compare-<파일명>.csv
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* 윈도우 cmd 는 *.xlsx 를 펼쳐주지 않는다. 여기서 편다 */
const expand = pat => {
  if (!pat.includes("*")) return [pat];
  const dir = path.dirname(pat) || ".";
  const re = new RegExp("^" + path.basename(pat).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i");
  try { return fs.readdirSync(dir).filter(f => re.test(f)).map(f => path.join(dir, f)); } catch { return []; }
};
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;   // 폴더 정리: 데이터·키·넣는곳은 app 위
const INBOX = path.join(ROOT, "넣는곳", "아이템스카우트");
const argv = process.argv.slice(2).filter(f => !f.startsWith("--"));
/* 파일을 안 주면 넣는곳\아이템스카우트 의 엑셀 전부 */
const files = [...new Set((argv.length ? argv : [path.join(INBOX, "*.xlsx")]).flatMap(expand))];
if (!files.length) { console.error("넣는곳\\아이템스카우트 에 엑셀이 없다. 아이템스카우트에서 오늘 받은 연관키워드 엑셀을 거기에 넣어라."); process.exit(1); }

/* ── 키 ── */
function loadKeys() {
  const A = { naver_ad_api_key: "KEY", naver_ad_secret: "SECRET", naver_ad_customer: "CUSTOMER", 액세스라이선스: "KEY", 비밀키: "SECRET", 고객id: "CUSTOMER" };
  for (const dir of [...new Set([ROOT, process.cwd(), HERE])]) {
    let raw; try { raw = fs.readFileSync(path.join(dir, "key.txt"), "utf8"); } catch { continue; }
    const o = {};
    for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) {
      const i = line.indexOf("="); if (i < 0) continue;
      const k = A[line.slice(0, i).trim().toLowerCase().replace(/[\s-]/g, "")]; const v = line.slice(i + 1).trim();
      if (k && v) o[k] = v;
    }
    if (o.KEY) return o;
  }
  return {};
}
const { KEY, SECRET, CUSTOMER } = loadKeys();
if (!KEY) { console.error("key.txt 에 검색광고 키가 없다."); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function ad(method, p, { qs = "", body } = {}) {
  const ts = Date.now().toString();
  const sig = crypto.createHmac("sha256", SECRET).update(`${ts}.${method}.${p}`).digest("base64");
  const r = await fetch("https://api.searchad.naver.com" + p + qs, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { "X-Timestamp": ts, "X-API-KEY": KEY, "X-Customer": CUSTOMER, "X-Signature": sig, "Content-Type": "application/json; charset=UTF-8" } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { ok: r.ok, status: r.status, json: j };
}

/* ── xlsx ── */
function unzip(buf) {
  const e = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
  let n = buf.readUInt16LE(e + 10), o = buf.readUInt32LE(e + 16); const m = {};
  for (let i = 0; i < n; i++) {
    const meth = buf.readUInt16LE(o + 10), cs = buf.readUInt32LE(o + 20), nl = buf.readUInt16LE(o + 28), xl = buf.readUInt16LE(o + 30), cl = buf.readUInt16LE(o + 32), lo = buf.readUInt32LE(o + 42);
    const name = buf.slice(o + 46, o + 46 + nl).toString("utf8");
    const lnl = buf.readUInt16LE(lo + 26), lxl = buf.readUInt16LE(lo + 28);
    const d = buf.slice(lo + 30 + lnl + lxl, lo + 30 + lnl + lxl + cs);
    m[name] = meth === 8 ? zlib.inflateRawSync(d) : d; o += 46 + nl + xl + cl;
  }
  return m;
}
const dec = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const colIdx = r => { let n = 0; for (const c of r.replace(/\d+/g, "")) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
function readXlsx(file) {
  const z = unzip(fs.readFileSync(file));
  const ss = []; const sst = z["xl/sharedStrings.xml"]?.toString("utf8") || "";
  for (const m of sst.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)) ss.push(dec([...m[1].matchAll(/<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(x => x[1]).join("")));
  const sheet = Object.keys(z).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  const rows = [];
  for (const rm of z[sheet].toString("utf8").matchAll(/<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const row = [];
    for (const cm of (rm[1] || "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const a = cm[1], b = cm[2] || ""; const ref = (a.match(/\br="([A-Z]+\d+)"/) || [])[1]; const t = (a.match(/\bt="(\w+)"/) || [])[1];
      let v = (b.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/) || [])[1];
      if (t === "s") v = ss[+v]; else if (t === "inlineStr") v = dec([...b.matchAll(/<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(q => q[1]).join("")); else if (v != null) v = dec(v);
      row[ref ? colIdx(ref) : row.length] = v ?? "";
    }
    rows.push(row);
  }
  return rows;
}
const num = v => { const t = String(v ?? "").replace(/[,%\s]/g, ""); if (!t || t === "-") return null; if (/^</.test(t)) return { masked: +t.slice(1) }; const x = parseFloat(t); return isFinite(x) ? x : null; };
const nv = v => (v && typeof v === "object") ? 0 : v;   // "< 10" 은 0 으로 센다(네이버 원본도 문자열)
const clean = s => String(s).replace(/[\s&/,·]+/g, "").toUpperCase();
const pct = (a, b) => (a == null || b == null) ? null : (b === 0 ? (a === 0 ? 0 : null) : (a - b) / b * 100);
const med = xs => { const s = xs.filter(x => x != null && isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

for (const file of files) {
  const rows = readXlsx(file);
  const hi = rows.findIndex(r => r.some(x => String(x).replace(/\s/g, "") === "키워드") && r.some(x => /상품수/.test(String(x))));
  if (hi < 0) { console.error(file + " — 아이템스카우트 연관키워드 엑셀로 안 보인다."); continue; }
  const H = rows[hi].map(x => String(x ?? "").replace(/\s/g, ""));
  const c = n => H.indexOf(n);
  const IS = rows.slice(hi + 1).filter(r => r[c("키워드")]).map(r => ({
    kw: String(r[c("키워드")]).trim(), pc: num(r[c("PC검색")]), mo: num(r[c("모바일검색")]), tot: num(r[c("총검색수")]),
    prod: num(r[c("상품수")]), comp: num(r[c("경쟁강도")]), clk: num(r[c("평균클릭수")]),
    tpc: num(r[c("PC클릭률")]), tmo: num(r[c("모바일클릭률")]), adPc: num(r[c("PC광고단가")]), adMo: num(r[c("모바일광고단가")]),
    clkComp: num(r[c("클릭경쟁률")]), adPerClk: num(r[c("클릭대비광고비")]), cat: r[c("대표카테고리")] || "", cls: r[c("키워드분류")] || ""
  }));
  const mt = fs.statSync(file).mtime;
  const stamp = (path.basename(file).match(/(\d{13})/) || [])[1];
  console.log(`\n${path.basename(file)} — ${IS.length}개 · 파일 시각 ${stamp ? new Date(+stamp).toLocaleString("ko-KR") : mt.toLocaleString("ko-KR")} · 네이버 지금 ${new Date().toLocaleString("ko-KR")}`);

  /* 네이버 지금 값 */
  const N = {}; const hints = [...new Set(IS.map(x => clean(x.kw)))];
  for (let i = 0; i < hints.length; i += 5) {
    const g = hints.slice(i, i + 5);
    let r = await ad("GET", "/keywordstool", { qs: "?hintKeywords=" + g.map(encodeURIComponent).join(",") + "&showDetail=1" });
    let list = r.ok ? r.json.keywordList : [];
    if (!r.ok) for (const h of g) { const one = await ad("GET", "/keywordstool", { qs: "?hintKeywords=" + encodeURIComponent(h) + "&showDetail=1" }); if (one.ok) list.push(...one.json.keywordList); }
    for (const x of list || []) if (g.includes(clean(x.relKeyword))) N[clean(x.relKeyword)] = { pc: x.monthlyPcQcCnt, mo: x.monthlyMobileQcCnt, cpc: +x.monthlyAvePcClkCnt || 0, cmo: +x.monthlyAveMobileClkCnt || 0, tpc: +x.monthlyAvePcCtr || 0, tmo: +x.monthlyAveMobileCtr || 0 };
    await sleep(120);
  }
  for (const device of ["PC", "MOBILE"]) {
    const d = device === "PC" ? "pc" : "mo";
    for (let i = 0; i < hints.length; i += 200) {
      const r = await ad("POST", "/estimate/median-bid/keyword", { body: { device, period: "MONTH", items: hints.slice(i, i + 200) } });
      for (const e of r.json?.estimate || []) { const o = N[clean(e.keyword)]; if (o) o["med" + d] = e.bid; }
      const r2 = await ad("POST", "/estimate/median-bid/keyword", { body: { device, period: "DAY", items: hints.slice(i, i + 200) } });
      for (const e of r2.json?.estimate || []) { const o = N[clean(e.keyword)]; if (o) o["medD" + d] = e.bid; }
      const r3 = await ad("POST", "/estimate/exposure-minimum-bid/keyword", { body: { device, period: "MONTH", items: hints.slice(i, i + 200) } });
      for (const e of r3.json?.estimate || []) { const o = N[clean(e.keyword)]; if (o) o["min" + d] = e.bid; }
    }
    for (let i = 0; i < hints.length; i += 30) {
      const items = hints.slice(i, i + 30).flatMap(k => [1, 2, 3, 4, 5].map(p => ({ key: k, position: p })));
      const r = await ad("POST", "/estimate/average-position-bid/keyword", { body: { device, items } });
      if (!r.ok) console.error("  순위 입찰가 실패", r.status);
      for (const e of r.json?.estimate || []) { const o = N[clean(e.keyword)]; if (o) (o["pos" + d] ||= [])[e.position - 1] = e.bid; }
    }
  }

  /* 열마다 맞대기 */
  const lines = [["키워드", "IS PC검색", "N PC검색", "IS 모바일검색", "N 모바일검색", "검색 차이%", "IS 평균클릭", "N 클릭합", "클릭 차이%", "IS PC클릭률", "N PC클릭률", "IS 모바일클릭률", "N 모바일클릭률",
    "IS PC광고단가", "N 중간입찰(월)PC", "N 중간입찰(일)PC", "N 최소노출PC", "N 순위PC 1~5", "IS 모바일광고단가", "N 중간입찰(월)MO", "N 중간입찰(일)MO", "N 최소노출MO", "N 순위MO 1~5",
    "IS 상품수", "IS 경쟁강도", "상품수÷IS총검색", "상품수÷N총검색", "IS 클릭경쟁률", "상품수÷IS클릭", "IS 클릭대비광고비"].join(",")];
  const D = { vol: [], clk: [], tpc: [], tmo: [], cand: {} };
  const cands = ["medpc", "medDpc", "minpc", "pos1pc", "pos2pc", "pos3pc", "pos4pc", "pos5pc"];
  let found = 0, maskedN = 0;
  for (const x of IS) {
    const n = N[clean(x.kw)]; if (!n) { lines.push([x.kw, "", "네이버에 없음"].join(",")); continue; }
    found++;
    const npc = num(n.pc), nmo = num(n.mo);
    if ((npc && typeof npc === "object") || (nmo && typeof nmo === "object")) maskedN++;
    const nt = nv(npc) + nv(nmo), it = (nv(x.pc) || 0) + (nv(x.mo) || 0);
    const vd = pct(it, nt), cd = pct(x.clk, n.cpc + n.cmo);
    D.vol.push(vd); D.clk.push(cd); D.tpc.push(pct(x.tpc, n.tpc)); D.tmo.push(pct(x.tmo, n.tmo));
    const cv = { medpc: n.medpc, medDpc: n.medDpc, minpc: n.minpc };
    (n.pospc || []).forEach((v, i) => cv["pos" + (i + 1) + "pc"] = v);
    for (const k of cands) if (x.adPc != null && cv[k] != null) (D.cand[k] ||= []).push(Math.abs(pct(x.adPc, cv[k]) ?? 999));
    const cvm = { medmo: n.medmo, medDmo: n.medDmo, minmo: n.minmo };
    (n.posmo || []).forEach((v, i) => cvm["pos" + (i + 1) + "mo"] = v);
    for (const k of Object.keys(cvm)) if (x.adMo != null && cvm[k] != null) (D.cand[k] ||= []).push(Math.abs(pct(x.adMo, cvm[k]) ?? 999));
    lines.push([x.kw, nv(x.pc), n.pc, nv(x.mo), n.mo, vd?.toFixed(1), x.clk, (n.cpc + n.cmo).toFixed(1), cd?.toFixed(1), x.tpc, n.tpc, x.tmo, n.tmo,
      x.adPc, n.medpc, n.medDpc, n.minpc, (n.pospc || []).join("/"), x.adMo, n.medmo, n.medDmo, n.minmo, (n.posmo || []).join("/"),
      x.prod, x.comp, x.prod != null && it ? (x.prod / it).toFixed(2) : "", x.prod != null && nt ? (x.prod / nt).toFixed(2) : "",
      x.clkComp, x.prod != null && x.clk ? (x.prod / x.clk).toFixed(2) : "", x.adPerClk].map(v => v == null ? "" : String(v).includes(",") ? `"${v}"` : v).join(","));
  }
  const within = (xs, t) => { const v = xs.filter(x => x != null); return v.length ? (v.filter(x => Math.abs(x) <= t).length / v.length * 100).toFixed(0) + "%" : "—"; };
  console.log(`  네이버에서 찾음 ${found}/${IS.length} · 네이버가 "< 10" 으로 가린 것 ${maskedN}`);
  console.log(`  검색수      차이 중앙값 ${med(D.vol)?.toFixed(1)}% · ±1% 안 ${within(D.vol, 1)} · ±5% 안 ${within(D.vol, 5)}`);
  console.log(`  평균클릭수  차이 중앙값 ${med(D.clk)?.toFixed(1)}% · ±5% 안 ${within(D.clk, 5)}`);
  console.log(`  클릭률      PC ±5% 안 ${within(D.tpc, 5)} · 모바일 ±5% 안 ${within(D.tmo, 5)}`);
  console.log("  광고단가 후보 (|차이| 중앙값, 작을수록 그것이다)");
  for (const [k, xs] of Object.entries(D.cand).sort((a, b) => med(a[1]) - med(b[1]))) console.log(`    ${k.padEnd(8)} ${med(xs)?.toFixed(1)}%  · ±5% 안 ${within(xs, 5)} (${xs.length}개)`);
  fs.mkdirSync(path.join(ROOT, "naver-out"), { recursive: true });
  const out = path.join(ROOT, "naver-out", "compare-" + path.basename(file).replace(/\.xlsx$/i, "") + ".csv");
  fs.writeFileSync(out, "﻿" + lines.join("\r\n"), "utf8");
  console.log(`  → ${out}`);
}
