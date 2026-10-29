#!/usr/bin/env node
/**
 * 연관 목록 묶음(data-rel-N.js) · 사전 묶음(data-dict-N.js)을 gzip 해 base64 글자로 적은 z/*.txt 로 만든다 (2026-10-29)
 *
 * 왜
 *   저장본(claude.ai 아티팩트) 한 버전은 256MB 까지만 담는다. 10/29 매일 수집에서 연관 목록 묶음 199MB + 사전 묶음 81MB 로
 *   모두 304MB 가 되어 올리기가 거부됐다. 묶음은 글자 자료라 gzip 하면 약 1/3 로 준다.
 *   저장본은 .bin 같은 이진 파일을 받지 않는다(글자 · 그림 · 글꼴 · 소리 형식만) — 그래서 base64 글자로 적는다(gzip 보다 1/3 크다).
 *   화면(keyword-lab.html partLoad)은 https 로 열렸을 때 z/*.txt 를 받아 풀고, PC 에서 열면 원래 .js 를 읽는다.
 *
 * 무엇을
 *   묶음 .js 를 읽어 그 안의 자료(window.RELPART[N] · window.KWDICT[N])만 JSON 으로 꺼내 gzip → base64 → app/z/data-rel-N.txt · data-dict-N.txt
 *   .txt 가 .js 보다 새것이면 건너뛴다. .js 가 없어진 .txt 는 지운다.
 *
 * 실행:  node pack-z.mjs          (매일 수집 bat 끝에서 부른다)
 *        node pack-z.mjs --all    (전부 다시)
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const Z = path.join(HERE, "z");
const ALL = process.argv.includes("--all");
const require = createRequire(import.meta.url);
fs.mkdirSync(Z, { recursive: true });

const parts = fs.readdirSync(HERE).map(f => f.match(/^data-(rel|dict)-(\d+)\.js$/)).filter(Boolean);
let made = 0, skip = 0, rawB = 0, zB = 0;
for (const [f, kind, n] of parts) {
  const src = path.join(HERE, f), dst = path.join(Z, "data-" + kind + "-" + n + ".txt");
  const st = fs.statSync(src);
  rawB += st.size;
  if (!ALL && fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= st.mtimeMs) { skip++; zB += fs.statSync(dst).size; continue; }
  globalThis.window = {};
  delete require.cache[src]; require(src);
  const o = kind === "rel" ? window.RELPART?.[n] : window.KWDICT?.[n];
  if (!o) { console.error("[X] " + f + " 에서 자료를 못 읽었다"); process.exit(1); }
  const txt = zlib.gzipSync(Buffer.from(JSON.stringify(o), "utf8"), { level: 9 }).toString("base64");
  fs.writeFileSync(dst + ".tmp", txt, "ascii"); fs.renameSync(dst + ".tmp", dst);
  made++; zB += txt.length;
}
/* .js 가 없어진 묶음의 .txt 는 지운다(10/29 처음 만든 .bin 도) — 올릴 때 저장본에서도 빼야 한다 */
const have = new Set(parts.map(([, kind, n]) => "data-" + kind + "-" + n + ".txt"));
let gone = 0;
for (const f of fs.readdirSync(Z)) if (/\.(bin|txt)$/.test(f) && !have.has(f)) { fs.unlinkSync(path.join(Z, f)); gone++; }
const MB = b => (b / 1048576).toFixed(1) + " MB";
console.log(`묶음 줄이기  ${parts.length}개 · 새로 ${made} · 그대로 ${skip} · 지움 ${gone} · ${MB(rawB)} → ${MB(zB)} (z/*.txt)`);
