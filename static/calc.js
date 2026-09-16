(async function () {
  const cssHref = document.querySelector('link[href*="static/style.css"]').getAttribute('href');
  const v = (cssHref.match(/\?v=([^&]+)/) || [])[1] || '';
  const base = cssHref.replace(/static\/style\.css.*$/, '');
  const D = await (await fetch(base + 'static/data.json?v=' + v)).json();
  const R = D.rules, FX = D.fx.rates;
  const out = document.getElementById('result');
  const $ = id => document.getElementById(id);
  const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const num = el => { const n = parseFloat((el.value || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };
  const norm = s => s.toLowerCase().replace(/\s+/g, '');
  const params = new URLSearchParams(location.search);

  // ----- pickers (same component as PCPairs) -----
  const picked = {};
  function picker(input, list, labelOf, searchOf, initialSlug, onPick) {
    const menu = $(input.id + '-menu');
    let items = [], active = -1;
    const remembered = params.get(input.dataset.kind === 'items' ? 'item' : 'from') || localStorage.getItem('jikguse.' + input.dataset.kind);
    choose(list.find(x => x.slug === remembered) || list.find(x => x.slug === initialSlug) || list[0], false);
    function choose(x, fire = true) { picked[input.dataset.kind] = x; input.value = labelOf(x); localStorage.setItem('jikguse.' + input.dataset.kind, x.slug); close(); onPick && onPick(x); if (fire) render(); }
    function rank(x, q) { const t = searchOf(x).map(norm); if (t.includes(q)) return 0; if (t.some(k => k.startsWith(q))) return 1; return 2; }
    function open(q) {
      const nq = norm(q);
      items = (nq ? list.filter(x => searchOf(x).some(k => norm(k).includes(nq))).sort((a, b) => rank(a, nq) - rank(b, nq)) : list).slice(0, 8);
      menu.innerHTML = items.length ? items.map((x, i) => `<li role="option" data-i="${i}" ${i === active ? 'aria-selected="true"' : ''}>${labelOf(x)}</li>`).join('') : '<li class="empty">없는 항목이에요. 비슷한 품목을 골라 주세요.</li>';
      menu.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
    function close() { menu.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); }
    input.addEventListener('focus', () => { setTimeout(() => input.select(), 0); open(''); });
    input.addEventListener('click', () => { if (picked[input.dataset.kind] && input.value === labelOf(picked[input.dataset.kind])) input.select(); });
    input.addEventListener('input', () => { active = -1; open(input.value); });
    input.addEventListener('keydown', e => {
      if (menu.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); open(input.value); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); open(input.value); e.preventDefault(); }
      else if (e.key === 'Enter') { const it = items[active >= 0 ? active : 0]; if (it) choose(it); e.preventDefault(); }
      else if (e.key === 'Escape') { close(); input.value = labelOf(picked[input.dataset.kind]); }
    });
    menu.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { choose(items[+li.dataset.i]); e.preventDefault(); } });
    input.addEventListener('blur', () => setTimeout(() => { close(); const p = picked[input.dataset.kind]; if (p) input.value = labelOf(p); }, 120));
  }

  // ----- tax model (mirror of scripts/model.py) -----
  function compute(item, country, price, ship, fwd, fta, simplified) {
    const cur = country.currency, priceK = price * FX[cur], shipK = ship * FX[cur], usd = priceK / FX.USD;
    const excluded = item.excluded;
    const limit = (country.courier200 && !excluded) ? R.exemption_usd_us_courier : R.exemption_usd;
    const under = usd <= limit;
    const ftaOk = fta && country.fta && item.group !== 'tobacco';
    const ict = R.consumption_tax;
    let lines = [], method = 'exempt', taxable = 0, exempt = under, partial = false;
    if (item.group === 'alcohol') {
      const a = R.alcohol[item.alcohol]; taxable = priceK + shipK;
      const duty = (under || ftaOk) ? 0 : taxable * a.duty, liquor = (taxable + duty) * a.liquor, edu = liquor * a.edu, vat = under ? 0 : (taxable + duty + liquor + edu) * R.vat;
      lines = [['관세', duty], ['주세', liquor], ['교육세', edu], ['부가세', vat]]; method = under ? 'alcohol_partial' : 'alcohol'; exempt = false; partial = under;
    } else if (under) { method = 'exempt'; }
    else if (item.group === 'tobacco') { method = 'unsupported'; }
    else {
      taxable = priceK + shipK;
      const useSimp = simplified && item.duty > 0 && !ftaOk && taxable <= R.simplified_cap_krw;
      if (useSimp) {
        const lux = Object.entries(R.luxury).filter(([k]) => !k.startsWith('_')).map(([, v]) => v).find(v => v.items.includes(item.slug));
        if (lux && taxable > lux.threshold_krw) { lines = [['간이세율 (개별소비세 대상 고가품)', lux.base_krw + (taxable - lux.threshold_krw) * lux.over_rate]]; method = 'simplified_luxury'; }
        else { const rate = R.simplified_rates[item.group]; lines = [[`간이세율 ${Math.round(rate * 100)}% (관세·부가세 통합)`, taxable * rate]]; method = 'simplified'; }
      } else {
        const duty = (ftaOk || item.duty === 0) ? 0 : taxable * item.duty;
        const vatRate = (R.vat_exempt_items || []).includes(item.slug) ? 0 : R.vat;
        lines = [[`관세 ${ftaOk ? '0% (FTA)' : Math.round(item.duty * 1000) / 10 + '%'}`, duty]];
        let excise = 0, edu = 0; const thr = ict.thresholds_krw[item.slug];
        if (thr && taxable + duty > thr) { excise = (taxable + duty - thr) * ict.rate; edu = excise * ict.edu; lines.push(['개별소비세 (기준 초과분 20%)', excise], ['교육세', edu]); }
        lines.push([`부가세 ${Math.round(vatRate * 100)}%`, (taxable + duty + excise + edu) * vatRate]); method = 'general';
      }
    }
    const tax = lines.reduce((s, [, v]) => s + v, 0);
    return { exempt, partial, limit, usd, priceK, shipK, taxable, lines, tax, total: priceK + shipK + tax + fwd, method, ftaOk: ftaOk && !under, eff: (priceK + shipK) ? tax / (priceK + shipK) * 100 : 0 };
  }


  // Count-up on the headline number (skipped when the user prefers reduced motion).
  function countUp(el) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const target = parseFloat(el.textContent.replace(/[^0-9.]/g, '')); if (!isFinite(target)) return;
    const fmt = el.textContent.includes(',') ? n => Math.round(n).toLocaleString('ko-KR') : n => String(Math.round(n));
    const t0 = performance.now(), dur = 420;
    (function step(t) { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(target * e); if (k < 1) requestAnimationFrame(step); })(t0);
  }

  function render() {
    const item = picked.items, country = picked.countries;
    if (!item || !country) return;
    const cur = country.currency;
    $('cur1').textContent = `(${cur})`; $('cur2').textContent = `(${cur})`;
    const price = num($('price')), ship = num($('ship')), fwd = num($('fwd')), fta = $('fta').checked, simp = $('simp').checked;
    if (!price) { out.innerHTML = `<section class="sheet balanced quiet"><p class="sheet-title">가격을 넣으면 바로 계산됩니다</p><p class="sheet-text">${country.name} · ${item.name} · 면세 한도 미화 ${(country.courier200 && !item.excluded) ? 200 : 150}달러 = ${country.symbol}${Math.round(((country.courier200 && !item.excluded) ? 200 : 150) * FX.USD / FX[cur]).toLocaleString('ko-KR')} (이번 주 과세환율)</p></section>`; return; }
    const r = compute(item, country, price, ship, fwd, fta, simp);
    const cls = r.exempt ? 'balanced' : r.eff > 60 ? 'severe' : r.eff > 20 ? 'moderate' : 'mild';
    let title, text;
    if (r.method === 'unsupported') { title = '담배는 아직 계산하지 않습니다'; text = '관세 40%에 개별소비세·담배소비세·지방교육세가 개비·그램 단위로 붙어 별도 확인이 필요합니다.'; }
    else if (r.partial) { title = `세금 ${won(r.tax)} · 관세·부가세만 면제`; text = `주류는 미화 ${r.limit}달러 이하(1병·1L 이하)면 관세와 부가세는 면제되지만 주세와 교육세는 그대로 붙습니다. 물품가 미화 ${r.usd.toFixed(0)}달러, 과세가격 ${won(r.taxable)}.`; }
    else if (r.exempt) { title = `면세 — 세금 0원 · ${item.excluded ? '일반통관(소액면세)' : '목록통관'}`; text = `물품가 미화 ${r.usd.toFixed(0)}달러로 한도 ${r.limit}달러 이내입니다. 총비용은 물품가 ${won(r.priceK)} + 배송 ${won(r.shipK)}${fwd ? ' + 배대지 ' + won(fwd) : ''}.`; }
    else {
      title = `세금 ${won(r.tax)} (${r.eff.toFixed(1)}%) · ${item.excluded ? '일반통관' : '목록통관 한도 초과'}`;
      const over = r.usd - r.limit;
      text = `물품가 미화 ${r.usd.toFixed(0)}달러로 한도 ${r.limit}달러를 ${over.toFixed(0)}달러 넘어 전체가 과세됩니다. 과세가격 ${won(r.taxable)}${r.ftaOk ? ' · FTA 적용으로 관세 0%' : ''}.`;
    }
    const rows = r.lines.map(([n, v]) => `<tr><th>${n}</th><td>${won(v)}</td></tr>`).join('');
    let nearLimit = '';
    if (!r.exempt && !r.partial && r.method !== 'unsupported' && r.usd - r.limit < 30) {
      const under = Math.floor(r.limit * FX.USD / FX[cur]);
      const saved = item.group === 'alcohol' ? r.lines.filter(([n]) => /관세|부가세/.test(n)).reduce((s, [, v]) => s + v, 0) : r.tax;
      nearLimit = `<p class="sheet-text tip">한도를 ${(r.usd - r.limit).toFixed(0)}달러만 넘었습니다. 물품가를 ${country.symbol}${under.toLocaleString('ko-KR')} 아래로 맞추면 ${item.group === 'alcohol' ? `관세·부가세 ${won(saved)}이 빠집니다(주세·교육세는 남음)` : `세금 ${won(saved)}이 사라집니다`}.</p>`;
    }
    const actions = `<p class="sheet-actions"><a class="next" href="${base}items/${item.slug}/from/${country.slug}/">${country.name}에서 ${item.name} 직구 가이드</a><a class="next" href="https://www.coupang.com/np/search?q=${encodeURIComponent(item.name)}" rel="nofollow noopener" target="_blank">쿠팡 국내가와 비교</a></p>`;
    out.innerHTML = `<section class="sheet ${cls}"><div class="sheet-num"><span class="num">${Math.round(r.total).toLocaleString('ko-KR')}</span><span class="pct">원</span></div><p class="sheet-title">${title}</p><p class="sheet-text">${text}</p>${nearLimit}${rows ? `<table class="tbl spec mini"><tbody><tr><th>물품가</th><td>${won(r.priceK)}</td></tr><tr><th>해외 배송비</th><td>${won(r.shipK)}</td></tr>${rows}${fwd ? `<tr><th>배대지·국내 배송</th><td>${won(fwd)}</td></tr>` : ''}</tbody></table>` : ''}${actions}</section>`;
    document.querySelectorAll('.sheet-num .num').forEach(countUp);
  }

  picker($('country'), D.countries, c => c.name, c => [c.name, c.currency, ...(c.shops || [])], 'us', () => { render(); });
  picker($('item'), D.items, i => i.name, i => [i.name, ...(i.aliases || [])], 'clothing');
  ['price', 'ship', 'fwd'].forEach(id => $(id).addEventListener('input', render));
  $('fta').addEventListener('change', render); $('simp').addEventListener('change', render);
  if (params.get('price')) $('price').value = params.get('price');
  render();
})();
