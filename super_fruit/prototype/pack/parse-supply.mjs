/* ── 공급사 파일 → 표준 공급가표 ──
 *
 *   node parse-supply.mjs                 supply 폴더 전부
 *   node parse-supply.mjs 파일.xlsx        하나만
 *
 * 공급사마다 엑셀 모양이 다르다. 열 이름도, 머리글 위치도, 시트 수도 다르다.
 * 그래서 열 이름을 고정하지 않고 찾아낸다. 못 찾으면 화면에 뭐가 있었는지 찍는다.
 * 파일 이름 앞부분을 공급사 이름으로 쓴다: "온그린_20260916.xlsx" → 온그린
 *
 * 결과: naver-out/supply.json
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { makeMatcher, normalize, sizeBands, bandOf } from "./normalize-supply.mjs";

const OUTDIR = "naver-out";
const SRC = "supply";

/* ── xlsx = zip. 라이브러리 없이 XML 두 개만 꺼낸다. ── */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--)
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("zip 구조가 아니다");
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    if (name.endsWith(".xml")) out[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}
const unesc = t => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
const colNum = ref => { let c = 0; for (const ch of (ref.match(/^[A-Z]+/) || [""])[0]) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; };

function readXlsx(buf) {
  const files = unzip(buf);
  const sst = [];
  if (files["xl/sharedStrings.xml"])
    for (const m of files["xl/sharedStrings.xml"].toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g))
      sst.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => unesc(t[1])).join(""));
  /* 시트가 여럿이면 행이 제일 많은 것을 쓴다. 안내 시트가 1번인 경우가 흔하다. */
  const sheets = Object.keys(files).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  let best = [];
  for (const sn of sheets) {
    const sheet = files[sn].toString("utf8"), rows = [];
    for (const rm of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cm of rm[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const at = (cm[1].match(/r="([A-Z]+\d+)"/) || [])[1];
        const t = (cm[1].match(/t="([^"]+)"/) || [])[1];
        let val = "";
        if (t === "inlineStr") val = [...cm[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => unesc(x[1])).join("");
        else { const v = (cm[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1]; if (v != null) val = t === "s" ? (sst[+v] ?? "") : unesc(v); }
        const idx = at ? colNum(at) : cells.length;
        while (cells.length < idx) cells.push("");
        cells.push(val);
      }
      rows.push(cells);
    }
    const use = rows.filter(r => r.some(x => String(x).trim()));
    if (use.length > best.length) best = use;
  }
  return best;
}
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === "," || c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}

/* ── 열 찾기 ──
   이름으로 먼저 찾고, 못 찾으면 내용으로 짚는다.
   상품명 열은 "글자가 길고 숫자가 아닌 열", 가격 열은 "전부 숫자이고 값이 큰 열". */
const NAME_COLS  = ["상품명","제품명","품명","상품","품목명","옵션명","name","product","title","goods"];
const PRICE_COLS = ["공급가","공급단가","원가","단가","도매가","납품가","매입가","price","cost","supply"];
const SHIP_COLS  = ["배송비","택배비","운임","shipping","delivery"];
const OPT_COLS   = ["옵션","옵션명","규격","중량","사이즈","option","spec"];
const STOCK_COLS = ["재고","수량","stock","qty"];
const norm = s => String(s ?? "").replace(/[\s_\-()]/g, "").toLowerCase();
const num = v => { const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, "")); return isFinite(n) ? n : null; };

function findHeader(rows) {
  /* 머리글은 첫 줄이 아닐 수 있다. 상품명·가격 후보가 같이 보이는 첫 줄을 고른다. */
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const h = rows[i].map(norm);
    const hasName = h.some(x => NAME_COLS.some(c => x.includes(norm(c))));
    const hasPrice = h.some(x => PRICE_COLS.some(c => x.includes(norm(c))));
    if (hasName && hasPrice) return i;
  }
  return -1;
}
const findCol = (head, names) => {
  const h = head.map(norm);
  for (const n of names.map(norm)) { const i = h.indexOf(n); if (i >= 0) return i; }
  for (let i = 0; i < h.length; i++) if (names.map(norm).some(n => h[i].includes(n))) return i;
  return -1;
};
/* 이름으로 못 찾을 때 내용으로 짚는다 */
function guessCols(rows) {
  const n = Math.min(rows.length, 60), width = Math.max(...rows.slice(0, n).map(r => r.length));
  let nameCol = -1, priceCol = -1, bestLen = 0, bestNum = 0;
  for (let c = 0; c < width; c++) {
    const vals = rows.slice(0, n).map(r => String(r[c] ?? "").trim()).filter(Boolean);
    if (vals.length < n * 0.4) continue;
    const nums = vals.filter(v => num(v) != null && /^[\d,.\s원]+$/.test(v));
    const avgLen = vals.reduce((s, v) => s + v.length, 0) / vals.length;
    if (nums.length > vals.length * 0.8) {
      const med = num(vals[Math.floor(vals.length / 2)]) || 0;
      if (med >= 500 && med <= 5000000 && med > bestNum) { bestNum = med; priceCol = c; }
    } else if (avgLen > bestLen && avgLen >= 5) { bestLen = avgLen; nameCol = c; }
  }
  return { nameCol, priceCol };
}

/* ── 실행 ── */
const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
let files = [];
if (args.length) {
  const expand = p => { if (!p.includes("*")) return [p];
    const d = path.dirname(p) || ".";
    const re = new RegExp("^" + path.basename(p).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i");
    try { return fs.readdirSync(d).filter(f => re.test(f)).map(f => path.join(d, f)); } catch { return []; } };
  files = [...new Set(args.flatMap(expand))];
} else {
  try { files = fs.readdirSync(SRC).filter(f => /\.(xlsx|csv|tsv|txt)$/i.test(f)).map(f => path.join(SRC, f)); }
  catch { files = []; }
}
if (!files.length) {
  console.error(`\n  ${SRC} 폴더에 공급사 파일이 없다.`);
  console.error(`  supply 폴더를 만들고 공급사에서 받은 엑셀을 넣어라.`);
  console.error(`  파일 이름 앞을 공급사 이름으로 쓴다:  온그린_20260916.xlsx → 온그린\n`);
  process.exit(1);
}

const terms = [...new Set(JSON.parse(fs.readFileSync("sections.json", "utf8")).sections.flatMap(s => s.terms))];
let varieties = {};
try { varieties = JSON.parse(fs.readFileSync("varieties.json", "utf8")); }
catch { console.error("varieties.json 이 없다. node build-varieties.mjs 를 먼저 돌려라."); process.exit(1); }
const match = makeMatcher(terms, varieties);

const all = [];
const report = [];
for (const f of files) {
  const supplier = path.basename(f).replace(/\.(xlsx|csv|tsv|txt)$/i, "").split(/[_\-\s]/)[0];
  let rows;
  try {
    const buf = fs.readFileSync(f);
    rows = (buf[0] === 0x50 && buf[1] === 0x4b) ? readXlsx(buf)
         : parseCsv(buf.toString("utf8").replace(/^﻿/, ""));
  } catch (e) { report.push([path.basename(f), 0, 0, "못 읽음: " + e.message]); continue; }
  if (rows.length < 2) { report.push([path.basename(f), 0, 0, "행이 없다"]); continue; }

  const hi = findHeader(rows);
  let iName, iPrice, iShip = -1, iOpt = -1, iStock = -1, body, how;
  if (hi >= 0) {
    const head = rows[hi];
    iName = findCol(head, NAME_COLS); iPrice = findCol(head, PRICE_COLS);
    iShip = findCol(head, SHIP_COLS); iOpt = findCol(head, OPT_COLS); iStock = findCol(head, STOCK_COLS);
    if (iOpt === iName) iOpt = -1;
    body = rows.slice(hi + 1); how = `머리글 ${hi + 1}행`;
  } else {
    const g = guessCols(rows);
    iName = g.nameCol; iPrice = g.priceCol; body = rows; how = "내용으로 추정";
  }
  if (iName < 0 || iPrice < 0) {
    report.push([path.basename(f), rows.length, 0,
      `상품명/가격 열을 못 찾았다. 첫 줄: ${rows[0].slice(0, 8).join(" | ").slice(0, 80)}`]);
    continue;
  }

  let n = 0, noItem = 0;
  for (const r of body) {
    const name = String(r[iName] ?? "").trim();
    const price = num(r[iPrice]);
    if (!name || !price) continue;
    const rec = normalize({ supplier, name, option: iOpt >= 0 ? r[iOpt] : "", price, ship: iShip >= 0 ? r[iShip] : null }, match);
    rec.stock = iStock >= 0 ? num(r[iStock]) : null;
    if (!rec.item) noItem++;
    all.push(rec); n++;
  }
  report.push([path.basename(f), body.length, n, `${how} · 품목 못 찾은 줄 ${noItem}`]);
}

const cuts = sizeBands(all);
for (const r of all) r.band = bandOf(r, cuts);

fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(path.join(OUTDIR, "supply.json"),
  JSON.stringify({ savedAt: new Date().toISOString(), files: files.map(f => path.basename(f)),
    suppliers: [...new Set(all.map(r => r.supplier))], bands: cuts, rows: all }), "utf8");

console.log("\n── 공급사 파일 읽기");
for (const [f, raw, ok, note] of report)
  console.log(`  ${f.padEnd(30)} ${String(raw).padStart(6)}행 → ${String(ok).padStart(6)}건   ${note}`);

const withItem = all.filter(r => r.item).length;
const withKg = all.filter(r => r.kg).length;
const withCnt = all.filter(r => r.count).length;
console.log(`\n  전체 ${all.length.toLocaleString()}건`);
console.log(`    품목 찾음   ${withItem.toLocaleString()} (${pct(withItem)})`);
console.log(`    중량 읽음   ${withKg.toLocaleString()} (${pct(withKg)})   → 원/kg 비교 가능`);
console.log(`    과수 읽음   ${withCnt.toLocaleString()} (${pct(withCnt)})   → g/과 크기 비교 가능`);
function pct(n) { return all.length ? (n / all.length * 100).toFixed(1) + "%" : "0%"; }

if (all.length && withItem / all.length < 0.7) {
  console.log("\n  품목을 못 찾은 상품명 20개 — 사전에 보탤 것이 있는지 봐라");
  all.filter(r => !r.item).slice(0, 20).forEach(r => console.log("    " + r.raw.slice(0, 70)));
}
console.log(`\n  → ${OUTDIR}/supply.json\n`);
