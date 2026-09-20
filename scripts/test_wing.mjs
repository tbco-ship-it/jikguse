// node scripts/test_wing.mjs — 윙 상품 관리 화면 붙여넣기 파서(static/rg-wing.js) + 진단 계산. Fixtures rebuilt from the 2026-09-20 screenshot.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
new Function(readFileSync(join(ROOT, 'static/rg-wing.js'), 'utf8'))();
const { RgWing } = globalThis;
const fx = f => readFileSync(join(ROOT, 'scripts/fixtures', f), 'utf8');
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('parse wing_row_real.txt (innerText of 재고현황, two rows): first row only, every field', () => {
  const { ok, w, missing } = RgWing.parse(fx('wing_row_real.txt'));
  assert.equal(ok, true); assert.equal(missing.length, 1); assert.match(missing[0], /^반품률 — /);
  assert.deepEqual(w.y, { sold: 3, rev: 49000, views: 0, single: null, bundle: null });
  assert.deepEqual(w.d7, { sold: 43, rev: 313600, views: 366, single: 32, bundle: 11 });
  assert.deepEqual(w.d30, { sold: 287, rev: 1617000, views: 2419, single: 165, bundle: 122 });
  assert.deepEqual(w.stock, { avail: 106, availDays: 9, inbound: 100, recommend: 27 });
  assert.deepEqual(w.price, { list: 9800, final: 7350 });
  assert.deepEqual(w.cost, { unit: 2678, storageMonth: 0 });
  assert.deepEqual(w.ret, { rate: null, month: null }); // 반품률 box is not on the 재고현황 list
  assert.ok(w.name.startsWith('예시 라이딩마스크'), w.name);
  assert.deepEqual(w.ids, ['10000000001', '90000000001', '60000001']);
});
t('parse wing_row_tabs.txt (row copied as one tab-joined line + 반품률 box)', () => {
  const { ok, w, missing } = RgWing.parse(fx('wing_row_tabs.txt'));
  assert.equal(ok, true); assert.deepEqual(missing, []);
  assert.deepEqual(w.d30, { sold: 287, rev: 1617000, views: 2419, single: 165, bundle: 122 });
  assert.deepEqual(w.stock, { avail: 106, availDays: 9, inbound: 100, recommend: 27 });
  assert.deepEqual(w.price, { list: 9800, final: 7350 });
  near(w.ret.rate, 9.81132075471698, 1e-9); assert.equal(w.ret.month, 8);
  assert.ok(w.name.startsWith('예시 라이딩마스크'), w.name);
});
t('parse: second row of the real list (조회 수 empty for 어제, 입고권장 = 재고 양호)', () => {
  const t2 = fx('wing_row_real.txt'); const { w } = RgWing.parse(t2.slice(t2.indexOf('예시 간절기')));
  assert.deepEqual(w.y, { sold: 0, rev: 0, views: null, single: null, bundle: null });
  assert.deepEqual(w.d7, { sold: 2, rev: 15800, views: 92, single: null, bundle: null });
  assert.deepEqual(w.d30, { sold: 10, rev: 79000, views: 313, single: null, bundle: null });
  assert.deepEqual(w.stock, { avail: 19, availDays: 24, inbound: 0, recommend: null });
  assert.deepEqual(w.price, { list: 7900, final: 7900 }); assert.deepEqual(w.cost, { unit: 3080, storageMonth: 3220 });
});
t('parse wing_row_copy.txt (real drag-copy: expanded panel loses its labels, keeps N원 / views / %)', () => {
  const { ok, w, missing } = RgWing.parse(fx('wing_row_copy.txt'));
  assert.equal(ok, true); assert.deepEqual(missing, []);
  assert.deepEqual(w.y, { sold: 3, rev: 49000, views: 0, single: null, bundle: null });
  assert.deepEqual(w.d7, { sold: 43, rev: 313600, views: 366, single: null, bundle: null });
  assert.deepEqual(w.d30, { sold: 287, rev: 1617000, views: 2419, single: null, bundle: null });
  assert.deepEqual(w.stock, { avail: 106, availDays: 9, inbound: 100, recommend: 27 });
  assert.deepEqual(w.price, { list: 9800, final: 7350 }); assert.deepEqual(w.cost, { unit: 2678, storageMonth: 0 });
  near(w.ret.rate, 9.81132075471698, 1e-9); assert.equal(w.ret.month, null);
  assert.ok(w.name.startsWith('예시 라이딩마스크'), w.name);
});
t('parse: drag-copy of the row alone (panel not opened) → counts and stock only, no 실판매가', () => {
  const t2 = fx('wing_row_copy.txt'); const { ok, w, missing } = RgWing.parse(t2.slice(0, t2.indexOf('49,000원')));
  assert.equal(ok, true); assert.deepEqual([w.d30.sold, w.d30.rev, w.ret.rate], [287, null, null]);
  assert.equal(missing.length, 1); assert.match(missing[0], /^매출·조회수·반품률 — /);
});
t('parse: minimal layout — 판매가능 without the days badge, 매출 with 원 suffix, 반품률 without month', () => {
  const { w } = RgWing.parse('지난 7일 10\n매출 80,000원\n조회 수 100\n지난 30일 60\n매출 500,000원\n조회 수 700\n판매가능 40\n입고중 0\n판매가 12,000\n반품률 4.5%');
  assert.deepEqual(w.stock, { avail: 40, availDays: null, inbound: 0, recommend: null });
  assert.equal(w.price.list, 12000);
  assert.deepEqual([w.d7.rev, w.d30.rev, w.y.rev], [80000, 500000, null]);
  assert.deepEqual([w.d7.views, w.d30.views], [100, 700]);
  assert.deepEqual(w.ret, { rate: 4.5, month: null });
});
t('parse: garbage → not ok, missing lists what is absent', () => {
  const r = RgWing.parse('안녕하세요 배대지 신청서\n[620453] 치마 100개');
  assert.equal(r.ok, false); assert.ok(r.missing.includes('판매량(지난 7일·30일)'));
});
t('diagnose: 실판매가·속도·추세·전환율·번들 비중', () => {
  const { w } = RgWing.parse(fx('wing_row_real.txt'));
  const d = RgWing.diagnose(w, { lead: 25, cover: 30, perUnit: 1000 });
  near(d.asp.y, 49000 / 3); near(d.asp.d7, 313600 / 43); near(d.asp.d30, 1617000 / 287);
  near(d.discount, 1 - (1617000 / 287) / 9800, 1e-9);
  near(d.rate7, 43 / 7, 1e-9); near(d.rate30, 287 / 30, 1e-9); near(d.rate, 43 / 7, 1e-9); near(d.trend, (43 / 7) / (287 / 30) - 1, 1e-9);
  near(d.cvr.d7, 43 / 366, 1e-9); near(d.cvr.d30, 287 / 2419, 1e-9);
  near(d.bundleShare, 122 / 287, 1e-9);
});
t('diagnose: 재고 소진·리드타임 부족분·추천 발주 (7일 속도 7개/일, 재고 206)', () => {
  const { w } = RgWing.parse('지난 7일 49\n지난 30일 294\n판매가능 9일 106\n입고중 100\n판매가 9,800');
  const d = RgWing.diagnose(w, { lead: 25, cover: 30, perUnit: 1000 });
  assert.deepEqual(d.stock, { avail: 106, inbound: 100, total: 206 });
  near(d.daysAvail, 106 / 7, 1e-9); near(d.daysTotal, 206 / 7, 1e-9);
  near(d.leadDemand, 175); assert.equal(d.shortage, 0); assert.equal(d.gapDays, 0); assert.equal(d.lostProfit, 0);
  assert.equal(d.reorderQty, Math.ceil(7 * 55 - 206)); // 179
  near(d.monthlyUnits, 210); near(d.monthlyProfit, 210000);
  // longer lead time than the stock lasts → shortage and lost profit
  const d2 = RgWing.diagnose(w, { lead: 40, cover: 30, perUnit: 1000 });
  assert.equal(d2.shortage, Math.ceil(7 * 40 - 206)); // 74
  near(d2.gapDays, 40 - 206 / 7, 1e-9); assert.equal(d2.lostProfit, 74000);
});
t('diagnose: no sales → no rates, nulls not NaN', () => {
  const { w } = RgWing.parse('지난 7일 0\n지난 30일 0\n판매가능 50\n판매가 10,000');
  const d = RgWing.diagnose(w, {});
  assert.equal(d.rate, 0); assert.equal(d.daysTotal, null); assert.equal(d.reorderQty, null); assert.equal(d.asp.d30, null);
});
console.log(`${n} tests passed`);
