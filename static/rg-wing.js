// 윙 › 로켓그로스 › 상품 관리 화면(상품 한 줄 + 판매 요약 박스)을 복사해 붙여 넣은 텍스트를 읽는다. Pure functions, no DOM;
// loaded by rg-widget.js and scripts/test_wing.mjs.
//   parse(text)        → { ok, w, missing }   w = 판매량(어제·7일·30일, 단품·번들, 매출, 조회수) · 재고(판매가능·입고중·입고권장) ·
//                                              판매가(표시가·최종구매가) · 쿠팡 예상 비용(개당)·누적보관비 · 반품률(월)
//   diagnose(w, opts)  → 판매 속도·추세, 전환율, 재고 소진일, 리드타임 대비 부족분·놓치는 순이익, 추천 발주 수량 (실판매가는 못 구한다 — 아래)
//   inferTier(cost, basis, rate, table) → 쿠팡 예상 비용(개당)과 맞는 사이즈 유형
// Labels are matched loosely (whitespace, ⓘ badges, '자동조정'·'할인' tags in between) because the copied text keeps the layout
// only roughly; verified against the 2026-09-21 재고현황 list — innerText, a one-line tab copy, and a real drag-copy with the
// 판매 상세 panel open (scripts/fixtures/wing_row_*.txt).
(function (root) {
  const num = s => { const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n; };
  const one = (t, re) => { const m = t.match(re); return m ? num(m[m.length - 1]) : null; };
  const HEADER = /상품\s*정보|최근\s*판매량|재고\s*상태|판매가\s*\(|비용\s*\(|상품\s*상태|아이템위너|배지/;

  // One period box (어제 / 지난 7일 / 지난 30일): the label, its count right after, then 단품기준·번들기준·매출 (원)·조회 수 until the
  // next period label or the 재고 column. The same label can appear twice (a compact row + a detailed box) — first non-null wins.
  const PERIODS = [['y', /어제/g], ['d7', /지난\s*7\s*일/g], ['d30', /지난\s*30\s*일/g]];
  const CUT = /어제|지난\s*7\s*일|지난\s*30\s*일|판매\s*가능|입고\s*중|판매가|반품률/;
  function periodBox(t, re) {
    const box = { sold: null, rev: null, views: null, single: null, bundle: null };
    for (const m of t.matchAll(re)) {
      const rest = t.slice(m.index + m[0].length), cut = rest.slice(1).search(CUT), seg = cut < 0 ? rest : rest.slice(0, cut + 1);
      const pick = (re2, k) => { if (box[k] == null) box[k] = one(seg, re2); };
      pick(/^\s*[:：]?\s*([\d,]+)/, 'sold');
      pick(/매출\s*(?:\(\s*원\s*\))?\s*[:：]?\s*([\d,]+)/, 'rev');
      pick(/조회\s*수\s*[:：]?\s*([\d,]+)/, 'views');
      pick(/단품\s*기준\s*[:：]?\s*([\d,]+)/, 'single');
      pick(/번들\s*기준\s*[:：]?\s*([\d,]+)/, 'bundle');
    }
    return box;
  }

  function parse(text) {
    // a whole list pasted → the first product only: a row ends with its 비용 column, so an 어제 after 예상(개당)/누적보관비 starts the next row
    let t = String(text || '').replace(/\u00a0/g, ' ').replace(/\r/g, '');
    const costAt = t.search(/예상\s*\(?\s*개당|누적\s*보관비/);
    if (costAt >= 0) { const nxt = t.indexOf('어제', costAt); if (nxt > 0) t = t.slice(0, nxt); }
    const w = {};
    for (const [k, re] of PERIODS) w[k] = periodBox(t, re);
    // A drag-copy of the expanded 판매 상세 panel keeps only the values, not their labels (2026-09-21 measured: '49,000원 / 0 /
    // 판매 추이 보기 / 313,600원 / 366 / 1,617,000원 / 2,419 / 9.81%'): after the 비용 column, 'N원' + a bare number = 매출·조회수 of
    // 어제 → 7일 → 30일, and the lone percentage is the 반품률.
    if (costAt >= 0 && w.d30.rev == null) {
      const tail = t.slice(costAt);
      const pairs = [...tail.matchAll(/([\d,]+)\s*원(?!\s*\))\s*\n\s*(?:([\d,]+)(?![\d,]*\s*[원%]))?/g)].map(m => [num(m[1]), m[2] != null ? num(m[2]) : null]);
      const keys = pairs.length >= 3 ? ['y', 'd7', 'd30'] : pairs.length === 2 ? ['d7', 'd30'] : pairs.length === 1 ? ['d30'] : [];
      keys.forEach((k, i) => { if (w[k].rev == null) w[k].rev = pairs[i][0]; if (w[k].views == null) w[k].views = pairs[i][1]; });
    }
    // 판매가능 carries a '9일' days-left badge before the count
    const av = t.match(/판매\s*가능\s*(?:\D{0,12}?(\d+)\s*일)?\D{0,12}?([\d,]+)/);
    w.stock = { avail: av ? num(av[2]) : null, availDays: av && av[1] ? num(av[1]) : null,
      inbound: one(t, /입고\s*중\s*[:：]?\s*([\d,]+)/), recommend: one(t, /입고\s*권장\s*[:：]?\s*([\d,]+)/) };
    w.price = { list: one(t, /판매가\s*자동\s*조정\s*[:：]?\s*([\d,]+)/) ?? one(t, /판매가(?!능|\s*\()\s*[:：]?\s*([\d,]+)/),
      final: one(t, /최종\s*구매가\s*(?:할인)?\D{0,8}?([\d,]+)/) };
    w.cost = { unit: one(t, /예상\s*\(?\s*개당\s*\)?\s*[:：]?\D{0,8}?([\d,]+)/), storageMonth: one(t, /누적\s*보관비\s*[:：]?\s*([\d,]+)/) };
    const rm = t.match(/반품률\s*(?:\(\s*(\d+)\s*월\s*\))?[^\d%]{0,12}?([\d.]+)\s*%/);
    w.ret = { rate: rm ? num(rm[2]) : null, month: rm && rm[1] ? num(rm[1]) : null };
    if (w.ret.rate == null && costAt >= 0) { const pm = t.slice(costAt).match(/([\d.]+)\s*%/); if (pm) w.ret.rate = num(pm[1]); } // label lost in a drag-copy
    // product name: the longest non-header, non-numeric line before the first 어제
    const head = t.split(/어제/)[0].split(/[\n\t]/).map(s => s.replace(/\d{7,}(\s*[·•]\s*\d{7,})*|아이템위너|배지/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(s => s && /[가-힣A-Za-z]/.test(s) && !HEADER.test(s));
    w.name = head.length ? head.sort((a, b) => b.length - a.length)[0].slice(0, 80) : null;
    const ids = t.match(/(\d{10,12})\s*[·•]?\s*(\d{10,12})\s*[·•]?\s*(\d{7,9})/);
    w.ids = ids ? ids.slice(1, 4) : null;
    const missing = [];
    if (w.d30.sold == null && w.d7.sold == null) missing.push('판매량(지난 7일·30일)');
    if (w.stock.avail == null) missing.push('판매가능 재고');
    if (w.price.list == null) missing.push('판매가');
    if (w.d30.rev == null || w.ret.rate == null) missing.push(`${w.d30.rev == null ? '매출·조회수' : ''}${w.d30.rev == null && w.ret.rate == null ? '·' : ''}${w.ret.rate == null ? '반품률' : ''} — 재고현황에서 판매량 숫자(지난 30일)를 눌러 판매 상세를 펼친 뒤 상품 줄부터 상세 끝까지 복사하면 읽힙니다`);
    const ok = w.d30.sold != null || w.d7.sold != null;
    return { ok, w, missing };
  }

  // opts: lead(발주→입고 일), cover(리드타임 뒤 며칠치 더 두는지), perUnit(개당 순이익, 실판매가 기준, 없으면 null)
  function diagnose(w, opts) {
    const o = Object.assign({ lead: 25, cover: 30, perUnit: null }, opts || {});
    // 윙의 매출은 결제액이 아니라 단품 판매량 × 표시가다 (2026-09-21 실측: 1,617,000 = 단품 165 × 9,800, 313,600 = 32 × 9,800, 다른 상품
    // 79,000 = 10 × 7,900) — 번들 판매분 매출과 최종구매가 할인이 빠져 있어 실판매가는 여기서 못 구한다. 그 공식과 맞는지만 알린다.
    // A drag-copy loses the 단품·번들 split; when 매출 is an exact multiple of 표시가 within 판매량, that multiple is the 단품 count.
    const d = {}, rv = w.d30, L = w.price.list;
    let single = rv.single;
    if (single == null && rv.rev > 0 && L > 0 && rv.rev % L === 0 && rv.rev / L <= rv.sold) single = rv.rev / L;
    d.revUnits = single != null ? single : rv.sold;
    d.revInferred = rv.single == null && single != null;
    d.revPerUnit = rv.rev != null && d.revUnits > 0 ? rv.rev / d.revUnits : null;
    d.revIsList = d.revPerUnit != null && L > 0 ? Math.abs(rv.rev - d.revUnits * L) <= Math.max(L, rv.rev * 0.01) : null;
    d.rate7 = w.d7.sold != null ? w.d7.sold / 7 : null;
    d.rate30 = w.d30.sold != null ? w.d30.sold / 30 : null;
    d.rate = d.rate7 != null ? d.rate7 : d.rate30;            // 예측엔 최근 7일 속도, 없으면 30일
    d.trend = d.rate7 != null && d.rate30 > 0 ? d.rate7 / d.rate30 - 1 : null;
    const cvr = k => w[k].views > 0 && w[k].sold != null ? w[k].sold / w[k].views : null;
    d.cvr = { d7: cvr('d7'), d30: cvr('d30') };
    const b = w.d30.bundle, s = w.d30.single;
    d.bundleShare = b != null && s != null && b + s > 0 ? b / (b + s) : null;
    const avail = w.stock.avail || 0, inbound = w.stock.inbound || 0, total = avail + inbound;
    d.stock = { avail, inbound, total };
    if (d.rate > 0) {
      d.daysAvail = avail / d.rate; d.daysTotal = total / d.rate;
      d.leadDemand = d.rate * o.lead;
      d.shortage = Math.max(0, Math.ceil(d.leadDemand - total));   // 지금 발주해도 도착 전에 못 파는 수량
      d.gapDays = Math.max(0, o.lead - d.daysTotal);
      d.lostProfit = o.perUnit != null ? d.shortage * o.perUnit : null;
      d.reorderQty = Math.max(0, Math.ceil(d.rate * (o.lead + o.cover) - total));
      d.monthlyUnits = d.rate * 30;
      d.monthlyProfit = o.perUnit != null ? d.monthlyUnits * o.perUnit : null;
    } else { d.daysAvail = d.daysTotal = d.leadDemand = d.shortage = d.gapDays = d.reorderQty = d.monthlyUnits = null; d.lostProfit = d.monthlyProfit = null; }
    return d;
  }

  // 쿠팡 예상 비용(개당)을 요금표로 역산한다 — 실측: 2,678 = 최종구매가 7,350 × 7.8% + 극소형 입출고 980 + 배송 1,125 (원 단위 일치).
  // basis = 최종구매가(없으면 표시가), rate = 카테고리 수수료 %, table = 요금 그룹. 여섯 유형 중 가장 가까운 것과 그 오차를 돌려준다.
  function inferTier(costUnit, basis, rate, table) {
    const C = root.RgCalc;
    if (!C || !(costUnit > 0) || !(basis > 0) || !table || typeof rate !== 'number') return null;
    const ests = C.SIZES.map((_, i) => basis * rate / 100 + C.lookup(table, 'wh', i, basis) + C.lookup(table, 'sh', i, basis));
    let i = 0; ests.forEach((e, j) => { if (Math.abs(e - costUnit) < Math.abs(ests[i] - costUnit)) i = j; });
    return { i, est: ests[i], gap: (ests[i] - costUnit) / costUnit, ests };
  }

  root.RgWing = { parse, diagnose, inferTier };
})(typeof window !== 'undefined' ? window : globalThis);
