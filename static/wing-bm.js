// 북마클릿 "윙 → 로켓그로스 계산기" — runs INSIDE wing.coupang.com (injected by the bookmarklet on /rocket/, which also opens the
// calculator tab synchronously so the popup is allowed). Reads the 로켓그로스 재고현황 list and, per live item, the 판매분석 daily
// series (up to 364 days), then hands one JSON payload to the calculator tab with postMessage. Nothing is sent anywhere else and no
// Wing data leaves the seller's browser. Same-origin POSTs need X-XSRF-TOKEN = the XSRF-TOKEN cookie (measured 2026-09-20/21).
//   list:   POST /tenants/rfm-inventory/inventory-health-dashboard/search        (viProperties[], paginationResponse.searchAfterSortValues)
//   series: POST /tenants/rfm-ss/api/business-insight/vendor-item-summary        (saleSummaryByDate[{date, unitsSold}], sparse — no-sale days omitted)
// The bookmarklet sets window.__jkRg = { win, origin } before loading this file.
(async function () {
  const cfg = window.__jkRg || {};
  const ORIGIN = cfg.origin || 'https://jikguse.com/';
  const target = cfg.win;
  const DAYS = 364; // API limit: [today-364, today]
  const pad = n => (n < 10 ? '0' : '') + n;
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:14px 16px;border-radius:14px;background:#191f28;color:#fff;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)';
  box.innerHTML = '<b style="display:block;margin-bottom:4px">직구세 로켓그로스 계산기</b><span data-m>윙 재고현황을 읽는 중…</span>';
  document.body.appendChild(box);
  const say = m => { box.querySelector('[data-m]').textContent = m; };
  const fail = m => { say('실패: ' + m); box.style.background = '#b3261e'; setTimeout(() => box.remove(), 12000); if (target) try { target.postMessage({ type: 'jikguse-rg-wing-error', error: m }, ORIGIN.replace(/\/$/, '')); } catch (e) { /* closed */ } };
  try {
    if (!/wing\.coupang\.com$/.test(location.hostname)) return fail('쿠팡 윙(wing.coupang.com) 화면에서 눌러 주세요');
    const xsrf = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    if (!xsrf) return fail('윙 로그인 상태가 아니에요 — 로그인 후 다시 눌러 주세요');
    const post = async (url, body) => {
      const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': xsrf }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`${url.split('/').pop()} ${r.status}`);
      return r.json();
    };
    // 1. every 재고현황 row (VISIBLE + hidden-by-seller, so a hidden item's stock still counts)
    const rows = [];
    for (const hidden of ['VISIBLE', 'HIDDEN']) {
      let after = null;
      for (let pg = 0; pg < 30; pg++) {
        let j;
        try { j = await post('/tenants/rfm-inventory/inventory-health-dashboard/search', { paginationRequest: { pageSize: 200, pageNumber: pg, searchAfterSortValues: after }, hiddenStatus: hidden, sort: [{ sortParameter: 'ORDERABLE_QUANTITY', sortDirection: 'DESCENDING' }] }); }
        catch (e) { if (hidden === 'VISIBLE') throw e; break; } // the hidden list is a bonus
        const got = j.viProperties || []; for (const r of got) if (!rows.some(x => x.vendorItemId === r.vendorItemId)) rows.push(r);
        const p = j.paginationResponse || {}; after = p.searchAfterSortValues;
        if (!got.length || !after || !after.length || rows.length >= (p.totalNumberOfElements || 0)) break;
      }
    }
    const num = v => v == null ? null : Number(typeof v === 'object' ? v.amount : v);
    const items = [];
    for (const r of rows) {
      const L = r.listingDetails || {}, inv = r.inventoryDetails || {}, ss = r.salesStatistics || {}, pr = r.pricing || {}, st = r.settlementStatistics || {}, cr = r.creturnConfigViewDto || {};
      const avail = num(inv.orderableQuantity) || 0, inbound = num(inv.inProgressInboundStatistics && inv.inProgressInboundStatistics.inProgressInboundQuantity) || 0;
      const box_ = k => { const b = ss[k] || {}; return { sold: num(b.unitsSoldBeforeExcludingCancellations), canc: Math.abs(num(b.unitsCancelled) || 0), views: num(b.totalPageViews), gmv: num(b.gmv) }; };
      const d30 = box_('last30DaysSales');
      if (!(avail > 0 || inbound > 0 || d30.sold > 0)) continue; // dead rows (no stock, no sales) are noise
      const ins = cr.vendorItemCustomerReturnMonthlyInsights || {}, cur = ins['0'] || ins[0] || null;
      const list = num(pr.salesPrice), inst = num(pr.allMemberInstantDiscount) || 0;
      const cat5 = [cr.displayCategoryCodeLevel5, cr.displayCategoryCodeLevel4, cr.displayCategoryCodeLevel3, cr.displayCategoryCodeLevel2, cr.displayCategoryCodeLevel1].find(c => c);
      const take = num(st.takeRateAmount), wh = num(st.warehousingFee), ff = num(st.fulfillmentFee);
      items.push({
        id: r.vendorItemId, pid: L.productId, iid: L.itemId, name: L.vendorInventoryName || cr.productName || '', opt: L.vendorInventoryItemName || '', reg: L.productRegistrationDate || null,
        price: { list, final: list != null ? list - inst : null }, avail, inbound, doc: num(inv.daysOfCover), rec: inv.recommendedReplenishment ? { qty: num(inv.recommendedReplenishment.quantity), days: num(inv.recommendedReplenishment.replenishWithinDays) } : null,
        y: box_('yesterdaySales'), d7: box_('last7DaysSales'), d30,
        ret30: num(inv.customerReturns && inv.customerReturns.last30Days && inv.customerReturns.last30Days.count), ret: cur ? { rate: num(cur.returnRate), month: new Date().getMonth() + 1, units: num(cur.orderUnitCount), returns: num(cur.returnOrderUnitCount) } : null,
        cat: { code: cat5 || null, kan: cr.kanCategoryId || null, path: null }, cost: { unit: take != null && wh != null && ff != null ? Math.round(take + wh + ff) : null, take, wh, ff, storageMonth: num(inv.storageFee && inv.storageFee.monthlyStorageFeeAmount) },
        series: null,
      });
    }
    if (!items.length) return fail('재고나 최근 판매가 있는 로켓그로스 상품이 없어요');
    // 2. daily units per live item (4 at a time — each call ~0.6 s)
    const today = new Date(), end = ymd(today), start = ymd(new Date(today.getTime() - (DAYS - 1) * 864e5));
    let done = 0; const q = items.slice();
    say(`${items.length}개 상품의 일별 판매량을 읽는 중… 0/${items.length}`);
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (q.length) {
        const it = q.shift();
        try {
          const j = await post('/tenants/rfm-ss/api/business-insight/vendor-item-summary', { vendorItemId: it.id, startDate: start, endDate: end });
          const u = {}; for (const d of j.saleSummaryByDate || []) if (d && d.date) u[d.date] = Number(d.unitsSold) || 0;
          it.series = { from: start, to: end, u, at: j.lastSalesRefreshTimestamp || j.lastRefreshTimestamp || null };
          const vd = j.vendorItemDetails || {};
          if (Array.isArray(vd.categoryPath)) it.cat.path = vd.categoryPath.join('>');
          if (vd.displayCategoryCode && !it.cat.code) it.cat.code = vd.displayCategoryCode;
          if (vd.itemName && !it.name) it.name = vd.itemName;
        } catch (e) { it.seriesError = String(e && e.message || e); }
        done++; say(`${items.length}개 상품의 일별 판매량을 읽는 중… ${done}/${items.length}`);
      }
    }));
    const payload = { type: 'jikguse-rg-wing', v: 1, at: new Date().toISOString(), today: end, from: start, vendor: (rows[0] && rows[0].creturnConfigViewDto && rows[0].creturnConfigViewDto.vendorId) || null, count: rows.length, items };
    // 3. hand it to the calculator tab; it answers 'jikguse-rg-got'. Repeat until it does (the tab may still be loading).
    if (!target || target.closed) return fail('계산기 탭이 닫혔어요 — 다시 눌러 주세요');
    let got = false;
    const onMsg = e => { if (e.data && e.data.type === 'jikguse-rg-got') { got = true; } };
    window.addEventListener('message', onMsg);
    const origin = ORIGIN.replace(/\/$/, '');
    for (let i = 0; i < 120 && !got; i++) { try { target.postMessage(payload, origin); } catch (e) { /* not ready */ } await new Promise(r => setTimeout(r, 500)); }
    window.removeEventListener('message', onMsg);
    if (!got) return fail('계산기 탭이 응답하지 않아요 — 팝업 차단을 풀고 다시 눌러 주세요');
    say(`${items.length}개 상품을 계산기 탭으로 보냈어요 (일별 판매량 ${start} ~ ${end})`);
    box.style.background = '#1f7a4d';
    try { target.focus(); } catch (e) { /* ignore */ }
    setTimeout(() => box.remove(), 6000);
  } catch (e) { fail(String(e && e.message || e)); }
})();
