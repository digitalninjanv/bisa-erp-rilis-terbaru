import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const BASE="http://127.0.0.1:3000";
const cookie={name:"better-auth.session_token",value:"xQ6RsUbS7mfIWfD8rq2UqNOX9ah6lbbn.kn1MM8yVFKi26brgnNUqGoXquVdkPvNcMurQ7W3lpxk%3D",domain:"127.0.0.1",path:"/",httpOnly:true,expires:1796343121};
const b=await chromium.launch();
for (const [name,path,w,h] of [["analisa","/app/analisa",1440,900],["pengguna","/app/pengaturan/pengguna",1440,900],["gudang-mobile","/app/gudang",390,844],["payroll-mobile","/app/akuntansi/payroll",390,844]]) {
 const ctx=await b.newContext({baseURL:BASE,viewport:{width:w,height:h}}); await ctx.addCookies([cookie]); const p=await ctx.newPage(); await p.goto(BASE+path,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(2500);
 const res=await new AxeBuilder({page:p}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();
 console.log("====",name);
 for (const v of res.violations) for (const n of v.nodes) console.log(v.id,"|",n.target.join(" "),"|",n.failureSummary?.replace(/\n/g," ").slice(0,600),"|",n.html.slice(0,300));
 await ctx.close();
}
await b.close();
