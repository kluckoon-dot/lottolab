/* ── 품종 사전을 만든다 ──
 *
 * 공급사는 "홍옥", 우리 키워드 사전은 "홍옥사과". 같은 물건인데 안 맞는다.
 * 나주배도 마찬가지다. 산지가 앞에 붙으면 사전에서 빠진다.
 *
 * 세 갈래로 모은다.
 *   1. supply-calendar.json 의 202품종 45카테고리   (품종 → 기준품목)
 *   2. 산지 + 품목 조합                              (나주배 → 배)
 *   3. 달력에 없는 흔한 품종 손으로 보탬              (홍옥 · 아리수 · 후지)
 *
 * 결과: varieties.json  { "홍옥": "사과", "나주배": "배", ... }
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* 폴더 정리 (2026-10-09): 설정 파일은 이 스크립트 옆(app\) */
const APPDIR = path.dirname(fileURLToPath(import.meta.url));

const cal = JSON.parse(fs.readFileSync(path.join(APPDIR, "supply-calendar.json"), "utf8"));
const map = {};
const put = (k, v) => {
  const w = String(k).replace(/\s+/g, "");
  if (!w || w.length < 2) return;
  if (!map[w]) map[w] = v;
};

/* 1. 달력 */
for (const x of cal.items) {
  const cat = String(x.c).trim();
  for (let v of String(x.v).split(/[&,]/)) {
    v = v.trim();
    if (!v) continue;
    const bare = v.replace(/\([^)]*\)/g, "").trim();     // 엔부사과(복숭아사과) → 엔부사과
    put(bare, cat);
    const inner = (v.match(/\(([^)]*)\)/) || [])[1];      // 괄호 안도 부른다
    if (inner) put(inner.trim(), cat);
    /* 품목 이름을 뗀 단독형도 등록한다. 홍로사과 → 홍로 */
    if (bare.length > cat.length && bare.endsWith(cat)) put(bare.slice(0, -cat.length), cat);
  }
  put(cat, cat);
}

/* 2. 산지 + 품목.
   공급사 상품명에 산지가 앞에 붙는 일이 아주 잦다. 조합을 미리 깔아둔다. */
const ORIGIN = ["나주","제주","성주","청송","문경","봉화","상주","영천","경산","충주","예산","천안",
  "해남","여수","통영","거제","완도","고흥","보성","순천","횡성","평창","홍천","양양","영월",
  "무주","장수","임실","김제","부여","공주","논산","밀양","의성","안동","영주","김천","거창",
  "함안","창녕","고령","산청","하동","남해","진영","울릉","강원","전남","경북","경남","충남","충북"];
const BASE = [...new Set(Object.values(map))];
for (const o of ORIGIN) for (const b of BASE) put(o + b, b);

/* 3. 달력에 없는 흔한 품종. 확실한 것만 넣는다. */
const EXTRA = {
  사과: ["홍옥","아리수","후지","미얀마","양광","홍장군","산사","서머킹","알프스오토메","이지플","골든볼","청사과","꿀사과","햇사과"],
  배: ["신고","원황","황금","추황","화산","만풍","한아름","감천","슈퍼골드","나주배","햇배"],
  감귤: ["노지귤","하우스귤","타이벡귤","조생귤","비가림귤","산지귤"],
  포도: ["샤인머스캣","캠벨","델라웨어","청포도","흑포도"],
  복숭아: ["백도","황도","천도","털복숭아","납작복숭아"],
  단감: ["부유","차랑","태추","대봉"],
  고구마: ["베니하루카","호박고구마","밤고구마","꿀고구마","자색고구마","햇고구마"],
  감자: ["수미","두백","홍감자","알감자","설봉"],
  양파: ["햇양파","자색양파","적양파","깐양파"],
  마늘: ["육쪽마늘","깐마늘","햇마늘","흑마늘","코끼리마늘"],
  토마토: ["대저토마토","짭짤이토마토","방울토마토","대추방울토마토","스테비아토마토","완숙토마토"],
  참외: ["성주참외","꿀참외"],
  수박: ["씨없는수박","애플수박","복수박","블랙망고수박"],
  딸기: ["설향","장희","죽향","금실","킹스베리"],
  배추: ["절임배추","알배추","김장배추","고랭지배추","황금배추"],
  옥수수: ["초당옥수수","찰옥수수","대학찰옥수수","미백찰옥수수"]
};
for (const [base, list] of Object.entries(EXTRA)) { put(base, base); for (const v of list) put(v, base); }

/* 스스로 가리키는 항목도 넣어둔다. 사과 → 사과 */
for (const b of [...new Set(Object.values(map))]) put(b, b);

const sorted = Object.fromEntries(Object.entries(map).sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0])));
fs.writeFileSync(path.join(APPDIR, "varieties.json"), JSON.stringify(sorted, null, 0), "utf8");

const byBase = {};
for (const [k, v] of Object.entries(sorted)) (byBase[v] || (byBase[v] = [])).push(k);
console.log(`품종 사전 ${Object.keys(sorted).length.toLocaleString()}개 · 기준품목 ${Object.keys(byBase).length}개`);
console.log("\n확인:");
for (const k of ["홍옥","나주배","제주감귤","성주참외","시나노골드","부사","샤인머스켓","샤인머스캣","절임배추","베니하루카"])
  console.log(`  ${k.padEnd(10)} → ${sorted[k] || "※ 없음"}`);
console.log("\n가장 많은 기준품목:");
Object.entries(byBase).sort((a,b)=>b[1].length-a[1].length).slice(0,6)
  .forEach(([b,l])=>console.log(`  ${b.padEnd(8)} ${String(l.length).padStart(3)}개  ${l.slice(0,6).join(" · ")}`));
