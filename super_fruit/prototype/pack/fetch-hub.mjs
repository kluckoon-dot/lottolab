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
const HOSTS = [
  "https://naveropenapi.apigw.ntruss.com",
  "https://openapi.naver.com",
  "https://apigw.ntruss.com",
  "https://naver-api-hub.apigw.ntruss.com"
];
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
const TREND_PATHS = [
  "/v1/datalab/search",
  "/datalab/v1/search",
  "/api-hub/v1/datalab/search",
  "/naver-api-hub/v1/datalab/search",
  "/apihub/v1/datalab/search",
  "/nhub/v1/datalab/search",
  "/v1/search/datalab",
  "/datalab/search"
];

/* 씨앗을 네이버한테 받아올 수 있는 통로가 있는지 확인할 후보들.
   404 면 없는 것, 400 이면 있는데 요청 형식만 틀린 것이다. */
const RAW_PATHS = [
  ["카테고리 목록",              "GET",  "/v1/datalab/shopping/categories", null],
  ["카테고리 목록(다른 이름)",    "GET",  "/v1/datalab/shopping/category", null],
  ["카테고리별 인기 키워드",      "POST", "/v1/datalab/shopping/category/keywords",
    { startDate: "2026-08-01", endDate: "2026-08-31", timeUnit: "month", category: "50000006",
      keyword: [{ name: "전체", param: ["전체"] }] }],
  ["카테고리 클릭 추세",          "POST", "/v1/datalab/shopping/categories",
    { startDate: "2026-08-01", endDate: "2026-08-31", timeUnit: "month",
      category: [{ name: "식품", param: ["50000006"] }] }],
  ["키워드별 기기",              "POST", "/v1/datalab/shopping/category/keyword/device",
    { startDate: "2026-08-01", endDate: "2026-08-31", timeUnit: "month", category: "50000006", keyword: "사과" }],
  ["키워드별 성별",              "POST", "/v1/datalab/shopping/category/keyword/gender",
    { startDate: "2026-08-01", endDate: "2026-08-31", timeUnit: "month", category: "50000006", keyword: "사과" }],
  ["키워드별 연령",              "POST", "/v1/datalab/shopping/category/keyword/age",
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

async function probe() {
  console.log("── 인증 정보 점검 (값은 보여주지 않는다)");
  console.log(`  Client ID      길이 ${String(ID).length}`);
  console.log(`  Client Secret  길이 ${String(SECRET).length}\n`);

  const body = trendBody(["샤인머스캣"]);
  const { startDate, endDate } = threeYears();
  console.log(`── 3년 주간 추세 요청으로 시험한다  ${startDate} ~ ${endDate}\n`);

  let hit = null, notable = [];
  for (const host of HOSTS) {
    for (const p of TREND_PATHS) {
      for (const auth of AUTHS) {
        const r = await tryCall(host, auth, body, p);
        const real = r.ok;
        const authish = r.raw === 401 || r.raw === 403 || r.raw === 405;
        if (real || authish) {
          const mark = real ? "OK  " : authish ? "경로○" : "    ";
          console.log(`  ${mark} ${String(r.raw).padEnd(5)} ${host}${p}  [${auth.name}]`
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
  if (args.includes("--probe") || args.length === 0) return probe();
  console.error("아직 --probe 만 지원한다. 주소가 확정되면 수집 기능을 붙인다.");
}
main().catch(e => { console.error(e); process.exit(1); });
