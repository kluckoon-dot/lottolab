/**
 * 받아 둔 네이버 목록 전부(품목 씨앗 · 꼬리 키워드 · 키워드별 목록 · 목록 밖 키워드를 직접 물은 값 related-stats.ndjson)에서 키워드마다 **가장 새로 받은 줄**을 고른다.
 *
 * 같은 키워드라도 받은 날이 다르면 숫자가 다르다(네이버 키워드도구는 최근 30일 값이라 날마다 조금씩 바뀐다).
 * 같은 시각에는 어느 씨앗으로 물어도 같은 숫자가 온다(2026-10-16 확인: 복숭아사과 · 엔부를 씨앗 4~5개로 동시에 물음).
 * 그래서 화면 · 목록 파일이 숫자를 낼 때는 늘 가장 새 줄을 쓴다 — 먼저 만난 목록의 숫자를 쓰면 며칠 전 값이 나온다(엔부 10/12 값 360 → 10/16 값 440).
 *
 *   import { latestRows } from "./naver-latest.mjs";
 *   const L = latestRows(OUTDIR);   // Map 키워드 → { x: [kw, pc, mo, depth, comp, clickPc, clickMo, ctrPc, ctrMo, masked], at, seed }
 */
import fs from "node:fs";
import path from "node:path";

export function latestRows(outdir) {
  const L = new Map();
  const put = (seed, at, rows) => { for (const x of rows || []) { const o = L.get(x[0]); if (!o || String(at) > String(o.at)) L.set(x[0], { x, at, seed }); } };
  const rd = f => { try { return JSON.parse(fs.readFileSync(path.join(outdir, f), "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
  const raw = rd("related-raw.json"); if (raw) for (const [k, v] of Object.entries(raw.seeds || {})) put(k, v.at, v.rows);
  const tl = rd("related-tails.json"); if (tl) for (const [k, v] of Object.entries(tl.seeds || {})) put(k, v.at, v.rows);
  for (const f of ["related-more.ndjson", "related-stats.ndjson", "related-combos.ndjson"]) try {
    for (const line of fs.readFileSync(path.join(outdir, f), "utf8").split("\n")) {
      if (!line.trim()) continue; let j; try { j = JSON.parse(line); } catch { continue; }
      if (j && j.rows) put(j.k || "", j.at, j.rows);
    }
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  return L;
}
