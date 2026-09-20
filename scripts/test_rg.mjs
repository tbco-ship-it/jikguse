// node scripts/test_rg.mjs — worked examples for the 로켓그로스 model (static/rg-calc.js). Hand-computed from the help-article rules.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
new Function(readFileSync(join(ROOT, 'static/rg-calc.js'), 'utf8'))();
const { RgCalc } = globalThis;
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

// synthetic fee table so the arithmetic is checkable by hand
const T = { bands: [0, 10000, 20000], wh: [[1000, 1100, 1200], [2000, 2100, 2200], [3, 3, 3], [4, 4, 4], [5, 5, 5], [6, 6, 6]],
  sh: [[1500, 1600, 1700], [2500, 2600, 2700], [3, 3, 3], [4, 4, 4], [5, 5, 5], [6, 6, 6]] };
const base = { table: T, sizeIdx: 0, extra: 0, cbm: 0.001, apparel: false, rate: 10.5, cost: 6000, turnover: 60, retRate: 0.2, unsellable: 0.2, adPct: 0, sellerDisc: 0, saver: false, simplified: false };

t('size tier needs both 세변합 and 무게; beyond 특대형 adds max(90cm당, 10kg당) 1,000', () => {
  assert.equal(RgCalc.sizeTier([200, 150, 50], 500).name, '극소형');
  assert.equal(RgCalc.sizeTier([400, 300, 150], 3000).name, '소형');        // 85cm → 소형, 3kg → 소형
  assert.equal(RgCalc.sizeTier([200, 150, 50], 3000).name, '소형');         // 40cm but 3kg → 소형 (weight binds)
  assert.equal(RgCalc.sizeTier([800, 300, 200], 1000).name, '대형1');       // 130cm > 120 → 대형1
});
t('tierDims: representative dims of a tier land in that tier; 2-bundles of 극소형/소형 stay ≤ 소형', () => {
  RgCalc.SIZES.forEach((sz, i) => { const d = RgCalc.tierDims(i); assert.equal(RgCalc.sizeTier(d.dims, d.wt).name, sz.name); });
  assert.deepEqual(RgCalc.tierDims(0), { dims: [133, 133, 133], wt: 1000 });           // (0+80)/2 = 40cm 세변합 → 13.3cm cube, 1kg
  assert.equal(RgCalc.sizeTier(RgCalc.bundleDims(RgCalc.tierDims(0).dims, 2), 2000).name, '극소형');
  assert.equal(RgCalc.sizeTier(RgCalc.bundleDims(RgCalc.tierDims(1).dims, 2), 7000).name, '중형');
});
t('size tier boundaries (≤ inclusive)', () => {
  assert.equal(RgCalc.sizeTier([500, 200, 100], 2000).name, '극소형');      // exactly 80cm, 2kg
  assert.equal(RgCalc.sizeTier([500, 200, 101], 2000).name, '소형');
  const big = RgCalc.sizeTier([1000, 900, 700], 35000);                     // 260cm, 35kg → 특대형 + 추가
  assert.equal(big.name, '특대형'); assert.equal(big.extra, 1000);
  assert.equal(RgCalc.sizeTier([2000, 900, 700], 20000).extra, 2000);       // 360cm → 110cm 초과 → 2단위
});
t('storage: 0.001㎥ free 30 over 60 days = 2원/day × expected remaining share', () => {
  near(RgCalc.storageCost(0.001, 30, 60), 14.5);
  assert.equal(RgCalc.storageCost(0.0002, 30, 60), 0);                       // 0.4원/day rounds to 0
  assert.equal(RgCalc.storageCost(0.001, 60, 60), 0);                        // 세이버 60일: nothing billable
  near(RgCalc.storageCost(0.01, 30, 100), (function () { let s = 0; for (let d = 31; d <= 100; d++) s += (d <= 45 ? 20 : d <= 60 ? 20 : 25) * (100 - d) / 100; return s; })());
});
t('compute: 20,000원 · 10.5% · 원가 6,000 · 반품 20%(월 100개 → 20건 무료 안에서 회수·재입고 0)', () => {
  const c = RgCalc.compute({ ...base, price: 20000, monthly: 100 });
  assert.equal(c.commission, 2100); assert.equal(c.wh, 1200); assert.equal(c.sh, 1700);
  near(c.storage, 14.5); near(c.revenue, 18181.818, 0.001);
  near(c.keptProfit, 7167.318, 0.001);
  assert.equal(c.billable, 0); near(c.returns.perReturn, 1260);              // 0.2 × (6,000 + 300)
  near(c.expected, 5478.955, 0.001); near(c.perSold, 6848.69, 0.01);
  near(c.margin, 0.27395, 1e-4); near(c.roi, 0.91316, 1e-4);
  near(c.vatOut, 20000 / 11, 0.001); near(c.vatIn, (2100 + 1200 + 1700 + 14.5) * 0.1, 0.001);
});
t('compute: 월 200개 → 반품 40건, 20건 초과분만 회수비 1,012·재입고 2,000(20,000원 구간 기본가) 과금', () => {
  const c = RgCalc.compute({ ...base, price: 20000, monthly: 200 });
  assert.equal(c.billable, 0.5); near(c.returns.pickup, 506); near(c.returns.restock, 1000);
  near(c.returns.perReturn, 506 + 0.8 * 1000 + 1260); near(c.expected, 5733.855 - 0.2 * (2566 + 14.5), 0.001);
});
t('세이버: 반품비 0, 보관 60일, 월 99,000 안분', () => {
  const c = RgCalc.compute({ ...base, price: 20000, monthly: 200, saver: true });
  assert.equal(c.billable, 0); assert.equal(c.storage, 0); assert.equal(c.saverShare, 495);
  near(c.expected, 0.8 * (18181.818 - 5000 - 6000 - 495) - 0.2 * (1260 + 495), 0.01);
});
t('의류: 45일 무료 보관, 회수비 의류 단가', () => {
  const c = RgCalc.compute({ ...base, price: 20000, monthly: 400, apparel: true });
  assert.equal(c.free, 45); near(c.storage, (function () { let s = 0; for (let d = 46; d <= 60; d++) s += 2 * (60 - d) / 60; return s; })());
  near(c.returns.pickup, 675 * 0.75);
});
t('판매자 할인 10%: 수수료·구간·매출 모두 할인 후 가격 기준', () => {
  const c = RgCalc.compute({ ...base, price: 20000, sellerDisc: 10 });
  assert.equal(c.sold, 18000); assert.equal(c.commission, 1890); assert.equal(c.wh, 1100);
});
t('간이과세자: 매출 99%, 비용 VAT 포함', () => {
  const a = RgCalc.compute({ ...base, price: 20000, monthly: 100 }), s = RgCalc.compute({ ...base, price: 20000, monthly: 100, simplified: true });
  near(s.revenue, 19800); near(s.keptProfit, 19800 - (2100 + 1200 + 1700 + 14.5) * 1.1 - 6000, 0.001);
  assert.ok(s.expected > a.expected);
});
t('광고비 10%: 매출 대비', () => { near(RgCalc.compute({ ...base, price: 20000, adPct: 10 }).ad, 2000); });
t('breakEven: 기대 순이익이 0을 넘는 가장 낮은 10원 단위 가격', () => {
  const x = { ...base, monthly: 100 };
  const p = RgCalc.breakEven(x);
  assert.ok(RgCalc.compute({ ...x, price: p }).expected >= 0 && RgCalc.compute({ ...x, price: p - 10 }).expected < 0, String(p));
  const p2 = RgCalc.breakEven(x, 0.2);
  const c2 = RgCalc.compute({ ...x, price: p2 }); assert.ok(c2.expected / c2.sold >= 0.2 && p2 > p);
});
t('bundleDims stacks along the shortest side', () => { assert.deepEqual(RgCalc.bundleDims([200, 150, 50], 3), [200, 150, 150]); });
t('return-rate defaults by 1차 카테고리', () => { assert.equal(RgCalc.returnDefault('패션의류잡화>여성패션>x'), 0.2); assert.equal(RgCalc.returnDefault('식품>x'), 0.02); assert.equal(RgCalc.returnDefault('없는>x'), 0.05); assert.ok(RgCalc.isApparel('패션의류잡화>y')); });

// real table sanity (data/rg_fees.json): 입출고+배송 for Apparel/Women Clothes MINI <5,000 = 2,500 (Wing 전체보기 표)
try {
  const F = JSON.parse(readFileSync(join(ROOT, 'data/rg_fees.json'), 'utf8'));
  const u = F.units.find(u => u.u1 === 'Apparel' && u.u2 === 'Women Clothes');
  if (u) t('real table: Apparel/Women Clothes 극소형 5,000원 미만 입출고+배송 = 2,500 (Wing 표), 10만원 이상 = 3,850', () => {
    assert.equal(RgCalc.lookup(u, 'wh', 0, 4999) + RgCalc.lookup(u, 'sh', 0, 4999), 2500);
    assert.equal(RgCalc.lookup(u, 'wh', 0, 100000) + RgCalc.lookup(u, 'sh', 0, 100000), 3850);
    assert.equal(u.base_wh[0] + u.base_sh[0], 3850);
  });
  const b = F.units.find(u => u.u1 === 'Beauty' && u.u2 === 'Skin Care');
  if (b) t('real table: Beauty/Skin Care is 저가 할인 대상 — 극소형 13,999원 입출고 1,100 + 배송 1,455', () => {
    assert.ok(b.lowasp); assert.equal(RgCalc.lookup(b, 'wh', 0, 13999), 1100);
  });
} catch (e) { console.log('skip real-table tests:', e.message); }

// RgWidget.evaluate: a saved slot (what the widget's save() writes) → same numbers as the in-form path, without a DOM.
new Function(readFileSync(join(ROOT, 'static/rg-widget.js'), 'utf8'))();
{
  const FEES = { units: [T], asof: 'test' };
  const cat = { p: '생활용품>테스트', r: 10.5, u: 0 };
  const slot = { cat, price: '19900', cost: '6000', sizeMode: 'tier', tierIdx: 0, turn: '60', monthly: '100', ret: '20', unsell: '20', ad: '0', disc: '0', inbound: '0' };
  t('evaluate: complete slot → ok, equals RgCalc.compute with the tier\'s representative dims', () => {
    const ev = globalThis.RgWidget.evaluate(FEES, slot);
    assert.ok(ev.ok); assert.equal(ev.I.tier.name, '극소형');
    const d = RgCalc.tierDims(0);
    near(ev.c.expected, RgCalc.compute({ ...base, price: 19900, cost: 6000, cbm: d.dims[0] ** 3 / 1e9, monthly: 100 }).expected);
  });
  t('evaluate: missing 판매가/카테고리/사이즈 → ok:false with needs; ctx.cost overrides the saved cost; empty slot is not ok', () => {
    assert.deepEqual(globalThis.RgWidget.evaluate(FEES, { ...slot, price: '' }).needs, { cat: false, price: true, size: false });
    assert.equal(globalThis.RgWidget.evaluate(FEES, { ...slot, cat: null }).ok, false);
    assert.equal(globalThis.RgWidget.evaluate(FEES, { ...slot, tierIdx: null }).ok, false);
    assert.equal(globalThis.RgWidget.evaluate(FEES, slot, { cost: 835.4 }).c.cost, 835);
    assert.equal(globalThis.RgWidget.evaluate(FEES, null).ok, false);
  });
  t('evaluate: pre-toggle save (dims only, no sizeMode) is read as dims mode', () => {
    const ev = globalThis.RgWidget.evaluate(FEES, { ...slot, sizeMode: undefined, tierIdx: undefined, d1: '400', d2: '300', d3: '150', wt: '3000' });
    assert.ok(ev.ok); assert.equal(ev.I.tier.name, '소형');
  });
}

console.log(`${n} tests passed`);
