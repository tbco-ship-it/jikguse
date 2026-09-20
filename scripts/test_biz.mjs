// node scripts/test_biz.mjs — worked examples for the business-import model (static/biz-calc.js) against the real data/hs.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
new Function(readFileSync(join(ROOT, 'static/biz-calc.js'), 'utf8'))();
const { BizCalc } = globalThis;
const HS = JSON.parse(readFileSync(join(ROOT, 'data/hs.json'), 'utf8'));
const byCode = Object.fromEntries(HS.codes.map(c => [c.c, c]));
const reel = byCode['9507300000'], hoodie = byCode['6110200000'], laptop = byCode['8471300000'];
const fx = { USD: 1358.72, CNY: 202.51 };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('source rates are what the examples below assume', () => {
  const col = c => HS.cols.indexOf(c);
  assert.equal(reel.r[col('A')], 8); assert.equal(reel.r[col('C')], 13); assert.equal(reel.r[col('FCN1')], 0); assert.equal(reel.r[col('FRCJP1')], 4);
  assert.equal(hoodie.r[col('A')], 13); assert.equal(hoodie.r[col('C')], 35); assert.equal(hoodie.r[col('FCN1')], 5.2); assert.equal(hoodie.r[col('FRCCN1')], 8.7);
  assert.equal(laptop.r[col('A')], 8); assert.equal(laptop.r[col('C')], 0);
});

t('rateFor: MFN = min(A, C); FTA only with C/O and only when lower', () => {
  let r = BizCalc.rateFor(reel, HS.cols, 'CN', false);
  assert.deepEqual([r.applied.rate, r.applied.code, r.useFta, r.fta.rate], [8, 'A', false, 0]);
  r = BizCalc.rateFor(reel, HS.cols, 'CN', true);
  assert.deepEqual([r.applied.rate, r.applied.code, r.applied.label], [0, 'FCN1', '한·중 FTA']);
  r = BizCalc.rateFor(laptop, HS.cols, 'TW', false); // ITA: WTO 0% beats 기본 8% with no agreement at all
  assert.deepEqual([r.applied.rate, r.applied.code, r.fta], [0, 'C', null]);
  r = BizCalc.rateFor(reel, HS.cols, 'JP', true);    // RCEP Japan 4% < 8%
  assert.deepEqual([r.applied.rate, r.applied.code], [4, 'FRCJP1']);
  r = BizCalc.rateFor(hoodie, HS.cols, 'CN', true);  // 한·중 5.2 beats RCEP 8.7
  assert.deepEqual([r.applied.rate, r.applied.code], [5.2, 'FCN1']);
});

t('compute: two-line LCL from China, freight allocated by value, 10원 truncation, C/O on', () => {
  const r = BizCalc.compute({ fx, cur: 'USD', cols: HS.cols, origin: 'CN', co: true, freight: 300, freightCur: 'USD', insurance: 0,
    brokerageKrw: 30000, domesticKrw: 0, lines: [{ entry: reel, qty: 10, price: 50 }, { entry: hoodie, qty: 100, price: 8 }] });
  // goods 679,360 + 1,086,976 = 1,766,336; freight 407,616 split 5:8
  assert.deepEqual(r.lines.map(l => l.cif), [836135, 1337816]);
  assert.deepEqual(r.lines.map(l => l.duty), [0, 69560]);
  assert.deepEqual(r.lines.map(l => l.vat), [83610, 140730]);
  assert.equal(r.duty, 69560); assert.equal(r.vat, 224340); assert.equal(r.tax, 293900);
  assert.equal(r.landed, 1766336 + 407616 + 293900 + 30000);
  assert.equal(r.landedNet, r.landed - 224340);
  assert.equal(r.ftaLines, 2);
});

t('compute: same shipment without C/O falls back to MFN', () => {
  const r = BizCalc.compute({ fx, cur: 'USD', cols: HS.cols, origin: 'CN', co: false, freight: 300, freightCur: 'USD',
    lines: [{ entry: reel, qty: 10, price: 50 }, { entry: hoodie, qty: 100, price: 8 }] });
  assert.deepEqual(r.lines.map(l => l.duty), [66890, 173910]);
  assert.deepEqual(r.lines.map(l => l.vat), [90300, 151170]);
  assert.equal(r.ftaLines, 0);
});

t('compute: KRW freight, CNY goods, empty/zero lines ignored', () => {
  const r = BizCalc.compute({ fx, cur: 'CNY', cols: HS.cols, origin: 'CN', co: false, freight: 100000, freightCur: 'KRW',
    lines: [{ entry: reel, qty: 2, price: 300 }, { entry: null, qty: 1, price: 1 }, { entry: hoodie, qty: 0, price: 50 }] });
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].cif, Math.floor(600 * 202.51 + 100000)); // 221,506
  assert.equal(r.lines[0].duty, BizCalc.floor10(221506 * 0.08));
  assert.equal(r.freightKrw, 100000);
});

t('flags: 세관장확인 and specific-duty entries are marked', () => {
  const phone = byCode['8517130000'] || HS.codes.find(c => c.c.startsWith('851713'));
  assert.ok(phone && phone.q, 'smartphones are 세관장확인 (전파법)');
  assert.ok(!reel.q, 'fishing reels are not');
  const orange = byCode['0805100000'];
  assert.ok(orange.x && orange.x.includes('FAU1'), 'seasonal FAU1 row expired → flagged');
});

console.log(`${n} tests passed`);
