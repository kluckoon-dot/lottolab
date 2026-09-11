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
  "https://openapi.naver.com",
  "https://naveropenapi.apigw.ntruss.com",
  "https://apihub.naver.com",
  "https://api-hub.naver.com"
];
/* 인증 헤더 후보. 이관 안내는 X-Naver-Client-* 를 쓴다고 되어 있으나
   NCP 게이트웨이 방식(X-NCP-APIGW-*)일 가능성도 같이 확인한다. */
const AUTHS = [
  { name: "X-Naver-Client-*", h: () => ({ "X-Naver-Client-Id": ID, "X-Naver-Client-Secret": SECRET }) },
  { name: "X-NCP-APIGW-*",    h: () => ({ "X-NCP-APIGW-API-KEY-ID": ID, "X-NCP-APIGW-API-KEY": SECRET }) }
];
const TREND_PATH = "/v1/datalab/search";

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
function safe(t) { let s = String(t ?? ""); for (const v of [ID, SECRET]) if (v) s = s.split(v).join("<가림>"); return s; }

async function tryCall(host, auth, body) {
  try {
    const res = await fetch(host + TREND_PATH, {
      method: "POST",
      headers: { ...auth.h(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, ok: res.ok, text, json };
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

  let hit = null, first = null;
  for (const host of HOSTS) {
    for (const auth of AUTHS) {
      const r = await tryCall(host, auth, body);
      const mark = r.ok ? "OK  " : "실패";
      console.log(`  ${mark}  ${host.padEnd(42)} ${auth.name.padEnd(18)} → ${r.status}`);
      if (r.ok && !hit) hit = { host, auth: auth.name, sample: r.text };
      if (!first && r.status !== "연결실패") first = { host, auth: auth.name, text: r.text };
      await sleep(250);
    }
  }
  console.log("");

  if (hit) {
    console.log("*** 통하는 조합을 찾았다 ***");
    console.log(`    주소   ${hit.host}${TREND_PATH}`);
    console.log(`    인증   ${hit.auth}\n`);
    console.log("── 응답 원본 (앞부분)");
    console.log(safe(hit.sample).slice(0, 1200));
    await fs.mkdir(OUTDIR, { recursive: true });
    await fs.writeFile(path.join(OUTDIR, "hub-endpoint.json"),
      JSON.stringify({ host: hit.host, auth: hit.auth, path: TREND_PATH, foundAt: new Date().toISOString() }, null, 1), "utf8");
    console.log(`\n주소를 ${OUTDIR}/hub-endpoint.json 에 저장했다. 다음부터는 이걸 쓴다.`);
    return;
  }

  console.log("통하는 조합이 없었다. 아래 응답을 그대로 보내주면 맞춰서 고친다.\n");
  if (first) {
    console.log(`── ${first.host} / ${first.auth} 의 응답`);
    console.log(safe(first.text).slice(0, 900));
  }
  console.log("\n확인할 것");
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
