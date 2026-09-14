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
  naver_hub_secret:"SECRET", hub_client_secret:"SECRET", clientsecret:"SECRET", client_secret:"SECRET", 허브시크릿:"SECRET",
  /* 검색 API(개발자센터)는 키가 따로다. 허브 키로는 401 이 난다. */
  search_id:"SEARCH_ID", searchid:"SEARCH_ID", naver_search_id:"SEARCH_ID",
  dev_client_id:"SEARCH_ID", 검색id:"SEARCH_ID", 검색아이디:"SEARCH_ID",
  search_secret:"SEARCH_SECRET", searchsecret:"SEARCH_SECRET", naver_search_secret:"SEARCH_SECRET",
  dev_client_secret:"SEARCH_SECRET", 검색시크릿:"SEARCH_SECRET"
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
    if (out.ID || out.SECRET || out.SEARCH_ID) return out;
  }
  return {};
}
const K = loadKeys();
const ID = process.env.NAVER_HUB_ID || K.ID;
const SECRET = process.env.NAVER_HUB_SECRET || K.SECRET;
const SEARCH_ID = process.env.NAVER_SEARCH_ID || K.SEARCH_ID;
const SEARCH_SECRET = process.env.NAVER_SEARCH_SECRET || K.SEARCH_SECRET;

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
function safe(t) { let s = String(t ?? ""); for (const v of [ID, SECRET, SEARCH_ID, SEARCH_SECRET]) if (v && String(v).length >= 6) s = s.split(v).join("<가림>"); return s; }

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
/* ── 큰 추세 파일 읽고 쓰기 ──
   2026-09-14 터졌다.  RangeError: Invalid string length  at JSON.stringify
   trend.json 이 512 MB 를 넘으면서 JSON.stringify 가 한 덩어리 문자열을 못 만든다.
   Node 의 최대 문자열이 536,870,888 글자다.

   왜 그렇게 커졌나. 키워드마다 주 날짜를 통째로 같이 적고 있었다.
     "샤인머스캣": [ [ "2023-09-11", 75.51758 ], [ "2023-09-18", 100 ], ... 156번 ]
   날짜 156개는 모든 키워드가 똑같다. 그걸 20만 번 반복해 적었으니 커질 수밖에 없다.

   고친 방식
     1. 날짜를 맨 위로 한 번만 뺀다 (periods)
     2. 값만 남긴다.  "샤인머스캣": [75.5,100,82.3, ...]
     3. 들여쓰기를 없앤다
     4. 저장할 때 한 덩어리로 만들지 않고 조각내어 파일에 흘려 쓴다
     5. 읽을 때도 통째로 안 읽는다. 항목을 하나씩 떼어 읽는다
   예전 형식(날짜가 같이 들어있는 파일)도 그대로 읽어서 새 형식으로 옮긴다.
   메모리에는 값들을 쉼표로 이은 문자열 하나로 들고 있는다. */
const TREND_TMP = ".tmp";

async function saveTrendFile(OUT, meta, done) {
  const tmp = OUT + TREND_TMP;
  const fh = await fs.open(tmp, "w");
  try {
    await fh.write('{"startDate":' + JSON.stringify(meta.startDate)
      + ',"endDate":' + JSON.stringify(meta.endDate)
      + ',"timeUnit":"week"'
      + ',"periods":' + JSON.stringify(meta.periods || [])
      + ',"savedAt":' + JSON.stringify(new Date().toISOString())
      + ',"calls":' + (meta.calls || 0)
      + ',"keywords":' + Object.keys(done).length
      + ',"failed":' + JSON.stringify(meta.failed || [])
      + ',"data":{');
    let first = true, buf = "";
    for (const k of Object.keys(done)) {
      buf += (first ? "" : ",") + JSON.stringify(k) + ":[" + done[k] + "]";
      first = false;
      if (buf.length > 4000000) { await fh.write(buf); buf = ""; }
    }
    if (buf) await fh.write(buf);
    await fh.write("}}");
  } finally { await fh.close(); }
  await fs.rename(tmp, OUT);
}

/* 옛 형식이든 새 형식이든 읽어서 { kw: "값,값,..." } 로 돌려준다 */
async function loadTrendFile(file) {
  const done = {}; let periods = null, meta = {};
  let fh; try { fh = await fs.open(file, "r"); } catch { return { done, periods, meta }; }
  const rs = fh.createReadStream({ encoding: "utf8", highWaterMark: 1 << 20 });
  let buf = "", started = false, head = "";
  const balanced = from => {
    let d = 0, str = false, esc = false;
    for (let i = from; i < buf.length; i++) {
      const c = buf[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { str = !str; continue; }
      if (str) continue;
      if (c === "[") d++; else if (c === "]") { d--; if (!d) return i; }
    }
    return -1;
  };
  const take = (key, arr) => {
    if (!arr.length) { done[key] = ""; return; }
    if (Array.isArray(arr[0])) {                       // 옛 형식 [["2023-09-11",75.5],...]
      if (!periods) periods = arr.map(x => x[0]);
      done[key] = arr.map(x => Math.round((x[1] || 0) * 10) / 10).join(",");
    } else if (typeof arr[0] === "object" && arr[0]) { // 혹시 {period,ratio}
      if (!periods) periods = arr.map(x => x.period);
      done[key] = arr.map(x => Math.round((x.ratio || 0) * 10) / 10).join(",");
    } else {
      done[key] = arr.join(",");                        // 새 형식 [75.5,100,...]
    }
  };
  const drain = () => {
    for (;;) {
      let i = 0;
      while (i < buf.length && /[\s,]/.test(buf[i])) i++;
      if (i >= buf.length) { buf = buf.slice(i); return; }
      if (buf[i] === "}") { buf = ""; return; }
      if (buf[i] !== '"') { buf = buf.slice(i); return; }
      let j = i + 1, esc = false;
      while (j < buf.length) { const c = buf[j]; if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') break; j++; }
      if (j >= buf.length) { buf = buf.slice(i); return; }
      const key = JSON.parse(buf.slice(i, j + 1));
      let k = j + 1;
      while (k < buf.length && /[\s:]/.test(buf[k])) k++;
      if (k >= buf.length || buf[k] !== "[") { buf = buf.slice(i); return; }
      const end = balanced(k);
      if (end < 0) { buf = buf.slice(i); return; }
      take(key, JSON.parse(buf.slice(k, end + 1)));
      buf = buf.slice(end + 1);
    }
  };
  for await (const chunk of rs) {
    buf += chunk;
    if (!started) {
      const a = buf.indexOf('"data"');
      if (a < 0) { if (buf.length > 4000000) buf = buf.slice(-2000000); continue; }
      const b = buf.indexOf("{", a);
      if (b < 0) continue;
      head = buf.slice(0, a);
      try { meta = JSON.parse(head.replace(/,\s*$/, "") + "}"); } catch {}
      if (meta.periods && meta.periods.length) periods = meta.periods;
      buf = buf.slice(b + 1); started = true;
    }
    drain();
  }
  if (started) drain();
  return { done, periods, meta };
}

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
  const loaded = await loadTrendFile(OUT);
  const done = loaded.done;
  let periods = loaded.periods;
  if (Object.keys(done).length) console.error(`이어하기: 이미 받은 ${Object.keys(done).length.toLocaleString()}개를 불러왔다.`);
  const todo = targets.filter(k => !done[k]);
  console.error(`3년 주간 추세 — 대상 ${targets.length.toLocaleString()}개 · 남은 ${todo.length.toLocaleString()}개`);
  if (!todo.length) { console.error("이미 다 받았다."); return; }

  let TREND = HUB_TREND;
  try { const e = JSON.parse(await fs.readFile(path.join(OUTDIR,"hub-endpoint.json"),"utf8"));
        if (e.path) { TREND = e.path; console.error(`저장된 주소를 쓴다: ${e.host||HUB}${TREND}`); } } catch {}
  const { startDate, endDate } = threeYears();
  const GROUP = 5;
  let calls = 0, failed = [];
  const save = () => saveTrendFile(OUT, { startDate, endDate, periods, calls, failed }, done);

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
      for (const res of (r.json?.results || [])) {
        const d = res.data || [];
        if (!periods && d.length) periods = d.map(x => x.period);
        done[res.title] = d.map(x => Math.round((x.ratio || 0) * 10) / 10).join(",");
      }
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

  /* 검색량 순으로만 자르면 과일·채소가 아닌 게 잔뜩 들어온다.
     실제로 상위 3,000개 중 1,703개가 식품 카테고리에서 빈 응답이었다.
     밥솥·탈모샴푸·싸이벡스제로나T 같은 눈덩이 확장 부산물이다.
     --seed-first 를 붙이면 씨앗과 두 글자 이상 겹치는 키워드를 앞으로 보낸다.
     키워드를 버리는 게 아니다. 순서만 바꾼다. */
  let seedSet = null, seedMax = 0, seedOne = [];
  if (args.includes("--seed-first")) {
    /* 씨앗을 두 글자로 잘라 쓰면 가짜가 걸린다.
       '타이벡감귤' 의 조각 '이벡' 때문에 '싸이벡스제로나T' 가 과일로 붙었다.
       그래서 두 글자 이상 씨앗은 통째로 들어있는지만 본다.

       한 글자 씨앗(배·무·귤·감·밤·마·쑥·딜)은 따로 다룬다. 빼버리면
       배·나주배·햇배·금귤·풋귤·공주밤·햇밤 같은 진짜 품목이 통째로 뒤로 밀린다.
       실측으로 확인했다. 그래서 자리를 본다.
         그 자체        배, 귤, 밤
         끝에 올 때      나주배, 공주밤, 옥광밤, 풋귤
         앞이면서 4자 이하  배가격, 귤청, 마효능, 배도매
       길이를 안 걸면 마스카포네치즈·감기에좋은음식·마피아게임까지 딸려온다.

       그래도 포포나무·장마·마가린 같은 가짜가 100개쯤 남는다. 그냥 둔다.
       순서를 매기는 일일 뿐이고, 가짜는 식품에서 빈 응답으로 나온 뒤
       --shop-fix 가 제 카테고리를 찾아준다. 버려지지 않는다. */
    const want = (val("--tiers") || "1").split(",").map(x => parseInt(x.trim(), 10)).filter(Boolean);
    try {
      const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
      const sj = JSON.parse(await fs.readFile(path.join(here, "seeds.json"), "utf8"));
      seedSet = new Set();
      const ones = new Set();
      for (const t of (sj.tiers || [])) {
        if (!want.includes(t.tier)) continue;
        for (const n of (t.seeds || [])) {
          const w = String(n).replace(/\s+/g, "");
          if (w.length === 1) ones.add(w);
          else if (w.length >= 2) { seedSet.add(w); if (w.length > seedMax) seedMax = w.length; }
        }
      }
      seedOne = [...ones];
      const names = (sj.tiers || []).filter(t => want.includes(t.tier)).map(t => `${t.tier}.${t.name}`);
      console.error(`씨앗 우선: ${names.join(" · ")} — 두 글자 이상 ${seedSet.size.toLocaleString()}개 · 한 글자 ${seedOne.length}개(${seedOne.join("")})`);
    } catch (e) { seedSet = null; console.error(`seeds.json 을 읽지 못했다. 검색량 순 그대로 간다. (${e.message})`); }
  }
  const related = kw => {
    if (!seedSet) return false;
    for (let i = 0; i < kw.length; i++)
      for (let L = 2; L <= Math.min(seedMax, kw.length - i); L++)
        if (seedSet.has(kw.slice(i, i + L))) return true;
    for (const c of seedOne)
      if (kw === c || kw.endsWith(c) || (kw.startsWith(c) && kw.length <= 4)) return true;
    return false;
  };

  let pool = rows.filter(r => (r.total || 0) >= minVol).sort((a, b) => b.total - a.total);
  if (seedSet) {
    const near = pool.filter(r => related(r.kw)), far = pool.filter(r => !related(r.kw));
    console.error(`씨앗과 겹치는 것 ${near.length.toLocaleString()}개를 앞으로, 나머지 ${far.length.toLocaleString()}개를 뒤로 보냈다.`);
    pool = [...near, ...far];
  }
  let targets = pool.map(r => r.kw);
  if (limit > 0) targets = targets.slice(0, limit);

  const OUT = path.join(OUTDIR, "shop.json");
  await fs.mkdir(OUTDIR, { recursive: true });
  const done = {};
  try { Object.assign(done, JSON.parse(await fs.readFile(OUT, "utf8")).data || {}); } catch {}
  const full = k => done[k] && done[k].device && done[k].gender && done[k].age;
  const todo = targets.filter(k => !full(k));

  /* 왜 남았는지를 숫자로 먼저 밝힌다.
     '남은 개수'만 보면 코드가 잃어버린 건지, 애초에 대상이 바뀐 건지 구분이 안 된다. */
  const inFile = Object.keys(done).length;
  const fresh  = targets.filter(k => !done[k]).length;              // 파일에 아예 없던 키워드
  const part   = targets.filter(k => done[k] && !full(k)).length;   // 있는데 덜 받은 키워드
  const miss   = { device: 0, gender: 0, age: 0 };
  for (const k of targets) if (done[k] && !full(k))
    for (const d of ["device", "gender", "age"]) if (!done[k][d]) miss[d]++;

  const { startDate, endDate } = (() => {
    const end = new Date(); end.setDate(1); end.setDate(0);              // 지난달 말일
    const start = new Date(end); start.setMonth(start.getMonth() - 11); start.setDate(1);
    return { startDate: ymd(start), endDate: ymd(end) };
  })();

  console.error(`쇼핑인사이트 — 카테고리 ${CAT} · 기간 ${startDate} ~ ${endDate}`);
  console.error(`대상 ${targets.length.toLocaleString()}개 · 남은 ${todo.length.toLocaleString()}개 · 예상 ${(todo.length * 3).toLocaleString()}회`);
  console.error(`  shop.json 안 ${inFile.toLocaleString()}개 · 그중 이번 대상에 없던 새 키워드 ${fresh.toLocaleString()}개 · 덜 받은 것 ${part.toLocaleString()}개`);
  if (part) console.error(`  덜 받은 항목: 기기 ${miss.device} · 성별 ${miss.gender} · 연령 ${miss.age}`);
  if (fresh > 50) console.error(`  ※ 새 키워드가 ${fresh.toLocaleString()}개다. 그사이 keywords.json 이 커져서 상위 ${limit.toLocaleString()}개 명단이 바뀐 것이다. 코드가 잃어버린 게 아니다.`);
  if ((todo.length * 3) > budget)
    console.error(`한도 ${budget.toLocaleString()}회에 걸린다. ${Math.floor(budget / 3).toLocaleString()}개까지만 받고 멈춘다. 다음 달에 이어받으면 된다.`);
  if (!todo.length) { console.error("이미 다 받았다."); return; }

  let calls = 0, failed = [], emptyN = 0;
  const save = async () => fs.writeFile(OUT, JSON.stringify({
    category: CAT, startDate, endDate, savedAt: new Date().toISOString(),
    calls, keywords: Object.keys(done).length,
    targets: targets.length, targetList: targets,   // 이번에 무엇을 대상으로 삼았는지 남긴다
    emptyDims: emptyN, failed, data: done }, null, 1), "utf8");

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
        /* 200 인데 내용이 빈 경우다. 실패가 아니라 '이 카테고리엔 그 키워드가 없다'는 답이다.
           빈 값도 답이므로 그대로 저장한다. 다시 물어보지 않는다. */
        if (!Object.keys(slot[dim]).length) emptyN++;
      }
      await sleep(120);
    }
    if (i % 20 === 0) await save();
    if (i % 50 === 0) console.error(`  ${i + 1}/${todo.length} · 호출 ${calls.toLocaleString()}회`);
  }
  await save();
  const stillPart = targets.filter(k => done[k] && !full(k)).length;
  console.error(`\n완료  호출 ${calls.toLocaleString()}회 · 키워드 ${Object.keys(done).length.toLocaleString()}개 · 실패 ${failed.length}건 · 빈 응답 ${emptyN.toLocaleString()}개`);
  console.error(`      아직 덜 받은 키워드 ${stillPart.toLocaleString()}개. 실패 건수보다 많으면 알려줘라.`);
  console.error(`→ ${OUT}`);
}

/* ── 빈 응답 키워드의 제 카테고리 찾기 ──
   식품(50000006)으로만 물었더니 상위 3,000개 중 1,703개가 빈 응답이었다.
   밥솥·탈모샴푸·싸이벡스제로나T 처럼 식품이 아닌 키워드이기 때문이다.
   그 키워드를 버리지 않는다. 어느 카테고리 소속인지 찾아서 거기서 다시 받는다.

   찾는 방법은 --cat --name 과 같다. 카테고리를 바꿔가며 물어보고
   데이터가 나오는 첫 카테고리를 그 키워드의 자리로 본다.
   기기(device)로 찔러보므로, 맞는 순간 기기 데이터는 이미 손에 들어온다.
   그래서 한 키워드당 '탐색 N회 + 성별·연령 2회' 다.
   어디에도 없으면 쇼핑 키워드가 아니라는 뜻이다(맛집·지명 등). 표시해두고 다시 묻지 않는다. */
const FIX_CATS = [
  ["생활/건강",    "50000008"], ["출산/육아",   "50000005"],
  ["디지털/가전",   "50000003"], ["가구/인테리어", "50000004"],
  ["화장품/미용",   "50000002"], ["패션의류",    "50000000"],
  ["스포츠/레저",   "50000007"], ["여가/생활편의", "50000009"]
];

async function shopFix(args) {
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const OUT = path.join(OUTDIR, "shop.json");
  let j; try { j = JSON.parse(await fs.readFile(OUT, "utf8")); }
  catch { console.error(`${OUT} 을 읽지 못했다. 11단계를 먼저 돌려라.`); process.exit(1); }
  const done = j.data || {};
  const { startDate, endDate } = j;

  /* 세 항목 다 있는데 내용이 전부 빈 것만 고른다. 아직 못 받은 건 11단계 몫이다. */
  const allEmpty = k => {
    const v = done[k]; if (!v) return false;
    if (v.noCat || v.cat) return false;                       // 이미 처리했다
    return ["device", "gender", "age"].every(d => v[d] && !Object.keys(v[d]).length);
  };
  let list = Object.keys(done).filter(allEmpty);

  /* 검색량 순으로 본다 */
  const src = val("--from") || path.join(OUTDIR, "keywords.json");
  try {
    const rows = JSON.parse(await fs.readFile(src, "utf8")).rows;
    const vol = new Map(rows.map(r => [r.kw, r.total || 0]));
    list.sort((a, b) => (vol.get(b) || 0) - (vol.get(a) || 0));
  } catch { console.error("keywords.json 을 못 읽어 검색량 순 정렬은 건너뛴다."); }

  const budget = parseInt(val("--budget") || "9000", 10);
  const limit  = parseInt(val("--limit")  || "0", 10);
  if (limit > 0) list = list.slice(0, limit);
  console.error(`빈 응답 키워드 ${list.length.toLocaleString()}개의 제 카테고리를 찾는다.`);
  console.error(`후보 카테고리 ${FIX_CATS.length}개 · 한 키워드당 최대 ${FIX_CATS.length + 2}회 · 한도 ${budget.toLocaleString()}회\n`);
  if (!list.length) { console.error("찾을 게 없다."); return; }

  let calls = 0, found = 0, none = 0;
  const save = async () => fs.writeFile(OUT, JSON.stringify({ ...j, savedAt: new Date().toISOString(), data: done }, null, 1), "utf8");

  outer:
  for (let i = 0; i < list.length; i++) {
    const kw = list[i], slot = done[kw];
    let hit = null;
    for (const [name, cid] of FIX_CATS) {
      if (calls >= budget) { console.error(`\n한도 ${budget.toLocaleString()}회 도달. 저장하고 멈춘다.`); break outer; }
      const r = await call("POST", SHOP_PATHS.device, { body: {
        startDate, endDate, timeUnit: "month", category: cid, keyword: kw } });
      calls++;
      await sleep(110);
      const rows2 = (r.json?.results?.[0]?.data) || [];
      if (r.ok && rows2.length) { hit = { name, cid, rows: rows2 }; break; }
    }
    if (!hit) { slot.noCat = true; none++; }
    else {
      slot.cat = hit.cid; slot.catName = hit.name;
      const fold = data => {
        const out = {}; for (const d of data) (out[d.group] ||= []).push(d.ratio);
        return Object.fromEntries(Object.entries(out).map(([g, a]) => [g, +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)]));
      };
      slot.device = fold(hit.rows);
      for (const [dim, pth] of [["gender", SHOP_PATHS.gender], ["age", SHOP_PATHS.age]]) {
        if (calls >= budget) break;
        const r = await call("POST", pth, { body: {
          startDate, endDate, timeUnit: "month", category: hit.cid, keyword: kw } });
        calls++;
        if (r.ok) slot[dim] = fold((r.json?.results?.[0]?.data) || []);
        await sleep(110);
      }
      found++;
    }
    if (i % 20 === 0) await save();
    if (i % 100 === 0) console.error(`  ${i + 1}/${list.length} · 호출 ${calls.toLocaleString()}회 · 찾음 ${found.toLocaleString()} · 없음 ${none.toLocaleString()}`);
  }
  await save();
  console.error(`\n완료  호출 ${calls.toLocaleString()}회 · 제자리 찾음 ${found.toLocaleString()}개 · 어디에도 없음 ${none.toLocaleString()}개`);
  console.error("어디에도 없는 건 쇼핑 키워드가 아니라는 뜻이다. 맛집·지명 같은 것들이다. 다시 묻지 않는다.");
  console.error(`→ ${OUT}`);
}

/* ── shop.json 진단 (호출 0회) ──
   왜 자꾸 남은 개수가 크게 나오는지 파일만 보고 판정한다.
   원인이 둘 중 무엇인지 가른다.
     1) 대상 명단이 바뀌었다  → keywords.json 이 커져서 상위 N 개가 달라진 것. 정상.
     2) 받은 걸 잃어버렸다    → 내 코드 잘못. 고쳐야 한다. */
async function shopStat(args) {
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const OUT = path.join(OUTDIR, "shop.json");
  let j; try { j = JSON.parse(await fs.readFile(OUT, "utf8")); }
  catch { console.error(`${OUT} 을 읽지 못했다.`); process.exit(1); }
  const data = j.data || {};
  const keys = Object.keys(data);

  let fullN = 0, partN = 0, emptyAll = 0;
  const miss = { device: 0, gender: 0, age: 0 };
  const partSample = [];
  for (const k of keys) {
    const v = data[k] || {};
    const have = ["device", "gender", "age"].filter(d => v[d]);
    if (have.length === 3) {
      fullN++;
      if (have.every(d => !Object.keys(v[d]).length)) emptyAll++;
    } else {
      partN++;
      for (const d of ["device", "gender", "age"]) if (!v[d]) miss[d]++;
      if (partSample.length < 10) partSample.push(`${k}(${have.join("·") || "없음"})`);
    }
  }
  console.log(`\n── shop.json 진단   저장 ${j.savedAt || "?"}`);
  console.log(`  카테고리 ${j.category}  ·  기간 ${j.startDate} ~ ${j.endDate}`);
  console.log(`  파일 안 키워드      ${keys.length.toLocaleString()}개`);
  console.log(`  3개 다 받은 것      ${fullN.toLocaleString()}개   (그중 내용이 전부 빈 것 ${emptyAll.toLocaleString()}개)`);
  console.log(`  덜 받은 것          ${partN.toLocaleString()}개`);
  if (partN) {
    console.log(`    빠진 항목  기기 ${miss.device} · 성별 ${miss.gender} · 연령 ${miss.age}`);
    console.log(`    예시  ${partSample.join("  ")}`);
  }
  console.log(`  기록된 실패         ${(j.failed || []).length.toLocaleString()}건`);

  /* 대상 명단이 바뀌었는지 본다 */
  const src = val("--from") || path.join(OUTDIR, "keywords.json");
  let rows = null;
  try { rows = JSON.parse(await fs.readFile(src, "utf8")).rows; } catch {}
  if (rows) {
    const limit = parseInt(val("--limit") || "3000", 10);
    const minVol = parseInt(val("--min-vol") || "100", 10);
    const now = rows.filter(r => (r.total || 0) >= minVol)
                    .sort((a, b) => b.total - a.total).map(r => r.kw).slice(0, limit);
    const fresh = now.filter(k => !data[k]).length;
    console.log(`\n  keywords.json 전체    ${rows.length.toLocaleString()}개`);
    console.log(`  지금 기준 상위 ${limit.toLocaleString()}개 중 shop.json 에 없는 것  ${fresh.toLocaleString()}개`);
    if (j.targetList) {
      const before = new Set(j.targetList);
      const changed = now.filter(k => !before.has(k)).length;
      console.log(`  지난번 대상 명단과 달라진 것  ${changed.toLocaleString()}개`);
    } else console.log("  (지난번 대상 명단이 파일에 없다. 이번 수집부터 기록된다.)");
    console.log("");
    if (fresh > 50) {
      console.log("  판정: 대상 명단이 바뀐 것이다.");
      console.log("        그사이 keywords.json 이 커져서 상위 명단에 새 키워드가 들어왔다.");
      console.log("        받은 걸 잃어버린 게 아니다. 계속 돌리면 채워진다.");
    } else if (partN > (j.failed || []).length + 50) {
      console.log("  판정: 받은 걸 잃어버렸다. 내 잘못이다. 이 화면을 그대로 보내줘라.");
    } else {
      console.log("  판정: 정상이다. 남은 건 실패분뿐이다.");
    }
  }
  console.log("");
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
  ["곡물",       "햅쌀"],   ["축산",      "삼겹살"],
  ["수산",       "고등어"],  ["가공식품",   "라면"],
  ["화장품",     "립스틱"],  ["패션",      "티셔츠"],
  ["생활용품",   "세탁세제"], ["디지털",     "노트북"],
  ["대조군",     "쟈끄루퉁뷔"]   // 아무 데도 없어야 하는 말. 여기 O 가 뜨면 이 검사는 못 쓴다.
];

/* 세 가지를 구분한다. 뭉뚱그리면 안 된다.
     살아있음  200 이고 data 가 있다
     없음      200 인데 data 가 비었다  →  그런 카테고리가 없다
     오류      400/500 등            →  카테고리 존재 여부를 모른다. 한 번 더 때려본다.
   2026-09-11 50000001 패션잡화가 400 "쇼핑 API 호출 오류" 를 냈다.
   이걸 '없음' 으로 읽었던 게 내 실수다. 오류는 모른다는 뜻이지 없다는 뜻이 아니다. */
/* 식품 하위를 가를 때 쓰는 촘촘한 판. --probe food 로 고른다.
   1차 카테고리 가를 때 쓰는 넓은 판(CAT_PROBE)으로는 과일과 채소가 안 갈린다. */
const CAT_PROBE_FOOD = [
  ["과일",   "사과"],   ["채소",   "상추"],   ["곡물",   "햅쌀"],
  ["축산",   "삼겹살"],  ["수산",   "고등어"],  ["건강",   "홍삼"],
  ["음료",   "원두커피"], ["과자",   "초콜릿"],  ["유제품", "우유"],
  ["조미료", "간장"],    ["즉석",   "즉석밥"],  ["냉동",   "냉동만두"],
  ["대조군", "쟈끄루퉁뷔"]
];

async function catLive(id, name, startDate, endDate, retry = 1) {
  const r = await call("POST", SHOP_PATHS.categories, { body: {
    startDate, endDate, timeUnit: "month", category: [{ name: name || id, param: [id] }] } });
  const data = r.json?.results?.[0]?.data || [];
  if (!r.ok && retry > 0) { await sleep(700); return catLive(id, name, startDate, endDate, retry - 1); }
  const state = !r.ok ? "오류" : data.length > 0 ? "살아있음" : "없음";
  return { state, live: state === "살아있음", raw: r.raw, text: r.text, n: data.length };
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
  const good = {}, errs = [];
  for (const [name, id] of cands) {
    const r = await catLive(id, name, startDate, endDate);
    if (scan) { if (r.live) { good[id] = id; console.log(`  살아있음  ${id}`); }
                else if (r.state === "오류") { errs.push(id); console.log(`  오류      ${id}   ${r.raw}`); } }
    else {
      console.log(`  ${r.state.padEnd(4, "  ")}  ${id}  ${name}` +
                  (r.live ? "" : `   ${String(r.raw)} ${safe(r.text).replace(/\s+/g, " ").slice(0, 90)}`));
      if (r.live) good[name] = id; else if (r.state === "오류") errs.push(`${id} ${name}`);
    }
    await sleep(130);
  }
  console.log(`\n  살아있는 것 ${Object.keys(good).length}개.`);
  if (errs.length) {
    console.log(`  오류 ${errs.length}개 — ${errs.join(" · ")}`);
    console.log("  오류는 '없다'가 아니라 '모른다'다. 두 번 때려도 같으면 나중에 다시 확인한다.");
  }

  /* 정체 확인 */
  if (args.includes("--name")) {
    console.log("\n── 정체 확인  (그 카테고리 안에 이 키워드가 있는지 물어본다)\n");
    const PANEL = (val("--probe") === "food") ? CAT_PROBE_FOOD : CAT_PROBE;
    let liveIds = [...new Set(Object.values(good))];
    /* 한 ID 당 키워드 10회다. 스캔 결과가 크면 호출이 순식간에 불어난다. */
    const cap = parseInt(val("--name-limit") || "40", 10);
    if (liveIds.length > cap) {
      console.log(`  살아있는 ID 가 ${liveIds.length}개다. 전부 하면 ${(liveIds.length * PANEL.length).toLocaleString()}회가 된다.`);
      console.log(`  앞에서 ${cap}개만 본다. 더 보려면 --name-limit 숫자 를 붙여라.\n`);
      liveIds = liveIds.slice(0, cap);
    }
    console.log(`  호출 ${(liveIds.length * PANEL.length).toLocaleString()}회 예정.\n`);
    console.log("  " + "ID".padEnd(11) + PANEL.map(([t]) => t.padEnd(7)).join(""));
    const named = {};
    for (const id of liveIds) {
      const hit = [];
      for (const [, kw] of PANEL) {
        const r = await call("POST", SHOP_PATHS.device, { body: {
          startDate, endDate, timeUnit: "month", category: id, keyword: kw } });
        hit.push(r.ok && (r.json?.results?.[0]?.data || []).length > 0);
        await sleep(110);
      }
      named[id] = PANEL.filter((_, k) => hit[k]).map(([t]) => t);
      console.log("  " + id.padEnd(11) + hit.map(h => (h ? "  O    " : "  .    ")).join(""));
    }
    await fs.writeFile(path.join(OUTDIR, "hub-cat-identity.json"), JSON.stringify(named, null, 1), "utf8");
    const ctrl = PANEL.findIndex(([t]) => t === "대조군");
    const badCtrl = ctrl >= 0 && Object.values(named).some(v => v.includes("대조군"));
    console.log("\n  O 가 붙은 것이 그 카테고리에 실제로 있는 키워드다.");
    if (badCtrl) {
      console.log("  *** 대조군 열에 O 가 떴다. 없는 말인데도 데이터가 나온다는 뜻이다.");
      console.log("      이 정체 확인은 못 쓴다. 다른 방법을 찾아야 한다. 알려줘라. ***");
    }
    console.log("  한 줄이 전부 O 면 그 ID 는 상위 카테고리이거나, 이 검사가 카테고리를 안 가린다는 뜻이다.");
    console.log(`  → ${OUTDIR}/hub-cat-identity.json`);
  }

  await fs.writeFile(path.join(OUTDIR, "hub-categories.json"), JSON.stringify(good, null, 1), "utf8");
  console.log(`\n  → ${OUTDIR}/hub-categories.json\n`);
}

/* ── 상품수 찾기 ──
   이게 막힌 곳의 전부다. 상품수만 있으면 세 가지가 한 번에 풀린다.
     1. 경쟁강도를 아이템스카우트와 같은 식으로 계산한다 (상품수 ÷ 검색수).
        PDF 48개를 역산해 이 식을 확인했다. 100% 일치했다.
     2. 대표카테고리를 추정한다.
     3. 요리 키워드를 걸러낸다. 검색수에 비해 상품수가 터무니없이 적은 것들이다.

   옛 쇼핑검색 API 는 openapi.naver.com/v1/search/shop.json 이었고 응답의 total 이 상품수다.
   2026-07-31 종료됐지만 다른 것들이 API HUB 로 옮겨간 전례가 있다.
     검색어트렌드  /search-trend/v1/search    (확인됨)
     쇼핑인사이트  /shopping/v1/...           (확인됨)
   이관 규칙은 v1 이 뒤로 가고 .json 이 빠지는 것이었다.
     /v1/search/news.json  ->  /search/v1/news
   그러면 쇼핑검색은 /search/v1/shop 이 된다. 그 자리를 때려본다. */
async function findShopCount() {
  const q = process.argv.includes("--kw") ? process.argv[process.argv.indexOf("--kw") + 1] : "고구마";
  console.log(`\n── 상품수를 주는 자리를 찾는다   시험 키워드 "${q}"\n`);

  const qs = "?query=" + encodeURIComponent(q) + "&display=1";
  /* 이관 규칙은 /v1/search/shop.json → /search/v1/shop 이었다.
     그 규칙대로 만든 것과, 옛 주소 그대로인 것을 둘 다 찔러본다. */
  const HUB_PATHS = [
    "/search/v1/shop", "/search/v1/shop.json", "/search/v1/shopping",
    "/shopping/v1/search", "/shop/v1/search", "/shopping-search/v1/search",
    "/shopping/v1/shop", "/search-shop/v1/search", "/commerce/v1/search",
    "/v1/search/shop.json"
  ];
  const OLD_PATHS = ["/v1/search/shop.json", "/v1/search/shop"];
  const CTRL = "/zzz-not-real/v1/nothing";
  /* 결정적 대조군.
     블로그·뉴스 검색은 허브로 "이관"됐고 쇼핑 검색은 "종료"됐다고 한다.
     그 말이 맞다면 /search/v1/blog 는 살아있고 /search/v1/shop 만 404 여야 한다.
     둘 다 404 면 404 의 뜻은 "종료"가 아니라 "이 계정이 검색 API 를 구독 안 함"이다.
     이 한 줄이 막다른 길인지 신청만 하면 되는지를 가른다. */
  const LIVE_PATHS = ["/search/v1/blog", "/search/v1/news"];

  const get = async (host, p2, headers) => {
    try {
      const res = await fetch(host + p2 + qs, { headers });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { status: res.status, json, text };
    } catch (e) { return { status: "연결실패", json: null, text: String(e.message || e) }; }
  };
  const NCP = { "X-NCP-APIGW-API-KEY-ID": ID, "X-NCP-APIGW-API-KEY": SECRET };
  const hasDev = !!(SEARCH_ID && SEARCH_SECRET);
  const DEV = hasDev
    ? { "X-Naver-Client-Id": SEARCH_ID, "X-Naver-Client-Secret": SEARCH_SECRET }
    : { "X-Naver-Client-Id": ID, "X-Naver-Client-Secret": SECRET };
  const totalOf = j => j && (j.total ?? j.totalCount ?? (j.result && j.result.total));

  /* 대조군부터. 없는 경로가 뭘 돌려주는지 알아야 판정할 수 있다. */
  const ctl = await get(HUB, CTRL, NCP);
  console.log(`  대조군 ${ctl.status}  ${safe(ctl.text).replace(/\s+/g, " ").slice(0, 90)}`);
  console.log(`  → 이것과 다른 응답만 의미가 있다.\n`);

  console.log(hasDev
    ? "  검색 API 키가 따로 있다. 개발자센터 주소에는 그 키를 쓴다.\n"
    : "  검색 API 키가 없다. 개발자센터 주소에도 허브 키를 써본다.\n"
      + "  거기서 401(인증 실패)이 나오면 그건 '주소는 살아있고 키만 다르다'는 뜻이다.\n");

  /* 살아있다고 알려진 검색 API 부터. 이게 뭘 주는지가 판정의 기준이다. */
  console.log("  [기준점] 이관됐다고 알려진 검색 API 가 이 키로 뭘 주는지 먼저 본다");
  let liveOk = false, liveStatus = [];
  for (const p2 of LIVE_PATHS) {
    const r = await get(HUB, p2, NCP);
    await sleep(200);
    const code = (r.json && r.json.error && r.json.error.errorCode) || "";
    if (String(r.status) !== String(ctl.status)) liveOk = true;
    liveStatus.push(`${p2} → ${r.status}${code ? " (" + code + ")" : ""}`);
    console.log(`    ${String(r.status).padEnd(6)} ${p2.padEnd(24)} ${safe(r.text).replace(/\s+/g, " ").slice(0, 70)}`);
  }
  console.log(liveOk
    ? "    → 블로그·뉴스는 살아있다. 그러면 쇼핑의 404 는 진짜 '없음'이다.\n"
    : "    → 블로그·뉴스도 대조군과 똑같다. 404 는 '종료'가 아니라\n"
      + "       '이 계정이 검색 API 를 구독하지 않았다'는 뜻일 수 있다.\n"
      + "       NCP 콘솔에서 검색 API 를 신청하면 달라질 수 있다.\n");

  const hits = [];
  let sawAuthFail = false;
  const plan = [
    [HUB, NCP, "API HUB", HUB_PATHS, "ncp"],
    [(process.env.NAVER_DEV_HOST || "https://openapi.naver.com"), DEV, hasDev ? "개발자센터 (검색 API 키)" : "개발자센터 (허브 키로 시험)", OLD_PATHS, hasDev ? "dev" : "ncp"]
  ];
  for (const [host, headers, label, list, auth] of plan) {
    console.log(`  [${label}] ${host}`);
    for (const p2 of list) {
      const r = await get(host, p2, headers);
      await sleep(200);
      const total = totalOf(r.json);
      if (total != null) {
        console.log(`    *** 상품수 나옴 *** ${p2}   total=${Number(total).toLocaleString()}`);
        hits.push({ host, path: p2, total: Number(total), label, auth });
        continue;
      }
      if (r.status === 401 || r.status === 403) sawAuthFail = true;
      const sameAsCtl = host === HUB && String(r.status) === String(ctl.status);
      const mark = sameAsCtl ? "    " : "  ? ";
      console.log(`  ${mark}${String(r.status).padEnd(6)} ${p2.padEnd(24)} ${safe(r.text).replace(/\s+/g, " ").slice(0, 80)}`);
    }
    console.log("");
  }

  if (hits.length) {
    await fs.mkdir(OUTDIR, { recursive: true });
    await fs.writeFile(path.join(OUTDIR, "hub-shopcount.json"),
      JSON.stringify({ kw: q, hits, liveOk, liveStatus, at: new Date().toISOString() }, null, 1), "utf8");
    const h = hits[0];
    console.log(`  찾았다.  ${h.host}${h.path}`);
    console.log(`  "${q}" 상품수 ${h.total.toLocaleString()}개`);
    console.log(`  → ${OUTDIR}/hub-shopcount.json 에 저장했다.`);
    console.log(`  이 파일을 보내주면 전체 수집기를 붙인다.\n`);
  } else if (liveOk) {
    console.log("  상품수를 주는 자리가 없다. 그리고 그건 설정 문제가 아니다.");
    console.log("  블로그·뉴스 검색은 같은 키로 살아있는데 쇼핑만 404 다.");
    console.log("  = 쇼핑 검색 API 는 실제로 없어진 것이다. 공식 경로는 막혔다.\n");
  } else if (!hasDev && sawAuthFail) {
    console.log("  자리는 찾았다. 키가 다를 뿐이다.");
    console.log("  openapi.naver.com 이 404 가 아니라 401(인증 실패)을 줬다.");
    console.log("  = 주소는 살아있고, 허브 키로는 못 들어간다는 뜻이다.\n");
    console.log("  할 일: developers.naver.com 에서 애플리케이션을 하나 만들고");
    console.log("         '검색' API 를 추가한 뒤, 거기서 나온 Client ID / Secret 을");
    console.log("         key.txt 에 두 줄 더 적어라. 무료고 하루 25,000번이다.\n");
    console.log("           SEARCH_ID=받은Client ID");
    console.log("           SEARCH_SECRET=받은Client Secret\n");
    console.log("  적고 나서 이 파일을 다시 더블클릭하면 된다.\n");
  } else {
    console.log("  상품수를 주는 자리를 못 찾았다.");
    console.log("  다만 블로그·뉴스 검색도 똑같이 404 였다. 구독 문제일 수 있다.");
    console.log("  NCP 콘솔 > API HUB 에서 '검색' 을 신청해보고 다시 돌려라.\n");
  }
}

/* ── 정보성/쇼핑성 판별 시험 ──
   상품수가 없어졌으니 "이 키워드로 물건이 팔리나" 를 다른 걸로 재야 한다.
   지금까지 네 개를 재봤고 네 개 다 실패했다.
     광고 유무            정보성 7/7 에도 광고가 붙는다. 오탐 100%
     입찰가 수준          920원 대 1,230원. 1.3배로는 못 가른다
     쇼핑인사이트 잡힘     검색량 보정하면 90% 대 100%. 차이 없다
     쇼핑클릭÷검색량       방향이 뒤집힌다. 추석선물세트 0.007 < 콜라비효능 1.150

   다섯 번째 후보: 지식iN 문서수.
   "콜라비효능" 은 사람들이 묻는 말이고 "한우선물세트" 는 묻는 말이 아니다.
   지식iN 문서수 ÷ 검색수 가 그 차이를 잡아줄 것이라는 가설이다.

   가설일 뿐이다. 42,000번 붓기 전에 80개로 먼저 잰다. */
const TEST_INFO = ["고구마효능","단호박효능","토마토효능","블루베리효능","양파효능","마늘효능",
  "무화과효능","콜라비효능","레몬밤효능","모로오렌지효능","아보카도먹는법","콩나물무침","오징어볶음",
  "닭볶음탕","가지볶음","시금치무침","애호박볶음","감자조림","연근조림","우엉조림",
  "브로콜리데치는법","고구마삶는법","단호박찌는법","밤까는법","마늘까는법","생강보관법",
  "바나나보관법","양배추보관법","대파보관법","깻잎장아찌만드는법","오이지담그는법","총각김치담그는법",
  "호박죽만드는법","단호박수프레시피","토마토스파게티레시피","망고스무디레시피","블루베리스무디레시피",
  "아스파라거스요리","비트효능","여주효능"];
const TEST_SHOP = ["추석선물세트","한우선물세트","곶감선물세트","사과선물세트","포도선물세트",
  "제주갈치선물세트","마장동소고기선물세트","구포국수선물세트","쌀10KG","쌀20KG","햇반20개",
  "샤인머스캣선물세트","한라봉5kg","제주감귤10kg","블루베리1kg","대추방울토마토5kg","성주참외10kg",
  "밤고구마10kg","단감10kg","자두5kg","복숭아5kg","사과10kg","배5kg","고구마10kg",
  "빵택배","여수간장게장택배","전복1kg","새우10kg","닭가슴살1kg","삼겹살1kg",
  "한돈선물세트","굴비선물세트","멸치선물세트","견과류선물세트","건조과일선물세트",
  "산지직송사과","산지직송감자","햇양파10kg","제철과일박스","과일선물세트"];

async function intentTest(args) {
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const NCP = { "X-NCP-APIGW-API-KEY-ID": ID, "X-NCP-APIGW-API-KEY": SECRET };
  const WHICH = (val("--api") || "kin").toLowerCase();
  const PATHS = { kin: "/search/v1/kin", blog: "/search/v1/blog", cafe: "/search/v1/cafearticle",
                  webkr: "/search/v1/webkr", news: "/search/v1/news" };
  const p2 = PATHS[WHICH];
  if (!p2) { console.error("--api 는 kin / blog / cafe / webkr / news 중 하나다."); return; }

  console.log(`\n── 정보성 판별 시험   ${WHICH} 문서수를 쓴다   ${HUB}${p2}`);
  console.log(`   정보성 ${TEST_INFO.length}개 · 쇼핑성 ${TEST_SHOP.length}개, 총 ${TEST_INFO.length + TEST_SHOP.length}번 부른다\n`);

  const one = async kw => {
    for (let t = 0; t < 3; t++) {
      try {
        const res = await fetch(HUB + p2 + "?query=" + encodeURIComponent(kw) + "&display=1", { headers: NCP });
        const text = await res.text();
        if (res.status === 401) return { err: "401 " + safe(text).replace(/\s+/g, " ").slice(0, 90) };
        if (res.status === 404) return { err: "404 이 경로가 없다" };
        if (res.status === 429) return { err: "429 한도" };
        let j = null; try { j = JSON.parse(text); } catch {}
        if (j && j.total != null) return { total: Number(j.total) };
        if (res.status >= 500) { await sleep(500 * (t + 1)); continue; }
        return { err: String(res.status) + " " + safe(text).replace(/\s+/g, " ").slice(0, 70) };
      } catch (e) { await sleep(500 * (t + 1)); }
    }
    return { err: "연결 실패" };
  };

  const probe = await one(TEST_INFO[0]);
  if (probe.err) {
    console.log(`  첫 호출부터 막혔다: ${probe.err}\n`);
    if (/401/.test(probe.err)) {
      console.log("  NCP 콘솔 > API HUB > Application 에서 그 Application 을 수정하고");
      console.log(`  "${WHICH === "kin" ? "지식iN" : WHICH === "blog" ? "블로그" : WHICH}" 를 체크해서 저장한 뒤 다시 돌려라.`);
      console.log("  키는 그대로 쓴다. 새로 받을 필요 없다.\n");
    }
    return;
  }

  const run = async list => {
    const out = [];
    for (const kw of list) { const r = await one(kw); await sleep(120); if (r.total != null) out.push([kw, r.total]); }
    return out;
  };
  const A = await run(TEST_INFO), B = await run(TEST_SHOP);
  if (!A.length || !B.length) { console.log("  표본을 못 모았다.\n"); return; }

  const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const mA = med(A.map(x => x[1])), mB = med(B.map(x => x[1]));
  console.log(`  정보성 ${A.length}개 문서수 중앙값 ${mA.toLocaleString()}`);
  console.log(`  쇼핑성 ${B.length}개 문서수 중앙값 ${mB.toLocaleString()}`);
  console.log(`  차이 ${(Math.max(mA, mB) / Math.max(Math.min(mA, mB), 1)).toFixed(1)}배  (${mA > mB ? "정보성이 많다 = 방향 맞음" : "쇼핑성이 더 많다 = 가설과 반대"})\n`);

  console.log("  문턱으로 갈라보면");
  console.log("    문턱          정보성 잡음   쇼핑성 오탐   차이");
  const all = A.concat(B).map(x => x[1]).sort((a, b) => a - b);
  const cuts = [...new Set([1, 2, 3, 5, 8, 12, 20, 35, 60, 100].map(p => all[Math.floor(all.length * p / 100)] || 0))];
  let best = { gap: -1 };
  for (const t of cuts.sort((a, b) => a - b)) {
    const tp = A.filter(x => x[1] >= t).length / A.length * 100;
    const fp = B.filter(x => x[1] >= t).length / B.length * 100;
    if (tp - fp > best.gap) best = { gap: tp - fp, t, tp, fp };
    console.log(`    ${String(t.toLocaleString()).padStart(10)}  ${tp.toFixed(0).padStart(8)}%  ${fp.toFixed(0).padStart(9)}%  ${(tp - fp).toFixed(0).padStart(5)}%p`);
  }
  console.log(`\n  제일 잘 갈리는 문턱 ${best.t.toLocaleString()} → 차이 ${best.gap.toFixed(0)}%p`);
  console.log(best.gap >= 60
    ? "  쓸 만하다. 42,000개 전체에 붓자.\n"
    : best.gap >= 40
      ? "  애매하다. 보조 지표로는 쓰되 단독 판정에는 못 쓴다.\n"
      : "  못 쓴다. 이것도 버린다.\n");

  await fs.mkdir(OUTDIR, { recursive: true });
  await fs.writeFile(path.join(OUTDIR, `intent-test-${WHICH}.json`),
    JSON.stringify({ api: WHICH, path: p2, info: A, shop: B, best, at: new Date().toISOString() }, null, 1), "utf8");
  console.log(`  → ${OUTDIR}/intent-test-${WHICH}.json\n`);
}

/* ── 상품수 전체 수집 ──
   18단계가 자리를 찾아 hub-shopcount.json 을 만든 뒤에만 돌아간다.
   호스트와 경로를 그 파일에서 읽는다. 내가 주소를 외워둘 필요가 없다. */
async function collectShopCount(args) {
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const FOUND = path.join(OUTDIR, "hub-shopcount.json");
  let cfg;
  try { cfg = JSON.parse(await fs.readFile(FOUND, "utf8")); }
  catch { console.error(`\n  ${FOUND} 이 없다. 18단계(18-find-shopcount.bat)부터 돌려라.\n`); return; }
  const hit = (cfg.hits || [])[0];
  if (!hit) { console.error("\n  찾은 자리가 없다. 18단계 결과를 먼저 보내줘라.\n"); return; }
  /* 18단계가 어떤 키로 뚫었는지 적어둔다. 그대로 따라 쓴다. */
  const useDev = hit.auth === "dev";
  if (useDev && !(SEARCH_ID && SEARCH_SECRET)) {
    console.error("\n  검색 API 키(SEARCH_ID / SEARCH_SECRET)가 key.txt 에 없다. 18단계 안내를 보라.\n"); return;
  }
  const headers = hit.host === HUB
    ? { "X-NCP-APIGW-API-KEY-ID": ID, "X-NCP-APIGW-API-KEY": SECRET }
    : useDev
      ? { "X-Naver-Client-Id": SEARCH_ID, "X-Naver-Client-Secret": SEARCH_SECRET }
      : { "X-Naver-Client-Id": ID, "X-Naver-Client-Secret": SECRET };

  const listFile = val("--only") || path.join(OUTDIR, "section-keywords.txt");
  let want;
  try { want = (await fs.readFile(listFile, "utf8")).split(/\r?\n/).map(t => t.trim()).filter(Boolean); }
  catch { console.error(`\n  ${listFile} 이 없다. 16b-pack-sections.bat 을 먼저 돌리면 만들어진다.\n`); return; }

  const OUT = path.join(OUTDIR, "shopcount.json");
  let done = {}, calls = 0;
  try { const prev = JSON.parse(await fs.readFile(OUT, "utf8")); done = prev.data || {}; calls = prev.calls || 0; } catch {}
  const todo = want.filter(k => done[k] == null);
  const MAX = parseInt(val("--max") ?? "24000", 10);
  const plan = todo.slice(0, MAX);

  console.log(`\n── 상품수 수집   ${hit.host}${hit.path}`);
  console.log(`  목표 ${want.length.toLocaleString()}개 · 이미 받은 것 ${Object.keys(done).length.toLocaleString()}개`);
  console.log(`  이번에 ${plan.length.toLocaleString()}개를 채운다 (하루 한도 ${MAX.toLocaleString()})\n`);
  if (!plan.length) { console.log("  더 받을 게 없다. 끝.\n"); return; }

  const save = async () => {
    const tmp = OUT + ".tmp";
    const fh = await fs.open(tmp, "w");
    try {
      await fh.write('{"host":' + JSON.stringify(hit.host) + ',"path":' + JSON.stringify(hit.path)
        + ',"savedAt":' + JSON.stringify(new Date().toISOString())
        + ',"calls":' + calls + ',"keywords":' + Object.keys(done).length + ',"data":{');
      let first = true, buf = "";
      for (const k of Object.keys(done)) {
        buf += (first ? "" : ",") + JSON.stringify(k) + ":" + done[k];
        first = false;
        if (buf.length > 4000000) { await fh.write(buf); buf = ""; }
      }
      if (buf) await fh.write(buf);
      await fh.write("}}");
    } finally { await fh.close(); }
    await fs.rename(tmp, OUT);
  };

  let i = 0, ok = 0, bad = 0, stop = "";
  const one = async kw => {
    const url = hit.host + hit.path + "?query=" + encodeURIComponent(kw) + "&display=1";
    for (let t = 0; t < 3; t++) {
      try {
        const res = await fetch(url, { headers });
        const text = await res.text();
        calls++;
        if (res.status === 429) { stop = "하루/한달 한도에 걸렸다"; return; }
        if (res.status === 401 || res.status === 403) { stop = `키가 거부됐다 (${res.status}). ${safe(text).slice(0, 120)}`; return; }
        let j = null; try { j = JSON.parse(text); } catch {}
        const total = j && (j.total ?? j.totalCount ?? (j.result && j.result.total));
        if (total != null) { done[kw] = Number(total); ok++; return; }
        if (res.status >= 500 || res.status === 0) { await sleep(600 * (t + 1)); continue; }
        bad++; return;
      } catch { await sleep(600 * (t + 1)); }
    }
    bad++;
  };

  const WORKERS = 4;
  const worker = async () => {
    while (!stop) {
      const n = i++;
      if (n >= plan.length) return;
      await one(plan[n]);
      await sleep(120);
      if (n % 500 === 499) {
        await save();
        console.log(`  ${(n + 1).toLocaleString()} / ${plan.length.toLocaleString()}   받음 ${ok.toLocaleString()} · 실패 ${bad.toLocaleString()}`);
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  await save();

  console.log(`\n  끝.  받음 ${ok.toLocaleString()} · 실패 ${bad.toLocaleString()} · 호출 누적 ${calls.toLocaleString()}`);
  if (stop) console.log(`  ${stop}. 내일 같은 파일을 다시 돌리면 이어서 채운다.`);
  const left = want.length - Object.keys(done).length;
  console.log(`  남은 키워드 ${left.toLocaleString()}개`);
  console.log(`  → ${OUT}\n`);
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
  if (args.includes("--intent-test")) return intentTest(args);
  if (args.includes("--shop-count-all")) return collectShopCount(args);
  if (args.includes("--shop-count")) return findShopCount();
  if (args.includes("--shop-stat")) return shopStat(args);
  if (args.includes("--shop-fix")) return shopFix(args);
  if (args.includes("--shop")) return collectShop(args);
  if (args.includes("--cat")) return checkCat(args);
  if (args.includes("--probe") || args.length === 0) return probe();
  console.error("--probe / --find / --trend / --shop / --shop-stat / --shop-count / --shop-count-all / --intent-test / --cat 중 하나를 써라.");
}
main().catch(e => { console.error(e); process.exit(1); });
