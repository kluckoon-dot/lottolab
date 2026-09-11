import { chromium } from "playwright";
const b=await chromium.launch({executablePath:process.env.PW_EXE});
const p=await b.newPage({viewport:{width:1280,height:1400}});
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto("file:///home/user/lottolab/super_fruit/prototype/keyword-lab.html");
await p.waitForTimeout(1200);
await p.click(".hchip.more");                    // 전부 펼쳐 놓고 고른다
await p.waitForTimeout(300);
const names = await p.evaluate(()=>[...document.querySelectorAll(".hchip:not(.more) span:first-child")].map(s=>s.textContent));
console.log("품목 칩", names.length, "개 · 앞 10개:", names.slice(0,10).join(" "));
let bad=0, n=0;
for (const nm of names.slice(0,14)) {
  const chip = p.locator(".hchip:not(.more)").nth(names.indexOf(nm));
  await chip.click(); await p.waitForTimeout(260);
  const r = await p.evaluate(()=>({
    kw: document.querySelector(".hero-kw").textContent,
    sub: document.querySelector(".hero-sub").textContent,
    count: document.querySelector("#count").textContent,
    rows: [...document.querySelectorAll("#kwBody .kw")].slice(0,5).map(e=>e.childNodes[0].textContent.trim())
  }));
  n++;
  const heroOk = r.kw.includes(nm) || nm==="기타";
  const rowsOk = nm==="기타" || r.rows.every(k=>k.includes(nm));
  if(!heroOk||!rowsOk){ bad++; console.log(`  X ${nm}  히어로=${r.kw}  목록=${r.rows.join(",")}`); }
  else console.log(`  O ${nm.padEnd(8)} 히어로 ${r.kw.padEnd(14)} 목록 ${r.rows.slice(0,3).join(" · ")}`);
  await chip.click(); await p.waitForTimeout(150);   // 해제
}
console.log(`\n${n}개 중 ${n-bad}개 일치` + (errs.length?"  오류: "+errs.join(";"):"  콘솔오류 없음"));
await b.close();
