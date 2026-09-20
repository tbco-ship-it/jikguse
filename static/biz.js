// 사업자 수입 계산기 page: HS picker per line, LCL freight allocation, result sheet. Model in biz-calc.js.
(async function () {
  const $ = id => document.getElementById(id);
  const cssHref = document.querySelector('link[href*="static/style.css"]').getAttribute('href');
  const base = cssHref.replace(/static\/style\.css.*$/, '');
  const D = await (await fetch(base + 'static/data.json?v=' + ((cssHref.match(/\?v=([^&]+)/) || [])[1] || ''))).json();
  const FX = D.fx.rates;
  const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const num = el => { const n = parseFloat((el.value || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; };
  const pct = r => (Math.round(r * 10) / 10) + '%';
  const fmtHs = c => c.slice(0, 4) + '.' + c.slice(4, 6) + '-' + c.slice(6);
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const out = $('result'), linesEl = $('lines');
  const { BizCalc } = window;

  // ----- HS table (lazy, ~400 KB gzipped) -----
  let HS = null, REQ = null, byCode = {};
  const hsUrl = linesEl.dataset.hs, reqUrl = linesEl.dataset.req;
  const hsReady = fetch(hsUrl).then(r => r.json()).then(d => {
    HS = d;
    const norm = s => s.toLowerCase().replace(/\s+/g, '');
    for (const c of d.codes) {
      byCode[c.c] = c;
      c.h4 = d.h4[c.c.slice(0, 4)] || ''; c.h6 = d.h6[c.c.slice(0, 6)] || d.h6[c.c.slice(0, 5)] || '';
      c.s = norm([c.c, c.h4, c.h6, c.p || '', c.n, c.e, ...(c.k || [])].join('|'));
      c.top = norm([c.n, ...(c.k || [])].join('|'));
    }
    mountAll(); render();
  });
  const reqReady = () => REQ ? Promise.resolve(REQ) : fetch(reqUrl).then(r => r.json()).then(d => (REQ = d.req));

  function search(q) {
    const toks = q.toLowerCase().split(/\s+/).map(t => t.replace(/[.\-]/g, '')).filter(Boolean);
    const nq = toks.join('');
    if (!nq) return [];
    if (/^\d{2,10}$/.test(nq)) return HS.codes.filter(c => c.c.startsWith(nq)).slice(0, 8);
    const hits = [];
    for (const c of HS.codes) {
      if (!toks.every(t => c.s.includes(t))) continue;
      const rank = c.top.includes(nq) ? 0 : (c.h6 && c.h6.toLowerCase().replace(/\s+/g, '').includes(nq)) ? 1 : 2;
      hits.push([rank, c]);
      if (hits.length > 400) break;
    }
    return hits.sort((a, b) => a[0] - b[0]).slice(0, 8).map(x => x[1]);
  }
  // Heading › subheading › leaf, dropping repeated '기타' steps so the label reads as a path.
  function labelOf(c) {
    const parts = [c.h4, c.h6, c.p, c.n].filter(Boolean).map(s => s.length > 48 ? s.slice(0, 46) + '…' : s);
    return parts.filter((p, i) => i === parts.length - 1 || p !== parts[i + 1]).join(' › ');
  }

  // ----- lines -----
  const KEY = 'jikguse.biz';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
  const lines = (saved.lines && saved.lines.length ? saved.lines : [{ hs: '', qty: '', price: '' }]).map(l => ({ ...l, entry: null }));

  function lineHtml(i) {
    return `<div class="line" data-i="${i}">
      <label class="field"><span>품목 <small class="muted">(품명이나 HS 코드)</small></span>
        <input class="pick hs" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" placeholder="${HS ? '낚시 릴, 후드티, 9507.30…' : '세율표 불러오는 중…'}" ${HS ? '' : 'disabled'}><ul class="menu" role="listbox" hidden></ul>
      </label>
      <div class="qp">
        <label class="field">수량<input class="num-in qty" type="text" inputmode="numeric" placeholder="100" autocomplete="off"></label>
        <label class="field"><span>단가 <span class="cur-l muted">USD</span></span><input class="num-in price" type="text" inputmode="decimal" placeholder="8.5" autocomplete="off"></label>
        <button type="button" class="rm" aria-label="품목 삭제">✕</button>
      </div>
      <p class="line-meta muted small"></p>
    </div>`;
  }

  function mountLine(el) {
    const i = +el.dataset.i, L = lines[i];
    const input = el.querySelector('.hs'), menu = el.querySelector('.menu'), meta = el.querySelector('.line-meta');
    const qty = el.querySelector('.qty'), price = el.querySelector('.price');
    qty.value = L.qty || ''; price.value = L.price || '';
    let items = [], active = -1;
    const setMeta = () => {
      if (!L.entry) { meta.textContent = ''; return; }
      const rt = BizCalc.rateFor(L.entry, HS.cols, $('origin').value, true);
      const bits = [fmtHs(L.entry.c), `기본 ${pct(rt.mfn.rate)}${rt.mfn.code === 'C' ? ' (WTO)' : ''}`];
      if (rt.fta) bits.push(`${rt.fta.label} ${pct(rt.fta.rate)}`);
      if (L.entry.u) bits.push('종량세 병행');
      if (L.entry.q) bits.push('세관장확인');
      meta.textContent = bits.join(' · ');
    };
    const choose = (c, fire = true) => { L.entry = c; L.hs = c ? c.c : ''; input.value = c ? c.n : ''; input.title = c ? labelOf(c) : ''; close(); setMeta(); if (fire) render(); };
    const open = q => {
      items = search(q);
      menu.innerHTML = items.length ? items.map((c, k) => `<li role="option" data-i="${k}" ${k === active ? 'aria-selected="true"' : ''}><b>${esc(c.n)}</b><small>${esc(fmtHs(c.c))} · ${esc(labelOf(c).replace(/ › [^›]*$/, ''))}</small></li>`).join('')
        : `<li class="empty">${q.trim() ? '검색 결과가 없어요. 다른 말이나 HS 앞 4자리로 찾아보세요.' : '품명, 영문명, HS 코드 앞자리로 검색'}</li>`;
      menu.hidden = false; input.setAttribute('aria-expanded', 'true');
    };
    const close = () => { menu.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); };
    input.addEventListener('focus', () => { if (!HS) return; setTimeout(() => input.select(), 0); open(input.value); });
    input.addEventListener('input', () => { active = -1; open(input.value); });
    input.addEventListener('keydown', e => {
      if (menu.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); open(input.value); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); open(input.value); e.preventDefault(); }
      else if (e.key === 'Enter') { const it = items[active >= 0 ? active : 0]; if (it) choose(it); e.preventDefault(); }
      else if (e.key === 'Escape') { close(); input.value = L.entry ? L.entry.n : ''; }
    });
    menu.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { choose(items[+li.dataset.i]); e.preventDefault(); } });
    input.addEventListener('blur', () => setTimeout(() => { close(); if (L.entry) input.value = L.entry.n; }, 120));
    qty.addEventListener('input', () => { L.qty = qty.value; render(); });
    price.addEventListener('input', () => { L.price = price.value; render(); });
    el.querySelector('.rm').addEventListener('click', () => { lines.splice(i, 1); if (!lines.length) lines.push({ hs: '', qty: '', price: '', entry: null }); mountAll(); render(); });
    if (HS && L.hs && byCode[L.hs]) choose(byCode[L.hs], false);
    el.__setMeta = setMeta;
  }
  function mountAll() {
    linesEl.innerHTML = lines.map((_, i) => lineHtml(i)).join('');
    linesEl.querySelectorAll('.line').forEach(mountLine);
    linesEl.querySelectorAll('.cur-l').forEach(s => { s.textContent = $('cur').value; });
    linesEl.querySelectorAll('.rm').forEach(b => { b.hidden = lines.length === 1; });
  }
  $('add').addEventListener('click', () => { lines.push({ hs: '', qty: '', price: '', entry: null }); mountAll(); const last = linesEl.querySelector('.line:last-child .hs'); if (last && !last.disabled) last.focus(); });

  // ----- shipment fields -----
  const origin = $('origin');
  BizCalc.ORIGINS.forEach(o => origin.add(new Option(o.name, o.k)));
  origin.value = saved.origin || 'CN';
  const CURS = ['USD', 'CNY', 'JPY', 'EUR', 'GBP', 'HKD', 'AUD', 'CAD', 'SGD', 'TWD'].filter(c => FX[c]);
  CURS.forEach(c => $('cur').add(new Option(`${c} (${FX[c].toLocaleString('ko-KR')}원)`, c)));
  $('cur').value = saved.cur || 'USD';
  ['KRW', ...CURS].forEach(c => $('frcur').add(new Option(c, c)));
  $('frcur').value = saved.frcur || 'USD';
  ['freight', 'ins', 'broker', 'domestic'].forEach(id => { if (saved[id]) $(id).value = saved[id]; });
  $('co').checked = !!saved.co;
  const rerender = () => { linesEl.querySelectorAll('.line').forEach(el => el.__setMeta && el.__setMeta()); render(); };
  origin.addEventListener('change', rerender);
  $('cur').addEventListener('change', () => { linesEl.querySelectorAll('.cur-l').forEach(s => { s.textContent = $('cur').value; }); render(); });
  $('frcur').addEventListener('change', () => { $('frcur2').textContent = $('frcur').value; render(); });
  $('frcur2').textContent = $('frcur').value;
  ['freight', 'ins', 'broker', 'domestic'].forEach(id => $(id).addEventListener('input', render));
  $('co').addEventListener('change', rerender);

  function save() {
    localStorage.setItem(KEY, JSON.stringify({ lines: lines.map(l => ({ hs: l.hs, qty: l.qty, price: l.price })), origin: origin.value, cur: $('cur').value, frcur: $('frcur').value,
      freight: $('freight').value, ins: $('ins').value, broker: $('broker').value, domestic: $('domestic').value, co: $('co').checked }));
  }

  // ----- result -----
  function render() {
    save();
    if (!HS) return;
    const cur = $('cur').value;
    const input = { fx: FX, cur, cols: HS.cols, origin: origin.value, co: $('co').checked, freight: num($('freight')), freightCur: $('frcur').value, insurance: num($('ins')),
      brokerageKrw: num($('broker')), domesticKrw: num($('domestic')), lines: lines.map(l => ({ entry: l.entry, qty: parseFloat(l.qty) || 0, price: parseFloat(l.price) || 0 })) };
    const r = BizCalc.compute(input);
    if (!r.lines.length) {
      out.innerHTML = `<section class="sheet balanced quiet"><p class="sheet-label">예상 세액</p><p class="sheet-title">품목·수량·단가를 넣으면 바로 계산됩니다</p><p class="sheet-text">사업자 일반 수입신고 기준 — 150달러 면세·목록통관·간이세율은 적용하지 않습니다. 이번 주 과세환율 USD ${FX.USD.toLocaleString('ko-KR')}원.</p></section>`;
      return;
    }
    const orig = BizCalc.ORIGINS.find(o => o.k === origin.value);
    const rows = r.lines.map(l => `<tr><th><span class="ln">${esc(l.entry.n)}</span><small>${fmtHs(l.entry.c)} · ${l.qty.toLocaleString('ko-KR')} × ${l.price.toLocaleString('ko-KR')} ${cur}</small></th><td data-l="과세가격">${won(l.cif)}</td><td data-l="세율">${pct(l.rate.applied.rate)}<small>${esc(l.rate.applied.label)}</small></td><td data-l="관세">${won(l.duty)}</td><td data-l="부가세">${won(l.vat)}</td></tr>`).join('');
    const notes = [];
    if (input.co && r.ftaLines) notes.push(`협정세율 ${r.ftaLines}개 품목 — 수입신고 때 ${esc(orig.name)} 원산지증명서(C/O)를 제출해야 합니다. 원산지 기준(역내 부가가치·세번 변경)을 못 채우면 기본세율로 돌아갑니다.`);
    if (input.co && !r.ftaLines) notes.push(`${esc(orig.name)} 원산지 협정세율이 기본세율보다 낮은 품목이 없어 C/O 없이도 같은 세액입니다.`);
    if (!input.co && orig.codes.length && r.lines.some(l => l.rate.fta && l.rate.fta.rate < l.rate.mfn.rate)) {
      const saveK = r.lines.reduce((s, l) => s + (l.rate.fta && l.rate.fta.rate < l.rate.mfn.rate ? l.duty - BizCalc.floor10(l.cif * l.rate.fta.rate / 100) : 0), 0);
      notes.push(`원산지증명서(C/O)를 갖추면 관세가 약 ${won(saveK)} 줄어듭니다 — 위 '원산지증명서 있음'을 켜서 비교해 보세요.`);
    }
    if (r.staleLines) notes.push(`${r.staleLines}개 품목의 협정세율은 자료 기준일 이후 한 단계 더 내려갔을 수 있습니다(관세청 관세율표 갱신 전). 관세청 CLIP에서 현재 세율을 확인하세요.`);
    if (r.specificLines) notes.push(`${r.specificLines}개 품목은 종량세(㎏·ℓ당 세액)가 함께 적용되는 품목입니다. 여기 관세는 종가세 부분만이라 실제 세액이 더 클 수 있습니다.`);
    const reqLines = r.lines.filter(l => l.req);
    const reqBlock = reqLines.length ? `<div class="req" id="req"><p class="sheet-title">세관장확인 대상 ${reqLines.length}개 품목 — 수입요건 먼저 확인</p><p class="sheet-text">관세법 제226조에 따라 신고 전에 요건승인기관 확인이 필요합니다. 요건이 없으면 통관이 보류됩니다.</p><ul class="req-list">${reqLines.map(l => `<li data-hs="${l.entry.c}"><b>${esc(l.entry.n)}</b> <small>${fmtHs(l.entry.c)}</small><div class="req-body muted small">불러오는 중…</div></li>`).join('')}</ul></div>` : '';
    out.innerHTML = `<section class="sheet ${r.tax ? 'moderate' : 'balanced'}"><p class="sheet-label">예상 세액 (관세 + 부가세)</p><div class="sheet-num"><span class="num">${Math.round(r.tax).toLocaleString('ko-KR')}</span><span class="pct">원</span></div>
      <p class="sheet-title">관세 ${won(r.duty)} + 부가세 ${won(r.vat)} · 총 착지비용 ${won(r.landed)}</p>
      <p class="sheet-text">부가세 ${won(r.vat)}은 매입세액공제 대상이라 사업자 실부담은 <strong>${won(r.landedNet)}</strong>(물품가 ${won(r.goodsKrw)} + 운임·보험 ${won(r.freightKrw + r.insKrw)} + 관세 ${won(r.duty)}${r.brokerage + r.domestic ? ' + 수수료·국내운송 ' + won(r.brokerage + r.domestic) : ''})입니다. 과세가격 합계 ${won(r.cif)} = 물품가 미화 ${Math.round(r.goodsUsd).toLocaleString('ko-KR')}달러 + 운임·보험, 품목별 물품가 비례 안분.</p>
      ${notes.map(n => `<p class="sheet-text tip">${n}</p>`).join('')}
      <div class="tbl-wrap"><table class="tbl spec biz"><thead><tr><th>품목</th><th>과세가격</th><th>세율</th><th>관세</th><th>부가세</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${reqBlock}
      <p class="sheet-actions"><button type="button" class="next" id="copy">결과 텍스트 복사</button></p>
      <p class="muted small basis">세율: 관세청 품목번호별 관세율표 2026-02-11 · 세관장확인: 관세법 제226조 고시 2026-07-16 · 환율: 관세청 과세환율 ${D.fx.applies_from}~${D.fx.applies_to}. 예상치이며 신고 세액과 품목분류의 책임은 신고인에게 있습니다. 실제 신고 전 관세사 확인을 권합니다. 세율 오류 제보: hello@jikguse.com</p></section>`;
    $('copy').addEventListener('click', () => {
      const txt = [`[직구세 사업자 수입 계산 · jikguse.com/business/]`, `원산지 ${orig.name} · ${input.co ? 'C/O 있음' : 'C/O 없음'} · 과세환율 ${cur} ${FX[cur]}원`,
        ...r.lines.map(l => `- ${l.entry.n} (${fmtHs(l.entry.c)}) ${l.qty}×${l.price} ${cur} → 과세가격 ${won(l.cif)}, ${l.rate.applied.label} ${pct(l.rate.applied.rate)}, 관세 ${won(l.duty)}, 부가세 ${won(l.vat)}${l.req ? ' · 세관장확인' : ''}`),
        `관세 ${won(r.duty)} + 부가세 ${won(r.vat)} = ${won(r.tax)} · 총 착지비용 ${won(r.landed)} (부가세 공제 후 ${won(r.landedNet)})`, `※ 예상치. 신고 책임은 신고인, 관세사 확인 권장.`].join('\n');
      navigator.clipboard.writeText(txt).then(() => { $('copy').textContent = '복사했어요'; setTimeout(() => { $('copy').textContent = '결과 텍스트 복사'; }, 1500); });
    });
    if (reqLines.length) reqReady().then(req => {
      out.querySelectorAll('#req li').forEach(li => {
        const items = req[li.dataset.hs] || [];
        li.querySelector('.req-body').innerHTML = items.map(([law, text]) => `<details><summary>${esc(law)}</summary><p>${esc(text)}</p></details>`).join('') || '요건 문구 없음';
      });
    });
  }

  mountAll();
  render();
})();
