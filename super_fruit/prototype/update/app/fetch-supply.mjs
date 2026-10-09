/* ── 공급사 open API 에서 공급가를 받아온다 ──
 *
 *   node fetch-supply.mjs              suppliers.json 의 켜둔 곳 전부
 *   node fetch-supply.mjs --only 온그린  한 곳만
 *   node fetch-supply.mjs --probe      구조만 훑어보고 끝낸다 (저장 안 함)
 *
 * --probe 가 핵심이다. 응답이 어떻게 생겼는지 모를 때 먼저 이걸 돌리면
 * 상품 배열이 어디 있는지, 열 이름이 뭔지 찍어준다. 그걸 보고 map 을 채우면 된다.
 *
 * 받은 것은 parse-supply 와 똑같이 표준화해서 naver-out/supply.json 에 넣는다.
 * 파일로 읽은 것과 API 로 받은 것이 한 표에 섞인다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/* 폴더 정리 (2026-10-09): 프로그램은 app\ 에, key.txt · naver-out · 넣는곳 은 그 위 폴더에 둔다.
   예전처럼 한 폴더에 다 있어도 그대로 돈다. */
const APPDIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(APPDIR).toLowerCase() === "app" ? path.dirname(APPDIR) : APPDIR;

import { makeMatcher, normalize, sizeBands, bandOf } from "./normalize-supply.mjs";

const OUTDIR = path.join(ROOT, "naver-out");
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const PROBE = args.includes("--probe");
const ONLY = val("--only");

let cfg;
try { cfg = JSON.parse(fs.readFileSync(path.join(APPDIR, "suppliers.json"), "utf8")); }
catch {
  console.error("\n  suppliers.json 이 없다.");
  console.error("  suppliers.example.json 을 복사해서 이름을 suppliers.json 으로 바꾸고 채워라.\n");
  process.exit(1);
}

/* 점으로 파고든다. "data.items" → obj.data.items */
const dig = (obj, p) => {
  if (!p) return obj;
  return String(p).split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
};
/* 배열이 어디 있는지 스스로 찾는다. 가장 긴 객체 배열을 고른다. */
function findList(obj, depth = 0, at = "") {
  if (depth > 4 || obj == null) return null;
  if (Array.isArray(obj) && obj.length && typeof obj[0] === "object") return { at, n: obj.length, sample: obj[0] };
  if (typeof obj !== "object") return null;
  let best = null;
  for (const [k, v] of Object.entries(obj)) {
    const r = findList(v, depth + 1, at ? at + "." + k : k);
    if (r && (!best || r.n > best.n)) best = r;
  }
  return best;
}
/* 국내 공급사는 영문 약어와 한글 로마자를 섞어 쓴다. 실제로 본 것들을 넣어둔다.
   goods_nm · danga 를 못 짚어서 한 곳을 통째로 놓친 적이 있다. */
const KEY_HINTS = {
  name: ["productname","goodsname","itemname","prdname","prodname","name","title","subject",
         "goodsnm","itemnm","prdnm","prodnm","gdsnm","상품명","제품명","품명","상품이름"],
  option: ["optionname","option","spec","opt","optnm","optionnm","sizenm",
           "옵션","옵션명","규격","선택","사이즈"],
  price: ["supplyprice","price","cost","wholesale","unitprice","sellprice","buyprice",
          "danga","gongeupga","gongupga","wonga","공급가","단가","원가","도매가","매입가","납품가"],
  ship: ["deliveryfee","shippingfee","shipfee","dlvfee","baesongbi","bae",
         "배송비","택배비","운임","배송료"],
  stock: ["stock","stockqty","qty","inventory","jaego","재고","수량","재고수량"]
};
const norm = s => String(s).replace(/[\s_\-]/g, "").toLowerCase();
function guessMap(sample) {
  const keys = Object.keys(sample || {});
  const out = {};
  for (const [our, hints] of Object.entries(KEY_HINTS)) {
    const hit = keys.find(k => hints.some(h => norm(k) === norm(h)))
             || keys.find(k => hints.some(h => norm(k).includes(norm(h))));
    if (hit) out[our] = hit;
  }
  return out;
}

async function call(s, page) {
  const q = new URLSearchParams(s.query || {});
  if (s.paging && page != null) {
    q.set(s.paging.param || "page", String(page));
    if (s.paging.sizeParam) q.set(s.paging.sizeParam, String(s.paging.size || 100));
  }
  const url = s.url + (q.toString() ? (s.url.includes("?") ? "&" : "?") + q : "");
  const res = await fetch(url, {
    method: s.method || "GET",
    headers: Object.assign({ "Accept": "application/json" }, s.headers || {}),
    body: (s.method === "POST" && s.body) ? JSON.stringify(s.body) : undefined
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

const terms = [...new Set(JSON.parse(fs.readFileSync(path.join(APPDIR, "sections.json"), "utf8")).sections.flatMap(x => x.terms))];
const match = makeMatcher(terms, JSON.parse(fs.readFileSync(path.join(APPDIR, "varieties.json"), "utf8")));

const list = (cfg.suppliers || []).filter(s => (ONLY ? s.name === ONLY : s.enabled !== false));
if (!list.length) { console.error("\n  켜둔 공급사가 없다. suppliers.json 의 enabled 를 true 로 바꿔라.\n"); process.exit(1); }

const all = [];
for (const s of list) {
  console.log(`\n── ${s.name}`);
  let r;
  try { r = await call(s, s.paging ? 1 : null); }
  catch (e) { console.log(`   못 불렀다: ${e.message}`); continue; }
  if (r.status !== 200 || !r.json) {
    console.log(`   ${r.status} — ${String(r.text).replace(/\s+/g, " ").slice(0, 140)}`);
    continue;
  }
  const found = s.list ? { at: s.list, n: (dig(r.json, s.list) || []).length, sample: (dig(r.json, s.list) || [])[0] }
                       : findList(r.json);
  if (!found || !found.n) {
    console.log("   상품 배열을 못 찾았다. 응답 맨 위 열쇠: " + Object.keys(r.json).join(" · "));
    continue;
  }
  const map = (s.map && Object.keys(s.map).length) ? s.map : guessMap(found.sample);
  console.log(`   상품 배열: ${found.at || "(맨 위)"} · ${found.n}건`);
  console.log(`   열 이름: ${Object.keys(found.sample).slice(0, 14).join(" · ")}`);
  console.log(`   짚어낸 짝: ${Object.entries(map).map(([k, v]) => k + "←" + v).join(" · ") || "(없음)"}`);
  if (PROBE) {
    console.log("   보기 한 줄: " + JSON.stringify(found.sample).slice(0, 220));
    continue;
  }
  if (!map.name || !map.price) {
    console.log("   상품명 또는 공급가 열을 못 짚었다. 위 열 이름을 보내주면 map 을 채워준다.");
    continue;
  }

  /* 쪽 넘기기 */
  let rows = dig(r.json, found.at) || [];
  if (s.paging && s.paging.type === "page") {
    for (let p = 2; p <= (s.paging.max || 20); p++) {
      const more = await call(s, p);
      const arr = more.json ? (dig(more.json, found.at) || []) : [];
      if (!arr.length) break;
      rows = rows.concat(arr);
      await new Promise(r2 => setTimeout(r2, 150));
    }
  }
  let n = 0;
  for (const row of rows) {
    const name = String(dig(row, map.name) ?? "").trim();
    const price = Number(String(dig(row, map.price) ?? "").replace(/[^\d.]/g, ""));
    if (!name || !price) continue;
    const rec = normalize({ supplier: s.name, name,
      option: map.option ? dig(row, map.option) : "", price,
      ship: map.ship ? dig(row, map.ship) : null }, match);
    rec.stock = map.stock ? Number(String(dig(row, map.stock) ?? "").replace(/[^\d.]/g, "")) || null : null;
    rec.source = "api";
    all.push(rec); n++;
  }
  console.log(`   받음 ${n.toLocaleString()}건`);
}

if (PROBE) { console.log("\n  훑어보기만 했다. 저장하지 않았다.\n"); process.exit(0); }
if (!all.length) { console.error("\n  받은 게 없다. 위 메시지를 보내주면 맞춰준다.\n"); process.exit(1); }

/* 파일로 읽어둔 것이 있으면 합친다. API 것이 이긴다. */
let merged = all;
try {
  const prev = JSON.parse(fs.readFileSync(path.join(OUTDIR, "supply.json"), "utf8"));
  const fromApi = new Set(all.map(r => r.supplier));
  merged = all.concat((prev.rows || []).filter(r => !fromApi.has(r.supplier)));
} catch {}

const cuts = sizeBands(merged);
for (const r of merged) r.band = bandOf(r, cuts);
fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(path.join(OUTDIR, "supply.json"),
  JSON.stringify({ savedAt: new Date().toISOString(), files: [],
    suppliers: [...new Set(merged.map(r => r.supplier))], bands: cuts, rows: merged }), "utf8");

const ok = merged.filter(r => r.kg).length, cnt = merged.filter(r => r.count).length;
console.log(`\n  전체 ${merged.length.toLocaleString()}건 · 공급사 ${[...new Set(merged.map(r => r.supplier))].length}곳`);
console.log(`    중량 읽음 ${ok.toLocaleString()} (${(ok / merged.length * 100).toFixed(1)}%)  → 원/kg 비교 가능`);
console.log(`    과수 읽음 ${cnt.toLocaleString()} (${(cnt / merged.length * 100).toFixed(1)}%)  → g/과 크기 비교 가능`);
console.log(`\n  → ${OUTDIR}/supply.json\n`);
