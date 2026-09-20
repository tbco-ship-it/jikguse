// For each unique (u1,u2) in kan_info.jsonl: fetch lowasp warehousing-fee + fulfillment-fee tables (they include the plain promo table
// for non-eligible categories) → fee_tables.jsonl. Tab p9 (space 4). Loops until kan2 crawl ends; STOP file.
const fs = await import('node:fs');
const DIR = '/Users/aiden/.buzz-dev/.scratch/ori/rg';
const outPath = DIR+'/fee_tables.jsonl';
const log = (m)=>fs.appendFileSync(DIR+'/crawl_fees.log', new Date().toISOString()+' '+m+'\n');
const _sp = (await listTaskSpaces()).find(s=>s.name==='ori-rg');
const task = _sp ? await taskSpace(_sp.id) : await taskSpace('ori-rg');
const page = await task.newPage();
if (!/wing\.coupang\.com/.test(await page.url())) { await page.goto('https://wing.coupang.com/tenants/rfm/settlements/fee-details'); await page.waitForLoadState(); await page.waitForTimeout(3000); }
const START = new Date().toISOString();
let idle = 0;
while (true) {
  if (fs.existsSync(DIR+'/STOP')) { log('stop'); break; }
  const done = new Set(fs.existsSync(outPath) ? fs.readFileSync(outPath,'utf8').split('\n').filter(Boolean).map(l=>{const o=JSON.parse(l); return o.u1+'|'+o.u2;}) : []);
  const pairs = [...new Set(fs.readFileSync(DIR+'/kan_info.jsonl','utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(o=>o.u1).map(o=>o.u1+'|'+o.u2))].filter(p=>!done.has(p));
  const k2 = (fs.readFileSync(DIR+'/crawl_kan2.log','utf8').split('\n').filter(Boolean).pop()||'');
  if (!pairs.length) { if (/ end$/.test(k2) && k2.slice(0,24) > START) { log('kan2 ended, all pairs done'); break; } idle++; await page.waitForTimeout(20000); continue; }
  for (const p of pairs) {
    if (fs.existsSync(DIR+'/STOP')) break;
    const [u1,u2] = p.split('|');
    let res;
    try {
      res = await page.evaluate(async({u1,u2})=>{
        const x = (document.cookie.match(/XSRF-TOKEN=([^;]+)/)||[])[1];
        const H = {'content-type':'application/json','accept':'application/json, text/plain, */*','X-XSRF-TOKEN':x};
        const body = JSON.stringify({agreementScope:'PRODUCTION',leafKanCategoryIds:[],unit1Unit2CategoryNames:[{unit1CategoryName:u1,unit2CategoryName:u2}]});
        const o={u1,u2};
        for (const ep of ['lowasp/warehousing-fee','lowasp/fulfillment-fee','revamp/warehousing-fee','revamp/fulfillment-fee']) {
          try { const r=await fetch('/tenants/rfm/accounting-fee/'+ep,{method:'POST',headers:H,body,credentials:'include'}); o[ep]=r.ok? await r.json() : {status:r.status}; } catch(e){ o[ep]={err:String(e).slice(0,60)}; }
        }
        return o;
      }, {u1,u2});
    } catch(e) { log('evaluate error '+e.message); await page.waitForTimeout(5000); continue; }
    fs.appendFileSync(outPath, JSON.stringify(res)+'\n');
    log(`pair ${p} ok=${!!(res['lowasp/warehousing-fee']||{}).feeRatesBySingleCategoryResponseV1}`);
    await page.waitForTimeout(400);
  }
}
log('end');
await page.close();
