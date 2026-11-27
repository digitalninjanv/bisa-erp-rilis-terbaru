import { chromium } from "@playwright/test";
const BASE="http://127.0.0.1:3000";
const cookie={name:"better-auth.session_token",value:"xQ6RsUbS7mfIWfD8rq2UqNOX9ah6lbbn.kn1MM8yVFKi26brgnNUqGoXquVdkPvNcMurQ7W3lpxk%3D",domain:"127.0.0.1",path:"/",httpOnly:true,expires:1796343121};
const b=await chromium.launch();
const results={};

for (const width of [390,360]) {
  const ctx=await b.newContext({baseURL:BASE,viewport:{width,height:844}}); await ctx.addCookies([cookie]); const p=await ctx.newPage();
  await p.goto("/app",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(1200);
  results[`homeHeader${width}`]=await p.evaluate(() => {
    const header=document.querySelector("header");
    const right=[...header.querySelectorAll("a,button")].map(el=>({label:el.getAttribute("aria-label")||el.textContent?.trim().slice(0,20),right:el.getBoundingClientRect().right,visible:el.getBoundingClientRect().width>0})).filter(x=>x.visible);
    return {innerWidth:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,maxRight:Math.max(...right.map(x=>x.right)),userMenu:right.find(x=>x.label==="Menu pengguna" || x.label?.startsWith("Nadia"))};
  });
  await ctx.close();
}

{
  const ctx=await b.newContext({baseURL:BASE,viewport:{width:1440,height:900}}); await ctx.addCookies([cookie]); const p=await ctx.newPage();
  await p.goto("/app",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(900);
  const trigger=p.getByRole("button",{name:/Cari apa saja/}); await trigger.click(); await p.waitForTimeout(300);
  const inside=[]; for(let i=0;i<14;i++){ await p.keyboard.press("Tab"); inside.push(await p.evaluate(()=>Boolean(document.activeElement?.closest('[role="dialog"]')))); }
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  results.commandPalette={allTabsInside:inside.every(Boolean),dialogClosed:await p.locator('[role="dialog"]').count()===0,focusReturned:await trigger.evaluate(el=>document.activeElement===el)};
  await ctx.close();
}

{
  const ctx=await b.newContext({baseURL:BASE,viewport:{width:1440,height:900}}); await ctx.addCookies([cookie]); const p=await ctx.newPage();
  await p.goto("/app/gudang/produk?q=air&category=01a208bc-3972-79da-b5e2-615118fe1154&warehouse=01a208bc-389b-7a54-b7ec-6be5a37fc26b",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(1200);
  await p.getByRole("link",{name:"Stok menipis"}).click(); await p.waitForTimeout(900);
  const url=new URL(p.url()); results.productFilter={category:url.searchParams.get("category"),warehouse:url.searchParams.get("warehouse"),q:url.searchParams.get("q"),lowStock:url.searchParams.get("lowStock")};

  await p.goto("/app/pengaturan?tab=lokasi",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(900);
  const link=p.getByRole("link",{name:/Ubah di Tab Umum/}); const has=await link.count();
  if(has){ await link.click(); await p.waitForTimeout(1000); results.settingsShortcut={url:p.url(),targetExists:await p.locator("#kebijakan-stok").count()>0,scrollY:await p.evaluate(()=>window.scrollY)}; }
  else results.settingsShortcut={linkMissing:true};

  await p.goto("/app/akuntansi/jurnal/baru",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(900);
  await p.getByLabel(/Keterangan/).fill("Uji batal aman");
  await p.getByRole("button",{name:"Batal",exact:true}).click(); await p.waitForTimeout(300);
  results.journalCancel={dialog:await p.getByRole("dialog").count()>0,title:await p.getByText("Batalkan jurnal ini?").count()>0};

  await p.goto("/app/pos/nota/01a21b35-b101-73b5-a52e-2807121f8ae9",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(1000);
  const body=await p.locator("body").innerText(); results.receipt={itemCount:body.includes("Jumlah item"),status:body.includes("Status")&&body.includes("LUNAS")};
  await p.screenshot({path:"audit/checks/system-ux/nota-after.png"});
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(results,null,2));
