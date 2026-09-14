import { chromium } from "playwright";
const b=await chromium.launch({executablePath:process.env.PW_EXE});
const p=await b.newPage({viewport:{width:1280,height:1500}});
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto("file:///home/user/lottolab/super_fruit/prototype/keyword-lab.html");
await p.waitForFunction(()=>document.querySelectorAll("#kwBody tr").length>0,{timeout:40000});

console.log("① 품목 칩을 누르면 그 품목 자체가 나오는가");
const names = await p.evaluate(()=>[...document.querySelectorAll(".hchip:not(.more)")].map(x=>x.querySelector("span").textContent));
let bad=0;
for (let i=0;i<Math.min(12,names.length);i++){
  const chip=p.locator(".hchip:not(.more)").nth(i);
  await chip.click(); await p.waitForTimeout(250);
  const hero=await p.textContent(".hero-kw");
  const ok = hero===names[i];
  if(!ok) bad++;
  console.log(`  ${ok?"O":"X"} ${names[i].padEnd(10)} → ${hero}`);
  await chip.click(); await p.waitForTimeout(120);
}
console.log(`  ${Math.min(12,names.length)}개 중 ${Math.min(12,names.length)-bad}개 일치\n`);

console.log("② 섹션을 바꾸면 품목 바로가기도 바뀌는가");
for (const [idx,label] of [[1,"과일·채소"],[3,"수산물"],[4,"축산물"]]) {
  await p.locator(".schip").nth(idx).click(); await p.waitForTimeout(400);
  const ns=await p.evaluate(()=>[...document.querySelectorAll(".hchip:not(.more)")].map(x=>x.querySelector("span").textContent).slice(0,8));
  console.log(`  ${label.padEnd(8)} → ${ns.join(" · ")}`);
  await p.locator(".schip").nth(idx).click(); await p.waitForTimeout(200);
}
console.log();
console.log("③ 입찰가 카드에 PC·모바일 둘 다 나오는가");
await p.fill("#exact","나주배"); await p.click("#exactGo"); await p.waitForTimeout(400);
console.log("  "+(await p.evaluate(()=>{
  const t=document.querySelector(".bidtab"); if(!t) return "없음";
  return [...t.querySelectorAll(".bidrow")].map(r=>r.querySelector("b").textContent+" "+[...r.querySelectorAll("span")].map(s=>s.textContent.replace(/(\d위)/,"$1 ")).join(" / ")).join("   |   ");
})));
console.log("\n가로넘침", await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth));
console.log(errs.length?"오류: "+errs.join(";"):"콘솔 오류 없음");
await p.locator("#hcards").screenshot({path:"cards2.png"});
await b.close();
