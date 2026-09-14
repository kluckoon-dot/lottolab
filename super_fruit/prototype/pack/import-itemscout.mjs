/* ── 아이템스카우트 내보내기 파일을 우리 데이터에 합친다 ──
 *
 * 쇼핑검색 API 가 2026-07-31 종료돼서 상품수 원본이 없다.
 * 남은 합법적인 경로는 하나다. 내 계정에서 내가 내려받은 파일.
 * 남의 사이트를 긁는 게 아니라 내 자료를 가져오는 것이다.
 *
 * 쓰는 법
 *   node import-itemscout.mjs 내려받은파일.csv
 *   node import-itemscout.mjs *.csv          여러 개 한꺼번에
 *
 * 열 이름은 자동으로 찾는다. 한글이든 영문이든, 순서가 달라도 된다.
 * 같은 키워드가 여러 파일에 있으면 최신 파일 값이 이긴다.
 *
 * 결과 : naver-out/shopcount.json   (19단계가 만들려던 것과 같은 모양)
 *        그대로 16b 팩에 실린다.
 */
import fs from "node:fs";
import path from "node:path";

const OUTDIR = "naver-out";
const OUT = path.join(OUTDIR, "shopcount.json");
const files = process.argv.slice(2).filter(f => !f.startsWith("--"));
if (!files.length) {
  console.error("\n  쓰는 법: node import-itemscout.mjs 내려받은파일.csv\n");
  console.error("  아이템스카우트에서 연관키워드를 CSV 또는 엑셀로 내려받은 뒤");
  console.error("  그 파일을 이 폴더에 두고 파일명을 적어라.\n");
  process.exit(1);
}

/* 열 이름 후보. 아이템스카우트가 이름을 바꿔도 대개 이 안에 든다. */
const COL = {
  kw:    ["키워드", "keyword", "검색어", "연관키워드", "keywords"],
  count: ["상품수", "총상품수", "product", "productcount", "total", "상품 수"],
  comp:  ["경쟁강도", "경쟁률", "competition", "compidx"],
  vol:   ["검색수", "총검색수", "한달검색수", "monthlysearch", "search", "검색량"]
};
const norm = s => String(s || "").replace(/[\s_\-()]/g, "").toLowerCase();
const findCol = (head, names) => {
  const h = head.map(norm);
  for (const n of names.map(norm)) { const i = h.indexOf(n); if (i >= 0) return i; }
  for (let i = 0; i < h.length; i++) if (names.map(norm).some(n => h[i].includes(n))) return i;
  return -1;
};

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

let done = {}, comp = {}, prevN = 0;
try {
  const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
  done = prev.data || {}; comp = prev.comp || {}; prevN = Object.keys(done).length;
  console.log(`이미 있던 ${prevN.toLocaleString()}개에 더한다.`);
} catch {}

let added = 0, updated = 0, skipped = 0;
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, "utf8"); }
  catch (e) { console.error(`  ${f} 를 못 읽었다: ${e.message}`); continue; }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (/^PK\x03\x04/.test(text)) {
    console.error(`  ${f} 는 엑셀 파일이다. 엑셀에서 열어 "다른 이름으로 저장 > CSV UTF-8" 로 바꾼 뒤 다시 넣어라.`);
    continue;
  }
  const rows = parseCsv(text);
  if (rows.length < 2) { console.error(`  ${f} 에 행이 없다.`); continue; }

  /* 머리글이 첫 줄이 아닐 수 있다. 키워드 열이 보이는 첫 줄을 머리글로 본다. */
  let hi = rows.findIndex(r => findCol(r, COL.kw) >= 0);
  if (hi < 0) {
    console.error(`  ${f} 에서 키워드 열을 못 찾았다. 첫 줄: ${rows[0].slice(0, 8).join(" | ")}`);
    continue;
  }
  const head = rows[hi];
  const iKw = findCol(head, COL.kw), iCt = findCol(head, COL.count), iCp = findCol(head, COL.comp);
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
    n++;
  }
  console.log(`  ${path.basename(f)}  ${n.toLocaleString()}행  (상품수 열 ${iCt >= 0 ? head[iCt] : "없음"} · 경쟁강도 열 ${iCp >= 0 ? head[iCp] : "없음"})`);
}

if (!added && !updated) { console.error("\n  가져온 게 없다. 위 메시지를 보내주면 열 이름을 맞춰준다.\n"); process.exit(1); }

fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  source: "itemscout-export", files: files.map(f => path.basename(f)),
  savedAt: new Date().toISOString(),
  keywords: Object.keys(done).length, data: done, comp
}), "utf8");

console.log(`\n  새로 ${added.toLocaleString()}개 · 덮어쓴 것 ${updated.toLocaleString()}개 · 값 없어 건너뜀 ${skipped.toLocaleString()}개`);
console.log(`  이제 상품수가 있는 키워드 ${Object.keys(done).length.toLocaleString()}개`);
console.log(`  → ${OUT}`);
console.log(`\n  16b-pack-sections.bat 을 다시 돌리면 화면에 실린다.\n`);
