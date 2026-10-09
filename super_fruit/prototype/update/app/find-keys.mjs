#!/usr/bin/env node
/**
 * 네이버 키가 어느 파일에 들어있는지 찾아준다.
 *
 * 값은 절대 출력하지 않는다. 파일 경로와 줄 번호, 변수 이름만 보여준다.
 * 그 파일을 직접 열어서 값을 key.txt 로 옮겨라.
 *
 * 실행:  node find-keys.mjs "찾을 폴더 경로"
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.argv[2] || ".";
const SKIP = new Set(["node_modules",".git","dist","build",".next","out",".wrangler/tmp","coverage"]);
const NAMES = /(NAVER|NCP|CLIENT[_-]?ID|CLIENT[_-]?SECRET|API[_-]?KEY|SECRET[_-]?KEY|ACCESS[_-]?KEY|CUSTOMER[_-]?ID|DATALAB|SEARCHAD|APIGW)/i;
const EXT = /\.(env|vars|toml|jsonc?|ya?ml|txt|ini|cfg|conf|properties|ts|js|mjs|cjs)$/i;
const BARE = /^(\.env.*|\.dev\.vars.*|wrangler\..*|\.npmrc|\.sites-runtime)$/i;

function mask(v){
  v = String(v).trim().replace(/^["']|["']$/g,"");
  if(!v) return "(비어 있음)";
  if(v.length <= 4) return "*".repeat(v.length) + `  (${v.length}자)`;
  return v.slice(0,2) + "*".repeat(Math.min(10, v.length-2)) + `  (${v.length}자)`;
}

let files = 0, hits = 0;
const found = [];

async function walk(dir, depth){
  if(depth > 6) return;
  let ents;
  try { ents = await fs.readdir(dir, { withFileTypes:true }); } catch { return; }
  for(const e of ents){
    const p = path.join(dir, e.name);
    if(e.isDirectory()){
      if(SKIP.has(e.name)) continue;
      await walk(p, depth+1);
    } else {
      if(!(EXT.test(e.name) || BARE.test(e.name))) continue;
      let st; try { st = await fs.stat(p); } catch { continue; }
      if(st.size > 2_000_000) continue;
      let txt; try { txt = await fs.readFile(p,"utf8"); } catch { continue; }
      files++;
      const lines = txt.split(/\r?\n/);
      for(let i=0;i<lines.length;i++){
        const L = lines[i];
        if(L.length > 400) continue;
        if(!NAMES.test(L)) continue;
        /* 줄 첫머리의 KEY=값, 그리고 한 줄짜리 JSON 안의 "KEY": "값" 둘 다 잡는다 */
        const pairs = [];
        const head = L.match(/^\s*(?:export\s+)?["']?([A-Za-z0-9_.-]{3,60})["']?\s*=\s*(.*)$/);
        if(head) pairs.push([head[1], head[2]]);
        const inline = /["']?([A-Za-z0-9_.-]{3,60})["']?\s*:\s*["']([^"']{1,200})["']/g;
        let g; while((g = inline.exec(L))) pairs.push([g[1], g[2]]);
        for(const [key, val] of pairs){
          if(!NAMES.test(key)) continue;
          if(/^\s*(process\.env|import\.meta|env\.|\$|\{\{)/.test(val)) continue;  // 코드에서 읽는 부분은 제외
          const clean = String(val).trim().replace(/^["']|["']$/g,"").replace(/,\s*$/,"");
          if(!clean || /^(여기에|붙여넣|paste|your|xxx+|\.\.\.)/i.test(clean)) continue;
          if(found.some(f=>f.file===(path.relative(ROOT,p)||p) && f.line===i+1 && f.key===key)) continue;
          hits++;
          found.push({ file: path.relative(ROOT,p) || p, line: i+1, key, masked: mask(clean) });
        }
      }
    }
  }
}

console.log("찾는 중...\n");
await walk(ROOT, 0);

if(!found.length){
  console.log(`파일 ${files}개를 뒤졌지만 키로 보이는 값을 못 찾았다.\n`);
  console.log("그렇다면 키가 이 PC 에 없다는 뜻이다. 흔한 경우는 이렇다.");
  console.log("  · Cloudflare Workers 로 배포했다면 키는 Cloudflare 대시보드에 있다");
  console.log("    (wrangler secret 으로 올리면 파일에 안 남는다)");
  console.log("  · 배포 서버의 환경변수로만 넣어뒀다");
  console.log("\n그럼 네이버 클라우드 콘솔에서 다시 복사하는 게 빠르다.");
  console.log("  콘솔 → NAVER API HUB → Application → ssbg-farm-research");
  console.log("  → [인증 정보] 버튼 → Client ID / Client Secret\n");
} else {
  console.log(`파일 ${files}개 중에서 ${hits}건을 찾았다. 값은 가려서 보여준다.\n`);
  const byFile = {};
  for(const f of found) (byFile[f.file] ||= []).push(f);
  for(const [file, list] of Object.entries(byFile)){
    console.log(`  ${file}`);
    for(const f of list) console.log(`     ${String(f.line).padStart(4)}줄  ${f.key.padEnd(28)} = ${f.masked}`);
    console.log("");
  }
  console.log("이 중에서 Client ID / Client Secret 으로 보이는 것을 찾아");
  console.log("해당 파일을 메모장으로 열고 값을 복사해 key.txt 에 넣어라.");
  console.log("\n※ 이 출력에는 값이 안 들어 있다. 그대로 보내줘도 된다.");
  console.log("   값 자체는 절대 채팅에 붙여넣지 마라.\n");
}
