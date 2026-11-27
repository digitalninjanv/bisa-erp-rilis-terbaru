import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const b=await chromium.launch();
for(const [name,path] of [["pos-riwayat","/app/pos/riwayat"],["jurnal-riwayat","/app/akuntansi/jurnal/riwayat"],["pengguna","/app/pengaturan/pengguna"]]){
 for(const [vp,w,h] of [["desktop",1440,900],["mobile",390,844]]){
  const ctx=await b.newContext({baseURL:"http://127.0.0.1:3000",viewport:{width:w,height:h}}); await ctx.addCookies([{name:"better-auth.session_token",value:"xQ6RsUbS7mfIWfD8rq2UqNOX9ah6lbbn.kn1MM8yVFKi26brgnNUqGoXquVdkPvNcMurQ7W3lpxk%3D",domain:"127.0.0.1",path:"/",httpOnly:true,expires:1796343121}]);
  const p=await ctx.newPage(); await p.goto(path,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(1200);
  const v=(await new AxeBuilder({page:p}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze()).violations.map(x=>({id:x.id,nodes:x.nodes.length}));
  console.log(name,vp,JSON.stringify(v)); await ctx.close();
 }
}
await b.close();
