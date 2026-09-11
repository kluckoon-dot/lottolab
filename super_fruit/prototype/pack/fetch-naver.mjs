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
 *   node fetch-naver.mjs --keywords-file kw.txt      지표 수집 (UTF-8, 한 줄에 하나)
 *   node fetch-naver.mjs --from supply-calendar.json --limit 40
 *
 * 윈도우 콘솔은 한글 인자가 깨질 수 있다. --probe 는 인자 없이 써라 (샤인머스캣이 기본값),
 * 목록은 --keywords-file 로 넘겨라.
 *
 * 결과: naver-out/keywords.json
 *
 * 키를 커밋하지 마라. .env 는 .gitignore 에 있다.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const HOST = "https://api.searchad.naver.com";

/* 키 읽기.
   1) 환경변수가 있으면 그걸 쓴다
   2) 없으면 이 파일 옆의 key.txt 를 읽는다 (프로그램 모르는 사람용)
   한글 라벨도 받아준다. 따옴표·공백·BOM 은 알아서 떼낸다. */
const ALIAS = {
  naver_ad_api_key:"KEY", 액세스라이선스:"KEY", 라이선스:"KEY", apikey:"KEY", api_key:"KEY",
  naver_ad_secret:"SECRET", 비밀키:"SECRET", secret:"SECRET", secretkey:"SECRET",
  naver_ad_customer:"CUSTOMER", 고객id:"CUSTOMER", 고객아이디:"CUSTOMER",
  customerid:"CUSTOMER", customer_id:"CUSTOMER", customer:"CUSTOMER"
};
function loadKeyFile() {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  for (const name of ["key.txt", ".env"]) {
    let raw;
    try { raw = require$readFileSync(path.join(here, name), "utf8"); } catch { continue; }
    const out = {};
    for (const line of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("//")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim().toLowerCase().replace(/[\s-]/g, "");
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (ALIAS[k] && v && !/여기에|붙여넣|paste|<|>/.test(v)) out[ALIAS[k]] = v;
    }
    if (Object.keys(out).length) return out;
  }
  return {};
}
import { readFileSync as require$readFileSync } from "node:fs";
const FILEKEYS = loadKeyFile();
const KEY = process.env.NAVER_AD_API_KEY || FILEKEYS.KEY;
const SECRET = process.env.NAVER_AD_SECRET || FILEKEYS.SECRET;
const CUSTOMER = process.env.NAVER_AD_CUSTOMER || FILEKEYS.CUSTOMER;

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

/* 출력에 키가 섞여 나가는 일이 없게 한 번 걸러낸다 */
function safe(text) {
  let t = String(text ?? "");
  for (const v of [KEY, SECRET, CUSTOMER]) if (v) t = t.split(v).join("<가림>");
  return t;
}
function explain(status, body) {
  const b = String(body || "");
  if (status === 403 && /not in allowlist/i.test(b)) return "네트워크 차단. 이 PC 에서 api.searchad.naver.com 에 못 나간다.";
  if (status === 403 && /auth-failed|Auth Failed/i.test(b)) return "네이버가 키를 거부했다. 네트워크는 뚫렸다.";
  if (status === 401) return "인증 실패. 키 세 값을 다시 확인해라.";
  if (status === 403) return "권한 없음. API 사용 신청 상태를 확인해라.";
  if (status === 404) return "경로가 다르다. 이 엔드포인트는 후보에서 빼면 된다.";
  if (status === 429) return "호출 한도 초과.";
  return "";
}

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

/* 값을 노출하지 않고 모양만 본다. 대부분의 인증 실패는 여기서 잡힌다. */
function shapeReport() {
  const shape = v => {
    const t = String(v ?? "");
    const cls = /^\d+$/.test(t) ? "숫자만"
      : /^[A-Za-z0-9+/=]+$/.test(t) ? "영문+숫자(+/=)"
      : /\s/.test(t) ? "공백·줄바꿈 섞임 ← 의심"
      : "기타 문자 포함";
    return { len: t.length, head: t.slice(0, 4), cls, tail: t.slice(-1) };
  };
  const k = shape(KEY), s2 = shape(SECRET), c = shape(CUSTOMER);
  console.log("── 키 모양 점검 (값은 보여주지 않는다)");
  console.log(`  액세스라이선스  길이 ${k.len}  앞 4글자 ${k.head}  ${k.cls}`);
  console.log(`  비밀키          길이 ${s2.len}  ${s2.cls}${s2.tail === "=" ? "  끝이 = 로 끝남" : ""}`);
  console.log(`  고객ID          길이 ${c.len}  ${c.cls}`);

  const warn = [];
  if (!/^\d+$/.test(String(CUSTOMER))) warn.push("고객ID 가 숫자가 아니다. 네이버 아이디나 사업자번호를 넣은 게 아닌지 확인해라.");
  if (String(CUSTOMER).length < 5 || String(CUSTOMER).length > 12) warn.push("고객ID 자릿수가 보통과 다르다.");
  if (KEY === SECRET) warn.push("액세스라이선스와 비밀키가 같은 값이다.");
  if (/\s/.test(String(KEY)) || /\s/.test(String(SECRET))) warn.push("키 안에 공백이나 줄바꿈이 섞여 있다. 붙여넣기를 다시 해라.");
  if (k.len && s2.len && k.len > s2.len) warn.push("보통 비밀키가 액세스라이선스보다 길다. 두 값이 서로 바뀌었을 수 있다.");
  if (warn.length) { console.log("\n  의심되는 점"); warn.forEach(w => console.log("   · " + w)); }
  console.log("");
}

/* 인증 실패의 원인을 갈라낸다.
   키를 잘못 넣은 것인지, 내 서명 구현이 틀린 것인지는 밖에서 구분되지 않는다.
   그래서 조합을 전부 시도해보고 200 이 나오는 게 있는지 본다. 6번이면 끝난다. */
async function diagnose(kw) {
  const P = "/keywordstool";
  const QS = "?hintKeywords=" + encodeURIComponent(kw) + "&showDetail=1";
  const variants = [
    { name: "표준 (시각.METHOD.경로)",  msg: ts => `${ts}.GET.${P}` },
    { name: "경로에 쿼리까지 포함",      msg: ts => `${ts}.GET.${P}${QS}` },
    { name: "메서드 소문자",             msg: ts => `${ts}.get.${P}` }
  ];
  const creds = [
    { name: "입력한 그대로", api: KEY,    sec: SECRET },
    { name: "두 값 맞바꿈",  api: SECRET, sec: KEY }
  ];
  console.log("  조합을 하나씩 시도한다. 200 이 하나라도 나오면 거기서 답이 갈린다.\n");
  let hit = null;
  for (const c of creds) {
    for (const v of variants) {
      const ts = Date.now().toString();
      const sig = crypto.createHmac("sha256", c.sec).update(v.msg(ts)).digest("base64");
      let status = "??";
      try {
        const res = await fetch(HOST + P + QS, {
          headers: { "X-Timestamp": ts, "X-API-KEY": c.api, "X-Customer": String(CUSTOMER),
                     "X-Signature": sig, "Content-Type": "application/json; charset=UTF-8" }
        });
        status = res.status;
        if (res.ok && !hit) hit = { cred: c.name, variant: v.name };
      } catch (e) { status = "연결실패"; }
      console.log(`   ${status === 200 ? "OK  " : "실패"}  ${c.name} / ${v.name}  → ${status}`);
      await sleep(250);
    }
  }
  console.log("");
  if (hit) {
    console.log("*** 통하는 조합을 찾았다 ***");
    console.log(`    자격증명: ${hit.cred}`);
    console.log(`    서명방식: ${hit.variant}`);
    if (hit.cred === "두 값 맞바꿈")
      console.log("\n    → key.txt 에서 액세스라이선스와 비밀키의 위치를 맞바꾸고 저장한 뒤 다시 실행해라.");
    if (hit.variant !== "표준 (시각.METHOD.경로)")
      console.log("\n    → 서명 방식 문제다. 이 결과를 보내주면 코드를 고쳐서 다시 보낸다.");
    return true;
  }
  console.log("여섯 조합이 전부 실패했다.");
  console.log("서명 방식 문제가 아니다. 키 값 자체가 이 계정에서 안 통한다는 뜻이다.\n");
  return false;
}

function authChecklist() {
  console.log("── 인증 실패 점검표 (위에서부터 흔한 순서)");
  console.log("  1. 고객ID  검색광고 화면 우측 상단 [내 정보] 옆 숫자다.");
  console.log("     네이버 아이디도, 사업자등록번호도, 광고그룹 번호도 아니다.");
  console.log("  2. 키 쌍   액세스라이선스와 비밀키는 같이 발급된 한 쌍이어야 한다.");
  console.log("     예전에 발급한 것과 새로 발급한 것을 섞어 넣지 않았는지 본다.");
  console.log("  3. 재발급  비밀키는 발급 때 한 번만 보인다. 못 봤으면 못 쓴다.");
  console.log("     [도구] → [API 사용 관리] 에서 다시 발급받고 그 자리에서 둘 다 복사한다.");
  console.log("  4. 계정    로그인한 계정에 검색광고 광고주 계정이 있어야 한다.");
  console.log("     여러 계정을 쓰고 있으면 키를 발급한 그 계정의 고객ID 여야 한다.");
  console.log("  5. 붙여넣기  key.txt 에서 = 뒤에 값만 있어야 한다.");
  console.log("     따옴표는 떼주지만 중간에 줄바꿈이 들어가면 못 고친다.\n");
}

async function probeBids(kw) {
  for (const shape of BID_SHAPES) {
    for (const device of ["PC", "MOBILE"]) {
      const r = await call(shape.method, shape.path, { body: shape.body(kw, device) });
      console.log(`\n── ${shape.name} / ${device} → HTTP ${r.status} ${explain(r.status, r.text)}`);
      console.log(safe(r.text).slice(0, 900));
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

  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < 18) { console.error(`Node ${process.versions.node} 은 너무 낮다. 18 이상이 필요하다.`); process.exit(1); }
  if (!KEY || !SECRET || !CUSTOMER) {
    const miss = [];
    if (!KEY) miss.push("액세스라이선스");
    if (!SECRET) miss.push("비밀키");
    if (!CUSTOMER) miss.push("고객ID");
    console.error("\n키가 없다: " + miss.join(" / "));
    console.error("같은 폴더의 key.txt 를 메모장으로 열어서 = 뒤에 값을 붙여넣고 저장해라.");
    console.error("세 줄 모두 채워야 한다.\n");
    process.exit(1);
  }
  console.error("키 확인 완료. 고객ID " + String(CUSTOMER).slice(0, 3) + "***");

  if (has("--probe")) {
    const kw = args[args.indexOf("--probe") + 1] || "샤인머스캣";
    shapeReport();
    console.log(`=== /keywordstool 원본 · "${kw}" ===`);
    const r = await keywordTool(kw);
    console.log("HTTP", r.status, explain(r.status, r.text));
    console.log(safe(r.text).slice(0, 2000));

    if (r.status === 403 && /auth-failed|Auth Failed/i.test(r.text)) {
      console.log("\n=== 인증 실패 자동 진단 ===");
      console.log("  네트워크는 뚫렸다. 이건 네이버 서버가 직접 준 응답이다.");
      console.log("  남은 가능성은 두 가지다. 키 값이 안 맞거나, 서명 방식이 안 맞거나.\n");
      const fixed = await diagnose(kw);
      if (!fixed) authChecklist();
      console.log("입찰가 탐침은 건너뛴다. 인증이 풀린 뒤에 다시 돌리면 된다.");
      return;
    }

    console.log("\n=== 입찰가 엔드포인트 탐침 ===");
    await probeBids(kw);
    console.log("\n이 출력을 그대로 붙여주면 파서를 확정한다.");
    return;
  }

  let hints = [];
  if (val("--keywords-file")) {
    // 윈도우 콘솔에서 한글 인자가 깨지는 문제를 피한다. UTF-8 파일에 한 줄에 하나씩.
    const raw = await fs.readFile(val("--keywords-file"), "utf8");
    hints = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  else if (val("--keywords")) hints = val("--keywords").split(",").map(s => s.trim());
  else if (val("--from")) {
    const cat = JSON.parse(await fs.readFile(val("--from"), "utf8"));
    hints = cat.items.map(i => i.v);
  } else {
    console.error("--keywords-file / --keywords / --from 중 하나가 필요하다");
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
      failed.push({ hint, status: r.status, note: explain(r.status, r.text), body: safe(r.text).slice(0, 200) });
      console.error(`${hint} → 실패 HTTP ${r.status} ${explain(r.status, r.text)}`);
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
