#!/usr/bin/env node
/**
 * NAVER API HUB 수집기 — 3년 주간 추세 · 연령 · 성별 · 기기
 *
 * 검색광고 API(fetch-naver.mjs)와는 별개 서비스다. 둘 다 필요하다.
 *   검색광고 API  →  월검색수 · 클릭 · CTR · 경쟁도 · 1~3위 입찰가
 *   API HUB       →  3년 주간 추세 · 연령 · 성별 · 기기
 *
 * 원칙은 같다. 키워드는 합치지도 버리지도 않는다.
 *
 * 실행
 *   node fetch-hub.mjs --probe        호출 주소와 인증을 찾아낸다 (제일 먼저)
 *   node fetch-hub.mjs --trend        3년 주간 추세 수집
 *   node fetch-hub.mjs --shop         키워드별 기기·성별·연령 수집
 *   node fetch-hub.mjs --cat          카테고리 ID 가 살아있는지 확인
 */
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

const OUTDIR = "naver-out";

/* ── 키 ── */
const ALIAS = {
  naver_hub_id:"ID", hub_client_id:"ID", clientid:"ID", client_id:"ID", 허브id:"ID", 허브아이디:"ID",
  naver_hub_secret:"SECRET", hub_client_secret:"SECRET", clientsecret:"SECRET", client_secret:"SECRET", 허브시크릿:"SECRET"
};
function loadKeys() {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  for (const name of ["key.txt", ".env"]) {
    let raw; try { raw = readFileSync(path.join(here, name), "utf8"); } catch { continue; }
    const out = {};
    for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) {
      const t = line.trim(); if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("="); if (i < 0) continue;
      const k = t.slice(0, i).trim().toLowerCase().replace(/[\s-]/g, "");
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (ALIAS[k] && v && !/여기에|붙여넣|paste|<|>/.test(v)) out[ALIAS[k]] = v;
    }
    if (out.ID || out.SECRET) return out;
  }
  return {};
}
const K = loadKeys();
const ID = process.env.NAVER_HUB_ID || K.ID;
const SECRET = process.env.NAVER_HUB_SECRET || K.SECRET;

/* ── 호출 주소 후보.
   이관하면서 주소가 바뀌었는데 문서를 직접 확인하지 못했다.
   추측으로 못 박지 않고, 실제로 때려보고 되는 것을 찾는다. ── */
/* 2026-09-11 실호출로 확정.
     주소   POST https://naverapihub.apigw.ntruss.com/search-trend/v1/search
     헤더   X-NCP-APIGW-API-KEY-ID : Client ID
            X-NCP-APIGW-API-KEY    : Client Secret
   200 과 156주치 실데이터를 받았다.
   앞서 naveropenapi.apigw.ntruss.com 은 구 AI·NAVER API 게이트웨이였고
   거기서 나온 210 은 "이 게이트웨이에 그런 경로가 있긴 하다" 그 이상이 아니었다. */
const HUB = process.env.NAVER_HUB_HOST || "https://naverapihub.apigw.ntruss.com";
/* 2026-09-11 이관 가이드로 확정.
     호출 도메인   openapi.naver.com     →  naverapihub.apigw.ntruss.com
     API Path     /v1/search/news.json  →  /search/v1/news
                  (v1 이 앞에서 뒤로 이동하고 .json 이 빠진다)
     헤더         X-Naver-Client-Id     →  X-NCP-APIGW-API-KEY-ID
                  X-Naver-Client-Secret →  X-NCP-APIGW-API-KEY

   그동안 naveropenapi.apigw.ntruss.com 을 두드렸는데 그건 옛 게이트웨이다.
   그래서 210 "구독 필요" 가 나왔다. 키가 그쪽에 구독되어 있지 않았을 뿐이다. */
const HOSTS = [HUB, "https://naveropenapi.apigw.ntruss.com"];
/* 1차 진단에서 얻은 것
     openapi.naver.com          401 NID AUTH  → 호스트와 헤더는 맞고 값이 거부됨
     naveropenapi.apigw.ntruss  404           → 호스트는 살아있고 경로가 다름
   그래서 이번에는 경로를 여러 개 때려본다. 404 가 아닌 게 하나라도 나오면 그게 답이다. */
/* 인증 헤더 후보. 이관 안내는 X-Naver-Client-* 를 쓴다고 되어 있으나
   NCP 게이트웨이 방식(X-NCP-APIGW-*)일 가능성도 같이 확인한다. */
import crypto from "node:crypto";
const AUTHS = [
  { name: "X-Naver-Client-*", h: () => ({ "X-Naver-Client-Id": ID, "X-Naver-Client-Secret": SECRET }) },
  { name: "X-NCP-APIGW-*",    h: () => ({ "X-NCP-APIGW-API-KEY-ID": ID, "X-NCP-APIGW-API-KEY": SECRET }) },
  { name: "NCP 서명 v2",       sign: true,
    h: (method, uri) => {
      const ts = Date.now().toString();
      const msg = `${method} ${uri}\n${ts}\n${ID}`;
      const sig = crypto.createHmac("sha256", SECRET).update(msg).digest("base64");
      return { "x-ncp-apigw-timestamp": ts, "x-ncp-iam-access-key": ID, "x-ncp-apigw-signature-v2": sig };
    } },
  { name: "둘 다 같이",         h: () => ({ "X-Naver-Client-Id": ID, "X-Naver-Client-Secret": SECRET,
                                           "X-NCP-APIGW-API-KEY-ID": ID, "X-NCP-APIGW-API-KEY": SECRET }) }
];
const TREND_PATH = "/v1/datalab/search";
const HUB_TREND = "/search-trend/v1/search";   // 2026-09-11 실호출로 확정. 200 + 156주 데이터 확인
const TREND_PATHS = [HUB_TREND];
/* 대조군. 존재할 리 없는 경로다.
   이게 404 면 "404 = 없는 경로, 210 = 있는데 구독 안 됨" 으로 읽어도 된다.
   이것마저 210 이면 210 은 아무 의미가 없다는 뜻이므로 다르게 접근해야 한다. */
const CONTROL_PATH = "/zzz-definitely-not-an-api/v1/nothing";
/* 경로 규칙은 legacy 에서 유도되는 게 아니라 제품 이름을 그대로 쓴다.
     검색어트렌드 → /search-trend/v1/search   (2026-09-11 확정)
     쇼핑인사이트 → /shopping/v1/...          (2026-09-11 확정)
   쇼핑 쪽 서비스 이름은 shopping-insight 가 아니라 그냥 shopping 이었다.
   8개 경로 전부 200 과 실데이터를 확인했다. */
const SHOP_PATHS = {
  categories:  "/shopping/v1/categories",                  // 분야별 트렌드 (목록 조회가 아니다)
  keywords:    "/shopping/v1/category/keywords",           // 카테고리 안 키워드 트렌드
  catDevice:   "/shopping/v1/category/device",
  catGender:   "/shopping/v1/category/gender",
  catAge:      "/shopping/v1/category/age",
  device:      "/shopping/v1/category/keyword/device",
  gender:      "/shopping/v1/category/keyword/gender",
  age:         "/shopping/v1/category/keyword/age"
};

/* 씨앗을 네이버한테 받아올 수 있는 통로가 있는지 확인할 후보들.
   404 면 없는 것, 400 이면 있는데 요청 형식만 틀린 것이다. */
const RAW_PATHS = [
  ["분야별 트렌드",        "POST", SHOP_PATHS.categories,
    { startDate: "2026-08-01", endDate: "2026-08-31", timeUnit: "month",
      category: [{ name: "식품", param: ["50000006"] }] }],
  ["카테고리별 인기 키워드", "POST", SHOP_PATHS.keywords,
    { startDate: "2026-08-01", endDate: "2026-08-31", timeUnit: "month", category: "50000006",
      keyword: [{ name: "사과", param: ["사과"] }] }],
  ["키워드별 기기",        "POST", SHOP_PATHS.device,
    { startDate: "2026-08-01", endDate: "2026-08-31", timeUnit: "month", category: "50000006", keyword: "사과" }],
  ["키워드별 성별",        "POST", SHOP_PATHS.gender,
    { startDate: "2026-08-01", endDate: "2026-08-31", timeUnit: "month", category: "50000006", keyword: "사과" }],
  ["키워드별 연령",        "POST", SHOP_PATHS.age,
    { startDate: "2026-08-01", endDate: "2026-08-31", timeUnit: "month", category: "50000006", keyword: "사과" }]
];

function ymd(d) { return d.toISOString().slice(0, 10); }
function threeYears() {
  const end = new Date(); const start = new Date(end); start.setFullYear(start.getFullYear() - 3);
  return { startDate: ymd(start), endDate: ymd(end) };
}
function trendBody(keywords) {
  const { startDate, endDate } = threeYears();
  return { startDate, endDate, timeUnit: "week",
           keywordGroups: keywords.map(k => ({ groupName: k, keywords: [k] })) };
}
function safe(t) { let s = String(t ?? ""); for (const v of [ID, SECRET]) if (v && String(v).length >= 6) s = s.split(v).join("<가림>"); return s; }

async function tryCall(host, auth, body, p) {
  try {
    const res = await fetch(host + (p || TREND_PATH), {
      method: "POST",
      headers: { ...auth.h("POST", p || TREND_PATH), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    /* openapi.naver.com 은 없는 경로에도 200 + 에러 본문을 돌려준다.
       ("Partner does not exists" 등) 그래서 본문까지 봐야 진짜 성공인지 안다. */
    const errBody = !!(json && (json.errorCode || json.error_code || json.errorMessage || json.message));
    return { status: res.status, ok: res.ok && !errBody, raw: res.status, errBody, text, json };
  } catch (e) { return { status: "연결실패", ok: false, text: String(e.message || e), json: null }; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 확정된 조합으로 호출한다 — NCP 게이트웨이 + X-NCP-APIGW-* 헤더 */
async function call(method, p, { body } = {}) {
  try {
    const res = await fetch(HUB + p, { method,
      headers: { "X-NCP-APIGW-API-KEY-ID": ID, "X-NCP-APIGW-API-KEY": SECRET,
                 "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    const errBody = !!(json && (json.error || json.errorCode || json.errorMessage));
    return { ok: res.ok && !errBody, raw: res.status, json, text };
  } catch (e) { return { ok: false, raw: "연결실패", json: null, text: String(e.message || e) }; }
}

async function probe() {
  console.log("── 인증 정보 점검 (값은 보여주지 않는다)");
  console.log(`  Client ID      길이 ${String(ID).length}`);
  console.log(`  Client Secret  길이 ${String(SECRET).length}\n`);

  const body = trendBody(["샤인머스캣"]);
  const { startDate, endDate } = threeYears();
  console.log(`── 3년 주간 추세 요청으로 시험한다  ${startDate} ~ ${endDate}\n`);

  /* 먼저 대조군으로 응답의 의미를 보정한다 */
  console.log("── 먼저 대조군으로 응답의 뜻을 확인한다");
  const ctrl = [];
  for (const host of HOSTS) {
    const r = await tryCall(host, AUTHS[1], body, CONTROL_PATH);
    const code = (r.json && r.json.error && r.json.error.errorCode) || "";
    ctrl.push({ host, status: r.raw, code });
    console.log(`  ${String(r.raw).padEnd(5)} ${code ? "("+code+") " : ""}${host}${CONTROL_PATH}`);
    await sleep(180);
  }
  const ctrl210 = ctrl.some(c => c.code === "210");
  console.log(ctrl210
    ? "\n  → 없는 경로에도 210 이 온다. 210 은 경로 판단에 못 쓴다. 200(OK) 만 믿는다.\n"
    : "\n  → 없는 경로는 210 이 아니다. 그러므로 210 = 경로는 있는데 구독이 안 된 것이다.\n");

  let hit = null, notable = [];
  for (const host of HOSTS) {
    for (const p of TREND_PATHS) {
      for (const auth of [AUTHS[1]]) {          // 콘솔이 지정한 X-NCP-APIGW-* 만 쓴다
        const r = await tryCall(host, auth, body, p);
        const code = (r.json && r.json.error && r.json.error.errorCode) || "";
        const real = r.ok;
        const authish = !real && (r.raw === 401 || r.raw === 403 || r.raw === 405)
                        && !(ctrl210 && code === "210");
        if (real || authish) {
          const mark = real ? "OK  " : authish ? "경로○" : "    ";
          console.log(`  ${mark} ${String(r.raw).padEnd(5)} ${code ? "("+code+") " : ""}${host}${p}  [${auth.name}]`
            + (r.errBody ? "  ← 200 인데 본문은 에러" : ""));
          notable.push({ host, p, auth: auth.name, status: r.raw, authish, text: r.text });
        }
        if (r.ok && !hit) hit = { host, auth: auth.name, path: p, sample: r.text };
        await sleep(200);
      }
    }
  }
  if (!notable.length) console.log("  전부 404 또는 연결실패였다.");
  console.log("\n  OK    = 진짜 성공");
  console.log("  경로○ = 경로는 맞다. 401·403 이면 인증 문제, 405 면 메서드 문제");
  console.log("");

  if (hit) {
    console.log("*** 통하는 조합을 찾았다 ***");
    console.log(`    주소   ${hit.host}${hit.path}`);
    console.log(`    인증   ${hit.auth}\n`);
    console.log("── 응답 원본 (앞부분)");
    console.log(safe(hit.sample).slice(0, 1200));
    await fs.mkdir(OUTDIR, { recursive: true });
    await fs.writeFile(path.join(OUTDIR, "hub-endpoint.json"),
      JSON.stringify({ host: hit.host, auth: hit.auth, path: hit.path, foundAt: new Date().toISOString() }, null, 1), "utf8");
    console.log(`\n주소를 ${OUTDIR}/hub-endpoint.json 에 저장했다.\n`);

    console.log("── 씨앗을 네이버한테 받아올 수 있는지 확인한다");
    console.log("   200 된다 · 400 통로는 있다(형식만 맞추면 됨) · 404 없다\n");
    for (const [name, method, p, body] of RAW_PATHS) {
      let st = "??", txt = "";
      try {
        const res = await fetch(hit.host + p, {
          method,
          headers: { ...AUTHS.find(a => a.name === hit.auth).h(method, p), "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined
        });
        st = res.status; txt = safe(await res.text()).replace(/\s+/g, " ").slice(0, 200);
      } catch (e) { st = "연결실패"; txt = String(e.message || e); }
      console.log(`  ${String(st).padEnd(6)} ${name.padEnd(22)} ${p}`);
      if (txt) console.log(`         ${txt}`);
      await sleep(280);
    }
    console.log("\n이 출력을 보내주면 씨앗을 어디서 받을지 확정한다.");
    return;
  }

  var sub210 = notable.filter(n => /"210"|subscription to the API is required/i.test(n.text));
  if (sub210.length) {
    console.log("*** 모든 후보가 210 이다 ***\n");
    console.log("    " + HUB + HUB_TREND + "  [X-NCP-APIGW-*]");
    console.log('    응답: 210 "A subscription to the API is required."\n');
    console.log("    210 은 게이트웨이가 요청을 제대로 읽었다는 뜻이다.");
    console.log("    주소도 헤더 이름도 맞다. 남은 것은 둘 중 하나다.\n");
    console.log("    콘솔 [인증 정보] 팝업이 헤더 이름을 직접 표기하므로 키와 헤더는 맞다.");
    console.log("    그렇다면 남은 것은 호출 주소다. 위 후보 중에 정답이 없다는 뜻이다.\n");
    console.log("    확실하게 끝내는 방법:");
    console.log("      콘솔 화면 상단의 [개발 가이드] 버튼을 눌러라.");
    console.log("      공식 문서가 열리고 거기에 호출 주소가 적혀 있다.");
    console.log("      그 주소 한 줄만 알려주면 바로 붙인다.\n");
    return;
  }
  const auth401 = notable.filter(n => n.status === 401);
  if (auth401.length) {
    console.log("*** 경로는 찾았다. 인증만 막혀 있다 ***");
    const seen = new Set();
    for (const n of auth401) { const k = n.host + n.p; if (seen.has(k)) continue; seen.add(k);
      console.log(`    ${n.host}${n.p}`); }
    console.log("\n    → Client ID / Client Secret 값을 다시 확인해야 한다.");
    console.log("      콘솔 [인증 정보] 팝업의 두 값을 그대로 복사했는지,");
    console.log("      다른 칸(Application 이름 등)을 잘못 넣지 않았는지 확인해라.\n");
  } else {
    console.log("통하는 조합이 없었다. 404 가 아니었던 것들의 응답이다.\n");
  }
  for (const n of notable.slice(0, 6)) {
    console.log(`── ${n.status}  ${n.host}${n.p}  [${n.auth}]`);
    console.log("   " + safe(n.text).replace(/\s+/g, " ").slice(0, 260) + "\n");
  }
  console.log("\n확인할 것");
  console.log("  0. Client ID 10자 / Secret 40자 조합이 맞는지 다시 확인");
  console.log("     콘솔 [인증 정보] 팝업에 나오는 두 값을 그대로 넣어야 한다");
  console.log("  1. 콘솔에서 Application 을 등록했는가");
  console.log("  2. 그 Application 에 '검색어트렌드' API 가 추가되어 있는가");
  console.log("     (API HUB 는 Application 마다 쓸 API 를 골라서 붙인다)");
  console.log("  3. [인증 정보] 팝업의 Client ID / Client Secret 을 그대로 넣었는가");
  console.log("     개발자센터의 예전 값은 API HUB 에서 통하지 않는다");
}

/* ── 3년 주간 추세 수집 ──
   한 번 호출에 키워드 그룹을 최대 5개까지 넣는다. 156주가 통째로 온다.
   키워드는 합치지도 버리지도 않는다. 철자가 다르면 각각 따로 받는다. */
async function collectTrend(args) {
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const src = val("--from") || path.join(OUTDIR, "keywords.json");
  let rows;
  try { rows = JSON.parse(await fs.readFile(src, "utf8")).rows; }
  catch { console.error(`${src} 을 읽지 못했다. 검색광고 수집을 먼저 끝내라.`); process.exit(1); }
  const minVol = parseInt(val("--min-vol") || "0", 10);
  const limit = parseInt(val("--limit") || "0", 10);
  let targets = rows.filter(r => (r.total || 0) >= minVol).sort((a, b) => b.total - a.total).map(r => r.kw);
  if (limit > 0) targets = targets.slice(0, limit);

  const OUT = path.join(OUTDIR, "trend.json");
  await fs.mkdir(OUTDIR, { recursive: true });
  const done = {};
  try { Object.assign(done, JSON.parse(await fs.readFile(OUT, "utf8")).data || {}); } catch {}
  const todo = targets.filter(k => !done[k]);
  console.error(`3년 주간 추세 — 대상 ${targets.length.toLocaleString()}개 · 남은 ${todo.length.toLocaleString()}개`);
  if (!todo.length) { console.error("이미 다 받았다."); return; }

  let TREND = HUB_TREND;
  try { const e = JSON.parse(await fs.readFile(path.join(OUTDIR,"hub-endpoint.json"),"utf8"));
        if (e.path) { TREND = e.path; console.error(`저장된 주소를 쓴다: ${e.host||HUB}${TREND}`); } } catch {}
  const { startDate, endDate } = threeYears();
  const GROUP = 5;
  let calls = 0, failed = [];
  const save = async () => fs.writeFile(OUT, JSON.stringify({
    startDate, endDate, timeUnit: "week", savedAt: new Date().toISOString(),
    calls, keywords: Object.keys(done).length, failed, data: done }, null, 1), "utf8");

  for (let i = 0; i < todo.length; i += GROUP) {
    const batch = todo.slice(i, i + GROUP);
    const r = await call("POST", TREND, { body: {
      startDate, endDate, timeUnit: "week",
      keywordGroups: batch.map(k => ({ groupName: k, keywords: [k] })) } });
    calls++;
    if (!r.ok) {
      failed.push({ batch, status: r.raw, note: safe(r.text).slice(0, 160) });
      console.error(`  ${i + batch.length}/${todo.length} 실패 ${r.raw} ${safe(r.text).slice(0, 90)}`);
      if (r.raw === 429) { console.error("  한도 도달. 저장하고 멈춘다."); break; }
    } else {
      for (const res of (r.json?.results || [])) done[res.title] = (res.data || []).map(d => [d.period, d.ratio]);
      if ((i / GROUP) % 20 === 0 || i + GROUP >= todo.length)
        console.error(`  ${Math.min(i + GROUP, todo.length)}/${todo.length} · 확보 ${Object.keys(done).length.toLocaleString()}개`);
    }
    if ((i / GROUP) % 20 === 0) await save();
    await sleep(200);
  }
  await save();
  console.error(`\n완료  호출 ${calls}회 · 키워드 ${Object.keys(done).length.toLocaleString()}개 · 실패 ${failed.length}건`);
  console.error(`→ ${OUT}`);
}

/* ── 쇼핑인사이트: 키워드별 기기 · 성별 · 연령 ──
   키워드 하나당 3회 호출이다. 묶어서 부를 방법이 없다.
   쇼핑인사이트 무료 구간이 월 30,000회이므로 키워드 10,000개가 한 달 천장이다.
   그래서 검색량 큰 순서로 받고, 중간에 끊겨도 이어받는다.
   원칙은 그대로다. 철자가 다르면 다른 키워드로 따로 받는다. 합치지 않는다. */
const SHOP_DIMS = [["device", SHOP_PATHS.device], ["gender", SHOP_PATHS.gender], ["age", SHOP_PATHS.age]];

async function collectShop(args) {
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const src = val("--from") || path.join(OUTDIR, "keywords.json");
  let rows;
  try { rows = JSON.parse(await fs.readFile(src, "utf8")).rows; }
  catch { console.error(`${src} 을 읽지 못했다. 검색광고 수집을 먼저 끝내라.`); process.exit(1); }

  const CAT = val("--cat-id") || "50000006";          // 기본 식품
  const minVol = parseInt(val("--min-vol") || "0", 10);
  const limit  = parseInt(val("--limit")  || "3000", 10);   // 3,000개 = 9,000회
  const budget = parseInt(val("--budget") || "27000", 10);  // 월 30,000 중 여유 3,000 남긴다

  let targets = rows.filter(r => (r.total || 0) >= minVol)
                    .sort((a, b) => b.total - a.total).map(r => r.kw);
  if (limit > 0) targets = targets.slice(0, limit);

  const OUT = path.join(OUTDIR, "shop.json");
  await fs.mkdir(OUTDIR, { recursive: true });
  const done = {};
  try { Object.assign(done, JSON.parse(await fs.readFile(OUT, "utf8")).data || {}); } catch {}
  const full = k => done[k] && done[k].device && done[k].gender && done[k].age;
  const todo = targets.filter(k => !full(k));

  const { startDate, endDate } = (() => {
    const end = new Date(); end.setDate(1); end.setDate(0);              // 지난달 말일
    const start = new Date(end); start.setMonth(start.getMonth() - 11); start.setDate(1);
    return { startDate: ymd(start), endDate: ymd(end) };
  })();

  console.error(`쇼핑인사이트 — 카테고리 ${CAT} · 기간 ${startDate} ~ ${endDate}`);
  console.error(`대상 ${targets.length.toLocaleString()}개 · 남은 ${todo.length.toLocaleString()}개 · 예상 ${(todo.length * 3).toLocaleString()}회`);
  if ((todo.length * 3) > budget)
    console.error(`한도 ${budget.toLocaleString()}회에 걸린다. ${Math.floor(budget / 3).toLocaleString()}개까지만 받고 멈춘다. 다음 달에 이어받으면 된다.`);
  if (!todo.length) { console.error("이미 다 받았다."); return; }

  let calls = 0, failed = [];
  const save = async () => fs.writeFile(OUT, JSON.stringify({
    category: CAT, startDate, endDate, savedAt: new Date().toISOString(),
    calls, keywords: Object.keys(done).length, failed, data: done }, null, 1), "utf8");

  outer:
  for (let i = 0; i < todo.length; i++) {
    const kw = todo[i];
    const slot = (done[kw] ||= {});
    for (const [dim, p] of SHOP_DIMS) {
      if (slot[dim]) continue;
      if (calls >= budget) { console.error(`\n한도 ${budget.toLocaleString()}회 도달. 저장하고 멈춘다.`); break outer; }
      const r = await call("POST", p, { body: { startDate, endDate, timeUnit: "month", category: CAT, keyword: kw } });
      calls++;
      if (!r.ok) {
        failed.push({ kw, dim, status: r.raw, note: safe(r.text).slice(0, 160) });
        if (r.raw === 429) { console.error("  호출 한도 도달. 저장하고 멈춘다."); break outer; }
      } else {
        /* group 별 ratio 를 그대로 접어둔다. mo/pc · f/m · 10~60 */
        const out = {};
        for (const res of (r.json?.results || []))
          for (const d of (res.data || [])) {
            (out[d.group] ||= []).push(d.ratio);
          }
        /* 월별로 여러 개 들어오므로 평균 낸다. 비율이라 합보다 평균이 맞다. */
        slot[dim] = Object.fromEntries(Object.entries(out)
          .map(([g, a]) => [g, +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)]));
      }
      await sleep(120);
    }
    if (i % 50 === 0) { await save(); console.error(`  ${i + 1}/${todo.length} · 호출 ${calls.toLocaleString()}회`); }
  }
  await save();
  console.error(`\n완료  호출 ${calls.toLocaleString()}회 · 키워드 ${Object.keys(done).length.toLocaleString()}개 · 실패 ${failed.length}건`);
  console.error(`→ ${OUT}`);
}

/* ── 카테고리 ID 확인 ──
   /categories 는 목록을 주지 않는다. 내가 넣은 ID 를 그대로 돌려줄 뿐이다.
   그래서 후보 ID 를 하나씩 때려서 살아있는지 본다. 대조군(59999999)이 '없음'으로
   나왔으므로 이 검사는 유효하다. data 가 비면 그런 카테고리가 없다는 뜻이다.

   단, '살아있다'는 것과 '그게 과일이다'는 다른 이야기다.
   응답의 title 은 내가 적어 보낸 이름을 되돌려주는 것뿐이라 이름 확인이 안 된다.
   그래서 --name 으로 정체를 따로 확인한다.
   그 카테고리 안에 그 키워드가 실제로 있는지를 물어보는 방식이다.
   사과가 되고 립스틱이 안 되면 그건 과일 쪽이다. */
const CAT_KNOWN = [
  ["패션의류",       "50000000"], ["패션잡화",     "50000001"],
  ["화장품/미용",     "50000002"], ["디지털/가전",   "50000003"],
  ["가구/인테리어",   "50000004"], ["출산/육아",     "50000005"],
  ["식품",          "50000006"], ["스포츠/레저",   "50000007"],
  ["생활/건강",      "50000008"], ["여가/생활편의", "50000009"],
  ["여가/생활편의?",  "50000010"],
  ["없는번호(대조군)", "59999999"]
];
/* 정체를 물어볼 키워드. 서로 다른 분야에서 하나씩 골랐다. */
const CAT_PROBE = [
  ["과일",       "사과"],   ["채소",      "상추"],
  ["곡물",       "쌀"],     ["축산",      "삼겹살"],
  ["수산",       "고등어"],  ["가공식품",   "라면"],
  ["화장품",     "립스틱"],  ["패션",      "티셔츠"],
  ["생활용품",   "세탁세제"], ["디지털",     "노트북"]
];

async function catLive(id, name, startDate, endDate) {
  const r = await call("POST", SHOP_PATHS.categories, { body: {
    startDate, endDate, timeUnit: "month", category: [{ name: name || id, param: [id] }] } });
  const data = r.json?.results?.[0]?.data || [];
  return { live: r.ok && data.length > 0, raw: r.raw, text: r.text, n: data.length };
}

async function checkCat(args) {
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const end = new Date(); end.setDate(1); end.setDate(0);
  const start = new Date(end); start.setMonth(start.getMonth() - 2); start.setDate(1);
  const startDate = ymd(start), endDate = ymd(end);
  await fs.mkdir(OUTDIR, { recursive: true });

  /* 어떤 ID 를 볼지 정한다 */
  let cands;
  const ids = val("--ids"), scan = val("--scan");
  if (ids) cands = ids.split(",").map(x => x.trim()).filter(Boolean).map(x => [x, x]);
  else if (scan) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(scan.trim());
    if (!m) { console.error("--scan 은 50000140-50000200 형태로 써라."); process.exit(1); }
    const [a, b] = [+m[1], +m[2]];
    if (b - a > 400) { console.error(`${b - a + 1}개는 너무 많다. 400개 이하로 끊어라.`); process.exit(1); }
    cands = []; for (let n = a; n <= b; n++) cands.push([String(n), String(n)]);
  } else cands = CAT_KNOWN;

  console.log(`── 카테고리 ID 확인  (${startDate} ~ ${endDate}) · ${cands.length}개\n`);
  const good = {};
  for (const [name, id] of cands) {
    const r = await catLive(id, name, startDate, endDate);
    if (scan) { if (r.live) { good[id] = id; console.log(`  살아있음  ${id}`); } }
    else {
      console.log(`  ${r.live ? "살아있음" : "없음    "}  ${id}  ${name}` +
                  (r.live ? "" : `   ${String(r.raw)} ${safe(r.text).replace(/\s+/g, " ").slice(0, 90)}`));
      if (r.live) good[name] = id;
    }
    await sleep(130);
  }
  console.log(`\n  살아있는 것 ${Object.keys(good).length}개.`);

  /* 정체 확인 */
  if (args.includes("--name")) {
    console.log("\n── 정체 확인  (그 카테고리 안에 이 키워드가 있는지 물어본다)\n");
    let liveIds = [...new Set(Object.values(good))];
    /* 한 ID 당 키워드 10회다. 스캔 결과가 크면 호출이 순식간에 불어난다. */
    const cap = parseInt(val("--name-limit") || "40", 10);
    if (liveIds.length > cap) {
      console.log(`  살아있는 ID 가 ${liveIds.length}개다. 전부 하면 ${(liveIds.length * CAT_PROBE.length).toLocaleString()}회가 된다.`);
      console.log(`  앞에서 ${cap}개만 본다. 더 보려면 --name-limit 숫자 를 붙여라.\n`);
      liveIds = liveIds.slice(0, cap);
    }
    console.log(`  호출 ${(liveIds.length * CAT_PROBE.length).toLocaleString()}회 예정.\n`);
    console.log("  " + "ID".padEnd(11) + CAT_PROBE.map(([t]) => t.padEnd(7)).join(""));
    const named = {};
    for (const id of liveIds) {
      const hit = [];
      for (const [, kw] of CAT_PROBE) {
        const r = await call("POST", SHOP_PATHS.device, { body: {
          startDate, endDate, timeUnit: "month", category: id, keyword: kw } });
        hit.push(r.ok && (r.json?.results?.[0]?.data || []).length > 0);
        await sleep(110);
      }
      named[id] = CAT_PROBE.filter((_, k) => hit[k]).map(([t]) => t);
      console.log("  " + id.padEnd(11) + hit.map(h => (h ? "  O    " : "  .    ")).join(""));
    }
    await fs.writeFile(path.join(OUTDIR, "hub-cat-identity.json"), JSON.stringify(named, null, 1), "utf8");
    console.log("\n  O 가 붙은 것이 그 카테고리에 실제로 있는 키워드다.");
    console.log("  한 줄이 전부 O 면 그 ID 는 상위 카테고리이거나, 이 검사가 카테고리를 안 가린다는 뜻이다.");
    console.log(`  → ${OUTDIR}/hub-cat-identity.json`);
  }

  await fs.writeFile(path.join(OUTDIR, "hub-categories.json"), JSON.stringify(good, null, 1), "utf8");
  console.log(`\n  → ${OUTDIR}/hub-categories.json\n`);
}

/* ── 경로 찾기 ──
   대조군으로 확인됐다.  404 = 없는 경로 · 210 = 있는데 구독 안 됨 · 200 = 정답
   그래서 404 가 아닌 것만 걸러내면 된다.
   이관 가이드의 규칙은 /v1/search/news.json → /search/v1/news 였다.
   즉 서비스 이름이 맨 앞으로 온다. 그 이름이 무엇인지를 찾는다. */
async function findPath() {
  const SERVICES = ["datalab","search","searchtrend","search-trend","trend","shopping",
                    "shoppinginsight","shopping-insight","insight","naversearch","nsearch",
                    "ai-naver-searchtrend","dl","openapi","naver"];
  const SHAPES = [
    s => `/${s}/v1/search`,
    s => `/${s}/v1/datalab/search`,
    s => `/${s}/v1/trend`,
    s => `/${s}/v1/search/trend`,
    s => `/${s}/v1/shopping/categories`
  ];
  const body = trendBody(["샤인머스캣"]);
  console.log("── 대조군으로 응답의 뜻을 먼저 확인한다");
  const c = await tryCall(HUB, AUTHS[1], body, "/zzz-not-real/v1/nothing");
  const cc = (c.json && c.json.error && c.json.error.errorCode) || "";
  console.log(`  ${c.raw} (${cc}) ${HUB}/zzz-not-real/v1/nothing`);
  if (String(c.raw) !== "404") {
    console.log("\n  대조군이 404 가 아니다. 이 방법은 못 쓴다. 여기서 멈춘다.\n");
    return;
  }
  console.log("  → 404 확인. 이제 404 가 아닌 경로만 찾으면 된다.\n");

  console.log(`── ${HUB} 을 훑는다  (서비스 ${SERVICES.length} × 형태 ${SHAPES.length})\n`);
  const found = [];
  for (const s of SERVICES) {
    for (const shape of SHAPES) {
      const p = shape(s);
      const r = await tryCall(HUB, AUTHS[1], body, p);
      const code = (r.json && r.json.error && r.json.error.errorCode) || "";
      if (String(r.raw) === "404") { await sleep(120); continue; }
      const tag = r.ok ? "OK  " : code === "210" ? "구독?" : "    ";
      console.log(`  ${tag} ${String(r.raw).padEnd(5)} ${code ? "("+code+") " : ""}${p}`);
      found.push({ p, status: r.raw, code, ok: r.ok, text: r.text });
      await sleep(150);
    }
  }
  console.log("");
  const ok = found.filter(f => f.ok);
  if (ok.length) {
    console.log("*** 찾았다 ***");
    for (const f of ok) console.log(`    ${HUB}${f.p}`);
    console.log("\n── 응답 원본");
    console.log(safe(ok[0].text).slice(0, 900));
    await fs.mkdir(OUTDIR, { recursive: true });
    await fs.writeFile(path.join(OUTDIR, "hub-endpoint.json"),
      JSON.stringify({ host: HUB, path: ok[0].p, auth: "X-NCP-APIGW-*", foundAt: new Date().toISOString() }, null, 1), "utf8");
    console.log(`\n주소를 ${OUTDIR}/hub-endpoint.json 에 저장했다.`);
    await findShopping();
    return;
  }
  if (found.length) {
    console.log("200 은 없었지만 404 도 아닌 것들이다. 이 중에 답이 있다.\n");
    for (const f of found.slice(0, 12)) {
      console.log(`  ${f.status} ${f.code ? "("+f.code+") " : ""}${f.p}`);
      console.log(`     ${safe(f.text).replace(/\s+/g," ").slice(0,180)}`);
    }
  } else {
    console.log("전부 404 였다. 서비스 이름이 후보에 없다.");
    console.log("콘솔 [개발 가이드] → 검색어트렌드 → search 페이지의 주소 한 줄이 필요하다.");
  }
  console.log("");
}

/* 쇼핑인사이트 경로도 같은 방식으로 찾는다.
   여기서 카테고리 목록이 잡히면 카테고리 ID 문제까지 한 번에 풀린다. */
async function findShopping() {
  console.log("\n\n── 이어서 쇼핑인사이트 경로를 찾는다\n");
  const SVC = ["shopping-insight","shoppinginsight","shopping","insight","datalab-shopping"];
  /* 레거시 쇼핑인사이트 경로
       /v1/datalab/shopping/categories
       /v1/datalab/shopping/category/keywords
       /v1/datalab/shopping/category/device|gender|age            (카테고리 단위)
       /v1/datalab/shopping/category/keyword/device|gender|age    (키워드 단위)
     검색어트렌드가 /v1/datalab/search → /search-trend/v1/search 로 갔으니
     꼬리를 어디서 자르는지는 확정이 아니다. 두 가지를 다 때려본다.
     서비스 이름이 맞는데 꼬리만 틀려서 404 로 지나쳐버리면 안 되니까 넓게 본다. */
  const CAT  = { startDate:"2026-08-01", endDate:"2026-08-31", timeUnit:"month", category:"50000006" };
  const KW   = { ...CAT, keyword:"사과" };
  const RES = [
    ["카테고리 목록",      "/categories",                      { startDate:"2026-08-01", endDate:"2026-08-31", timeUnit:"month", category:[{name:"식품",param:["50000006"]}] }],
    ["카테고리 목록2",     "/shopping/categories",             { startDate:"2026-08-01", endDate:"2026-08-31", timeUnit:"month", category:[{name:"식품",param:["50000006"]}] }],
    ["카테고리별 키워드",  "/category/keywords",               { ...CAT, keyword:[{name:"사과",param:["사과"]}] }],
    ["카테고리별 키워드2", "/shopping/category/keywords",      { ...CAT, keyword:[{name:"사과",param:["사과"]}] }],
    ["카테고리 기기",      "/category/device",                 CAT],
    ["카테고리 성별",      "/category/gender",                 CAT],
    ["카테고리 연령",      "/category/age",                    CAT],
    ["키워드별 기기",      "/category/keyword/device",         KW],
    ["키워드별 성별",      "/category/keyword/gender",         KW],
    ["키워드별 연령",      "/category/keyword/age",            KW],
    ["키워드별 기기2",     "/shopping/category/keyword/device", KW]
  ];
  const hits = {};
  for (const s of SVC) {
    let alive = false;
    for (const [name, res, body] of RES) {
      const p = `/${s}/v1${res}`;
      const r = await tryCall(HUB, AUTHS[1], body, p);
      const code = (r.json && r.json.error && r.json.error.errorCode) || "";
      if (String(r.raw) === "404") { await sleep(120); continue; }
      alive = true;
      const tag = r.ok ? "OK  " : "    ";
      console.log(`  ${tag} ${String(r.raw).padEnd(5)} ${code ? "("+code+") " : ""}${name.padEnd(16)} ${p}`);
      if (!r.ok) console.log(`         ${safe(r.text).replace(/\s+/g," ").slice(0,180)}`);
      if (r.ok) { hits[name] = p; console.log(`         ${safe(r.text).replace(/\s+/g," ").slice(0,220)}`); }
      await sleep(150);
    }
    if (alive) break;            // 살아있는 서비스 이름을 찾으면 거기서 멈춘다
  }
  console.log("");
  if (Object.keys(hits).length) {
    console.log("*** 쇼핑인사이트 경로 ***");
    for (const [k,v] of Object.entries(hits)) console.log(`    ${k.padEnd(16)} ${v}`);
    await fs.writeFile(path.join(OUTDIR, "hub-shopping.json"), JSON.stringify(hits, null, 1), "utf8");
    console.log(`\n  ${OUTDIR}/hub-shopping.json 에 저장했다.`);
    console.log("\n  주의: /categories 는 목록 조회가 아니라 '분야별 트렌드'다.");
        console.log("  내가 넣은 카테고리 ID 를 그대로 돌려준다. 트리를 받아오지는 못한다.");
        console.log("  카테고리 ID 는 --cat 으로 하나씩 유효한지 확인한다.");
  } else {
    console.log("쇼핑인사이트 쪽은 아직 못 찾았다. 위 응답을 보내주면 맞춘다.");
  }
  console.log("");
}

async function main() {
  const args = process.argv.slice(2);
  if (parseInt(process.versions.node, 10) < 18) { console.error("Node 18 이상이 필요하다."); process.exit(1); }
  if (!ID || !SECRET) {
    console.error("\nAPI HUB 인증 정보가 없다.");
    console.error("key.txt 를 메모장으로 열어 아래 두 줄에 값을 넣어라.\n");
    console.error("  NAVER_HUB_ID=");
    console.error("  NAVER_HUB_SECRET=\n");
    process.exit(1);
  }
  console.error(`API HUB 인증 정보 확인. Client ID ${String(ID).slice(0, 4)}***\n`);
  if (args.includes("--find")) return findPath();
  if (args.includes("--trend")) return collectTrend(args);
  if (args.includes("--shop")) return collectShop(args);
  if (args.includes("--cat")) return checkCat(args);
  if (args.includes("--probe") || args.length === 0) return probe();
  console.error("--probe / --find / --trend / --shop / --cat 중 하나를 써라.");
}
main().catch(e => { console.error(e); process.exit(1); });
