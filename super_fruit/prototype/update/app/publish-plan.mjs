#!/usr/bin/env node
/**
 * 저장본(claude.ai 아티팩트)에 올릴 묶음을 짠다 (2026-10-29)
 *
 * 왜
 *   한 번 올리기는 64MB · 255개, 한 버전은 256MB 까지 담는다. 10/29 자료가 304MB 가 되어 연관 · 사전 묶음은
 *   gzip + base64 한 z/*.txt(pack-z.mjs)로 올린다. 그 전에 올라간 data-rel-N.js · data-dict-N.js 는 저장본에서 빼야 자리가 난다.
 *
 * 실행:  node publish-plan.mjs [올라간목록.txt] --out plan.json
 *        올라간목록.txt = Artifact list(scope files)의 경로를 한 줄에 하나 — 주면 이제 안 쓰는 경로를 null 로 뺀다
 * 결과:  [{ label, files: { 경로: 경로 | { from, contentType } | null } }, ...]
 *        root 는 app 폴더, file_path 는 keyword-lab.html. 차례대로 올리고, data-head.js 는 마지막 묶음에 든다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIM = 60 * 1048576, MAXN = 250;
const num = f => +(f.match(/(\d+)\.\w+$/) || [0, 0])[1];
const bins = fs.readdirSync(path.join(HERE, "z")).filter(f => /^data-(rel|dict)-\d+\.txt$/.test(f))
  .sort((a, b) => (a.includes("dict") - b.includes("dict")) || num(a) - num(b)).map(f => "z/" + f);
const main = ["data-kw.js", "data-meta.js", "data-relidx.js", "data-trend.js", "data-click.js", "data-shop.js", "data-head.js"];
const size = p => fs.statSync(path.join(HERE, p)).size;

/* 올라가 있는데 이제 안 쓰는 것 */
/* 한 줄에 경로 하나 — list 결과 줄(- "경로"  형식  크기)을 그대로 붙여도 따옴표 안의 경로만 쓴다 */
const live = process.argv[2] ? fs.readFileSync(process.argv[2], "utf8").replace(/^﻿/, "").split(/\r?\n/)
  .map(s => { const m = s.match(/"([^"]+)"/); return m ? m[1] : s.trim().replace(/^-\s*/, "").split(/\s+/)[0]; }).filter(Boolean) : [];
const want = new Set(bins);
const drop = live.filter(p => /^data-(rel|dict)-\d+\.js$/.test(p) || (/^z\//.test(p) && !want.has(p)));

const out = []; let cur = {}, n = 0, tot = 0;
const flush = () => { if (n) out.push(cur); cur = {}; n = 0; tot = 0; };
const put = (k, v, z) => { if (n && (n + 1 > MAXN || tot + z > LIM)) flush(); cur[k] = v; n++; tot += z; };
for (const p of drop) put(p, null, 0);
for (const p of bins) put(p, p, size(p));
for (const p of main) put(p, p, size(p));
flush();
const res = out.map((files, i) => ({ label: `${i + 1}/${out.length}`, n: Object.keys(files).length,
  mb: +(Object.entries(files).reduce((s, [k, v]) => s + (v ? size(k) : 0), 0) / 1048576).toFixed(1), files }));
const all = bins.concat(main).reduce((s, p) => s + size(p), 0) + size("keyword-lab.html");
console.error(`올릴 것 ${bins.length + main.length}개 · ${(all / 1048576).toFixed(1)} MB (한 버전 256 MB 까지) · 뺄 것 ${drop.length}개 · 묶음 ${res.length}번`);
/* --out 파일 이면 그 파일에 쓴다(UTF-8) — PowerShell 의 > 는 글자 인코딩을 바꿀 수 있다 */
const oi = process.argv.indexOf("--out");
if (oi > 0) fs.writeFileSync(process.argv[oi + 1], JSON.stringify(res), "utf8"); else console.log(JSON.stringify(res));
