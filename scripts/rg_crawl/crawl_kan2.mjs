// KAN id -> commission + unit1/unit2. In-page background queue (fire-and-forget) polled from node, so no 15s evaluate cap. Tab p1, space 4.
const fs = await import('node:fs');
const DIR = '/Users/aiden/.buzz-dev/.scratch/ori/rg';
const outPath = DIR+'/kan_info.jsonl';
const log = (m)=>fs.appendFileSync(DIR+'/crawl_kan2.log', new Date().toISOString()+' '+m+'\n');
const _sp = (await listTaskSpaces()).find(s=>s.name==='ori-rg');
const task = _sp ? await taskSpace(_sp.id) : await taskSpace('ori-rg');
const page = await task.newPage();
if (!/wing\.coupang\.com/.test(await page.url())) { await page.goto('https://wing.coupang.com/tenants/rfm/settlements/fee-details'); await page.waitForLoadState(); await page.waitForTimeout(3000); }
await page.evaluate(()=>{ if (window.__rg) return; const S = window.__rg = { q: [], out: [], busy: 0 };
  const x = (document.cookie.match(/XSRF-TOKEN=([^;]+)/)||[])[1];
  const H = {'content-type':'application/json','accept':'application/json, text/plain, */*','X-XSRF-TOKEN':x};
  const one = async k => { const o={kan:k}; try { const r=await fetch('/tenants/seller-web/v2/vendor-inventory/commission?categoryId='+k,{credentials:'include'}); o.cst=r.status; if(r.ok){const j=await r.json(); o.rate=j.serviceFeeRatio; o.promo=j.promotionInfo;} } catch(e){ o.cerr=String(e).slice(0,50); }
    try { const r=await fetch('/tenants/rfm/accounting-fee/category/search',{method:'POST',headers:H,body:String(k),credentials:'include'}); o.sst=r.status; if(r.ok){const j=await r.json(); o.u1=j.unit1; o.u2=j.unit2; o.kpath=j.fullPathName; o.useq=j.unitCategorySeq;} } catch(e){ o.serr=String(e).slice(0,50); }
    return o; };
  for (let w=0; w<4; w++) (async()=>{ while (true) { if (!S.q.length) { await new Promise(r=>setTimeout(r,300)); continue; } S.busy++; const k=S.q.shift(); try { S.out.push(await one(k)); } catch(e) { S.out.push({kan:k,err:String(e)}); } S.busy--; } })();
});
let idle = 0, pushed = new Set();
while (true) {
  if (fs.existsSync(DIR+'/STOP')) { log('stop'); break; }
  // drain results
  const got = await page.evaluate(()=>{ const o = window.__rg.out.splice(0); return o; });
  if (got.length) { fs.appendFileSync(outPath, got.map(o=>JSON.stringify(o)).join('\n')+'\n'); }
  const done = new Set(fs.existsSync(outPath) ? fs.readFileSync(outPath,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l).kan) : []);
  const kans = [...new Set(fs.readFileSync(DIR+'/kan_map.jsonl','utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l).kan).filter(k=>k && !done.has(k) && !pushed.has(k)))];
  const qlen = await page.evaluate(()=>window.__rg.q.length + window.__rg.busy);
  if (kans.length && qlen < 40) { const chunk = kans.slice(0, 100); chunk.forEach(k=>pushed.add(k)); await page.evaluate((c)=>{ window.__rg.q.push(...c); }, chunk); }
  const k1 = (fs.readFileSync(DIR+'/crawl_kan.log','utf8').split('\n').filter(Boolean).pop()||'');
  if (!kans.length && qlen === 0) { idle++; if (/ end$/.test(k1) && idle > 3) { log('all done'); break; } } else idle = 0;
  if (Math.random() < 0.1) log(`done=${done.size} queue=${qlen} pending=${kans.length}`);
  await page.waitForTimeout(3000);
}
log('end');
await page.close();
