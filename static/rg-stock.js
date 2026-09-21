// 재고·발주 계획 — pure functions, no DOM. Loaded by rg-widget.js (재고 계획 card) and scripts/test_stock.mjs.
//   velocity(series, { today, reg })   → 7·30·90일 판매 속도 (series = { 'YYYY-MM-DD': units } from the Wing 판매분석 API, sparse:
//                                        days with no row are 0 only once the item exists — the window starts at the first known date/등록일)
//   weekly(series, today, weeks)       → last N weeks [{ from, to, units }] for the bar chart
//   STAGES / medians(orders)           → lead-time stages (1688 주문 → … → 쿠팡 입고 완료) and their medians from the 기록장 once ≥3 samples
//   eta(order, days, today)            → where an in-progress order is and when it should land
//   forecast({...})                    → 품절일(속도별 범위) · 발주 마감일 · 발주 수량, arrivals from the 기록장 folded in day by day
// Dates are 'YYYY-MM-DD' strings in the browser's local zone (the seller's clock, KST) — never toISOString (UTC flips the day at 09:00 KST).
(function (root) {
  const pad = n => (n < 10 ? '0' : '') + n;
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const addDays = (s, n) => { const d = parse(s); if (!d) return null; d.setDate(d.getDate() + n); return ymd(d); };
  const daysBetween = (a, b) => { const x = parse(a), y = parse(b); return x && y ? Math.round((y - x) / 864e5) : null; };
  const today = () => ymd(new Date());

  // A window of N days ending yesterday (today's row is partial until the nightly refresh). Days before the item existed are not
  // "0 sold" — they are left out of the divisor, so a 20-day-old item's 90-day rate is units / 20.
  function velocity(series, o) {
    o = o || {};
    const t = o.today || today();
    const keys = Object.keys(series || {}).filter(k => parse(k)).sort();
    const first = keys.length ? keys[0] : null;
    const born = [first, o.reg].filter(Boolean).sort()[0] || null; // earliest of first row / 등록일
    const win = n => {
      const from = addDays(t, -n), to = addDays(t, -1);
      let units = 0; for (const k of keys) if (k >= from && k <= to) units += +series[k] || 0;
      const start = born && born > from ? born : from;
      const days = !born || born > to ? 0 : Math.max(0, daysBetween(start, to) + 1); // nothing known yet → no rate, not 0/day
      return { units, days, rate: days > 0 ? units / days : null };
    };
    return { d7: win(7), d30: win(30), d90: win(90), first, born, today: t };
  }

  function weekly(series, t, weeks) {
    t = t || today(); weeks = weeks || 13;
    const out = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const to = addDays(t, -1 - w * 7), from = addDays(to, -6);
      let units = 0; for (const k in series) if (k >= from && k <= to) units += +series[k] || 0;
      out.push({ from, to, units });
    }
    return out;
  }

  // Each stage = the days from the previous recorded date to this one. Defaults sum to 25 (the lead the calculator assumed before).
  const STAGES = [
    { k: 'order', label: '1688 주문', next: '배대지 도착', d: 7 },
    { k: 'fwd', label: '배대지 도착', next: '출고·통관', d: 4 },
    { k: 'clear', label: '출고·통관', next: '국내 주소 도착', d: 2 },
    { k: 'kr', label: '국내 주소 도착', next: '포장·입고 요청', d: 4 },
    { k: 'req', label: '입고 요청', next: '쿠팡 입고 완료', d: 8 },
    { k: 'fc', label: '쿠팡 입고 완료', next: null, d: 0 },
  ];
  const MIN_SAMPLES = 3;
  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  // orders: [{ dates: { order, fwd, clear, kr, req, fc } }] — only consecutive recorded dates count for a stage; a skipped stage
  // (배대지 도착 blank, 출고 filled) contributes nothing to either. overrides: { order: 5 } typed by the seller wins over both.
  function medians(orders, overrides) {
    overrides = overrides || {};
    return STAGES.slice(0, -1).map((st, i) => {
      const nx = STAGES[i + 1].k, samples = [];
      for (const o of orders || []) { const a = o.dates && o.dates[st.k], b = o.dates && o.dates[nx]; const n = a && b ? daysBetween(a, b) : null; if (n != null && n >= 0) samples.push(n); }
      const med = median(samples);
      const typed = overrides[st.k] != null && overrides[st.k] !== '' && isFinite(+overrides[st.k]) ? +overrides[st.k] : null;
      const d = typed != null ? typed : samples.length >= MIN_SAMPLES ? med : st.d;
      return { k: st.k, label: st.label, next: st.next, d, n: samples.length, median: med, src: typed != null ? 'user' : samples.length >= MIN_SAMPLES ? 'log' : 'default' };
    });
  }
  const totalLead = stages => stages.reduce((s, x) => s + (+x.d || 0), 0);

  // The last recorded stage, and the day the goods should reach Coupang if every remaining stage takes its planned days.
  function eta(order, stages, t) {
    t = t || today();
    const dates = (order && order.dates) || {};
    let last = -1; STAGES.forEach((st, i) => { if (dates[st.k]) last = i; });
    if (last < 0) return { stage: null, done: false, eta: null, late: false };
    if (STAGES[last].k === 'fc') return { stage: STAGES[last], done: true, eta: dates.fc, late: false };
    let rem = 0; for (let i = last; i < STAGES.length - 1; i++) rem += +(stages[i] && stages[i].d) || 0;
    const e = addDays(dates[STAGES[last].k], rem);
    return { stage: STAGES[last], done: false, eta: e < t ? t : e, planned: e, late: e < t, remaining: rem };
  }

  // Day-by-day: stock today = 판매가능 + 입고중 (Coupang receives 입고중 within days); tracker arrivals land on their ETA.
  // rates: { d7, d30, d90 } (units/day, null when unknown); base = which one drives the headline ('d30' by default).
  function forecast(o) {
    const t = o.today || today();
    const stock0 = (+o.avail || 0) + (+o.inbound || 0);
    const arrivals = (o.arrivals || []).filter(a => a && a.date && a.qty > 0);
    const lead = +o.lead || 0, cover = +o.cover || 0, buffer = o.buffer != null ? +o.buffer : 0;
    const runOut = rate => {
      if (!(rate > 0)) return null;
      let s = stock0, day = t;
      for (let i = 0; i < 730; i++) {
        for (const a of arrivals) if (a.date === day) s += +a.qty;
        s -= rate;
        if (s < 0) return { date: day, days: i };
        day = addDays(day, 1);
      }
      return { date: null, days: 730 }; // more than two years — not a stockout question
    };
    const keys = ['d7', 'd30', 'd90'];
    const out = {}; keys.forEach(k => { out[k] = runOut(o.rates ? o.rates[k] : null); });
    const base = o.base && out[o.base] ? o.base : out.d30 ? 'd30' : keys.find(k => out[k]) || null;
    const main = base ? out[base] : null;
    const dated = keys.map(k => out[k]).filter(x => x && x.date);
    const range = dated.length > 1 ? { from: dated.map(x => x.date).sort()[0], to: dated.map(x => x.date).sort().slice(-1)[0] } : null;
    const spread = range ? daysBetween(range.from, range.to) : 0;
    let orderBy = null, gap = 0;
    if (main && main.date) {
      orderBy = addDays(main.date, -(lead + buffer));
      const arrive = addDays(t, lead);
      gap = Math.max(0, daysBetween(main.date, arrive)); // ordering today still leaves this many empty days
    }
    const rate = base && o.rates ? o.rates[base] : null;
    const arriving = arrivals.reduce((s, a) => s + (+a.qty || 0), 0);
    const qty = rate > 0 ? Math.max(0, Math.ceil(rate * (lead + cover) - stock0 - arriving)) : null;
    return { base, rate, stock0, arriving, by: out, main, range, spread, orderBy, gap, lead, cover, buffer, qty, past: orderBy != null && orderBy < t };
  }

  root.RgStock = { ymd, parse, addDays, daysBetween, today, velocity, weekly, STAGES, MIN_SAMPLES, medians, totalLead, eta, forecast, median };
})(typeof window !== 'undefined' ? window : globalThis);
