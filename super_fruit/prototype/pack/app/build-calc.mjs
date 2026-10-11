#!/usr/bin/env node
/**
 * 판매가 계산기 엑셀을 저장된 화면(claude.ai 페이지)에 싣는다
 *
 * 왜
 *   화면의 마진 · 손익분기 전환율은 수수료 · 원가 · 판매가에서 나온다. 보갬은 이 값을 판매가 계산기 엑셀로 관리한다.
 *   PC 실시간에서는 넣는곳\공급가표·계산기 의 엑셀을 열 때마다 읽지만, 저장된 화면은 PC 폴더를 못 본다.
 *   그래서 계산기의 설정(수수료율 · 광고 안전계수 · 목표 ROAS · 쿠폰액 · 최소 공헌이익)과 옵션별 원가 · 판매가를 파일로 실어 둔다.
 *
 * 읽는 것   넣는곳\공급가표·계산기\*.xlsx 가운데 판매가 계산기 모양인 것 (또는 인자로 준 파일)
 *           읽는 방법은 화면과 같은 xlsx-lab.js 를 그대로 쓴다 — 둘이 다른 숫자를 내지 않게.
 * 결과      app\data-calc.js   window.CALCRECS=[{ file, kind:"calc", rows, set, savedAt }]
 *
 * 주의  원가 · 공급처가 들어 있다. 공개 저장소에 올리지 않는다 (저장소에는 빈 파일 window.CALCRECS=[]; 만 둔다).
 *
 * 실행:  node build-calc.mjs                 넣는곳의 계산기 전부
 *        node build-calc.mjs 파일.xlsx        하나만
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;
const INBOX = path.join(ROOT, "넣는곳", "공급가표·계산기");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const OUT = val("--out") || path.join(HERE, "data-calc.js");
const given = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");

/* 화면이 쓰는 읽기 모듈을 그대로 */
globalThis.window = globalThis.window || {};
vm.runInThisContext(fs.readFileSync(path.join(HERE, "xlsx-lab.js"), "utf8"));
const X = globalThis.window.XlsxLab;

let files = given.length ? given.map(f => path.resolve(f))
  : (fs.existsSync(INBOX) ? fs.readdirSync(INBOX).filter(n => /\.xlsx$/i.test(n) && !n.startsWith("~$")).map(n => path.join(INBOX, n)) : []);
files = files.map(f => ({ f, m: fs.statSync(f).mtimeMs })).sort((a, b) => b.m - a.m);   // 새 파일이 앞

const round = (v, d) => (typeof v === "number" && isFinite(v)) ? Math.round(v * 10 ** d) / 10 ** d : v;
const recs = [];
for (const { f, m } of files) {
  const buf = fs.readFileSync(f);
  const book = await X.readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const d = X.detect(book);
  if (d.kind !== "calc") { console.log("  건너뜀 (계산기 모양이 아님):", path.basename(f)); continue; }
  const rows = X.readCalc(d.t).map(r => ({ ...r,
    nProfit: round(r.nProfit, 0), cProfit: round(r.cProfit, 0), nRate: round(r.nRate, 4), cRate: round(r.cRate, 4), nRoas: round(r.nRoas, 3), cRoas: round(r.cRoas, 3) }));
  const set = X.readCalcSet(book);
  recs.push({ file: path.basename(f), kind: "calc", rows, set, savedAt: new Date(m).toISOString() });
  console.log(`  ${path.basename(f)} — 옵션 ${rows.length}개`);
  if (set) console.log(`    수수료 네이버 ${(set.nFee * 100).toFixed(2)}% · 쿠팡 ${(set.cFee * 100).toFixed(2)}% · 목표 ROAS ${set.nRoas} / ${set.cRoas} · 안전계수 ${set.nK} / ${set.cK} · 쿠폰 ${set.coupon} · 최소 공헌이익 ${set.minProfit} · 기준 옵션 ${set.base} · 기준일 ${set.date}`);
  else console.log("    [!] 설정_원가 탭에서 수수료율을 찾지 못했다. 옵션만 싣는다.");
}
fs.writeFileSync(OUT, "window.CALCRECS=" + JSON.stringify(recs) + ";\n", "utf8");
console.log(recs.length ? `→ ${OUT} (${recs.length}개 파일, ${fs.statSync(OUT).size.toLocaleString()} 바이트)` : `→ ${OUT} (계산기 없음 — 빈 파일)`);
