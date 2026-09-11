import { chromium } from "playwright";
import fs from "node:fs";
const E = JSON.parse(fs.readFileSync("expect.json","utf8"));
const b = await chromium.launch({executablePath:process.env.PW_EXE});
const p = await b.newPage({viewport:{width:1280,height:1200}});
const errs=[]; p.on("pageerror",e=>errs.push(String(e.message)));
await p.goto("file:///home/user/lottolab/super_fruit/prototype/keyword-lab.html");
await p.waitForTimeout(1200);

const kpiMargin = await p.evaluate(()=>document.querySelectorAll("#kpi .v-v")[0].textContent);
console.log("마진        화면", kpiMargin, " | 원본", Math.round(E.margin).toLocaleString("ko-KR")+"원");

let bad=0, n=0;
for (const [kw, e] of Object.entries(E.kw)) {
  await p.fill("#exact", kw); await p.click("#exactGo"); await p.waitForTimeout(250);
  const got = await p.evaluate(()=>{
    const cards=[...document.querySelectorAll(".hc")];
    const txt=c=>({ v:c.querySelector(".hc-v").textContent.trim(),
                    sp:[...c.querySelectorAll(".hc-sv")].map(x=>x.textContent.trim()) });
    return { kw: document.querySelector(".hero-kw").textContent,
             search:txt(cards[0]), becvr:txt(cards[1]), comp:txt(cards[2]),
             click:txt(cards[3]), ctr:txt(cards[4]), bid:txt(cards[5]) };
  });
  const num = s => Number(String(s).replace(/[^0-9.]/g,""));
  const checks = [
    ["키워드", got.kw, kw],
    ["검색수", num(got.search.v), e.tot],
    ["PC/MO", got.search.sp.map(num).join("/"), [e.pc,e.mo].join("/")],
    ["클릭수", num(got.click.v), e.clicks],
    ["CTR", got.ctr.sp.map(num).join("/"), [e.ctrPc,e.ctrMo].join("/")],
    ["입찰가", got.bid.sp.map(num).join("/"), e.bm.join("/")],
    ["광고깊이", num(got.comp.sp[0]), e.depth],
    ["손익분기", got.becvr.sp.map(num).join("/"), e.becvr.join("/")],
  ];
  const fails = checks.filter(([,a,x])=>String(a)!==String(x));
  n++;
  if (fails.length){ bad++; console.log(`  X ${kw}`); fails.forEach(([k,a,x])=>console.log(`      ${k}: 화면 ${a}  ≠  원본 ${x}`)); }
  else console.log(`  O ${kw}  검색 ${e.tot.toLocaleString()} · 손익분기3위 ${e.becvr[2]}%`);
}
console.log(`\n${n}개 중 ${n-bad}개 일치` + (errs.length?"\n오류: "+errs.join("; "):""));
await b.close();
