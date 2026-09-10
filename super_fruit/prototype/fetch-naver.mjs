#!/usr/bin/env node
/**
 * 네이버 검색광고 API 수집기
 *
 * 이 저장소가 도는 클라우드 세션에서는 api.searchad.naver.com 이 egress 정책으로 막혀 있다.
 * 네트워크가 열린 곳(로컬 PC 등)에서 실행하면 그대로 동작한다.
 *
 * 준비
 *   네이버 검색광고 → 도구 → API 사용 관리 에서 발급
 *   .env 또는 환경변수:
 *     NAVER_AD_API_KEY=...        (액세스라이선스)
 *     NAVER_AD_SECRET=...         (비밀키)
 *     NAVER_AD_CUSTOMER=...       (CUSTOMER_ID, 숫자)
 *
 * 실행
 *   node fetch-naver.mjs --probe 샤인머스캣          응답 원본을 그대로 덤프한다 (첫 실행용)
 *   node fetch-naver.mjs --keywords 샤인머스캣,사과   지표 수집
 *   node fetch-naver.mjs --from supply-calendar.json --limit 40
 *
 * 결과: naver-out/keywords.json
 *
 * 키를 커밋하지 마라. .env 는 .gitignore 에 있다.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const HOST = "https://api.searchad.naver.com";
const KEY = process.env.NAVER_AD_API_KEY;
const SECRET = process.env.NAVER_AD_SECRET;
const CUSTOMER = process.env.NAVER_AD_CUSTOMER;

/* 서명: HMAC-SHA256(비밀키, `${timestamp}.${method}.${path}`) → Base64
   path 는 쿼리스트링을 제외한 경로만 넣는다. */
function headers(method, urlPath) {
  const ts = Date.now().toString();
  const sig = crypto.createHmac("sha256", SECRET)
    .update(`${ts}.${method}.${urlPath}`).digest("base64");
  return {
    "X-Timestamp": ts,
    "X-API-KEY": KEY,
    "X-Customer": String(CUSTOMER),
    "X-Signature": sig,
    "Content-Type": "application/json; charset=UTF-8"
  };
}

async function call(method, urlPath, { query, body } = {}) {
  const qs = query ? "?" + new URLSearchParams(query) : "";
  const res = await fetch(HOST + urlPath + qs, {
    method,
    headers: headers(method, urlPath),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 원문 그대로 반환 */ }
  return { ok: res.ok, status: res.status, json, text };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── 1. 키워드 지표 + 연관 키워드 ──────────────────────────────
   /keywordstool 은 힌트 키워드의 연관 키워드까지 함께 돌려준다.
   탐색의 입구가 여기다. 접미사로 키워드를 지어내지 말고 이 응답을 써라. */
async function keywordTool(hint) {
  return call("GET", "/keywordstool", {
    query: { hintKeywords: hint, showDetail: "1" }
  });
}

/* ── 2. 순위별 입찰가 ────────────────────────────────────────
   경로와 본문 스키마는 계정 권한에 따라 다를 수 있어 확정 전이다.
   --probe 로 실제 응답을 먼저 확인하고 맞는 것 하나만 남겨라. */
const BID_SHAPES = [
  { name: "average-position-bid",
    method: "POST", path: "/estimate/average-position-bid/keyword",
    body: (kw, device) => ({ device, keywordplus: false, key: kw,
      items: [1, 2, 3].map(p => ({ key: kw, position: p })) }) },
  { name: "exposure-minimum-bid",
    method: "POST", path: "/estimate/exposure-minimum-bid/keyword",
    body: (kw, device) => ({ device, period: "MONTH", items: [{ key: kw }] }) }
];

async function probeBids(kw) {
  for (const shape of BID_SHAPES) {
    for (const device of ["PC", "MOBILE"]) {
      const r = await call(shape.method, shape.path, { body: shape.body(kw, device) });
      console.log(`\n── ${shape.name} / ${device} → HTTP ${r.status}`);
      console.log(r.text.slice(0, 900));
      await sleep(300);
    }
  }
}

/* 지표 정규화. 프로토타입(keyword-lab.html)의 필드 이름에 맞춘다.
   "< 10" 같은 문자열이 섞여 오므로 숫자로 강제한다. */
function num(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = parseInt(v.replace(/[^\d]/g, ""), 10); return isNaN(n) ? 0 : n; }
  return 0;
}
function normalize(row) {
  const pc = num(row.monthlyPcQcCnt), mo = num(row.monthlyMobileQcCnt);
  return {
    kw: row.relKeyword,
    pc, mo, total: pc + mo,
    moShare: pc + mo ? mo / (pc + mo) : 0,
    clickPc: num(row.monthlyAvePcClkCnt),
    clickMo: num(row.monthlyAveMobileClkCnt),
    ctrPc: parseFloat(row.monthlyAvePcCtr) || 0,
    ctrMo: parseFloat(row.monthlyAveMobileCtr) || 0,
    depth: num(row.plAvgDepth),
    compIdx: row.compIdx || null,       // 높음 / 중간 / 낮음
    fetchedAt: new Date().toISOString()
  };
}

async function main() {
  const args = process.argv.slice(2);
  const has = f => args.includes(f);
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

  if (!KEY || !SECRET || !CUSTOMER) {
    console.error("환경변수가 없다: NAVER_AD_API_KEY / NAVER_AD_SECRET / NAVER_AD_CUSTOMER");
    process.exit(1);
  }

  if (has("--probe")) {
    const kw = args[args.indexOf("--probe") + 1] || "샤인머스캣";
    console.log(`=== /keywordstool 원본 · "${kw}" ===`);
    const r = await keywordTool(kw);
    console.log("HTTP", r.status);
    console.log(r.text.slice(0, 2000));
    console.log("\n=== 입찰가 엔드포인트 탐침 ===");
    await probeBids(kw);
    console.log("\n이 출력을 그대로 붙여주면 파서를 확정한다.");
    return;
  }

  let hints = [];
  if (val("--keywords")) hints = val("--keywords").split(",").map(s => s.trim());
  else if (val("--from")) {
    const cat = JSON.parse(await fs.readFile(val("--from"), "utf8"));
    hints = cat.items.map(i => i.v);
  } else {
    console.error("--keywords 또는 --from 이 필요하다");
    process.exit(1);
  }
  const limit = parseInt(val("--limit") || "0", 10);
  if (limit > 0) hints = hints.slice(0, limit);

  const out = {}, failed = [];
  let calls = 0;
  for (const hint of hints) {
    const r = await keywordTool(hint);
    calls++;
    if (!r.ok) {
      failed.push({ hint, status: r.status, body: r.text.slice(0, 200) });
      // 429 / 한도 초과는 여기서 멈춘다. 이전 값으로 덮어쓰지 않는다.
      if (r.status === 429) { console.error("한도 도달. 남은 작업은 다음 회차로 넘긴다."); break; }
    } else {
      out[hint] = (r.json?.keywordList || []).map(normalize);
      console.error(`${hint} → ${out[hint].length}개`);
    }
    await sleep(350);           // 초당 3회 이하로 유지
  }

  await fs.mkdir("naver-out", { recursive: true });
  await fs.writeFile(path.join("naver-out", "keywords.json"),
    JSON.stringify({ fetchedAt: new Date().toISOString(), calls, hints: hints.length,
                     ok: Object.keys(out).length, failed, data: out }, null, 2), "utf8");
  console.error(`\n호출 ${calls}회 · 성공 ${Object.keys(out).length} · 실패 ${failed.length}`);
  console.error("→ naver-out/keywords.json");
  if (failed.length) console.error("실패는 실패로 남겼다. 성공처럼 보이게 덮지 않았다.");
}
main().catch(e => { console.error(e); process.exit(1); });
