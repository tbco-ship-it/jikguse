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

for (const f of ['wing_row_lines.txt', 'wing_row_tabs.txt']) t(`parse ${f}: every field of the 상품 관리 row`, () => {
  const { ok, w, missing } = RgWing.parse(fx(f));
  assert.equal(ok, true); assert.deepEqual(missing, []);
  assert.deepEqual(w.y, { sold: 2, rev: 19600, views: 57 });
  assert.deepEqual(w.d7, { sold: 49, rev: 372400, views: 447, single: 38, bundle: 11 });
  assert.deepEqual(w.d30, { sold: 294, rev: 1666000, views: 2509, single: 170, bundle: 124 });
  assert.deepEqual(w.stock, { avail: 106, availDays: 9, inbound: 100, recommend: 27 });
  assert.deepEqual(w.price, { list: 9800, final: 7350 });
  assert.deepEqual(w.cost, { unit: 2678, storageMonth: 0 });
  near(w.ret.rate, 9.81132075471698, 1e-9); assert.equal(w.ret.month, 8);
  assert.ok(w.name.startsWith('코스토프 투명스모그라이딩마스크'), w.name);
  assert.deepEqual(w.ids, ['15865801437', '94075183837', '66937503']);
});
t('parse: 판매가능 without the days badge, 반품률 without month, 2 매출 boxes → 7일·30일', () => {
  const { w } = RgWing.parse('지난 7일 10\n지난 30일 60\n판매가능 40\n입고중 0\n판매가 12,000\n매출 80,000원\n조회 수 100\n매출 500,000원\n조회 수 700\n반품률 4.5%');
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
  const { w } = RgWing.parse(fx('wing_row_lines.txt'));
  const d = RgWing.diagnose(w, { lead: 25, cover: 30, perUnit: 1000 });
  near(d.asp.y, 9800); near(d.asp.d7, 7600); near(d.asp.d30, 1666000 / 294);
  near(d.discount, 1 - (1666000 / 294) / 9800, 1e-9);
  near(d.rate7, 7); near(d.rate30, 9.8); near(d.rate, 7); near(d.trend, 7 / 9.8 - 1, 1e-9);
  near(d.cvr.d7, 49 / 447, 1e-9); near(d.cvr.d30, 294 / 2509, 1e-9);
  near(d.bundleShare, 124 / 294, 1e-9);
});
t('diagnose: 재고 소진·리드타임 부족분·추천 발주 (7일 속도 7개/일, 재고 206)', () => {
  const { w } = RgWing.parse(fx('wing_row_lines.txt'));
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
