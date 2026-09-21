// node scripts/test_stock.mjs — 재고·발주 계획 모델(static/rg-stock.js): 속도 창, 주간 집계, 리드타임 단계 중앙값, 진행 중 주문 ETA, 품절·발주 예측.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
new Function(readFileSync(join(ROOT, 'static/rg-stock.js'), 'utf8'))();
const S = globalThis.RgStock;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const T = '2026-09-21';

t('dates: local ymd, addDays across month end, daysBetween', () => {
  assert.equal(S.addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(S.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(S.daysBetween('2026-09-01', '2026-09-21'), 20);
  assert.equal(S.ymd(new Date(2026, 8, 21, 23, 30)), '2026-09-21'); // local, not UTC
});

t('velocity: windows end yesterday, today excluded; 90-day divisor stops at the first known day', () => {
  const series = {};
  for (let i = 1; i <= 20; i++) series[S.addDays(T, -i)] = 2; // 20 days × 2 = 40, item is 20 days old
  series[T] = 9; // today's partial row must not count
  const v = S.velocity(series, { today: T });
  assert.deepEqual(v.d7, { units: 14, days: 7, rate: 2 });
  assert.deepEqual(v.d30, { units: 40, days: 20, rate: 2 });
  assert.deepEqual(v.d90, { units: 40, days: 20, rate: 2 });
  assert.equal(v.first, S.addDays(T, -20));
});
t('velocity: 등록일 earlier than the first row extends the divisor (quiet days after launch are real zeros)', () => {
  const series = { [S.addDays(T, -1)]: 10 };
  const v = S.velocity(series, { today: T, reg: S.addDays(T, -10) });
  assert.deepEqual(v.d7, { units: 10, days: 7, rate: 10 / 7 });
  assert.deepEqual(v.d30, { units: 10, days: 10, rate: 1 });
});
t('velocity: sparse series (API omits no-sale days) still sums correctly and an empty series has no rate', () => {
  const series = { '2026-09-01': 5, '2026-09-13': 3 };
  const v = S.velocity(series, { today: T });
  assert.equal(v.d30.units, 8); assert.equal(v.d30.days, 20); assert.equal(v.d7.units, 0); assert.equal(v.d7.rate, 0);
  assert.equal(S.velocity({}, { today: T }).d30.rate, null);
});
t('weekly: 13 buckets of 7 days ending yesterday, oldest first', () => {
  const series = {}; for (let i = 1; i <= 91; i++) series[S.addDays(T, -i)] = 1;
  const w = S.weekly(series, T, 13);
  assert.equal(w.length, 13); assert.equal(w[12].to, '2026-09-20'); assert.equal(w[12].from, '2026-09-14'); assert.ok(w.every(x => x.units === 7));
  assert.equal(w[0].from, S.addDays(T, -91));
});

t('medians: defaults until 3 samples; typed override wins; skipped stage contributes nothing', () => {
  const o = d => ({ dates: d });
  const orders = [
    o({ order: '2026-07-01', fwd: '2026-07-06', clear: '2026-07-09', kr: '2026-07-11', req: '2026-07-14', fc: '2026-07-20' }),
    o({ order: '2026-08-01', fwd: '2026-08-09', clear: '2026-08-12', kr: '2026-08-14', req: '2026-08-18', fc: '2026-08-27' }),
    o({ order: '2026-08-20', fwd: '2026-08-26', clear: null, kr: '2026-09-01', req: '2026-09-04', fc: '2026-09-11' }),
  ];
  const m = S.medians(orders);
  assert.equal(m[0].k, 'order'); assert.equal(m[0].n, 3); assert.equal(m[0].d, 6); assert.equal(m[0].src, 'log');   // 5, 8, 6 → 6
  assert.equal(m[1].n, 2); assert.equal(m[1].d, 4); assert.equal(m[1].src, 'default');                                // fwd→clear only 2 samples
  assert.equal(m[2].n, 2); assert.equal(m[2].src, 'default');                                                          // clear→kr: third order skipped clear
  assert.equal(m[3].n, 3); assert.equal(m[3].d, 3); assert.equal(m[3].src, 'log');                                     // 3, 4, 3 → 3
  assert.equal(m[4].n, 3); assert.equal(m[4].d, 7); assert.equal(m[4].src, 'log');                                     // 6, 9, 7 → 7
  const m2 = S.medians(orders, { order: 10, req: '' });
  assert.equal(m2[0].d, 10); assert.equal(m2[0].src, 'user'); assert.equal(m2[4].d, 7);
  assert.equal(S.totalLead(S.medians([])), 25);
});
t('eta: last recorded stage + remaining planned days; late orders land "today"; completed orders are done', () => {
  const st = S.medians([]);
  const e = S.eta({ dates: { order: '2026-09-10', fwd: '2026-09-18' } }, st, T);
  assert.equal(e.stage.k, 'fwd'); assert.equal(e.done, false); assert.equal(e.remaining, 4 + 2 + 4 + 8); assert.equal(e.eta, '2026-10-06'); assert.equal(e.late, false);
  const late = S.eta({ dates: { order: '2026-08-01' } }, st, T);
  assert.equal(late.late, true); assert.equal(late.eta, T); assert.equal(late.planned, '2026-08-26');
  assert.equal(S.eta({ dates: { order: '2026-08-01', fc: '2026-08-30' } }, st, T).done, true);
  assert.equal(S.eta({ dates: {} }, st, T).stage, null);
});

t('forecast: stockout by each rate, range, order-by date, quantity; arrivals push the date out', () => {
  const f = S.forecast({ today: T, avail: 100, inbound: 20, rates: { d7: 4, d30: 3, d90: 2 }, lead: 25, cover: 30, buffer: 7 });
  assert.equal(f.base, 'd30'); assert.equal(f.stock0, 120);
  assert.equal(f.by.d30.date, S.addDays(T, 40)); // 120/3 = 40 → the 41st day goes negative? day index 40 → s = 120 − 41×3 < 0
  assert.equal(f.by.d7.date, S.addDays(T, 30)); assert.equal(f.by.d90.date, S.addDays(T, 60));
  assert.deepEqual(f.range, { from: S.addDays(T, 30), to: S.addDays(T, 60) }); assert.equal(f.spread, 30);
  assert.equal(f.orderBy, S.addDays(f.main.date, -32)); assert.equal(f.past, false); assert.equal(f.gap, 0);
  assert.equal(f.qty, Math.ceil(3 * 55 - 120));
  const g = S.forecast({ today: T, avail: 10, rates: { d30: 3 }, lead: 25, cover: 30, arrivals: [{ date: S.addDays(T, 3), qty: 300 }] });
  assert.equal(g.by.d30.date, S.addDays(T, Math.floor(310 / 3)));
  assert.equal(g.qty, 0); assert.equal(g.arriving, 300);
});
t('forecast: no rate → nothing; already-late order-by reports the empty days; huge stock → no stockout date', () => {
  const f = S.forecast({ today: T, avail: 50, rates: { d30: null, d7: null, d90: null }, lead: 25 });
  assert.equal(f.base, null); assert.equal(f.main, null); assert.equal(f.qty, null); assert.equal(f.orderBy, null);
  const g = S.forecast({ today: T, avail: 10, rates: { d30: 5 }, lead: 25, cover: 0, buffer: 0 });
  assert.equal(g.by.d30.days, 2); assert.equal(g.past, true); assert.equal(g.gap, 25 - 2);
  const h = S.forecast({ today: T, avail: 1e6, rates: { d30: 1 }, lead: 25 });
  assert.equal(h.main.date, null); assert.equal(h.orderBy, null);
});
t('forecast: base falls back to another window when d30 is unknown', () => {
  const f = S.forecast({ today: T, avail: 30, rates: { d7: 3 }, lead: 10 });
  assert.equal(f.base, 'd7'); assert.equal(f.rate, 3); assert.equal(f.by.d7.days, 10);
});

t('발주 수량: 리드+커버 창 밖에 도착하는 물량은 빼지 않는다 (GPT-6 Pro 2026-09-21)', () => {
  const f = S.forecast({ today: '2026-09-21', avail: 300, inbound: 0, rates: { d30: 10 }, lead: 25, cover: 30, buffer: 0, arrivals: [{ date: '2027-01-01', qty: 1000 }] });
  assert.equal(f.qty, 250); assert.equal(f.arriving, 0); assert.equal(f.arrivingLater, 1000); assert.equal(f.main.date, '2026-10-21');
  const g = S.forecast({ today: '2026-09-21', avail: 300, inbound: 0, rates: { d30: 10 }, lead: 25, cover: 30, buffer: 0, arrivals: [{ date: '2026-10-15', qty: 100 }] });
  assert.equal(g.qty, 150); assert.equal(g.arriving, 100);
});

console.log(`\n${n} tests passed`);
