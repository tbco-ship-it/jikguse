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

  const digitsOf = q => { const b = q.match(/\[(\d{6,10})\]/); return b ? b[1] : (q.replace(/[.\-\s]/g, '').match(/^\d{2,10}$/) || [])[0]; };
  function search(q) {
    const code = digitsOf(q);
    if (code) return HS.codes.filter(c => c.c.startsWith(code)).slice(0, 8);
    const toks = q.toLowerCase().split(/\s+/).map(t => t.replace(/[.\-]/g, '')).filter(Boolean);
    const nq = toks.join('');
    if (!nq) return [];
    const hits = [];
    for (const c of HS.codes) {
      if (!toks.every(t => c.s.includes(t))) continue;
      const rank = c.top.includes(nq) ? 0 : (c.h6 && c.h6.toLowerCase().replace(/\s+/g, '').includes(nq)) ? 1 : 2;
      hits.push([rank, c]);
      if (hits.length > 400) break;
    }
    return hits.sort((a, b) => a[0] - b[0]).slice(0, 8).map(x => x[1]);
  }
  // Generic leaves ('기타') read as their path so the picked row still says what it is.
  const nameOf = c => /^기타/.test(c.n) ? labelOf(c) : c.n;
  // Heading › subheading › leaf, dropping repeated '기타' steps so the label reads as a path.
  function labelOf(c) {
    const parts = [c.h4, c.h6, c.p, c.n].filter(Boolean).map(s => s.length > 48 ? s.slice(0, 46) + '…' : s);
    return parts.filter((p, i) => i === parts.length - 1 || p !== parts[i + 1]).join(' › ');
  }

  // ----- lines -----
  const KEY = 'jikguse.biz';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
  const lines = (saved.lines && saved.lines.length ? saved.lines : [{ hs: '', qty: '', price: '' }]).map(l => ({ ...l, entry: null })); // name = 품명 as typed on the forwarder sheet (empty when keyed by hand)

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
      if (L.h6) bits.push(`HS6 하위 ${L.h6}개 세율 동일 → 자동 확정`);
      meta.textContent = bits.join(' · ');
    };
    const choose = (c, fire = true) => { if (fire && c && c.c !== L.hs) L.name = ''; L.entry = c; L.hs = c ? c.c : ''; input.value = c ? nameOf(c) : ''; input.title = c ? labelOf(c) : ''; close(); setMeta(); if (fire) render(); }; // re-picking the code by hand drops the sheet 품명
    const rateTxt = c => { const rt = BizCalc.rateFor(c, HS.cols, $('origin').value, true); return `기본 ${pct(rt.mfn.rate)}${rt.fta ? ' · ' + rt.fta.label + ' ' + pct(rt.fta.rate) : ''}`; };
    const open = (q, head) => {
      items = search(q);
      menu.innerHTML = (head ? `<li class="empty">${head}</li>` : '') + (items.length ? items.map((c, k) => `<li role="option" data-i="${k}" ${k === active ? 'aria-selected="true"' : ''}><b>${esc(c.n)}</b><small>${esc(fmtHs(c.c))} · ${esc(labelOf(c).replace(/ › [^›]*$/, ''))}</small><small class="rate">${esc(rateTxt(c))}</small></li>`).join('')
        : `<li class="empty">${q.trim() ? '검색 결과가 없어요. 다른 말이나 HS 앞 4자리로 찾아보세요.' : '품명, 영문명, HS 코드 앞자리로 검색'}</li>`);
      menu.hidden = false; input.setAttribute('aria-expanded', 'true');
    };
    // A 6-digit code (what forwarder forms carry) resolves to its 10-digit row when that is unambiguous.
    const tryH6 = q => {
      const code = digitsOf(q);
      if (!code || code.length !== 6) return false;
      const r = BizCalc.resolveH6(HS.codes, code);
      if (r.entry) { L.h6 = r.n > 1 ? r.n : 0; choose(r.entry); return true; }
      if (r.n > 1) { open(code, `하위 코드 ${r.n}개의 세율이 달라요 — 맞는 것을 골라 주세요`); return true; }
      return false;
    };
    const close = () => { menu.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); };
    input.addEventListener('focus', () => { if (!HS) return; setTimeout(() => input.select(), 0); open(input.value); });
    input.addEventListener('input', () => { active = -1; L.h6 = 0; if (!tryH6(input.value)) open(input.value); });
    input.addEventListener('keydown', e => {
      if (menu.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); open(input.value); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); open(input.value); e.preventDefault(); }
      else if (e.key === 'Enter') { const it = items[active >= 0 ? active : 0]; if (it) choose(it); e.preventDefault(); }
      else if (e.key === 'Escape') { close(); input.value = L.entry ? nameOf(L.entry) : ''; }
    });
    menu.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { choose(items[+li.dataset.i]); e.preventDefault(); } });
    input.addEventListener('blur', () => setTimeout(() => { close(); if (L.entry) input.value = nameOf(L.entry); }, 120));
    qty.addEventListener('input', () => { L.qty = qty.value; render(); });
    price.addEventListener('input', () => { L.price = price.value; render(); });
    el.querySelector('.rm').addEventListener('click', () => { lines.splice(i, 1); if (!lines.length) lines.push({ hs: '', qty: '', price: '', entry: null }); mountAll(); render(); });
    if (HS && L.hs && byCode[L.hs]) choose(byCode[L.hs], false);
    else if (L.pending) { input.value = L.pending; meta.textContent = `HS ${L.pending} 하위 코드 세율이 달라요 — 눌러서 골라 주세요`; }
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
  $('frcur').value = saved.frcur || 'KRW';
  ['total', 'excl', 'ins'].forEach(id => { if (saved[id]) $(id).value = saved[id]; });
  $('co').checked = !!saved.co;
  if ($('ins').value) $('ins').closest('details').open = true;
  const rerender = () => { linesEl.querySelectorAll('.line').forEach(el => el.__setMeta && el.__setMeta()); render(); };
  origin.addEventListener('change', rerender);
  $('cur').addEventListener('change', () => { linesEl.querySelectorAll('.cur-l').forEach(s => { s.textContent = $('cur').value; }); render(); });
  const syncFrcur = () => { $('frcur2').textContent = $('frcur3').textContent = $('frcur').value; };
  $('frcur').addEventListener('change', () => { syncFrcur(); render(); });
  syncFrcur();
  ['total', 'excl', 'ins'].forEach(id => $(id).addEventListener('input', render));
  $('co').addEventListener('change', rerender);
  // 초기화: 저장된 입력을 지우고 빈 계산기로 (페이지를 오가도 마지막 입력이 남는 게 기본이라 따로 둔다)
  $('reset').addEventListener('click', () => {
    localStorage.removeItem(KEY);
    lines.length = 0; lines.push({ hs: '', qty: '', price: '', entry: null });
    ['total', 'excl', 'ins', 'paste-text'].forEach(id => { $(id).value = ''; });
    $('co').checked = false; $('frcur').value = 'KRW'; syncFrcur();
    $('paste-note').textContent = ''; $('bm-note').textContent = '';
    $('rg-panel').hidden = true;
    mountAll(); rerender();
    const first = linesEl.querySelector('input'); if (first) first.focus();
  });

  // ----- paste a forwarder's application page -----
  $('paste-toggle').addEventListener('click', () => {
    const show = $('paste').hidden;
    $('paste').hidden = !show; $('paste-toggle').setAttribute('aria-expanded', String(show));
    if (show) $('paste-text').focus();
  });
  $('paste-fill').addEventListener('click', () => {
    const P = BizCalc.parseSheet($('paste-text').value), note = $('paste-note');
    if (!P.lines.length && !P.totalKrw) { note.textContent = '품목(HS코드·수량·단가)이나 배송비를 찾지 못했어요. HS코드가 보이는 신청서 화면을 통째로 복사해 주세요. 배대지 화면이 안 읽히면 hello@jikguse.com으로 그 화면 텍스트를 보내 주시면 맞춰 드립니다.'; return; }
    if (P.lines.length) {
      const unresolved = [];
      lines.length = 0;
      for (const l of P.lines) {
        const r = BizCalc.resolveH6(HS.codes, l.h6);
        lines.push({ hs: r.entry ? r.entry.c : '', qty: String(l.qty), price: String(l.price), name: l.name || '', entry: null, pending: r.entry ? '' : l.h6, h6: r.entry && r.n > 1 ? r.n : 0 });
        if (!r.entry) unresolved.push(l.h6);
      }
      if (P.cur && FX[P.cur]) $('cur').value = P.cur;
      if (P.origin) origin.value = P.origin;
      mountAll();
      linesEl.querySelectorAll('.cur-l').forEach(s => { s.textContent = $('cur').value; });
      const bits = [`${P.lines.length}개 품목 채움`];
      if (P.declared) bits.push(Math.abs(P.declared.amount - P.goods) < 0.01 ? `신청서 총구매비 ${P.declared.amount.toLocaleString('ko-KR')} ${P.declared.cur} 일치` : `합계 ${P.goods.toLocaleString('ko-KR')} ${P.cur} — 신청서 총구매비 ${P.declared.amount.toLocaleString('ko-KR')}와 다름, 수량을 확인하세요`);
      if (unresolved.length) bits.push(`HS ${unresolved.join(', ')}는 10자리를 골라 주세요`);
      if (P.mixed) bits.push(`단가 통화가 섞여 있어요 — ${P.cur} 기준으로 넣었으니 다른 통화 줄은 단가를 고쳐 주세요`);
      note.textContent = bits.join(' · ');
    } else note.textContent = '';
    // 배대지 청구서는 원화: 품목만 채워졌어도 운임 통화를 KRW로 맞춘다 (예전 저장값 USD가 남아 헷갈렸던 건)
    if (P.lines.length || P.totalKrw) { $('frcur').value = 'KRW'; syncFrcur(); }
    if (P.totalKrw) {
      $('total').value = String(P.totalKrw); $('excl').value = String(P.exclKrw || '');
      $('paste-note').textContent += `${$('paste-note').textContent ? ' · ' : ''}배송비 ${P.totalKrw.toLocaleString('ko-KR')}원${P.exclKrw ? ` 중 과세 제외 ${P.exclKrw.toLocaleString('ko-KR')}원` : ' (결제·견적 화면도 붙이면 부가서비스를 뺍니다)'}`;
    }
    if (P.co) $('co').checked = true;
    rerender();
    if (P.lines.length) out.scrollIntoView({ behavior: 'smooth', block: 'start' }); // the sheet is below the form — take the reader to the number
  });

  // Bookmarklet: on any forwarder's application page, grab the page text and open this page with it in the hash. Where the
  // page exposes a same-origin 결제정보 popup keyed by a GR code (one forwarder's layout), that is fetched too so the add-on
  // split and C/O come along. Nothing leaves the browser except to this page; the hash never reaches a server.
  const BM = `(async()=>{const t=document.body.innerText;const g=(document.querySelector('[name=gr_code]')||{}).value||(t.match(/GR\\d{13}/)||[])[0];let p='';if(g){try{const h=await(await fetch('/service/service_03_apply_pop.php?gr_code='+g+'&tabName=con07')).text();p=new DOMParser().parseFromString(h,'text/html').body.textContent}catch(e){}}const i=t.indexOf('제품목록'),j=t.indexOf('고객상담센터');location.href='${location.origin}${base}business/#s='+encodeURIComponent((i>=0?t.slice(i,j>i?j:undefined):t)+'\\n'+p)})()`;
  $('bm').href = 'javascript:' + encodeURIComponent(BM);
  $('bm').addEventListener('click', e => { e.preventDefault(); $('bm-note').textContent = '클릭이 아니라 이 버튼을 위쪽 북마크바로 끌어다 놓는 거예요. 북마크바에 생기면, 배대지 신청서 화면에서 그걸 누르세요.'; });
  const fromHash = () => {
    const m = location.hash.match(/^#s=(.+)/);
    if (!m) return;
    try { $('paste-text').value = decodeURIComponent(m[1]); } catch (e) { return; }
    history.replaceState(null, '', location.pathname + location.search);
    $('paste').hidden = false; $('paste-toggle').setAttribute('aria-expanded', 'true');
    $('paste-fill').click();
  };
  hsReady.then(fromHash);

  function save() {
    localStorage.setItem(KEY, JSON.stringify({ lines: lines.map(l => ({ hs: l.hs, qty: l.qty, price: l.price, name: l.name || '' })), origin: origin.value, cur: $('cur').value, frcur: $('frcur').value,
      total: $('total').value, excl: $('excl').value, ins: $('ins').value, co: $('co').checked }));
  }

  // ----- result -----
  function render() {
    save();
    if (!HS) return;
    const cur = $('cur').value;
    const frcur = $('frcur').value, frFx = frcur === 'KRW' ? 1 : FX[frcur];
    const total = num($('total')), excl = Math.min(num($('excl')), total);
    const input = { fx: FX, cur, cols: HS.cols, origin: origin.value, co: $('co').checked, freight: total - excl, freightCur: frcur, insurance: num($('ins')),
      brokerageKrw: Math.round(excl * frFx), domesticKrw: 0, lines: lines.map(l => ({ entry: l.entry, name: l.name, qty: parseFloat(l.qty) || 0, price: parseFloat(l.price) || 0 })) };
    const r = BizCalc.compute(input);
    if (!r.lines.length) {
      out.innerHTML = `<section class="sheet balanced quiet"><p class="sheet-label">예상 세액</p><p class="sheet-title">품목·수량·단가를 넣으면 바로 계산됩니다</p><p class="sheet-text">사업자 일반 수입신고 기준 — 150달러 면세·목록통관·간이세율은 적용하지 않습니다. 이번 주 과세환율 USD ${FX.USD.toLocaleString('ko-KR')}원.</p></section>`;
      rgItems = []; $('rg-panel').hidden = true;
      return;
    }
    const orig = BizCalc.ORIGINS.find(o => o.k === origin.value);
    // 개당 원가(VAT 제외) = (과세가격 + 관세 + 과세 제외 부가서비스 안분) ÷ 수량 → 로켓그로스 계산기로 넘긴다
    const unitCost = l => (l.cif + l.duty + (r.cif ? r.brokerage * l.cif / r.cif : 0)) / (l.qty || 1);
    const idOf = l => l.entry.c + ':' + l.price;
    const rows = r.lines.map(l => `<tr><th><span class="ln">${esc(l.name || nameOf(l.entry))}</span><small>${l.name ? esc(nameOf(l.entry)) + ' · ' : ''}${fmtHs(l.entry.c)} · ${l.qty.toLocaleString('ko-KR')} × ${l.price.toLocaleString('ko-KR')} ${cur}</small><small><button type="button" class="rg-link" data-id="${esc(idOf(l))}">개당 ${won(unitCost(l))} → 로켓그로스 수익 보기</button></small></th><td data-l="과세가격">${won(l.cif)}</td><td data-l="세율">${pct(l.rate.applied.rate)}<small>${esc(l.rate.applied.label)}</small></td><td data-l="관세">${won(l.duty)}</td><td data-l="부가세">${won(l.vat)}</td></tr>`).join('');
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
    const reqBlock = reqLines.length ? `<div class="req" id="req"><p class="sheet-title">세관장확인 대상 ${reqLines.length}개 품목 — 수입요건 먼저 확인</p><p class="sheet-text">관세법 제226조에 따라 신고 전에 요건승인기관 확인이 필요합니다. 요건이 없으면 통관이 보류됩니다.</p><ul class="req-list">${reqLines.map(l => `<li data-hs="${l.entry.c}"><b>${esc(nameOf(l.entry))}</b> <small>${fmtHs(l.entry.c)}</small><div class="req-body muted small">불러오는 중…</div></li>`).join('')}</ul></div>` : '';
    out.innerHTML = `<section class="sheet ${r.tax ? 'moderate' : 'balanced'}"><p class="sheet-label">예상 세액 (관세 + 부가세)</p><div class="sheet-num"><span class="num">${Math.round(r.tax).toLocaleString('ko-KR')}</span><span class="pct">원</span></div>
      <p class="sheet-title">관세 ${won(r.duty)} + 부가세 ${won(r.vat)} · 총 착지비용 ${won(r.landed)}</p>
      <p class="sheet-text">부가세 ${won(r.vat)}은 매입세액공제 대상이라 사업자 실부담은 <strong>${won(r.landedNet)}</strong>(물품가 ${won(r.goodsKrw)} + 운임·보험 ${won(r.freightKrw + r.insKrw)} + 관세 ${won(r.duty)}${r.brokerage ? ' + 과세 제외 부가서비스 ' + won(r.brokerage) : ''})입니다. 과세가격 합계 ${won(r.cif)} = 물품가 미화 ${Math.round(r.goodsUsd).toLocaleString('ko-KR')}달러 + 운임 ${won(r.freightKrw)}${r.brokerage ? `(청구액 ${won(Math.round(total * frFx))} − 부가서비스 ${won(r.brokerage)})` : ''}${r.insKrw ? ' + 보험 ' + won(r.insKrw) : ''}, 품목별 물품가 비례 안분.</p>
      ${notes.map(n => `<p class="sheet-text tip">${n}</p>`).join('')}
      <div class="tbl-wrap"><table class="tbl spec biz"><thead><tr><th>품목</th><th>과세가격</th><th>세율</th><th>관세</th><th>부가세</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${reqBlock}
      <p class="sheet-actions"><button type="button" class="next alt" id="rg-open">+ 로켓그로스 수익도 같이 보기</button><button type="button" class="next ghost" id="copy">결과 텍스트 복사</button></p>
      <p class="muted small basis">세율: 관세청 품목번호별 관세율표 2026-02-11 · 세관장확인: 관세법 제226조 고시 2026-07-16 · 환율: 관세청 과세환율 ${D.fx.applies_from}~${D.fx.applies_to}. 예상치이며 신고 세액과 품목분류의 책임은 신고인에게 있습니다. 실제 신고 전 관세사 확인을 권합니다. 세율 오류 제보: hello@jikguse.com</p></section>`;
    $('copy').addEventListener('click', () => {
      const txt = [`[직구세 사업자 수입 계산 · jikguse.com/business/]`, `원산지 ${orig.name} · ${input.co ? 'C/O 있음' : 'C/O 없음'} · 과세환율 ${cur} ${FX[cur]}원`,
        ...r.lines.map(l => `- ${l.name ? l.name + ' · ' : ''}${nameOf(l.entry)} (${fmtHs(l.entry.c)}) ${l.qty}×${l.price} ${cur} → 과세가격 ${won(l.cif)}, ${l.rate.applied.label} ${pct(l.rate.applied.rate)}, 관세 ${won(l.duty)}, 부가세 ${won(l.vat)}${l.req ? ' · 세관장확인' : ''}`),
        `관세 ${won(r.duty)} + 부가세 ${won(r.vat)} = ${won(r.tax)} · 총 착지비용 ${won(r.landed)} (부가세 공제 후 ${won(r.landedNet)})`, `※ 예상치. 신고 책임은 신고인, 관세사 확인 권장.`].join('\n');
      navigator.clipboard.writeText(txt).then(() => { $('copy').textContent = '복사했어요'; setTimeout(() => { $('copy').textContent = '결과 텍스트 복사'; }, 1500); });
    });
    rgItems = r.lines.map(l => ({ id: idOf(l), hs: l.entry.c, name: l.name || nameOf(l.entry), query: l.name || '', cost: unitCost(l), qty: l.qty }));
    rgOutlay = r.landedNet;
    $('rg-open').addEventListener('click', () => openRg());
    out.querySelectorAll('.rg-link').forEach(b => b.addEventListener('click', () => openRg(b.dataset.id)));
    if (!$('rg-panel').hidden) syncRg();
    if (reqLines.length) reqReady().then(req => {
      out.querySelectorAll('#req li').forEach(li => {
        const items = req[li.dataset.hs] || [];
        li.querySelector('.req-body').innerHTML = items.map(([law, text]) => `<details><summary>${esc(law)}</summary><p>${esc(text)}</p></details>`).join('') || '요건 문구 없음';
      });
    });
  }

  // ----- 로켓그로스 panel: the same widget as /rocket/, fed the per-line landed unit cost. One saved slot per HS:price line. -----
  let rgItems = [], rgW = null, rgId = null, rgFees = null, rgOutlay = 0;
  const rgHost = $('rg-host'), rgChips = $('rg-chips'), rgTotal = $('rg-total');
  const rgReady = () => rgW ? Promise.resolve(rgW) : fetch(rgHost.dataset.fees).then(r => r.json()).then(fees => { rgFees = fees; return (rgW = window.RgWidget.mount(rgHost, { fees, catsUrl: rgHost.dataset.cats, base, key: null, embedded: true, onChange: renderTotal })); });
  const slotOf = it => { try { return JSON.parse(localStorage.getItem(KEY + '.rg.' + it.id)); } catch (e) { return null; } };
  const evalItem = it => rgFees ? window.RgWidget.evaluate(rgFees, slotOf(it), { cost: it.cost }) : { ok: false };
  function syncRg() {
    if (!rgItems.some(i => i.id === rgId)) rgId = rgItems.length ? rgItems[0].id : null;
    rgChips.innerHTML = rgItems.map(i => { const ev = evalItem(i); return `<button type="button" class="chip${i.id === rgId ? ' on' : ''}${ev.ok ? ' done' : ''}" role="tab" aria-selected="${i.id === rgId}" data-id="${esc(i.id)}" title="${esc(i.name)}"><span>${esc(i.name)}</span><small>개당 ${won(i.cost)}${ev.ok ? ` → 순이익 <b class="${ev.c.expected < 0 ? 'neg' : ''}">${won(ev.c.expected)}</b>` : ' · 입력 전'}</small></button>`; }).join('');
    rgChips.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { rgId = b.dataset.id; syncRg(); }));
    const it = rgItems.find(i => i.id === rgId);
    // query = the sheet's 품명 → the widget matches a Coupang category from it when none is saved for this slot
    if (it && rgW) rgW.load(KEY + '.rg.' + it.id, { cost: it.cost, name: it.name, query: it.query, hs: it.hs, note: `${it.name} 개당 원가 ${won(it.cost)} — 위 수입 계산에서 가져옴 (물품가 + 관세 + 운임·부가서비스 안분, 부가세 제외). 위 수입 계산이 바뀌면 같이 바뀝니다.` });
    else renderTotal();
  }
  // Whole-shipment view: every item's saved slot × its sheet quantity. Each sale returns 원가 + 순이익 in cash, so the payback point is
  // Σ 원가·수량 ÷ Σ (원가+순이익)·수량 of the shipment (items sell in proportion). Items without inputs are listed, not summed.
  function renderTotal() {
    if (!rgItems.length || !rgFees) { rgTotal.hidden = true; return; }
    const rows = rgItems.map(it => ({ it, ev: evalItem(it) }));
    const done = rows.filter(r => r.ev.ok), todo = rows.length - done.length;
    const sum = f => done.reduce((s, r) => s + f(r), 0);
    const profit = sum(r => r.ev.c.expected * r.it.qty), revenue = sum(r => r.ev.c.sold * r.it.qty), outlayDone = sum(r => r.it.cost * r.it.qty), back = sum(r => (r.it.cost + r.ev.c.expected) * r.it.qty);
    const payback = back > 0 ? outlayDone / back : null; // fraction of the (evaluated) shipment that must sell to get the outlay back
    const chip = id => { rgId = id; syncRg(); rgHost.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => rgW.focus(), 500); };
    const tr = rows.map(({ it, ev }) => `<tr${ev.ok ? '' : ' class="todo"'}><th><span class="ln">${esc(it.name)}</span><small>${it.qty.toLocaleString('ko-KR')}개 · 개당 원가 ${won(it.cost)}</small></th>
      ${ev.ok ? `<td data-l="판매가">${won(ev.I.price)}</td><td data-l="개당 순이익" class="${ev.c.expected < 0 ? 'neg' : ''}">${won(ev.c.expected)}<small>${(Math.round(ev.c.margin * 1000) / 10).toLocaleString('ko-KR')}%</small></td><td data-l="전부 팔면" class="${ev.c.expected < 0 ? 'neg' : ''}">${won(ev.c.expected * it.qty)}<small>${ev.I.monthly ? `월 ${ev.I.monthly.toLocaleString('ko-KR')}개 팔면 ${it.qty <= ev.I.monthly ? '1개월 안에 소진' : (Math.ceil(it.qty / ev.I.monthly * 10) / 10).toLocaleString('ko-KR') + '개월'}` : ''}</small></td>`
        : `<td colspan="3" data-l="상태"><button type="button" class="link-btn tot-link" data-id="${esc(it.id)}">카테고리·판매가·사이즈 입력하기 →</button></td>`}</tr>`).join('');
    const tone = !done.length ? 'quiet' : profit <= 0 ? 'severe' : profit / Math.max(1, outlayDone) < 0.1 ? 'moderate' : 'balanced';
    const head = !done.length ? `<p class="sheet-title">품목별 로켓그로스 입력을 채우면 이번 수입 전체 순이익이 여기 합산됩니다</p>`
      : `<div class="sheet-num"><span class="num">${Math.round(profit).toLocaleString('ko-KR')}</span><span class="pct">원</span></div>
      <p class="sheet-title">${done.length}개 품목 ${done.reduce((s, r) => s + r.it.qty, 0).toLocaleString('ko-KR')}개를 다 팔면 · 매출 ${won(revenue)} · 매입 ${won(outlayDone)} 대비 ROI ${(Math.round(profit / Math.max(1, outlayDone) * 1000) / 10).toLocaleString('ko-KR')}%${todo ? ` · 입력 전 ${todo}개 품목은 빠져 있음` : ''}</p>
      <p class="sheet-text"><strong>${payback == null ? '본전 불가 — 팔수록 현금이 줄어듭니다' : payback > 1 ? `다 팔아도 본전이 안 됩니다 (회수 ${Math.round(payback * 100)}% 필요)` : `전체의 ${Math.round(payback * 100)}%가 팔리면 본전`}</strong>${payback != null && payback <= 1 ? ' — 그 뒤 판매분은 전부 이익입니다 (품목이 비율대로 팔린다고 가정, 반품 기대값 반영, 부가세 별도).' : ''}</p>`;
    rgTotal.innerHTML = `<section class="sheet ${tone}"><p class="sheet-label">이번 수입 전체로 보면 (${rows.length}개 품목, 실부담 ${won(rgOutlay)})</p>${head}
      <div class="tbl-wrap"><table class="tbl spec biz total"><thead><tr><th>품목</th><th>판매가</th><th>개당 순이익</th><th>전부 팔면</th></tr></thead><tbody>${tr}</tbody></table></div></section>`;
    rgTotal.hidden = false;
    rgTotal.querySelectorAll('.tot-link').forEach(b => b.addEventListener('click', () => chip(b.dataset.id)));
  }
  function openRg(id) {
    if (id) rgId = id;
    $('rg-panel').hidden = false;
    rgReady().then(() => { syncRg(); $('rg-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); if (!id) return; setTimeout(() => rgW.focus(), 500); });
  }
  $('rg-close').addEventListener('click', () => { $('rg-panel').hidden = true; out.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  mountAll();
  render();
})();
