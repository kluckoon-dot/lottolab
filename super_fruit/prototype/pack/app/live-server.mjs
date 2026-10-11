/* ── 슈퍼프룻 키워드랩 · 실시간 서버 ──
 *
 *   node live-server.mjs        →  http://127.0.0.1:8787 이 열린다
 *
 * 왜 필요한가.
 *   화면에 있던 숫자는 9월 14일에 한 번 찍은 사진이었다. 검색광고 API 가 주는
 *   검색수는 "최근 30일" 이라, 제철이 도는 품목은 한 달만 지나도 전혀 다른 값이 된다.
 *   청도반시는 9월 중순이 1년 중 바닥(상대지수 1~3)이었고 10월이 성수기다.
 *   아이템스카우트와 네이버 키워드도구가 서로 같고 우리만 다른 이유가 그것이다.
 *
 *   해결은 실시간 조회뿐이다. 그런데 네이버 키는 비밀 서명이 필요해서
 *   공개된 웹페이지에는 넣을 수 없다. 그래서 키가 있는 이 PC 에서 작은 서버를 띄운다.
 *
 * 하는 일
 *   GET  /api/live?kw=청도반시        검색수·클릭수·클릭률·연관키워드 + 입찰가 1~3위 (PC·모바일)
 *   GET  /api/multi?kws=사과,배,감     여러 키워드를 한 번에. 정확히 그 키워드만 + 입찰가
 *   GET  /api/insight?kw=청도반시     3년 일간 검색 추세 · 쇼핑 클릭 추세 · 기기 · 성별 · 연령 (API HUB)
 *   GET  /api/uploads                 저장해둔 엑셀 분석 목록
 *   POST /api/uploads                 엑셀 분석 결과 저장
 *   DELETE /api/uploads/<id>          지우기
 *   그 밖의 주소는 이 폴더의 파일을 그대로 내준다 (keyword-lab.html 등)
 *
 * 이 PC 밖에서는 접속할 수 없다. 127.0.0.1 에만 붙는다.
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { exec } from "node:child_process";

const PORT = +(process.env.PORT || 8787);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(HERE).toLowerCase() === "app" ? path.dirname(HERE) : HERE;   // 폴더 정리: 데이터·키는 app 위
const OUTDIR = path.join(ROOT, "naver-out");
const CACHE = path.join(OUTDIR, "live-cache");
/* 넣는곳 — 보갬이 내려받은 엑셀을 옮겨두는 곳. 화면이 열릴 때 새 파일만 읽어 간다.
   폴더 이름은 화면에 보이는 그대로. xlsx 만 내준다. 다른 곳의 파일은 못 꺼내 간다. */
const INBOX = path.join(ROOT, "넣는곳");
const INBOX_DIRS = ["아이템스카우트", "네이버키워드도구", "공급가표·계산기"];
for (const d of INBOX_DIRS) { try { fs.mkdirSync(path.join(INBOX, d), { recursive: true }); } catch {} }
async function listInbox() {
  const out = [];
  for (const d of INBOX_DIRS) {
    let names = []; try { names = await fsp.readdir(path.join(INBOX, d)); } catch { continue; }
    for (const n of names) {
      if (!/\.xlsx$/i.test(n) || n.startsWith("~$")) continue;      // ~$ 는 엑셀이 열어둔 잠금 파일
      try { const st = await fsp.stat(path.join(INBOX, d, n)); out.push({ dir: d, name: n, mtime: st.mtimeMs, size: st.size }); } catch {}
    }
  }
  return out.sort((a, b) => a.mtime - b.mtime);
}
const UPLOADS = path.join(OUTDIR, "uploads");
const CACHE_MIN = +(process.env.LIVE_CACHE_MIN || 180);   // 같은 키워드는 3시간 안에 다시 부르지 않는다

/* ── 키 ── fetch-naver.mjs 와 같은 규칙으로 읽는다 */
const ALIAS = {
  naver_ad_api_key:"KEY", 액세스라이선스:"KEY", 라이선스:"KEY", apikey:"KEY", api_key:"KEY",
  naver_ad_secret:"SECRET", 비밀키:"SECRET", secret:"SECRET", secretkey:"SECRET",
  naver_ad_customer:"CUSTOMER", 고객id:"CUSTOMER", 고객아이디:"CUSTOMER",
  customerid:"CUSTOMER", customer_id:"CUSTOMER", customer:"CUSTOMER",
  /* B. NAVER API HUB — 검색어 트렌드 · 쇼핑 인사이트. fetch-hub.mjs 와 같은 이름들 */
  naver_hub_id:"HUB_ID", hub_client_id:"HUB_ID", clientid:"HUB_ID", client_id:"HUB_ID", 허브id:"HUB_ID", 허브아이디:"HUB_ID",
  naver_hub_secret:"HUB_SECRET", hub_client_secret:"HUB_SECRET", clientsecret:"HUB_SECRET", client_secret:"HUB_SECRET", 허브시크릿:"HUB_SECRET"
};
function loadKeys() {
  for (const name of ["key.txt", ".env"]) for (const dir of [...new Set([ROOT, HERE])]) {
    let raw; try { raw = fs.readFileSync(path.join(dir, name), "utf8"); } catch { continue; }
    const out = {};
    for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("//")) continue;
      const i = t.indexOf("="); if (i < 0) continue;
      const k = t.slice(0, i).trim().toLowerCase().replace(/[\s-]/g, "");
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (ALIAS[k] && v && !/여기에|붙여넣|paste|<|>/.test(v)) out[ALIAS[k]] = v;
    }
    if (Object.keys(out).length) return out;
  }
  return {};
}
const FK = loadKeys();
const KEY = process.env.NAVER_AD_API_KEY || FK.KEY;
const SECRET = process.env.NAVER_AD_SECRET || FK.SECRET;
const CUSTOMER = process.env.NAVER_AD_CUSTOMER || FK.CUSTOMER;
const AD_HOST = process.env.NAVER_AD_HOST || "https://api.searchad.naver.com";
const HUB_ID = process.env.NAVER_HUB_ID || FK.HUB_ID;
const HUB_SECRET = process.env.NAVER_HUB_SECRET || FK.HUB_SECRET;
const HUB_HOST = process.env.NAVER_HUB_HOST || "https://naverapihub.apigw.ntruss.com";
const INSIGHT_MIN = +(process.env.INSIGHT_CACHE_MIN || 720);  // 추세는 하루 단위라 12시간 묶어둔다
const CAT = process.env.SHOP_CAT || "50000006";                // 쇼핑인사이트 분야. 기본 식품

function sign(method, urlPath) {
  const ts = Date.now().toString();
  const sig = crypto.createHmac("sha256", SECRET).update(`${ts}.${method}.${urlPath}`).digest("base64");
  return { "X-Timestamp": ts, "X-API-KEY": KEY, "X-Customer": String(CUSTOMER),
           "X-Signature": sig, "Content-Type": "application/json; charset=UTF-8" };
}
async function ad(method, urlPath, { query, body, qs: rawQs } = {}) {
  const qs = rawQs || (query ? "?" + new URLSearchParams(query) : "");
  const res = await fetch(AD_HOST + urlPath + qs, { method, headers: sign(method, urlPath),
    body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const safe = t => { let s = String(t ?? ""); for (const v of [KEY, SECRET, CUSTOMER, HUB_ID, HUB_SECRET]) if (v && String(v).length >= 6) s = s.split(v).join("<가림>"); return s; };

/* 네이버는 적은 검색량을 "< 10" 문자열로 준다. 숫자로 바꾸되 가려졌다는 표시를 남긴다. */
const num = v => typeof v === "number" ? v : (parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10) || 0);
const masked = v => typeof v === "string" && /</.test(v);
/* 힌트에는 공백·& · / 가 들어가면 400 이 난다. 실측으로 확인한 규칙이다. */
const cleanHint = s => String(s).replace(/\([^)]*\)/g, "").replace(/[\s&/,·]+/g, "").slice(0, 20);
const same = (a, b) => String(a).replace(/\s+/g, "").toUpperCase() === String(b).replace(/\s+/g, "").toUpperCase();

/* ── 우리 전체 수집본의 키워드 이름표 ──
   9월까지 모은 keywords.json(56만 개 · 290MB)에서 이름과 당시 검색수만 뽑아 naver-out/all-keywords.tsv 로 둔다.
   숫자는 낡았으므로 화면에 쓰지 않는다 — "이런 키워드가 있다" 는 것만 쓰고, 값은 네이버에 지금 다시 묻는다.
   파일이 없으면 처음 한 번 만든다(10초쯤). */
let KWIDX = null;
async function kwIndex() {
  if (KWIDX) return KWIDX;
  const tsv = path.join(OUTDIR, "all-keywords.tsv");
  try { KWIDX = (await fsp.readFile(tsv, "utf8")).split("\n").filter(Boolean).map(l => { const i = l.lastIndexOf("\t"); return [l.slice(0, i), +l.slice(i + 1) || 0, l.slice(0, i).toUpperCase()]; }); return KWIDX; } catch {}
  const src = path.join(OUTDIR, "keywords.json");
  if (!fs.existsSync(src)) return (KWIDX = []);
  const out = []; let kw = null;
  const rl = (await import("node:readline")).createInterface({ input: fs.createReadStream(src, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    let m;
    if ((m = /^\s*"kw": "(.*)",?\s*$/.exec(line))) kw = m[1].replace(/\\(.)/g, "$1");
    else if (kw != null && (m = /^\s*"total": (\d+)/.exec(line))) { out.push([kw, +m[1], kw.toUpperCase()]); kw = null; }
  }
  await fsp.writeFile(tsv, out.map(x => x[0] + "\t" + x[1]).join("\n"), "utf8");
  return (KWIDX = out);
}

/* 씨앗 뒤(앞)에 흔히 붙는 말. 네이버 연관 목록에는 안 나와도 따로 물으면 값이 있는 키워드가 많다
   (밤보관법 · 밤삶는방법 · 밤10kg · 밤시세 — 아이템스카우트 연관 탭에는 있고 네이버 연관에는 없던 것들) */
const MOD_TAIL = ["가격","시세","10kg","5kg","3kg","2kg","1kg","파는곳","판매","직거래","도매","선물세트","선물","택배","추천","효능","칼로리","보관법","보관","요리","레시피","먹는법",
  "삶는법","삶는방법","삶기","삶는시간","찌는법","굽는법","손질","세척","제철","수확시기","종류","품종","묘목","모종","씨앗","재배","키우기","즙","주스","잼","청","말랭이","가루","칩","식초","차",
  "농장","껍질","까는법","까는기계","가위","칼","조림","파이","양갱","라떼","꿀"];
const MOD_HEAD = ["햇","국산","국내산","냉동","유기농","무농약","못난이","가정용","토종","특대","깐","생"];

async function lookup(kw, fresh, wide) {
  const hint = cleanHint(kw);
  if (!hint) throw Object.assign(new Error("키워드가 비었다"), { code: 400 });
  const file = path.join(CACHE, encodeURIComponent(hint) + (wide ? ".wide" : "") + ".json");
  if (!fresh) {
    try {
      const c = JSON.parse(await fsp.readFile(file, "utf8"));
      if (c.wide === !!wide && c.perf && Date.now() - Date.parse(c.at) < CACHE_MIN * 60000) return { ...c, cached: true };
    } catch {}
  }

  /* 1. 검색수·클릭수·클릭률 + 연관키워드.
        아이템스카우트 "연관 키워드" 탭이 보여주는 것과 같은 응답이다. */
  const r = await ad("GET", "/keywordstool", { query: { hintKeywords: hint, showDetail: "1" } });
  if (!r.ok) {
    const why = r.status === 429 ? "네이버 호출 한도에 걸렸다. 잠시 뒤 다시."
              : (r.status === 401 || r.status === 403) ? "네이버가 키를 거부했다. key.txt 를 확인."
              : `네이버 응답 ${r.status}`;
    throw Object.assign(new Error(why + " " + safe(r.text).slice(0, 120)), { code: 502 });
  }
  const list = (r.json?.keywordList || []).map(rowOf);
  const exact = list.find(x => same(x.kw, kw)) || list.find(x => same(x.kw, hint)) || null;

  /* 1-2. 한 겹 더.
        네이버는 씨앗 하나에 연관을 백여 개만 준다 (밤 125개 — 같은 날 아이템스카우트 연관 탭은 322개).
        씨앗 글자가 든 연관키워드를 다시 씨앗으로 물려, 거기서 나온 것 중 씨앗 글자가 든 것만 더한다
        (공주밤 → 공주햇밤가격 · 밤10kg · 햇밤가격 …). 다섯 개씩 한 번에 묻는다. 숫자는 전부 네이버가 지금 준 값이다. */
  const first = list.length, seen = new Set(list.map(x => x.kw)), H = hint.toUpperCase();
  const fam = list.filter(x => !same(x.kw, hint) && x.kw.toUpperCase().includes(H))
    .sort((a, b) => (b.pc + b.mo) - (a.pc + a.mo)).slice(0, 40).map(x => cleanHint(x.kw)).filter(Boolean);
  for (let i = 0; wide && i < fam.length; i += 5) {
    const r2 = await ad("GET", "/keywordstool", { qs: "?hintKeywords=" + fam.slice(i, i + 5).map(encodeURIComponent).join(",") + "&showDetail=1" });
    if (r2.status === 429) break;
    if (r2.ok) for (const row of (r2.json?.keywordList || [])) {
      const x = rowOf(row);
      if (!seen.has(x.kw) && x.kw.toUpperCase().includes(H)) { seen.add(x.kw); list.push(x); }
    }
    await sleep(120);
  }
  /* 1-3. 우리 전체 수집본에서 씨앗 글자가 든 키워드 (당시 검색수 큰 순 120개).
        이름만 가져오고 값은 네이버에 지금 다시 묻는다. 묻는 김에 딸려 오는 연관도 씨앗 글자가 들었으면 같이 담는다 */
  const deep1 = list.length - first;
  const mine = wide ? (await kwIndex()).filter(x => x[2].includes(H) && !seen.has(x[0])).sort((a, b) => b[1] - a[1]).slice(0, 100).map(x => x[0]) : [];
  /* 씨앗이 품목 이름처럼 짧을 때만 꼬리말을 붙여 묻는다 */
  const combos = wide && hint.length <= 6 ? [...MOD_TAIL.map(m => hint + m), ...MOD_HEAD.map(m => m + hint)].filter(k => !seen.has(k) && !mine.includes(k)) : [];
  const ask = [...combos, ...mine];
  const mg = []; for (let i = 0; i < ask.length; i += 5) mg.push(ask.slice(i, i + 5));
  let mi = 0, halt = false;
  const askMine = async () => {
    while (mi < mg.length && !halt) {
      const hs = mg[mi++].map(cleanHint).filter(Boolean); if (!hs.length) continue;
      /* 셋이 한꺼번에 물으면 네이버가 429 로 막는다(실측). 둘까지만, 막히면 쉬었다 다시 */
      let r3;
      for (let t = 0; t < 4; t++) {
        r3 = await ad("GET", "/keywordstool", { qs: "?hintKeywords=" + hs.map(encodeURIComponent).join(",") + "&showDetail=1" });
        if (r3.status !== 429) break;
        await sleep(800 * (t + 1));
      }
      if (r3.status === 429) { halt = true; break; }
      if (r3.ok) for (const row of (r3.json?.keywordList || [])) {
        const x = rowOf(row);
        if (!seen.has(x.kw) && x.kw.toUpperCase().includes(H)) { seen.add(x.kw); list.push(x); }
      }
      await sleep(150);
    }
  };
  await Promise.all([askMine(), askMine()]);

  /* 2. 입찰가 1~3위 · 중간 입찰가. 연관 전부(검색량 큰 순 500개까지).
        전에는 상위 30개만 받아서 나머지 줄에 9월 입찰가가 표시 없이 섞여 보였다.
        순위 입찰가는 한 번에 50개, 중간 입찰가는 200개까지 받는다 (2026-10-09 실측). */
  const want = [];
  if (exact) want.push(exact.kw);
  list.slice().sort((a, b) => (b.pc + b.mo) - (a.pc + a.mo))
    .forEach(x => { if (want.length < 500 && !want.includes(x.kw)) want.push(x.kw); });
  /* 쇼핑 클릭 지수는 검색한 키워드와 연관 상위 60개만. HUB 호출이 4개에 한 번이라 전부는 느리다 */
  const [{ bids, ad5 }, shop] = await Promise.all([bidsFor(want), shopIdxFor(want.slice(0, wide ? 60 : 120))]);
  const perf = await perfFor(want, bids);
  const out = { at: new Date().toISOString(), kw, hint, exact, related: list, first, deep: deep1, own: list.length - first - deep1, wide: !!wide, bids, med: ad5, shop, perf };   // med = 광고 단가(5위 입찰가). 이름은 화면과의 약속이라 그대로 둔다
  await fsp.mkdir(CACHE, { recursive: true });
  await fsp.writeFile(file, JSON.stringify(out), "utf8");
  return { ...out, cached: false };
}

/* ── 입찰가 1~3위 + 5위. 50개씩(한 번에 200항목이 한도) 묶어 PC·모바일 따로 ──
   5위 입찰가가 아이템스카우트의 "광고 단가" 다 (2026-10-11 같은 날 파일 330개로 확인). */
async function bidsFor(want) {
  const bids = {}, ad5 = {};
  for (let i = 0; i < want.length; i += 50) {
    const g = want.slice(i, i + 50);
    const items = []; for (const k of g) for (const p of [1, 2, 3, 5]) items.push({ key: k, position: p });
    for (const device of ["PC", "MOBILE"]) {
      const b = await ad("POST", "/estimate/average-position-bid/keyword",
        { body: { device, keywordplus: false, key: g[0], items } });
      if (b.ok) for (const e of (b.json?.estimate || [])) {
        if (e.position === 5) { (ad5[e.keyword] ||= [null, null])[device === "PC" ? 0 : 1] = e.bid; continue; }
        const slot = (bids[e.keyword] ||= { pc: [null, null, null], mo: [null, null, null] });
        (device === "PC" ? slot.pc : slot.mo)[e.position - 1] = e.bid;
      }
      await sleep(80);
    }
  }
  return { bids, ad5 };
}
/* ── 예상 실적 ── 네이버가 추정한 "그 입찰가로 광고하면 한 달에 몇 번 노출 · 클릭되고 얼마가 나가는가".
   키워드마다 넷(모바일 3위 · PC 3위 · 모바일 1위 · PC 1위 입찰가). 한 번에 200항목. refresh-naver.mjs 의 perf 와 같은 모양으로 돌려준다 */
async function perfFor(want, bids) {
  const out = {}, bidOf = v => +v > 0 ? Math.max(70, Math.round(+v / 10) * 10) : 0;
  const list = want.filter(k => bids[k]);
  for (let i = 0; i < list.length; i += 50) {
    const g = list.slice(i, i + 50), items = [], seen = new Set();
    const add = (k, device, bid) => { if (!bid) return; const id = k + "|" + device + "|" + bid; if (seen.has(id)) return; seen.add(id); items.push({ device, keywordplus: false, keyword: k, bid }); };
    for (const k of g) { const b = bids[k]; add(k, "MOBILE", bidOf(b.mo[2])); add(k, "PC", bidOf(b.pc[2])); add(k, "MOBILE", bidOf(b.mo[0])); add(k, "PC", bidOf(b.pc[0])); }
    if (!items.length) continue;
    const r = await ad("POST", "/estimate/performance-bulk", { body: { items } });
    if (!r.ok) { await sleep(200); continue; }
    const got = {}; for (const e of r.json?.items || []) got[e.keyword + "|" + e.device + "|" + e.bid] = e;
    for (const k of g) { const b = bids[k], pick = (device, v) => got[k + "|" + device + "|" + bidOf(v)] || null, n = (x, f) => x ? Math.round(+x[f] || 0) : 0;
      const m3 = pick("MOBILE", b.mo[2]), p3 = pick("PC", b.pc[2]), m1 = pick("MOBILE", b.mo[0]), p1 = pick("PC", b.pc[0]);
      if (m3 || p3 || m1 || p1) out[k] = [n(m3, "clicks"), n(m3, "cost"), n(m3, "impressions"), n(p3, "clicks"), n(p3, "cost"), n(p3, "impressions"), n(m1, "clicks"), n(m1, "cost"), n(p1, "clicks"), n(p1, "cost")]; }
    await sleep(60);
  }
  return out;
}
/* ── 쇼핑 클릭 지수 (닭가슴살 = 100) ──
   쇼핑인사이트는 한 번에 넣은 키워드 중 제일 큰 값을 100 으로 둔 상대값만 준다. 닻을 같이 넣어 한 눈금으로 만든다.
   지수 ÷ 검색수 가 구매의도다 (아이템스카우트 쇼핑성/정보성 분류 대비 AUC 0.86). refresh-naver.mjs 와 같은 식. */
const SHOP_ANCHOR = "닭가슴살";
async function shopIdxFor(kws) {
  const out = {};
  if (!(HUB_ID && HUB_SECRET)) return out;
  const end = ymd(addDays(new Date(), -1)), start = ymd(addDays(new Date(), -31));
  const list = kws.filter(k => k !== SHOP_ANCHOR), groups = [];
  for (let i = 0; i < list.length; i += 4) groups.push(list.slice(i, i + 4));
  let gi = 0;
  const worker = async () => {
    while (gi < groups.length) {
      const g = groups[gi++];
      const r = await hub("/shopping/v1/category/keywords", { startDate: start, endDate: end, timeUnit: "month", category: CAT,
        keyword: [{ name: SHOP_ANCHOR, param: [SHOP_ANCHOR] }, ...g.map(k => ({ name: k, param: [k.replace(/\s+/g, "")] }))] });
      if (!r.ok) continue;
      const sum = t => ((r.json?.results || []).find(x => x.title === t)?.data || []).reduce((a, d) => a + (+d.ratio || 0), 0);
      const base = sum(SHOP_ANCHOR); if (!(base > 0)) continue;
      for (const k of g) out[k] = +(sum(k) / base * 100).toPrecision(5);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (kws.includes(SHOP_ANCHOR)) out[SHOP_ANCHOR] = 100;
  return out;
}
/* ── (쓰지 않음) 중간 입찰가 (최근 한 달). 아이템스카우트 "광고 단가" 와 맞대보는 값. 200개씩 ── */
async function medFor(want) {
  const med = {};
  for (let i = 0; i < want.length; i += 200) {
    const g = want.slice(i, i + 200);
    for (const device of ["PC", "MOBILE"]) {
      const r = await ad("POST", "/estimate/median-bid/keyword", { body: { device, period: "MONTH", items: g } });
      if (r.ok) for (const e of (r.json?.estimate || [])) {
        const slot = (med[e.keyword] ||= [null, null]);
        slot[device === "PC" ? 0 : 1] = e.bid;
      }
      await sleep(80);
    }
  }
  return med;
}
const rowOf = x => ({
  kw: x.relKeyword,
  pc: num(x.monthlyPcQcCnt), mo: num(x.monthlyMobileQcCnt),
  masked: masked(x.monthlyPcQcCnt) || masked(x.monthlyMobileQcCnt),
  clickPc: +x.monthlyAvePcClkCnt || 0, clickMo: +x.monthlyAveMobileClkCnt || 0,
  ctrPc: +x.monthlyAvePcCtr || 0, ctrMo: +x.monthlyAveMobileCtr || 0,
  depth: num(x.plAvgDepth), comp: x.compIdx || ""
});

/* ── 여러 키워드 한 번에 ──
   키워드도구는 씨앗을 5개까지 쉼표로 받는다. 돌아온 것 중 정확히 그 키워드만 고른다.
   연관은 버린다 — 여기서 원하는 건 "이 10개를 한 표에" 이기 때문이다.
   한 묶음이 실패하면 하나씩 다시 부른다. */
async function multi(kws) {
  const asked = [...new Set(kws.map(k => k.trim()).filter(Boolean))].slice(0, 30);
  if (!asked.length) throw Object.assign(new Error("키워드가 비었다"), { code: 400 });
  const found = {}, miss = [];
  const take = (list, group) => {
    for (const k of group) {
      const h = cleanHint(k);
      const x = list.find(r => same(r.relKeyword, k)) || list.find(r => same(r.relKeyword, h));
      if (x) found[k] = rowOf(x);
    }
  };
  for (let i = 0; i < asked.length; i += 5) {
    const group = asked.slice(i, i + 5);
    const hints = group.map(cleanHint).filter(Boolean);
    const r = await ad("GET", "/keywordstool", { qs: "?hintKeywords=" + hints.map(encodeURIComponent).join(",") + "&showDetail=1" });
    if (r.ok) take(r.json?.keywordList || [], group);
    else if (r.status === 429) throw Object.assign(new Error("네이버 호출 한도에 걸렸다. 잠시 뒤 다시."), { code: 502 });
    else for (const k of group) {
      const one = await ad("GET", "/keywordstool", { query: { hintKeywords: cleanHint(k), showDetail: "1" } });
      if (one.ok) take(one.json?.keywordList || [], [k]);
      await sleep(200);
    }
    await sleep(200);
  }
  for (const k of asked) if (!found[k]) miss.push(k);
  const rows = Object.values(found);
  const uniq = [...new Set(rows.map(x => x.kw))];
  const [{ bids, ad5: med }, shop] = await Promise.all([bidsFor(uniq), shopIdxFor(uniq)]);
  const perf = await perfFor(uniq, bids);
  return { at: new Date().toISOString(), asked, found: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.kw])),
           miss, related: rows, bids, med, shop, perf };
}

/* ── 추세 · 쇼핑 구매층 (NAVER API HUB) ──
   아이템스카우트 종합차트와 같은 원본이다.
     검색어 트렌드  /search-trend/v1/search            3년 일간 상대지수
     쇼핑 인사이트  /shopping/v1/category/keywords     3년 일간 클릭 상대지수
                    /shopping/v1/category/keyword/{device,gender,age}   최근 1년 클릭 비율
   상대지수(0~100)라서 절대값은 화면에서 '최근 30일 검색수'에 맞춰 환산한다. */
async function hub(p, body) {
  try {
    const res = await fetch(HUB_HOST + p, { method: "POST",
      headers: { "X-NCP-APIGW-API-KEY-ID": HUB_ID, "X-NCP-APIGW-API-KEY": HUB_SECRET, "Content-Type": "application/json" },
      body: JSON.stringify(body) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    const bad = !res.ok || !!(json && (json.errorCode || json.errorMessage || json.error));
    return { ok: !bad, status: res.status, json, text };
  } catch (e) { return { ok: false, status: "연결실패", json: null, text: String(e.message || e) }; }
}
const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/* 네이버는 값이 0 인 날을 빼고 준다. 빈 날을 0 으로 채워 하루 한 칸을 맞춘다. */
function dense(data, start, end) {
  const m = new Map((data || []).map(d => [d.period, d.ratio]));
  const v = [];
  for (let d = new Date(start + "T00:00:00"); ymd(d) <= end; d = addDays(d, 1)) v.push(+(m.get(ymd(d)) || 0).toFixed(3));
  return v;
}
function share(data) {
  const sum = {};
  for (const d of data || []) sum[d.group] = (sum[d.group] || 0) + (+d.ratio || 0);
  const tot = Object.values(sum).reduce((a, b) => a + b, 0);
  if (!tot) return null;
  return Object.fromEntries(Object.entries(sum).map(([g, v]) => [g, +(v / tot * 100).toFixed(1)]));
}
async function insight(kw, fresh) {
  kw = String(kw).trim().slice(0, 40);
  if (!kw) throw Object.assign(new Error("키워드가 비었다"), { code: 400 });
  const file = path.join(CACHE, "insight-" + encodeURIComponent(kw.replace(/\s+/g, "")) + ".json");
  if (!fresh) {
    try {
      const c = JSON.parse(await fsp.readFile(file, "utf8"));
      if (Date.now() - Date.parse(c.at) < INSIGHT_MIN * 60000) return { ...c, cached: true };
    } catch {}
  }
  const end = ymd(addDays(new Date(), -1));                       // 오늘 것은 아직 덜 찼다
  const s3 = new Date(end + "T00:00:00"); s3.setFullYear(s3.getFullYear() - 3);
  const start = ymd(addDays(s3, 1));
  const s1 = new Date(end + "T00:00:00"); s1.setFullYear(s1.getFullYear() - 1);
  const start1 = ymd(addDays(s1, 1));
  const out = { at: new Date().toISOString(), kw, cat: CAT, start, end, start1, errors: {} };
  const why = r => (r.status === 401 || r.status === 403) ? "API HUB 가 키를 거부했다" : r.status === 429 ? "호출 한도" : "응답 " + r.status;

  const s = await hub("/search-trend/v1/search", { startDate: start, endDate: end, timeUnit: "date",
    keywordGroups: [{ groupName: kw, keywords: [kw] }] });
  if (s.ok) out.search = dense(s.json?.results?.[0]?.data, start, end);
  else out.errors.search = why(s) + " " + safe(s.text).slice(0, 100);
  await sleep(120);

  const c = await hub("/shopping/v1/category/keywords", { startDate: start, endDate: end, timeUnit: "date",
    category: CAT, keyword: [{ name: kw, param: [kw] }] });
  if (c.ok) {
    const d = c.json?.results?.[0]?.data || [];
    if (d.length) out.click = dense(d, start, end); else out.errors.click = "쇼핑 클릭 기록이 없다 (식품 분야 기준)";
  } else out.errors.click = why(c) + " " + safe(c.text).slice(0, 100);

  for (const dim of ["device", "gender", "age"]) {
    await sleep(120);
    const r = await hub("/shopping/v1/category/keyword/" + dim, { startDate: start1, endDate: end, timeUnit: "month",
      category: CAT, keyword: kw });
    if (r.ok) { const v = share(r.json?.results?.[0]?.data); if (v) out[dim] = v; else out.errors[dim] = "기록 없음"; }
    else out.errors[dim] = why(r);
  }
  if (out.search || out.click || out.device) {
    await fsp.mkdir(CACHE, { recursive: true });
    await fsp.writeFile(file, JSON.stringify(out), "utf8");
  }
  return { ...out, cached: false };
}

/* ── 엑셀 분석 저장 ── */
async function listUploads() {
  try {
    const names = (await fsp.readdir(UPLOADS)).filter(f => f.endsWith(".json"));
    const out = [];
    for (const n of names) {
      try { out.push(JSON.parse(await fsp.readFile(path.join(UPLOADS, n), "utf8"))); } catch {}
    }
    return out.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  } catch { return []; }
}
async function saveUpload(obj) {
  if (!obj || !obj.file || !Array.isArray(obj.rows)) throw Object.assign(new Error("모양이 맞지 않는다"), { code: 400 });
  const id = crypto.createHash("sha1").update(obj.file + "|" + obj.kind).digest("hex").slice(0, 12);
  const rec = { id, file: String(obj.file).slice(0, 200), kind: obj.kind, rows: obj.rows,
                savedAt: new Date().toISOString() };
  /* 키워드도구·아이템스카우트 엑셀은 기준 시각과 덮어쓰기 전 값을 같이 둬야 다시 적용할 수 있다 */
  if (obj.at) rec.at = String(obj.at).slice(0, 40);
  if (obj.before && typeof obj.before === "object") rec.before = obj.before;
  if (obj.inbox && typeof obj.inbox === "object") rec.inbox = { dir: String(obj.inbox.dir).slice(0, 40), mtime: +obj.inbox.mtime || 0 };
  await fsp.mkdir(UPLOADS, { recursive: true });
  await fsp.writeFile(path.join(UPLOADS, id + ".json"), JSON.stringify(rec), "utf8");
  return rec;
}

/* ── 정적 파일 ── */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml" };
/* 내줄 수 있는 파일만 연다. key.txt 같은 것이 새면 안 된다. */
const PUBLIC = /^(keyword-lab\.html|xlsx-lab\.js|data-[a-z]+(-[0-9]+)?\.js)$/;

const send = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
};
const readBody = req => new Promise((ok, no) => {
  let n = 0; const parts = [];
  req.on("data", c => { n += c.length; if (n > 20 * 1048576) { no(new Error("너무 크다")); req.destroy(); } else parts.push(c); });
  req.on("end", () => ok(Buffer.concat(parts).toString("utf8")));
  req.on("error", no);
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  try {
    if (u.pathname === "/api/ping") return send(res, 200, { ok: true, keys: !!(KEY && SECRET && CUSTOMER), hub: !!(HUB_ID && HUB_SECRET) });
    if (u.pathname === "/api/multi") {
      if (!(KEY && SECRET && CUSTOMER)) return send(res, 500, { error: "key.txt 에 검색광고 키가 없다." });
      return send(res, 200, await multi((u.searchParams.get("kws") || "").split(/[,\n]/)));
    }
    if (u.pathname === "/api/insight") {
      if (!(HUB_ID && HUB_SECRET)) return send(res, 500, { error: "key.txt 에 API HUB 키(B 칸)가 없다." });
      return send(res, 200, await insight(u.searchParams.get("kw") || "", u.searchParams.get("fresh") === "1"));
    }
    if (u.pathname === "/api/live") {
      if (!(KEY && SECRET && CUSTOMER)) return send(res, 500, { error: "key.txt 에 검색광고 키가 없다." });
      const kw = (u.searchParams.get("kw") || "").trim();
      return send(res, 200, await lookup(kw, u.searchParams.get("fresh") === "1", u.searchParams.get("wide") === "1"));
    }
    /* 판정 기록 — 내린 판정과 실제 결과. 이 PC 의 naver-out/verdict-log.json 하나에 통째로 둔다 */
    if (u.pathname === "/api/log" && req.method === "GET") {
      try { return send(res, 200, JSON.parse(await fsp.readFile(path.join(OUTDIR, "verdict-log.json"), "utf8"))); }
      catch { return send(res, 200, []); }
    }
    if (u.pathname === "/api/log" && req.method === "POST") {
      const list = JSON.parse(await readBody(req));
      if (!Array.isArray(list)) throw Object.assign(new Error("모양이 맞지 않는다"), { code: 400 });
      await fsp.mkdir(OUTDIR, { recursive: true });
      const f = path.join(OUTDIR, "verdict-log.json");
      await fsp.writeFile(f + ".tmp", JSON.stringify(list), "utf8"); await fsp.rename(f + ".tmp", f);
      return send(res, 200, { ok: true, n: list.length });
    }
    if (u.pathname === "/api/inbox" && req.method === "GET") return send(res, 200, { root: "넣는곳", dirs: INBOX_DIRS, files: await listInbox() });
    if (u.pathname === "/api/inbox/file" && req.method === "GET") {
      const d = u.searchParams.get("dir") || "", n = path.basename(u.searchParams.get("name") || "");
      if (!INBOX_DIRS.includes(d) || !/\.xlsx$/i.test(n)) { res.writeHead(404); return res.end("없다"); }
      const f = path.join(INBOX, d, n);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end("없다"); }
      res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
      return fs.createReadStream(f).pipe(res);
    }
    if (u.pathname === "/api/uploads" && req.method === "GET") return send(res, 200, await listUploads());
    if (u.pathname === "/api/uploads" && req.method === "POST")
      return send(res, 200, await saveUpload(JSON.parse(await readBody(req))));
    if (u.pathname.startsWith("/api/uploads/") && req.method === "DELETE") {
      const id = u.pathname.split("/").pop().replace(/[^a-f0-9]/g, "");
      await fsp.rm(path.join(UPLOADS, id + ".json"), { force: true });
      return send(res, 200, { ok: true });
    }
    let name = decodeURIComponent(u.pathname.replace(/^\/+/, "")) || "keyword-lab.html";
    if (!PUBLIC.test(name)) { res.writeHead(404); return res.end("없다"); }
    let file = path.join(HERE, name);
    if (!fs.existsSync(file) && name.startsWith("data-")) file = path.join(HERE, "webdata", name);
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end("없다"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, e.code || 500, { error: String(e.message || e) });
  }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  슈퍼프룻 키워드랩 · 실시간\n  http://127.0.0.1:${PORT}\n`);
  console.log(KEY && SECRET && CUSTOMER
    ? "  검색광고 키 확인. 검색하면 네이버에서 바로 받아온다."
    : "  ※ key.txt 에 검색광고 키가 없다. 실시간 조회는 안 되고 수집본만 보인다.");
  console.log(HUB_ID && HUB_SECRET
    ? "  API HUB 키 확인. 종합차트 · 쇼핑 구매층도 바로 받아온다."
    : "  ※ key.txt 에 API HUB 키(B 칸)가 없다. 종합차트는 9월 수집본으로만 그린다.");
  console.log(`  같은 키워드는 ${CACHE_MIN}분 안에 다시 부르지 않는다. 새로 받으려면 화면의 ↻ 를 눌러라.`);
  console.log("  이 창을 닫으면 서버도 꺼진다.\n");
  /* 서버가 귀를 연 뒤에 브라우저를 띄운다. 먼저 띄우면 "연결할 수 없음" 이 뜬다. */
  if (process.argv.includes("--open")) {
    const url = `http://127.0.0.1:${PORT}/`;
    const cmd = process.platform === "win32" ? `start "" "${url}"`
              : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
server.on("error", e => {
  if (e.code === "EADDRINUSE") {
    console.log(`\n  ${PORT} 번이 이미 쓰이고 있다. 키워드랩이 벌써 켜져 있을 수 있다.`);
    console.log(`  브라우저에서 http://127.0.0.1:${PORT} 를 열어봐라.\n`);
    if (process.argv.includes("--open"))
      exec(process.platform === "win32" ? `start "" "http://127.0.0.1:${PORT}/"` : `true`, () => {});
  } else console.log("  서버 오류: " + e.message);
});
