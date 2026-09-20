// 윙 › 로켓그로스 › 상품 관리 화면(상품 한 줄 + 판매 요약 박스)을 복사해 붙여 넣은 텍스트를 읽는다. Pure functions, no DOM;
// loaded by rg-widget.js and scripts/test_wing.mjs.
//   parse(text)        → { ok, w, missing }   w = 판매량(어제·7일·30일, 단품·번들, 매출, 조회수) · 재고(판매가능·입고중·입고권장) ·
//                                              판매가(표시가·최종구매가) · 쿠팡 예상 비용(개당)·누적보관비 · 반품률(월)
//   diagnose(w, opts)  → 실판매가, 판매 속도·추세, 전환율, 재고 소진일, 리드타임 대비 부족분·놓치는 순이익, 추천 발주 수량
// Labels are matched loosely (whitespace, ⓘ badges, '자동조정'·'할인' tags in between) because the copied text keeps the layout
// only roughly; the layout verified so far is the 2026-09 상품 관리 list (scripts/fixtures/wing_*.txt).
(function (root) {
  const num = s => { const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n; };
  const one = (t, re) => { const m = t.match(re); return m ? num(m[m.length - 1]) : null; };
  const all = (t, re) => { const out = []; for (const m of t.matchAll(re)) out.push(num(m[1])); return out; };
  // 3 hits = 어제·7일·30일, 2 = 7일·30일, 1 = 30일 (the summary boxes run yesterday → 7d → 30d)
  const byPeriod = a => a.length >= 3 ? { y: a[0], d7: a[1], d30: a[2] } : a.length === 2 ? { y: null, d7: a[0], d30: a[1] } : { y: null, d7: null, d30: a[0] == null ? null : a[0] };
  const HEADER = /상품\s*정보|최근\s*판매량|재고\s*상태|판매가\s*\(|비용\s*\(|상품\s*상태|아이템위너|배지/;

  function parse(text) {
    const t = String(text || '').replace(/\u00a0/g, ' ').replace(/\r/g, '');
    const w = {};
    w.y = { sold: one(t, /어제\s*[:：]?\s*([\d,]+)/) };
    w.d7 = { sold: one(t, /지난\s*7\s*일\s*[:：]?\s*([\d,]+)/) };
    w.d30 = { sold: one(t, /지난\s*30\s*일\s*[:：]?\s*([\d,]+)/) };
    const single = all(t, /단품\s*기준\s*[:：]?\s*([\d,]+)/g), bundle = all(t, /번들\s*기준\s*[:：]?\s*([\d,]+)/g);
    const rev = byPeriod(all(t, /매출\s*[:：]?\s*([\d,]+)\s*원/g)), views = byPeriod(all(t, /조회\s*수\s*[:：]?\s*([\d,]+)/g));
    w.y.rev = rev.y; w.y.views = views.y;
    w.d7.rev = rev.d7; w.d7.views = views.d7; w.d7.single = single.length >= 2 ? single[0] : null; w.d7.bundle = bundle.length >= 2 ? bundle[0] : null;
    w.d30.rev = rev.d30; w.d30.views = views.d30; w.d30.single = single.length ? single[single.length - 1] : null; w.d30.bundle = bundle.length ? bundle[bundle.length - 1] : null;
    // 판매가능 carries a '9일' days-left badge before the count
    const av = t.match(/판매\s*가능\s*(?:\D{0,12}?(\d+)\s*일)?\D{0,12}?([\d,]+)/);
    w.stock = { avail: av ? num(av[2]) : null, availDays: av && av[1] ? num(av[1]) : null,
      inbound: one(t, /입고\s*중\s*[:：]?\s*([\d,]+)/), recommend: one(t, /입고\s*권장\s*[:：]?\s*([\d,]+)/) };
    w.price = { list: one(t, /판매가\s*자동\s*조정\s*[:：]?\s*([\d,]+)/) ?? one(t, /판매가(?!능|\s*\()\s*[:：]?\s*([\d,]+)/),
      final: one(t, /최종\s*구매가\s*(?:할인)?\D{0,8}?([\d,]+)/) };
    w.cost = { unit: one(t, /예상\s*\(?\s*개당\s*\)?\s*[:：]?\D{0,8}?([\d,]+)/), storageMonth: one(t, /누적\s*보관비\s*[:：]?\s*([\d,]+)/) };
    const rm = t.match(/반품률\s*(?:\(\s*(\d+)\s*월\s*\))?[^\d%]{0,12}?([\d.]+)\s*%/);
    w.ret = { rate: rm ? num(rm[2]) : null, month: rm && rm[1] ? num(rm[1]) : null };
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
    const ok = w.d30.sold != null || w.d7.sold != null;
    return { ok, w, missing };
  }

  // opts: lead(발주→입고 일), cover(리드타임 뒤 며칠치 더 두는지), perUnit(개당 순이익, 실판매가 기준, 없으면 null)
  function diagnose(w, opts) {
    const o = Object.assign({ lead: 25, cover: 30, perUnit: null }, opts || {});
    const asp = k => w[k] && w[k].sold > 0 && w[k].rev != null ? w[k].rev / w[k].sold : null;
    const d = { asp: { y: asp('y'), d7: asp('d7'), d30: asp('d30') } };
    d.discount = w.price.list > 0 && d.asp.d30 != null ? 1 - d.asp.d30 / w.price.list : null; // 표시가 대비 실판매가 할인율
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

  root.RgWing = { parse, diagnose };
})(typeof window !== 'undefined' ? window : globalThis);
