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

t('resolveH6: single row, identical rows, and rows that differ', () => {
  for (const h6 of ['620453', '871499', '630710', '962000']) { const r = BizCalc.resolveH6(HS.codes, h6); assert.equal(r.n, 1); assert.ok(r.entry); }
  const groups = {};
  for (const c of HS.codes) (groups[c.c.slice(0, 6)] ||= []).push(c);
  const stats = { single: 0, same: 0, differ: 0 };
  for (const h6 of Object.keys(groups)) { const r = BizCalc.resolveH6(HS.codes, h6); stats[r.n === 1 ? 'single' : r.same ? 'same' : 'differ']++; if (!r.same && r.n > 1) assert.equal(r.entry, null); }
  assert.equal(stats.single + stats.same + stats.differ, Object.keys(groups).length);
  assert.ok(stats.single + stats.same > stats.differ, `auto-resolved ${stats.single + stats.same} vs pick ${stats.differ}`);
  assert.equal(BizCalc.resolveH6(HS.codes, '999999').n, 0);
});

t('parseSheet: QuickStar 신청서조회 text → merged lines, currency, declared total, shipping', () => {
  const apply = readFileSync(join(ROOT, 'scripts/fixtures/quickstar_apply.txt'), 'utf8');
  const P = BizCalc.parseSheet(apply);
  assert.deepEqual(P.lines, [{ h6: '620453', qty: 235, price: 10.43 }, { h6: '871499', qty: 350, price: 3.82 }, { h6: '871499', qty: 150, price: 4.83 },
    { h6: '620453', qty: 100, price: 11 }, { h6: '630710', qty: 3000, price: 0.14 }, { h6: '962000', qty: 20, price: 28.5 }]); // 9 form rows → 6 (same HS + same price merged)
  assert.equal(P.cur, 'CNY'); assert.equal(P.origin, 'CN');
  assert.equal(P.goods, 6602.55); assert.deepEqual(P.declared, { amount: 6602.55, cur: 'CNY' });
  assert.equal(P.totalKrw, 185000); assert.equal(P.exclKrw, 20000); // only 선적서류작성 is itemised on this page
  assert.equal(P.co, false);
});

t('parseSheet: 결제정보 popup adds the full add-on split and C/O; both pages pasted together', () => {
  const pay = readFileSync(join(ROOT, 'scripts/fixtures/quickstar_pay.txt'), 'utf8');
  const P = BizCalc.parseSheet(pay);
  assert.equal(P.totalKrw, 185000); assert.equal(P.exclKrw, 90000); // 20,000 선적서류 + 70,000 추가요금(C/O 발급·원산지작업)
  assert.equal(P.co, true); assert.equal(P.lines.length, 0);
  const both = BizCalc.parseSheet(readFileSync(join(ROOT, 'scripts/fixtures/quickstar_apply.txt'), 'utf8') + '\n' + pay);
  assert.equal(both.lines.length, 6); assert.equal(both.totalKrw, 185000); assert.equal(both.exclKrw, 90000); assert.equal(both.co, true);
  assert.deepEqual(BizCalc.parseSheet('nothing here').lines, []);
});

t('parseSheet: other forwarders — table with 개/$·¥ symbols, HS코드: 10-digit, dotted HS with pcs/Unit price, and a bare price is not an HS code', () => {
  let P = BizCalc.parseSheet('상품명 | HS CODE | 수량 | 단가\n원피스 | 6204.43 | 100개 | $12.50\n헤어핀 | 9615.11 | 2,000개 | $0.85\n배송요금 320,000원\n통관대행료 30,000원\nC/O 발급 40,000원');
  assert.deepEqual(P.lines, [{ h6: '620443', qty: 100, price: 12.5 }, { h6: '961511', qty: 2000, price: 0.85 }]);
  assert.deepEqual([P.cur, P.totalKrw, P.exclKrw, P.co, P.mixed], ['USD', 320000, 70000, true, false]);
  P = BizCalc.parseSheet('품명: 낚시릴\nHS코드: 9507300000\n수량: 40\n가격: 28.5 USD\n\n품명: 낚싯대\nHS코드 950710\n수량 25\n가격 14 USD\n총 결제금액 150,000 KRW');
  assert.deepEqual(P.lines, [{ h6: '950730', qty: 40, price: 28.5 }, { h6: '950710', qty: 25, price: 14 }]); assert.equal(P.totalKrw, 150000);
  P = BizCalc.parseSheet('Item 1 - HS 8714.99.00 - 350 pcs - Unit price 3.82 CNY\nItem 2 - HS 6307.10 - 3000 pcs - Unit price ¥0.14\n국제운임 210,000 원\n원산지증명서 발급 30,000원\n원산지작업 40,000원');
  assert.deepEqual(P.lines, [{ h6: '871499', qty: 350, price: 3.82 }, { h6: '630710', qty: 3000, price: 0.14 }]);
  assert.deepEqual([P.cur, P.origin, P.totalKrw, P.exclKrw, P.co], ['CNY', 'CN', 210000, 70000, true]);
  P = BizCalc.parseSheet('상품 1234.56 CNY 수량 3\n배송비 50,000원');
  assert.deepEqual([P.lines.length, P.totalKrw], [0, 50000]);
  assert.equal(BizCalc.parseSheet('HS 6204.43 수량 10 $5\nHS 9615.11 수량 10 ¥5').mixed, true);
});

t('compute on the QuickStar shipment: freight 95,000 = 185,000 − 90,000, C/O on, 과세환율 CNY 208.51 (2026-08-23 week)', () => {
  const both = BizCalc.parseSheet(readFileSync(join(ROOT, 'scripts/fixtures/quickstar_apply.txt'), 'utf8'));
  const r = BizCalc.compute({ fx: { USD: 1387.76, CNY: 208.51 }, cur: 'CNY', cols: HS.cols, origin: 'CN', co: true, freight: 185000 - 90000, freightCur: 'KRW', insurance: 0, brokerageKrw: 90000,
    lines: both.lines.map(l => ({ entry: BizCalc.resolveH6(HS.codes, l.h6).entry, qty: l.qty, price: l.price })) });
  assert.equal(r.lines.length, 6); assert.equal(r.freightKrw, 95000); assert.equal(r.brokerage, 90000);
  assert.equal(r.goodsKrw, Math.floor(6602.55 * 208.51)); // 1,376,697
  assert.deepEqual(r.lines.map(l => l.rate.applied.code), ['E1', 'FCN1', 'FCN1', 'E1', 'FCN1', 'FCN1']); // skirts APTA 8.1%, rest 한·중 FTA
  assert.equal(r.cif, r.lines.reduce((s, l) => s + l.cif, 0));
  assert.ok(Math.abs(r.cif - (1376697 + 95000)) <= 6, 'allocation loses at most 1원 per line');
});

console.log(`${n} tests passed`);
