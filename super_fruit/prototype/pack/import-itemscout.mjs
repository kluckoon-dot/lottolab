/* ── 아이템스카우트 내보내기 파일을 우리 데이터에 합친다 ──
 *
 * 쇼핑검색 API 가 2026-07-31 종료돼서 상품수 원본이 없다.
 * 남은 합법적인 경로는 하나다. 내 계정에서 내가 내려받은 파일.
 * 남의 사이트를 긁는 게 아니라 내 자료를 가져오는 것이다.
 *
 * 쓰는 법
 *   node import-itemscout.mjs 내려받은파일.xlsx
 *   node import-itemscout.mjs *.xlsx         여러 개 한꺼번에
 *   xlsx 도 csv 도 그대로 읽는다. 엑셀로 변환할 필요 없다.
 *
 * 열 이름은 자동으로 찾는다. 한글이든 영문이든, 순서가 달라도 된다.
 * 같은 키워드가 여러 파일에 있으면 최신 파일 값이 이긴다.
 *
 * 결과 : naver-out/shopcount.json   (19단계가 만들려던 것과 같은 모양)
 *        그대로 16b 팩에 실린다.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const OUTDIR = "naver-out";
const OUT = path.join(OUTDIR, "shopcount.json");
/* 윈도우 cmd 는 *.xlsx 를 풀어주지 않는다. node 도 안 풀어준다.
   그래서 별표가 들어오면 여기서 직접 편다. 없는 패턴은 조용히 버린다. */
const expand = pat => {
  if (!pat.includes("*")) return [pat];
  const dir = path.dirname(pat) || ".";
  const re = new RegExp("^" + path.basename(pat).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i");
  try { return fs.readdirSync(dir).filter(f => re.test(f)).map(f => path.join(dir, f)); }
  catch { return []; }
};
const files = [...new Set(process.argv.slice(2).filter(f => !f.startsWith("--")).flatMap(expand))];
if (!files.length) {
  console.error("\n  쓰는 법: node import-itemscout.mjs 내려받은파일.xlsx\n");
  console.error("  아이템스카우트에서 연관키워드를 내려받은 뒤 (xlsx 그대로 됨)");
  console.error("  그 파일을 이 폴더에 두고 파일명을 적어라.\n");
  process.exit(1);
}

/* 열 이름 후보. 아이템스카우트가 이름을 바꿔도 대개 이 안에 든다. */
const COL = {
  kw:    ["키워드", "keyword", "검색어", "연관키워드", "keywords"],
  count: ["상품수", "총상품수", "product", "productcount", "상품 수"],
  comp:  ["경쟁강도", "경쟁률", "competition", "compidx"],
  vol:   ["총 검색수", "총검색수", "한달검색수", "monthlysearch", "검색량"],
  cat:   ["대표 카테고리", "대표카테고리", "category", "카테고리"],
  cls:   ["키워드 분류", "키워드분류", "분류", "type"],
  shop:  ["쇼핑성 지수", "쇼핑성지수"],
  info:  ["정보성 지수", "정보성지수"]
};
const norm = s => String(s || "").replace(/[\s_\-()]/g, "").toLowerCase();
const findCol = (head, names) => {
  const h = head.map(norm);
  for (const n of names.map(norm)) { const i = h.indexOf(n); if (i >= 0) return i; }
  for (let i = 0; i < h.length; i++) if (names.map(norm).some(n => h[i].includes(n))) return i;
  return -1;
};

/* ── xlsx 직접 읽기 ──
   엑셀로 열어서 CSV 로 저장하라고 시켰는데, 그건 파일 하나 넣을 때마다 손이 간다.
   xlsx 는 그냥 zip 이다. 안에 든 XML 두 개만 꺼내면 된다.
   외부 라이브러리 없이 node 의 zlib 만 쓴다. */
function unzip(buf) {
  /* 끝에서 중앙 디렉터리를 찾는다 */
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--)
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("zip 구조가 아니다");
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    /* 로컬 헤더에서 실제 자료 시작 위치를 다시 잰다. extra 길이가 다를 수 있다. */
    const lNameLen = buf.readUInt16LE(lho + 26), lExtraLen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    if (name.endsWith(".xml"))
      out[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}
const unesc = t => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, "&");
const colNum = ref => { let c = 0; for (const ch of (ref.match(/^[A-Z]+/) || [""])[0]) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; };

function readXlsx(buf) {
  const files = unzip(buf);
  const sstXml = files["xl/sharedStrings.xml"];
  const sst = [];
  if (sstXml) {
    const x = sstXml.toString("utf8");
    for (const m of x.matchAll(/<si>([\s\S]*?)<\/si>/g))
      sst.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => unesc(t[1])).join(""));
  }
  const sheetName = Object.keys(files).find(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  if (!sheetName) throw new Error("시트를 못 찾았다");
  const sheet = files[sheetName].toString("utf8");
  const rows = [];
  for (const rm of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cm[1], body = cm[2];
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const t = (attrs.match(/t="([^"]+)"/) || [])[1];
      let val = "";
      if (t === "inlineStr") val = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => unesc(x[1])).join("");
      else {
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (v != null) val = t === "s" ? (sst[+v] ?? "") : unesc(v);
      }
      const at = ref ? colNum(ref) : cells.length;
      while (cells.length < at) cells.push("");
      cells.push(val);
    }
    rows.push(cells);
  }
  return rows.filter(r => r.some(x => String(x).trim()));
}

/* 쉼표 구분. 따옴표 안의 쉼표는 구분자가 아니다. */
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}

const num = v => {
  const n = parseFloat(String(v ?? "").replace(/[,\s원개%]/g, ""));
  return isFinite(n) ? n : null;
};

let done = {}, comp = {}, meta = {}, prevN = 0;
try {
  const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
  done = prev.data || {}; comp = prev.comp || {}; meta = prev.meta || {};
  prevN = Object.keys(done).length;
  console.log(`이미 있던 ${prevN.toLocaleString()}개에 더한다.`);
} catch {}

let added = 0, updated = 0, skipped = 0;
for (const f of files) {
  let buf;
  try { buf = fs.readFileSync(f); }
  catch (e) { console.error(`  ${f} 를 못 읽었다: ${e.message}`); continue; }
  let rows;
  if (buf[0] === 0x50 && buf[1] === 0x4b) {           // "PK" = xlsx
    try { rows = readXlsx(buf); }
    catch (e) { console.error(`  ${path.basename(f)} 엑셀을 못 읽었다: ${e.message}`); continue; }
  } else {
    let text = buf.toString("utf8");
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    rows = parseCsv(text);
  }
  if (rows.length < 2) { console.error(`  ${f} 에 행이 없다.`); continue; }

  /* 머리글이 첫 줄이 아닐 수 있다. 키워드 열이 보이는 첫 줄을 머리글로 본다. */
  let hi = rows.findIndex(r => findCol(r, COL.kw) >= 0);
  if (hi < 0) {
    console.error(`  ${f} 에서 키워드 열을 못 찾았다. 첫 줄: ${rows[0].slice(0, 8).join(" | ")}`);
    continue;
  }
  const head = rows[hi];
  const iKw = findCol(head, COL.kw), iCt = findCol(head, COL.count), iCp = findCol(head, COL.comp);
  const iCa = findCol(head, COL.cat), iCl = findCol(head, COL.cls),
        iSh = findCol(head, COL.shop), iIn = findCol(head, COL.info);
  if (iCt < 0 && iCp < 0) {
    console.error(`  ${f} 에 상품수도 경쟁강도도 없다. 열: ${head.join(" | ")}`);
    continue;
  }
  let n = 0;
  for (const r of rows.slice(hi + 1)) {
    const kw = String(r[iKw] ?? "").trim();
    if (!kw) continue;
    const ct = iCt >= 0 ? num(r[iCt]) : null;
    const cp = iCp >= 0 ? num(r[iCp]) : null;
    if (ct == null && cp == null) { skipped++; continue; }
    if (ct != null) { if (done[kw] == null) added++; else updated++; done[kw] = ct; }
    if (cp != null) comp[kw] = cp;
    /* 대표 카테고리와 키워드 분류도 챙긴다.
       분류는 아이템스카우트가 직접 매긴 값이라 우리 낱말 규칙보다 낫다. */
    const cat = iCa >= 0 ? String(r[iCa] ?? "").trim() : "";
    const cls = iCl >= 0 ? String(r[iCl] ?? "").trim() : "";
    const sh  = iSh >= 0 ? num(r[iSh]) : null;
    if (cat || cls || sh != null) {
      const m = meta[kw] || (meta[kw] = {});
      if (cat) m.cat = cat;
      if (cls) m.cls = cls;
      if (sh != null) m.shop = sh;
    }
    n++;
  }
  console.log(`  ${path.basename(f)}  ${n.toLocaleString()}행  (상품수 ${iCt >= 0 ? "O" : "X"} · 경쟁강도 ${iCp >= 0 ? "O" : "X"} · 대표카테고리 ${iCa >= 0 ? "O" : "X"} · 분류 ${iCl >= 0 ? "O" : "X"})`);
}

if (!added && !updated) { console.error("\n  가져온 게 없다. 위 메시지를 보내주면 열 이름을 맞춰준다.\n"); process.exit(1); }

fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  source: "itemscout-export", files: files.map(f => path.basename(f)),
  savedAt: new Date().toISOString(),
  keywords: Object.keys(done).length, data: done, comp, meta
}), "utf8");

console.log(`\n  새로 ${added.toLocaleString()}개 · 덮어쓴 것 ${updated.toLocaleString()}개 · 값 없어 건너뜀 ${skipped.toLocaleString()}개`);
console.log(`  이제 상품수가 있는 키워드 ${Object.keys(done).length.toLocaleString()}개`);
{
  const withCat = Object.values(meta).filter(m => m.cat).length;
  const withCls = Object.values(meta).filter(m => m.cls).length;
  if (withCat || withCls)
    console.log(`  대표 카테고리 ${withCat.toLocaleString()}개 · 아이템스카우트 분류 ${withCls.toLocaleString()}개도 함께 받았다.`);
}

/* 몇 개를 넣었느냐보다 "화면에 있는 것 중 몇 개가 채워졌느냐" 가 중요하다.
   아이템스카우트가 주는 연관키워드가 우리가 모은 것과 겹쳐야 의미가 있다. */
try {
  const want = fs.readFileSync(path.join(OUTDIR, "section-keywords.txt"), "utf8")
                 .split(/\r?\n/).map(t => t.trim()).filter(Boolean);
  const set = new Set(want);
  const hit = Object.keys(done).filter(k => set.has(k)).length;
  const miss = Object.keys(done).length - hit;
  console.log(`\n  화면 키워드 ${want.length.toLocaleString()}개 중 ${hit.toLocaleString()}개가 채워졌다  (${(hit / want.length * 100).toFixed(1)}%)`);
  if (miss) console.log(`  화면에 없는 키워드도 ${miss.toLocaleString()}개 받아뒀다. 나중에 수집이 넓어지면 자동으로 붙는다.`);
  if (hit / want.length < 0.02)
    console.log(`  ※ 겹치는 게 별로 없다. 파는 품목 위주로 몇 개 더 내보내면 빨리 오른다.`);
} catch {
  console.log(`\n  (16b-pack-sections.bat 을 한 번 돌리면 화면 키워드 대비 몇 %가 채워졌는지도 같이 알려준다)`);
}
console.log(`  → ${OUT}`);
console.log(`\n  16b-pack-sections.bat 을 다시 돌리면 화면에 실린다.\n`);
