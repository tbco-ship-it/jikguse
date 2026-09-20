// Crawl display leaf -> KAN category id via Wing (my own tab p8 in space 4). Resumable; stop file .scratch/ori/rg/STOP
const fs = await import('node:fs');
const DIR = '/Users/aiden/.buzz-dev/.scratch/ori/rg';
const leaves = JSON.parse(fs.readFileSync(DIR+'/leaves.json','utf8'));
const outPath = DIR+'/kan_map.jsonl';
const done = new Set(fs.existsSync(outPath) ? fs.readFileSync(outPath,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l).code) : []);
const todo = leaves.filter(l=>!done.has(l.code));
const log = (m)=>fs.appendFileSync(DIR+'/crawl_kan.log', new Date().toISOString()+' '+m+'\n');
log(`start todo=${todo.length} done=${done.size}`);
const _sp = (await listTaskSpaces()).find(s=>s.name==='ori-rg');
const task = _sp ? await taskSpace(_sp.id) : await taskSpace('ori-rg');
const page = await task.newPage();
if (!/wing\.coupang\.com/.test(await page.url())) { await page.goto('https://wing.coupang.com/tenants/rfm/settlements/fee-details'); await page.waitForLoadState(); await page.waitForTimeout(3000); }
const BATCH = 24;
for (let i=0;i<todo.length;i+=BATCH) {
  if (fs.existsSync(DIR+'/STOP')) { log('stop file'); break; }
  const codes = todo.slice(i,i+BATCH).map(l=>l.code);
  let res;
  try {
    res = await page.evaluate(async(codes)=>{
      const one = async c => { try { const r=await fetch('/tenants/seller-web/v2/vendor-inventory/kanCategory?displayCategoryCode='+c,{credentials:'include'}); if(!r.ok) return [c,null,r.status]; const t=await r.text(); if(!t) return [c,null,'empty']; const j=JSON.parse(t); return [c,j.kanCategoryId,200]; } catch(e){ return [c,null,String(e).slice(0,60)]; } };
      const out=[]; const q=[...codes]; const workers=Array.from({length:6},async()=>{ while(q.length){ out.push(await one(q.shift())); } }); await Promise.all(workers); return out;
    }, codes);
  } catch(e) { log('evaluate error '+e.message); await page.waitForTimeout(5000); continue; }
  const lines = res.map(([code,kan,st])=>JSON.stringify({code,kan,st})).join('\n')+'\n';
  fs.appendFileSync(outPath, lines);
  const fails = res.filter(r=>r[1]==null).length;
  if (i % (BATCH*20) === 0 || fails) log(`i=${i+codes.length}/${todo.length} fails=${fails} sample=${JSON.stringify(res[0])}`);
  if (res.filter(r=>r[1]==null && r[2]!=='empty').length>BATCH/2) { log('many failures, pausing 60s'); await page.waitForTimeout(60000); }
  await page.waitForTimeout(200);
}
log('end');
await page.close();
