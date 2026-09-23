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
    let items = [], active = -1, query = '';
    const remembered = params.get(input.dataset.kind === 'items' ? 'item' : 'from') || localStorage.getItem('jikguse.' + input.dataset.kind);
    choose(list.find(x => x.slug === remembered) || list.find(x => x.slug === initialSlug) || list[0], false);
    // onPick runs before the label is written so it can change what the label says (country picked via a shop name)
    function choose(x, fire = true, typed) { picked[input.dataset.kind] = x; localStorage.setItem('jikguse.' + input.dataset.kind, x.slug); close(); onPick && onPick(x, fire ? (typed !== undefined ? typed : query) : undefined); input.value = labelOf(x); query = ''; if (fire) render(true); }
    function rank(x, q) { const t = searchOf(x).map(norm); if (t.includes(q)) return 0; if (t.some(k => k.startsWith(q))) return 1; return 2; }
    function open(q) {
      const nq = norm(q); query = q;
      items = (nq ? list.filter(x => searchOf(x).some(k => norm(k).includes(nq))).sort((a, b) => rank(a, nq) - rank(b, nq)) : list).slice(0, 8);
      menu.innerHTML = items.length ? items.map((x, i) => `<li role="option" data-i="${i}" ${i === active ? 'aria-selected="true"' : ''}>${labelOf(x, q)}</li>`).join('') : '<li class="empty">없는 항목이에요. 비슷한 품목을 골라 주세요.</li>';
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
    return { choose };
  }

  // ----- shop → country -----
  // "어디서 사나요" accepts a shop name too (알리 → 중국). The picked shop is shown in the field ("알리익스프레스 · 중국") and as a lit chip,
  // and decides the default price currency. Aliases (쉐인, temu…) live in countries.json shop_aliases.
  let shopPick = localStorage.getItem('jikguse.shop') || null;
  function shopOf(country, typed) {
    if (!typed) return null; const q = norm(typed), al = country.shop_aliases || {};
    const hit = (country.shops || []).find(x => norm(x).includes(q)); if (hit) return hit;
    const k = Object.keys(al).find(k => norm(k).includes(q)); return k ? al[k] : null;
  }
  const countryLabel = (c, q) => { const shop = q === undefined ? shopPick : shopOf(c, q); return shop ? `${shop} · ${c.name}` : c.name; };
  const QUICK_SHOPS = [['알리익스프레스', 'cn'], ['테무', 'cn'], ['쉬인', 'cn'], ['아마존', 'us'], ['아이허브', 'us'], ['타오바오', 'cn'], ['아마존 재팬', 'jp']];
  const shopChips = $('shops');
  shopChips.innerHTML = QUICK_SHOPS.map(([shop, slug]) => `<button type="button" class="chip" data-shop="${shop}" data-slug="${slug}"><span>${shop}</span></button>`).join('');
  function syncShopChips() { shopChips.querySelectorAll('.chip').forEach(b => b.classList.toggle('on', !!shopPick && b.dataset.shop === shopPick && picked.countries && picked.countries.slug === b.dataset.slug)); }

  // ----- price currency -----
  // The price field is in the country's currency by default, but people who paid in won (AliExpress·Temu·Shein show
  // won prices) shouldn't have to convert. Choices: country currency · USD · KRW. A manual pick sticks until the country changes.
  const KRW_SHOPS = /알리|테무|쉬인|쉐인|셰인|ali|temu|shein/i;
  const SYM = { USD: '$', KRW: '', JPY: '¥', CNY: '¥', EUR: '€', GBP: '£', HKD: 'HK$', AUD: 'A$' };
  const CUR_NAME = { USD: '달러', KRW: '원', JPY: '엔', CNY: '위안', EUR: '유로', GBP: '파운드', HKD: '홍콩달러', AUD: '호주달러' };
  const RATE = c => c === 'KRW' ? 1 : FX[c];
  const amt = (n, c) => c === 'KRW' ? Math.round(n).toLocaleString('ko-KR') + '원' : SYM[c] + n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  const curSel = $('cur');
  let curOverride = null; // { slug, cur } — a currency the user picked, valid while the same country is selected
  try { curOverride = JSON.parse(localStorage.getItem('jikguse.cur') || 'null'); } catch (e) { curOverride = null; }
  const curOptions = country => [...new Set([country.currency, 'USD', 'KRW'])];
  function currentCur(country) {
    const opts = curOptions(country);
    if (curOverride && curOverride.slug === country.slug && opts.includes(curOverride.cur)) return curOverride.cur;
    return curOverride && curOverride.slug === country.slug && curOverride.def || country.currency;
  }
  // Country pick: "알리/테무/쉬인" → default KRW; any other shop or the country itself → the country currency. Clears a manual pick from another country.
  function setCurDefault(country, typed) {
    const def = KRW_SHOPS.test(shopPick || typed || '') ? 'KRW' : country.currency;
    curOverride = { slug: country.slug, def };
    localStorage.setItem('jikguse.cur', JSON.stringify(curOverride));
  }
  function syncCurSelect(country) {
    const cur = currentCur(country), opts = curOptions(country);
    if (curSel.dataset.slug !== country.slug) { curSel.innerHTML = opts.map(c => `<option value="${c}">${c}</option>`).join(''); curSel.dataset.slug = country.slug; }
    curSel.value = cur; $('cur2').textContent = cur;
    return cur;
  }
  curSel.addEventListener('change', () => { const c = picked.countries; if (!c) return; curOverride = { slug: c.slug, def: curOverride && curOverride.slug === c.slug ? curOverride.def : c.currency, cur: curSel.value }; localStorage.setItem('jikguse.cur', JSON.stringify(curOverride)); render(true); });
  // "$29.9", "32,000원", "¥3,000" typed into the price field flips the chip to match (only to a currency that is on offer).
  function detectSymbol(text, country) {
    const opts = curOptions(country); let c = null;
    if (/원|₩/.test(text)) c = 'KRW';
    else if (/US?\$|(^|[^A-Z])\$/.test(text)) c = 'USD';
    else if (/¥|￥|円|元/.test(text)) c = opts.find(x => x === 'JPY' || x === 'CNY') || null;
    else if (/€/.test(text)) c = 'EUR'; else if (/£/.test(text)) c = 'GBP';
    return c && opts.includes(c) && c !== currentCur(country) ? c : null;
  }

  // ----- tax model (mirror of scripts/model.py) -----
  function compute(item, country, price, ship, fwd, fta, simplified, cur = country.currency) {
    // 면세 판정 금액 = 물품가 + 현지 배송비 (국제운송비·보험료 제외) — 관세청 소액면세 기준. cur = 입력 통화 (KRW 면 환율 1)
    const priceK = price * RATE(cur), shipK = ship * RATE(cur);
    // 면세 판정은 센트 단위로: 원화 왕복 나눗셈은 $190.05+$9.95 를 200.00000000000003 로 만들어 한도 초과로 읽는다 (GPT-6 Pro 2026-09-21)
    const usd = cur === 'USD' ? Math.round((price + ship) * 100) / 100 : Math.round((priceK + shipK) / FX.USD * 100) / 100;
    const excluded = item.excluded;
    const limit = (country.courier200 && !excluded) ? R.exemption_usd_us_courier : R.exemption_usd;
    const under = usd <= limit;
    const ftaOk = fta && country.fta && country.fta_zero !== false && item.group !== 'tobacco';
    const ftaPartial = fta && country.fta && country.fta_zero === false && item.group !== 'tobacco'; // 협정국이지만 품목별 잔존 관세 — 0% 확정 불가
    const ict = R.consumption_tax;
    let lines = [], method = 'exempt', taxable = 0, exempt = under, partial = false;
    if (item.group === 'alcohol') {
      const a = R.alcohol[item.alcohol]; taxable = priceK + shipK + fwd;
      const duty = (under || ftaOk) ? 0 : taxable * a.duty, liquor = (taxable + duty) * a.liquor, edu = liquor * a.edu, vat = under ? 0 : (taxable + duty + liquor + edu) * R.vat;
      lines = [[`관세<span class="pill">${(under||ftaOk) ? '면제' : Math.round(a.duty*100)+'%'}</span>`, duty], [`주세<span class="pill">${Math.round(a.liquor*100)}%</span>`, liquor], [`교육세<span class="pill">주세의 ${Math.round(a.edu*100)}%</span>`, edu], [`부가세<span class="pill">${under ? '면제' : '10%'}</span>`, vat]]; method = under ? 'alcohol_partial' : 'alcohol'; exempt = false; partial = under;
    } else if (under) { method = 'exempt'; }
    else if (item.group === 'tobacco') { method = 'unsupported'; }
    else {
      taxable = priceK + shipK + fwd; // 과세가격 = 물품가 + 현지 배송비 + 국제운송비(배대지 배송비) — 관세법 제30조 (GPT-6 Pro 2026-09-21)
      const useSimp = simplified && item.duty > 0 && !ftaOk && taxable <= R.simplified_cap_krw;
      if (useSimp) {
        const lux = Object.entries(R.luxury).filter(([k]) => !k.startsWith('_')).map(([, v]) => v).find(v => v.items.includes(item.slug));
        if (lux && taxable > lux.threshold_krw) { lines = [['간이세율 (개별소비세 대상 고가품)', lux.base_krw + (taxable - lux.threshold_krw) * lux.over_rate]]; method = 'simplified_luxury'; }
        else { const rate = R.simplified_rates[item.group]; lines = [[`간이세율<span class="pill">${Math.round(rate * 100)}% 통합</span>`, taxable * rate]]; method = 'simplified'; }
      } else {
        const duty = (ftaOk || item.duty === 0) ? 0 : taxable * item.duty;
        const vatRate = (R.vat_exempt_items || []).includes(item.slug) ? 0 : R.vat;
        lines = [[`관세<span class="pill">${ftaOk ? 'FTA 0%' : Math.round(item.duty * 1000) / 10 + '%' + (ftaPartial && item.duty > 0 ? ' · FTA 세율 확인 필요' : '')}</span>`, duty]];
        let excise = 0, edu = 0; const thr = ict.thresholds_krw[item.slug];
        if (thr && taxable + duty > thr) { excise = (taxable + duty - thr) * ict.rate; edu = excise * ict.edu; lines.push(['개별소비세<span class="pill">초과분 20%</span>', excise], ['교육세<span class="pill">개소세의 30%</span>', edu]); }
        lines.push([`부가세<span class="pill">${Math.round(vatRate * 100)}%</span>`, (taxable + duty + excise + edu) * vatRate]); method = 'general';
      }
    }
    const tax = lines.reduce((s, [, v]) => s + v, 0);
    return { cur, exempt, partial, limit, usd, priceK, shipK, fwd, taxable, lines, tax, total: priceK + shipK + tax + fwd, method, ftaOk: ftaOk && !under, ftaPartial: ftaPartial && !under && method === 'general' && item.duty > 0, eff: (priceK + shipK) ? tax / (priceK + shipK) * 100 : 0 };
  }


  // Count-up on the headline number (skipped when the user prefers reduced motion).
  function countUp(el) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const target = parseFloat(el.textContent.replace(/[^0-9.]/g, '')); if (!isFinite(target)) return;
    const fmt = el.textContent.includes(',') ? n => Math.round(n).toLocaleString('ko-KR') : n => String(Math.round(n));
    const t0 = performance.now(), dur = 420;
    (function step(t) { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(target * e); if (k < 1) requestAnimationFrame(step); })(t0);
  }

  // Home: the first priced result ends the landing state — hero + card glide up from centre (FLIP on transform) while the hidden sections below are armed to reveal.
  function leaveLanding() {
    const html = document.documentElement; if (!html.classList.contains('landing')) return;
    const stage = $('stage'), hero = stage.firstElementChild;
    const y0 = hero.getBoundingClientRect().top;
    html.classList.remove('landing');
    const dy = y0 - hero.getBoundingClientRect().top;
    if (dy > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // transform, not padding: the glide must not register as layout shift (CLS)
      stage.style.transition = 'none'; stage.style.transform = `translateY(${dy}px)`; void stage.offsetHeight;
      stage.style.transition = 'transform 1s cubic-bezier(.16,1,.3,1)'; stage.style.transform = 'translateY(0)';
      stage.addEventListener('transitionend', () => { stage.style.transition = ''; stage.style.transform = ''; }, { once: true });
    }
    if (window.__reveal) window.__reveal($('below'), true, 500);
  }
  // Result rises in Toss-style: label → amount → title → text → table → actions, 90ms apart.
  function riseIn() {
    const sheet = out.querySelector('.sheet'); if (!sheet) return;
    out.classList.remove('is-in'); out.classList.add('reveal');
    [sheet, ...sheet.children].forEach((el, i) => { el.classList.add('rv'); el.style.setProperty('--d', (i * 90) + 'ms'); });
    void out.offsetHeight; out.classList.add('is-in');
  }
  // On a phone the result sits below the form (often behind the browser's bottom bar): bring it into view so a tap visibly did something.
  // Layout position (offsetTop chain), not the rendered box: right after the first result the stage is mid-glide (translateY) and
  // scrollIntoView would land ~100px too far down; scroll-margin-top keeps the target below the sticky header.
  const bringIntoView = el => { if (innerWidth >= 900) return; setTimeout(() => { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop; y -= parseFloat(getComputedStyle(el).scrollMarginTop) || 0; scrollTo({ top: y, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, 60); };
  // scroll=true: a committed change (pick, price/ship/fwd change event, checkbox) — not per keystroke while the keyboard is up.
  function render(scroll) {
    const item = picked.items, country = picked.countries;
    if (!item || !country) return;
    // Currency chip follows the country (or the shop typed) even before a price is typed; the shipping label mirrors it.
    const cur = syncCurSelect(country);
    // Landing: nothing is shown until a price is typed; the "type a price" placeholder sheet only appears once the page has opened up.
    if (document.documentElement.classList.contains('landing') && !num($('price'))) return;
    const first = document.documentElement.classList.contains('landing');
    leaveLanding();
    const price = num($('price')), ship = num($('ship')), fwd = num($('fwd')), fta = $('fta').checked, simp = $('simp').checked;
    if (!price) { out.innerHTML = `<section class="sheet balanced quiet"><p class="sheet-label">예상 결제 총액</p><p class="sheet-title">가격을 넣으면 바로 계산됩니다</p><p class="sheet-text">${country.name} · ${item.name} · 면세 한도 미화 ${(country.courier200 && !item.excluded) ? 200 : 150}달러${cur === 'USD' ? '' : ` = ${amt(Math.round(((country.courier200 && !item.excluded) ? 200 : 150) * FX.USD / RATE(cur)), cur)} (이번 주 과세환율)`}</p></section>`; return; }
    const r = compute(item, country, price, ship, fwd, fta, simp, cur);
    const cls = r.exempt ? 'balanced' : r.eff > 60 ? 'severe' : r.eff > 20 ? 'moderate' : 'mild';
    let title, text;
    if (r.method === 'unsupported') { title = '담배는 아직 계산하지 않습니다'; text = '관세 40%에 개별소비세·담배소비세·지방교육세가 개비·그램 단위로 붙어 별도 확인이 필요합니다.'; }
    else if (r.partial) { title = `세금 ${won(r.tax)} · 관세·부가세만 면제`; text = `주류는 미화 ${r.limit}달러 이하(1병·1L 이하)면 관세와 부가세는 면제되지만 주세와 교육세는 그대로 붙습니다. 물품가+현지 배송비 미화 ${r.usd.toFixed(0)}달러, 과세가격 ${won(r.taxable)}.`; }
    else if (r.exempt) { title = `면세 — 세금 0원 · ${item.excluded ? '일반통관(소액면세)' : '목록통관'}`; text = `물품가+현지 배송비 미화 ${r.usd.toFixed(0)}달러로 한도 ${r.limit}달러 이내입니다. 총비용은 물품가 ${won(r.priceK)} + 배송 ${won(r.shipK)}${fwd ? ' + 배대지 ' + won(fwd) : ''}.`; }
    else {
      title = `세금 ${won(r.tax)} (${r.eff.toFixed(1)}%) · ${item.excluded ? '일반통관' : '목록통관 한도 초과'}`;
      const over = r.usd - r.limit;
      text = `물품가+현지 배송비 미화 ${r.usd.toFixed(0)}달러로 한도 ${r.limit}달러를 ${over.toFixed(0)}달러 넘어 전체가 과세됩니다. 과세가격 ${won(r.taxable)}${fwd ? ' (배대지 배송비 포함)' : ''}${r.ftaOk ? ' · FTA 적용으로 관세 0%' : ''}.${r.ftaPartial ? ` ${country.fta_name}는 품목별 잔존 관세가 있어 0%로 계산하지 않았습니다 — 관세율표의 협정세율을 확인하세요.` : ''}`;
    }
    const rows = r.lines.map(([n, v]) => `<tr><th>${n}</th><td>${won(v)}</td></tr>`).join('');
    // Non-USD input: show the conversion the verdict rests on, and warn near the limit when the user paid in won (the mall's rate ≠ customs' rate).
    let fxLine = '';
    if (cur !== 'USD' && r.method !== 'unsupported') {
      const edge = Math.abs(r.usd - r.limit) <= 10;
      fxLine = `<p class="sheet-text fxline">${amt(price + ship, cur)} ≈ US$${r.usd.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} (과세환율 ${cur === 'KRW' ? `${Math.round(FX.USD).toLocaleString('ko-KR')}원/$` : `1${CUR_NAME[cur]} = ${RATE(cur).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`})${edge && cur === 'KRW' ? ' · 쇼핑몰 환율과 세관 환율이 달라 한도 근처에서는 결과가 바뀔 수 있어요' : ''}</p>`;
    }
    let nearLimit = '';
    if (!r.exempt && !r.partial && r.method !== 'unsupported' && r.usd - r.limit < 30) {
      const under = Math.floor(r.limit * FX.USD / RATE(cur));
      const saved = item.group === 'alcohol' ? r.lines.filter(([n]) => /관세|부가세/.test(n)).reduce((s, [, v]) => s + v, 0) : r.tax;
      nearLimit = `<p class="sheet-text tip">한도를 ${(r.usd - r.limit).toFixed(0)}달러만 넘었습니다. 물품가를 ${amt(under, cur)} 아래로 맞추면 ${item.group === 'alcohol' ? `관세·부가세 ${won(saved)}이 빠집니다(주세·교육세는 남음)` : `세금 ${won(saved)}이 사라집니다`}.</p>`;
    }
    const actions = `<p class="sheet-actions"><a class="next" href="${base}items/${item.slug}/from/${country.slug}/">${country.name}에서 ${item.name} 직구 가이드</a>${item.cp ? `<a class="next" href="${item.cp.link}" rel="sponsored nofollow noopener" target="_blank">쿠팡 국내가와 비교</a>` : `<a class="next" href="https://www.coupang.com/np/search?q=${encodeURIComponent(item.name)}" rel="nofollow noopener" target="_blank">쿠팡 국내가와 비교</a>`}</p>${item.cp ? '<p class="muted small cp-note">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p>' : ''}`;
    out.innerHTML = `<section class="sheet ${cls}"><p class="sheet-label">예상 결제 총액</p><div class="sheet-num"><span class="num">${Math.round(r.total).toLocaleString('ko-KR')}</span><span class="pct">원</span></div><p class="sheet-title">${title}</p><p class="sheet-text">${text}</p>${fxLine}${nearLimit}${rows ? `<table class="tbl spec mini"><tbody><tr><th>물품가</th><td>${won(r.priceK)}</td></tr><tr><th>현지 배송비</th><td>${won(r.shipK)}</td></tr>${rows}${fwd ? `<tr><th>배대지 배송비</th><td>${won(fwd)}</td></tr>` : ''}</tbody></table>` : ''}${actions}</section>`;
    document.querySelectorAll('.sheet-num .num').forEach(countUp);
    if (first) riseIn();
    if (scroll === true) bringIntoView(out);
  }

  const countryPicker = picker($('country'), D.countries, countryLabel, c => [c.name, c.currency, ...(c.shops || []), ...Object.keys(c.shop_aliases || {})], 'us', (c, typed) => {
    if (typed !== undefined) { shopPick = shopOf(c, typed); if (shopPick) localStorage.setItem('jikguse.shop', shopPick); else localStorage.removeItem('jikguse.shop'); setCurDefault(c, typed); }
    else if (shopPick && !(c.shops || []).includes(shopPick)) { shopPick = null; localStorage.removeItem('jikguse.shop'); } // remembered shop from another country
    syncShopChips(); render();
  });
  shopChips.addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; const c = D.countries.find(x => x.slug === b.dataset.slug); if (c) countryPicker.choose(c, true, b.dataset.shop); });
  picker($('item'), D.items, i => i.name, i => [i.name, ...(i.aliases || [])], 'clothing');
  $('price').addEventListener('input', () => { const c = picked.countries, hit = c && detectSymbol($('price').value, c); if (hit) { curOverride = { slug: c.slug, def: curOverride && curOverride.slug === c.slug ? curOverride.def : c.currency, cur: hit }; localStorage.setItem('jikguse.cur', JSON.stringify(curOverride)); } });
  ['price', 'ship', 'fwd'].forEach(id => { $(id).addEventListener('input', () => render(false)); $(id).addEventListener('change', () => { if (num($('price'))) render(true); }); });
  $('fta').addEventListener('change', () => render(true)); $('simp').addEventListener('change', () => render(true));
  if (params.get('price')) $('price').value = params.get('price');
  window.addEventListener('pageshow', render);
  render();
})();
