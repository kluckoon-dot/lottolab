import { chromium } from "playwright";
const b=await chromium.launch({executablePath:process.env.PW_EXE});
const p=await b.newPage({viewport:{width:1280,height:1400}});
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto("file:///home/user/lottolab/super_fruit/prototype/keyword-lab.html");
await p.waitForTimeout(1200);
for (const kw of ["멜론","샤인머스켓","나주배","비즈멜론"]) {
  await p.fill("#exact",kw); await p.click("#exactGo"); await p.waitForTimeout(300);
  const r = await p.evaluate(()=>{
    const box=document.getElementById("buy");
    const bars=[...box.querySelectorAll(".bar2")].map(x=>[...x.children].map(c=>c.dataset.t));
    const ages=[...box.querySelectorAll(".ages i")].map(i=>i.dataset.t);
    return { na: !!box.querySelector(".na"), bars, ages, top:(box.querySelector(".buy-t")||{}).textContent };
  });
  console.log(kw.padEnd(10), r.na ? "데이터 없음 표시" : r.bars.map(x=>x.join(" / ")).join("  |  ") + "  |  " + r.ages.join(" "));
}
console.log("가로넘침", await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth));
await p.fill("#exact","멜론"); await p.click("#exactGo"); await p.waitForTimeout(300);
await p.locator("#buy").screenshot({path:"buy.png"});
const p2=await b.newPage({viewport:{width:390,height:900}});
await p2.goto("file:///home/user/lottolab/super_fruit/prototype/keyword-lab.html");
await p2.waitForTimeout(1000);
console.log("모바일 가로넘침", await p2.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth));
await p2.locator("#buy").screenshot({path:"buym.png"});
console.log(errs.length?"오류: "+errs.join(";"):"콘솔 오류 없음");
await b.close();
