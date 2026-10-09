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
import crypto from "node:crypto";
import { exec } from "node:child_process";

const PORT = +(process.env.PORT || 8787);
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUTDIR = path.join(HERE, "naver-out");
const CACHE = path.join(OUTDIR, "live-cache");
const UPLOADS = path.join(OUTDIR, "uploads");
const CACHE_MIN = +(process.env.LIVE_CACHE_MIN || 180);   // 같은 키워드는 3시간 안에 다시 부르지 않는다

/* ── 키 ── fetch-naver.mjs 와 같은 규칙으로 읽는다 */
const ALIAS = {
  naver_ad_api_key:"KEY", 액세스라이선스:"KEY", 라이선스:"KEY", apikey:"KEY", api_key:"KEY",
  naver_ad_secret:"SECRET", 비밀키:"SECRET", secret:"SECRET", secretkey:"SECRET",
  naver_ad_customer:"CUSTOMER", 고객id:"CUSTOMER", 고객아이디:"CUSTOMER",
  customerid:"CUSTOMER", customer_id:"CUSTOMER", customer:"CUSTOMER"
};
function loadKeys() {
  for (const name of ["key.txt", ".env"]) {
    let raw; try { raw = fs.readFileSync(path.join(HERE, name), "utf8"); } catch { continue; }
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

function sign(method, urlPath) {
  const ts = Date.now().toString();
  const sig = crypto.createHmac("sha256", SECRET).update(`${ts}.${method}.${urlPath}`).digest("base64");
  return { "X-Timestamp": ts, "X-API-KEY": KEY, "X-Customer": String(CUSTOMER),
           "X-Signature": sig, "Content-Type": "application/json; charset=UTF-8" };
}
async function ad(method, urlPath, { query, body } = {}) {
  const qs = query ? "?" + new URLSearchParams(query) : "";
  const res = await fetch(AD_HOST + urlPath + qs, { method, headers: sign(method, urlPath),
    body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const safe = t => { let s = String(t ?? ""); for (const v of [KEY, SECRET, CUSTOMER]) if (v && String(v).length >= 6) s = s.split(v).join("<가림>"); return s; };

/* 네이버는 적은 검색량을 "< 10" 문자열로 준다. 숫자로 바꾸되 가려졌다는 표시를 남긴다. */
const num = v => typeof v === "number" ? v : (parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10) || 0);
const masked = v => typeof v === "string" && /</.test(v);
/* 힌트에는 공백·& · / 가 들어가면 400 이 난다. 실측으로 확인한 규칙이다. */
const cleanHint = s => String(s).replace(/\([^)]*\)/g, "").replace(/[\s&/,·]+/g, "").slice(0, 20);
const same = (a, b) => String(a).replace(/\s+/g, "").toUpperCase() === String(b).replace(/\s+/g, "").toUpperCase();

async function lookup(kw, fresh) {
  const hint = cleanHint(kw);
  if (!hint) throw Object.assign(new Error("키워드가 비었다"), { code: 400 });
  const file = path.join(CACHE, encodeURIComponent(hint) + ".json");
  if (!fresh) {
    try {
      const c = JSON.parse(await fsp.readFile(file, "utf8"));
      if (Date.now() - Date.parse(c.at) < CACHE_MIN * 60000) return { ...c, cached: true };
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
  const list = (r.json?.keywordList || []).map(x => ({
    kw: x.relKeyword,
    pc: num(x.monthlyPcQcCnt), mo: num(x.monthlyMobileQcCnt),
    masked: masked(x.monthlyPcQcCnt) || masked(x.monthlyMobileQcCnt),
    clickPc: +x.monthlyAvePcClkCnt || 0, clickMo: +x.monthlyAveMobileClkCnt || 0,
    ctrPc: +x.monthlyAvePcCtr || 0, ctrMo: +x.monthlyAveMobileCtr || 0,
    depth: num(x.plAvgDepth), comp: x.compIdx || ""
  }));
  const exact = list.find(x => same(x.kw, kw)) || list.find(x => same(x.kw, hint)) || null;

  /* 2. 입찰가 1~3위. 검색한 키워드와 연관 상위 29개까지, 10개씩 묶어 PC·모바일 따로.
        묶음 조회는 9월 수집 때 지원되는 것을 확인했다. */
  const want = [];
  if (exact) want.push(exact.kw);
  list.slice().sort((a, b) => (b.pc + b.mo) - (a.pc + a.mo))
    .forEach(x => { if (want.length < 30 && !want.includes(x.kw)) want.push(x.kw); });
  const bids = {};
  for (let i = 0; i < want.length; i += 10) {
    const g = want.slice(i, i + 10);
    const items = []; for (const k of g) for (const p of [1, 2, 3]) items.push({ key: k, position: p });
    for (const device of ["PC", "MOBILE"]) {
      const b = await ad("POST", "/estimate/average-position-bid/keyword",
        { body: { device, keywordplus: false, key: g[0], items } });
      if (b.ok) for (const e of (b.json?.estimate || [])) {
        const slot = (bids[e.keyword] ||= { pc: [null, null, null], mo: [null, null, null] });
        (device === "PC" ? slot.pc : slot.mo)[e.position - 1] = e.bid;
      }
      await sleep(250);
    }
  }
  const out = { at: new Date().toISOString(), kw, hint, exact, related: list, bids };
  await fsp.mkdir(CACHE, { recursive: true });
  await fsp.writeFile(file, JSON.stringify(out), "utf8");
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
  await fsp.mkdir(UPLOADS, { recursive: true });
  await fsp.writeFile(path.join(UPLOADS, id + ".json"), JSON.stringify(rec), "utf8");
  return rec;
}

/* ── 정적 파일 ── */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml" };
/* 내줄 수 있는 파일만 연다. key.txt 같은 것이 새면 안 된다. */
const PUBLIC = /^(keyword-lab\.html|xlsx-lab\.js|data-[a-z]+\.js)$/;

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
    if (u.pathname === "/api/ping") return send(res, 200, { ok: true, keys: !!(KEY && SECRET && CUSTOMER) });
    if (u.pathname === "/api/live") {
      if (!(KEY && SECRET && CUSTOMER)) return send(res, 500, { error: "key.txt 에 검색광고 키가 없다." });
      const kw = (u.searchParams.get("kw") || "").trim();
      return send(res, 200, await lookup(kw, u.searchParams.get("fresh") === "1"));
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
