import { chromium } from "@playwright/test";
const b=await chromium.launch();
const pages=[["pos-riwayat","/app/pos/riwayat"],["jurnal-riwayat","/app/akuntansi/jurnal/riwayat"],["pengguna","/app/pengaturan/pengguna"]];
for(const [name,path] of pages){
 for(const [vp,w,h] of [["desktop",1440,900],["mobile",390,844]]){
  const ctx=await b.newContext({baseURL:"http://127.0.0.1:3000",viewport:{width:w,height:h}});
  await ctx.addCookies([{name:"better-auth.session_token",value:"xQ6RsUbS7mfIWfD8rq2UqNOX9ah6lbbn.kn1MM8yVFKi26brgnNUqGoXquVdkPvNcMurQ7W3lpxk%3D",domain:"127.0.0.1",path:"/",httpOnly:true,expires:1796343121}]);
  const p=await ctx.newPage(); const errors=[]; p.on("console",m=>{if(m.type()==="error") errors.push(m.text().slice(0,160));});
  await p.goto(path,{waitUntil:"domcontentloaded",timeout:45000}); await p.waitForTimeout(1500);
  await p.screenshot({path:`audit/checks/system-ux/${name}-${vp}-tanstack.png`});
  console.log(name,vp,"errors",errors.length,errors);
  await ctx.close();
 }
}
await b.close();
