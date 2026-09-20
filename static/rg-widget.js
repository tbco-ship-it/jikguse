// 로켓그로스 순수익 계산기 widget: form (category picker, size tier, sale terms) + result sheet + 묶음 비교, mounted into any
// container. Used standalone on /rocket/ (rg.js) and embedded under the 사업자 수입 계산기 result (biz.js), so one code path
// serves both — a fee-table or model change cannot drift between the two pages. Model in rg-calc.js.
//
//   RgWidget.mount(root, { fees, catsUrl, base, key, embedded })  → { load(key, ctx), reset(), render }
//   load(key, { cost, name, note, query, hs }) switches the saved-state slot (localStorage key) and, when given, sets the unit cost;
//   query (the 품명 typed on the forwarder sheet) + hs (its HS code, chapter → likely 1차 카테고리) pick a Coupang category
//   automatically when the slot has none saved.
// Size: the seller picks a 쿠팡 사이즈 유형 (극소형~특대형) by default — few people know their packed dimensions — and the tier's
// representative dims (RgCalc.tierDims) stand in for storage volume and bundle sizing. Exact mm/g entry is behind a toggle.
(function (root) {
  const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const pct1 = r => (Math.round(r * 1000) / 10).toLocaleString('ko-KR') + '%';
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const FIELDS = ['price', 'cost', 'd1', 'd2', 'd3', 'wt', 'turn', 'monthly', 'ret', 'unsell', 'ad', 'disc', 'inbound'];
  const DEFAULTS = { turn: '60', monthly: '100', unsell: '20', ad: '0', disc: '0', inbound: '0' };
  const SIZE_HELP = '택배 상자 기준으로 고르세요. 세변 합(가로+세로+높이)과 무게 둘 다 기준 안이어야 그 유형입니다 — 대략 계산용이고, 실제 유형은 쿠팡이 입고 때 측정합니다.';
  const CAT_HELP = '카테고리를 고르면 판매수수료율과 입출고·배송 요금 그룹이 정해집니다.';
  const PH = { price: ['얼마에 팔 건가요?', '19900'], cat: ['무슨 상품인가요? (예: 티셔츠, 토너, 사료)', '예: 골프 티셔츠, 스킨/토너, 강아지 사료'] }; // [needs input, filled]

  const formHtml = (o, id) => `<div class="calc card rg-card">
  <div class="sub-row"><h2 class="card-title">${o.embedded ? '로켓그로스로 팔면' : '상품 정보'}</h2><button type="button" class="link-btn rg-reset" title="입력을 모두 지우고 새로 시작">초기화</button></div>
  <label class="field cat-field"><span>카테고리 <small class="muted">(쿠팡 윙 상품등록과 같은 분류 · 판매수수료 자동)</small></span>
    <input class="num-in rg-cat" type="text" placeholder="${PH.cat[0]}" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="${id}-menu" aria-autocomplete="list">
    <ul id="${id}-menu" class="menu" role="listbox" hidden></ul>
    <p class="muted small rg-cat-note">${CAT_HELP}</p>
  </label>
  <div class="row">
    <label class="field price-field"><span>판매가 <small class="muted">(소비자가, VAT 포함)</small></span>
      <span class="money"><span class="unit">원</span><input data-f="price" class="num-in" type="text" inputmode="numeric" placeholder="${PH.price[0]}" autocomplete="off"></span>
    </label>
    <label class="field"><span>매입원가 <small class="muted">(개당, VAT 제외)</small></span>
      <span class="money"><span class="unit">원</span><input data-f="cost" class="num-in" type="text" inputmode="numeric" placeholder="6000" autocomplete="off"></span>
    </label>
  </div>
  <p class="muted small rg-cost-note">${o.embedded ? '' : `수입품이면 <a href="${o.base}business/">사업자 수입 계산기</a>에서 배대지 신청서를 붙여 넣고 [로켓그로스 수익도 같이 보기]를 누르면 관세·운임까지 포함한 개당 원가가 그대로 들어옵니다.`}</p>
  <div class="size-block">
  <h3 class="sub-h">사이즈 유형 <small class="muted">(판매 단위 1개, 포장 포함 · 쿠팡이 배송비를 매기는 6단계)</small></h3>
  <div class="tiers" role="radiogroup" aria-label="사이즈 유형">${root.RgCalc.SIZES.map((sz, i) => `<button type="button" class="tier" role="radio" aria-checked="false" data-i="${i}"><b>${sz.name}</b><small>${i ? '~' : ''}${sz.cm}cm · ${sz.kg}kg</small></button>`).join('')}</div>
  <p class="muted small rg-size-note">${SIZE_HELP}</p>
  <button type="button" class="link-btn rg-dims-toggle" aria-expanded="false">치수를 알아요 — 가로·세로·높이·무게로 정확히</button>
  <div class="row dims" hidden>
    <label class="field"><span>가로 <small class="muted">mm</small></span><input data-f="d1" class="num-in" type="text" inputmode="numeric" placeholder="200" autocomplete="off"></label>
    <label class="field"><span>세로 <small class="muted">mm</small></span><input data-f="d2" class="num-in" type="text" inputmode="numeric" placeholder="150" autocomplete="off"></label>
    <label class="field"><span>높이 <small class="muted">mm</small></span><input data-f="d3" class="num-in" type="text" inputmode="numeric" placeholder="50" autocomplete="off"></label>
    <label class="field"><span>무게 <small class="muted">g</small></span><input data-f="wt" class="num-in" type="text" inputmode="numeric" placeholder="300" autocomplete="off"></label>
  </div>
  </div>
  <details class="more"><summary>판매 조건 자세히 (판매기간·반품률·광고·세이버)</summary>
    <div class="row">
      <label class="field"><span>예상 판매기간 <small class="muted">(입고 후 다 팔릴 때까지, 일)</small></span><input data-f="turn" class="num-in" type="text" inputmode="numeric" value="60" autocomplete="off"></label>
      <label class="field"><span>월 판매량 <small class="muted">(개 · 반품 무료 20건·세이버 안분용)</small></span><input data-f="monthly" class="num-in" type="text" inputmode="numeric" value="100" autocomplete="off"></label>
    </div>
    <div class="row">
      <label class="field"><span>반품률 <small class="muted">(% · 쿠팡 미공개, 카테고리 기본값)</small></span><input data-f="ret" class="num-in" type="text" inputmode="decimal" placeholder="5" autocomplete="off"></label>
      <label class="field"><span>반품 중 재판매 불가 <small class="muted">(% · 원가 손실 + 반출비)</small></span><input data-f="unsell" class="num-in" type="text" inputmode="decimal" value="20" autocomplete="off"></label>
    </div>
    <div class="row">
      <label class="field"><span>광고비 <small class="muted">(매출 대비 %, VAT 별도)</small></span><input data-f="ad" class="num-in" type="text" inputmode="decimal" value="0" autocomplete="off"></label>
      <label class="field"><span>판매자 즉시할인 <small class="muted">(% · 수수료·정산 기준가에 반영)</small></span><input data-f="disc" class="num-in" type="text" inputmode="decimal" value="0" autocomplete="off"></label>
    </div>
    <div class="row">
      <label class="field"><span>입고 운송비 등 <small class="muted">(개당 · 물류센터까지 택배비, 바코드·포장 등, VAT 별도)</small></span><input data-f="inbound" class="num-in" type="text" inputmode="numeric" value="0" autocomplete="off"></label>
    </div>
    <div class="row">
      <label class="check"><input class="rg-saver" type="checkbox"> <span>로켓그로스 세이버 가입 (월 99,000원 · 반품비 무제한 무료 · 60일 무료 보관)</span></label>
      <label class="check"><input class="rg-simp" type="checkbox"> <span>간이과세자 (매입세액공제 없음)</span></label>
    </div>
  </details>
  <p class="muted small">예상치입니다. 실제 청구는 윙 &gt; 정산 &gt; 로켓그로스 정산현황 기준이며, 프로모션·요율은 바뀔 수 있습니다. <a href="${o.base}methodology/#rocket">계산 방법 보기</a></p>
</div>
<div class="result rg-result" aria-live="polite"></div>`;

  let seq = 0;
  function mount(host, o) {
    const { RgCalc } = root;
    const FEES = o.fees;
    const id = 'rg' + (++seq);
    host.innerHTML = formHtml(o, id);
    const q = s => host.querySelector(s);
    const F = {}; FIELDS.forEach(f => { F[f] = q(`[data-f="${f}"]`); });
    const num = el => { const n = parseFloat((el.value || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
    const out = q('.rg-result'), catInput = q('.rg-cat'), menu = q(`#${id}-menu`), saver = q('.rg-saver'), simp = q('.rg-simp');
    const catNote = q('.rg-cat-note'), sizeNote = q('.rg-size-note'), costNote = q('.rg-cost-note');
    const catField = q('.cat-field'), priceField = q('.price-field'), sizeBlock = q('.size-block'), tiers = q('.tiers'), dimsRow = q('.row.dims'), dimsToggle = q('.rg-dims-toggle');
    const costNoteOrig = costNote.innerHTML;
    let KEY = o.key, cat = null, catAuto = false, BP = {}, retTouched = false, ctx = {};
    let sizeMode = 'tier', tierIdx = null; // 'tier' = picked a 쿠팡 유형 (default) · 'dims' = typed mm/g
    let lastNum = null; // last headline number, to pulse the sheet when an input changes it
    let CATS = null;
    const catsReady = () => CATS ? Promise.resolve(CATS) : fetch(o.catsUrl).then(r => r.json()).then(d => {
      CATS = d.cats.map(c => ({ p: c[0], r: c[1], u: c[2], code: c[3], leaf: c[0].split('>').pop(), s: c[0].toLowerCase().replace(/\s+/g, '') }));
      return CATS;
    });
    const unitOf = c => FEES.units[c.u];

    // ----- category combobox -----
    let items = [], active = -1;
    const NICHE = /베이비|유아동|영유아|키즈|주니어|임산부|수유|빅사이즈|해외직구|반려|애완|강아지|고양이|골프|스키|낚시|한복|파티복|댄스|커버업|탁구|테니스|배드민턴/;
    // HS chapter → likely Coupang 1차 카테고리 (a second signal for the sheet-name match: 치마 + HS 62 → 여성 치마바지, not 치마/바지걸이)
    const CHAPTER_ROOTS = { 33: ['뷰티'], 34: ['뷰티', '생활용품'], 39: ['생활용품', '주방용품'], 42: ['패션의류잡화'], 44: ['생활용품', '가구/홈데코'], 48: ['문구/오피스'], 61: ['패션의류잡화'], 62: ['패션의류잡화'], 63: ['생활용품', '가구/홈데코'], 64: ['패션의류잡화'], 65: ['패션의류잡화'],
      69: ['주방용품', '가구/홈데코'], 70: ['주방용품', '생활용품'], 71: ['패션의류잡화'], 73: ['주방용품', '생활용품'], 82: ['생활용품', '주방용품'], 84: ['가전/디지털', '주방용품'], 85: ['가전/디지털'], 87: ['스포츠/레져', '자동차용품'], 90: ['가전/디지털', '헬스/건강식품'], 91: ['패션의류잡화'], 94: ['가구/홈데코', '생활용품'], 95: ['완구/취미', '스포츠/레져'], 96: ['생활용품', '문구/오피스'] };
    function search(qs, hs) {
      const toks = qs.toLowerCase().split(/\s+/).map(t => t.replace(/\//g, '')).filter(Boolean);
      if (!toks.length) return [];
      const nq = toks.join('');
      const roots = (hs && CHAPTER_ROOTS[String(hs).slice(0, 2)]) || null;
      const hits = [];
      for (const c of CATS) {
        const s = c.s.replace(/\//g, '');
        if (!toks.every(t => s.includes(t))) continue;
        const leaf = c.leaf.toLowerCase().replace(/[\s\/]/g, '');
        // exact leaf › leaf has it as a word (여성 후드티) › a leaf word starts with it (치마 → 치마바지, not 앞치마) › leaf contains › leaf has a word of it › only the path
        // contains; niche trees (베이비·유아동·임산부·반려·해외직구…) sink unless the query names them
        const words = c.leaf.toLowerCase().split(/[\s\/]+/);
        let rank = leaf === nq ? 0 : words.includes(nq) ? 1 : words.some(w => w.startsWith(nq)) ? 2 : leaf.includes(nq) ? 3 : toks.some(t => leaf.includes(t)) ? 4 : 5;
        if (NICHE.test(c.p) && !NICHE.test(qs)) rank += 1.5;
        if (roots && roots.includes(c.p.split('>')[0])) rank -= 1;
        hits.push([rank, c]);
        if (hits.length > 600) break;
      }
      return hits.sort((a, b) => a[0] - b[0] || a[1].p.length - b[1].p.length).slice(0, 10).map(x => x[1]); // same rank → shallower/shorter path first
    }
    // Sheet 품명 → category: the whole name first, then its longer words (모니터 받침대 → 모니터받침대 leaf; 안경닦이 → nothing → left for the seller).
    function autoMatch(qs, hs) {
      const full = search(qs, hs);
      if (full.length) return full[0];
      for (const w of qs.split(/\s+/).filter(w => w.length >= 2).sort((a, b) => b.length - a.length)) { const h = search(w, hs); if (h.length) return h[0]; }
      return null;
    }
    const open = qs => {
      items = search(qs);
      menu.innerHTML = items.length ? items.map((c, k) => `<li role="option" data-i="${k}" ${k === active ? 'aria-selected="true"' : ''}><b>${esc(c.leaf)}</b><small>${esc(c.p.split('>').slice(0, -1).join(' › '))}</small><small class="rate">수수료 ${c.r}%${unitOf(c).lowasp ? ' · 저가 할인 대상' : ''}</small></li>`).join('')
        : `<li class="empty">${qs.trim() ? '검색 결과가 없어요. 상품 종류를 다른 말로 적어 보세요(예: 티셔츠, 토너, 사료).' : '상품 종류를 입력하면 쿠팡 카테고리를 찾아 드려요'}</li>`;
      menu.hidden = false; catInput.setAttribute('aria-expanded', 'true');
    };
    const close = () => { menu.hidden = true; active = -1; catInput.setAttribute('aria-expanded', 'false'); };
    const choose = (c, auto) => { cat = c; catAuto = !!auto; catInput.value = c.leaf; catInput.title = c.p; close(); if (!retTouched) F.ret.value = String(RgCalc.returnDefault(c.p) * 100); render(); };
    catInput.addEventListener('focus', () => catsReady().then(() => { setTimeout(() => catInput.select(), 0); open(catInput.value); }));
    catInput.addEventListener('input', () => catsReady().then(() => { active = -1; open(catInput.value); }));
    catInput.addEventListener('keydown', e => {
      if (menu.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); open(catInput.value); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); open(catInput.value); e.preventDefault(); }
      else if (e.key === 'Enter') { const it = items[active >= 0 ? active : 0]; if (it) choose(it); e.preventDefault(); }
      else if (e.key === 'Escape') { close(); catInput.value = cat ? cat.leaf : ''; }
    });
    menu.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { choose(items[+li.dataset.i]); e.preventDefault(); } });
    catInput.addEventListener('blur', () => setTimeout(() => { close(); if (cat) catInput.value = cat.leaf; }, 120));

    // ----- size: tier buttons vs exact dims -----
    tiers.addEventListener('click', e => {
      const b = e.target.closest('.tier'); if (!b) return;
      tierIdx = +b.dataset.i; sizeMode = 'tier'; showDims(false); render();
    });
    function showDims(on) { dimsRow.hidden = !on; dimsToggle.setAttribute('aria-expanded', String(on)); dimsToggle.textContent = on ? '유형만 고를게요 — 치수 접기' : '치수를 알아요 — 가로·세로·높이·무게로 정확히'; }
    dimsToggle.addEventListener('click', () => { const on = dimsRow.hidden; sizeMode = on ? 'dims' : 'tier'; showDims(on); render(); if (on) F.d1.focus(); });
    ['d1', 'd2', 'd3', 'wt'].forEach(f => F[f].addEventListener('input', () => { sizeMode = 'dims'; }));
    function paintTiers(i) { tiers.querySelectorAll('.tier').forEach(b => { const on = +b.dataset.i === i; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); tiers.classList.toggle('derived', sizeMode === 'dims'); }

    // ----- inputs / state -----
    for (const f of FIELDS) F[f].addEventListener('input', render);
    F.ret.addEventListener('input', () => { retTouched = true; });
    saver.addEventListener('change', render); simp.addEventListener('change', render);
    q('.rg-reset').addEventListener('click', () => { reset(); catInput.focus(); });

    function save() {
      if (!KEY) return;
      const s = { cat, catAuto, bp: BP, saver: saver.checked, simp: simp.checked, retTouched, sizeMode, tierIdx };
      for (const f of FIELDS) s[f] = F[f].value;
      localStorage.setItem(KEY, JSON.stringify(s));
    }
    function applyState(s) {
      cat = s.cat && FEES.units[s.cat.u] && typeof s.cat.r === 'number' ? s.cat : null; // 저장된 선택이 새 요금표와 안 맞으면 버린다
      catInput.value = cat ? cat.leaf : ''; catInput.title = cat ? cat.p : ''; catAuto = !!(cat && s.catAuto);
      BP = s.bp || {}; retTouched = !!s.retTouched; saver.checked = !!s.saver; simp.checked = !!s.simp;
      for (const f of FIELDS) F[f].value = s[f] != null && s[f] !== '' ? s[f] : (DEFAULTS[f] || '');
      tierIdx = Number.isInteger(s.tierIdx) && RgCalc.SIZES[s.tierIdx] ? s.tierIdx : null;
      sizeMode = s.sizeMode === 'dims' || (!s.sizeMode && ['d1', 'd2', 'd3', 'wt'].some(f => F[f].value)) ? 'dims' : 'tier'; // pre-toggle saves had dims only
      showDims(sizeMode === 'dims');
      lastNum = null;
    }
    // Switch the saved-state slot; ctx.cost (per-unit landed cost) overrides the saved cost, ctx.note replaces the cost hint.
    function load(key, c) {
      KEY = key; ctx = c || {};
      let s = {}; try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* fresh */ }
      applyState(s);
      if (ctx.cost != null) F.cost.value = String(Math.round(ctx.cost));
      costNote.innerHTML = ctx.note != null ? esc(ctx.note) : costNoteOrig;
      render();
      if (cat) catsReady(); else matchFromQuery();
    }
    // No category saved for this slot but the sheet gave a 품명 → pick one; if none fits, leave the 품명 in the box to search from.
    function matchFromQuery() {
      if (!ctx.query) return;
      const key = KEY;
      catsReady().then(() => {
        if (KEY !== key || cat) return; // slot switched meanwhile — stale answer
        const c = autoMatch(ctx.query, ctx.hs);
        if (c) choose(c, true); else { catInput.value = ctx.query; render(); }
      });
    }
    function reset() {
      if (KEY) localStorage.removeItem(KEY);
      applyState({});
      if (ctx.cost != null) F.cost.value = String(Math.round(ctx.cost)); // the imported cost is context, not input — keep it
      render();
      matchFromQuery();
    }

    function inputs() {
      let dims, wt, tier = null;
      if (sizeMode === 'dims') { dims = [num(F.d1), num(F.d2), num(F.d3)]; wt = num(F.wt); if (dims.some(Boolean) || wt) tier = RgCalc.sizeTier(dims, wt); }
      else { const r = tierIdx != null ? RgCalc.tierDims(tierIdx) : { dims: [0, 0, 0], wt: 0 }; dims = r.dims; wt = r.wt; if (tierIdx != null) tier = RgCalc.sizeTier(dims, wt); }
      const cbm = dims[0] * dims[1] * dims[2] / 1e9;
      return { dims, wt, tier, cbm, price: num(F.price), cost: num(F.cost), turnover: num(F.turn) || 60, monthly: num(F.monthly),
        retRate: num(F.ret) / 100, unsellable: num(F.unsell) / 100, adPct: num(F.ad), sellerDisc: num(F.disc), inbound: num(F.inbound), saver: saver.checked, simplified: simp.checked };
    }
    const modelArgs = (I, dims, wt, price, cost, n) => {
      const tier = RgCalc.sizeTier(dims, wt), cbm = dims[0] * dims[1] * dims[2] / 1e9;
      return { ...I, table: unitOf(cat), rate: cat.r, sizeIdx: tier.i, extra: tier.extra, cbm, apparel: RgCalc.isApparel(cat.p), price, cost, tier, n };
    };
    function bandLabel(bands, price) {
      const i = RgCalc.band(bands, price);
      const lo = bands[i], hi = bands[i + 1];
      return hi ? `${lo.toLocaleString('ko-KR')}~${hi.toLocaleString('ko-KR')}원 구간` : `${lo.toLocaleString('ko-KR')}원 이상 구간`;
    }

    function render() {
      save();
      const I = inputs();
      paintTiers(I.tier ? I.tier.i : -1);
      sizeNote.textContent = !I.tier ? SIZE_HELP
        : sizeMode === 'dims' ? `사이즈 유형: ${I.tier.name} — 세변 합 ${I.tier.cm}cm · ${I.wt.toLocaleString('ko-KR')}g · 부피 ${(I.cbm * 1000).toFixed(2)}ℓ(${I.cbm.toFixed(4)}㎥)${I.tier.extra ? ` · 특대형 초과 추가비용 ${won(I.tier.extra)}` : ''}`
        : `${I.tier.name}: 세변 합 ${RgCalc.SIZES[I.tier.i].cm}cm · ${RgCalc.SIZES[I.tier.i].kg}kg까지. 입출고·배송비는 유형으로 정해지고, 보관비와 묶음 유형은 이 유형의 대표 크기(${I.dims.join('×')}mm · ${(I.wt / 1000).toLocaleString('ko-KR')}kg)로 어림합니다.`;
      catNote.textContent = cat ? `${catAuto && ctx.query ? `신청서 품명 '${ctx.query}' → 자동 매칭 · 다르면 위 칸에서 바꾸세요 · ` : ''}${cat.p.replace(/>/g, ' › ')} · 판매수수료 ${cat.r}% (VAT 별도)${unitOf(cat).lowasp ? ' · 14,000원 미만 저가 상품 전용 할인 대상' : ''}${RgCalc.isApparel(cat.p) ? ' · 45일 무료 보관·의류 회수비 단가' : ''}`
        : ctx.query && catInput.value === ctx.query ? `신청서 품명 '${ctx.query}'에 딱 맞는 쿠팡 카테고리가 없어요 — 상품 종류를 다른 말로 적어 골라 주세요(예: 청소포, 안경 액세서리).` : CAT_HELP;
      // what the seller still has to type is marked; placeholders talk until then
      const needs = { cat: !cat, price: !I.price, size: !I.tier };
      catField.classList.toggle('need', needs.cat); priceField.classList.toggle('need', needs.price); sizeBlock.classList.toggle('need', needs.size);
      catInput.placeholder = PH.cat[needs.cat ? 0 : 1]; F.price.placeholder = PH.price[needs.price ? 0 : 1];
      if (needs.cat || needs.price || needs.size) {
        const miss = [needs.cat && '카테고리', needs.price && '판매가', needs.size && '사이즈 유형'].filter(Boolean).join('·');
        out.innerHTML = `<section class="sheet balanced quiet"><p class="sheet-label">개당 순이익</p><p class="sheet-title">${miss}${/[가]$/.test(miss) ? '를' : '을'} 넣으면 바로 계산됩니다</p><p class="sheet-text">쿠팡 판매자센터 요금표(${FEES.asof}) 기준 — 판매수수료, 입출고비, 배송비, 보관비, 반품 회수·재입고비, 광고비를 빼고 부가세는 따로 보여 줍니다.</p></section>`;
        lastNum = null;
        return;
      }
      const A = modelArgs(I, I.dims, I.wt, I.price, I.cost, 1);
      const c = RgCalc.compute(A);
      const be = RgCalc.breakEven(A), m20 = RgCalc.breakEven(A, 0.2), m30 = RgCalc.breakEven(A, 0.3);
      const tone = c.expected <= 0 ? 'severe' : c.margin < 0.1 ? 'moderate' : 'balanced';
      const retLine = c.returns.r > 0 ? `반품 ${pct1(c.returns.r)} 반영: 반품 1건당 ${won(c.returns.perReturn)}(회수 ${won(c.returns.pickup)} + 재입고 ${won((1 - c.returns.q) * c.returns.restock)} + 재판매 불가 ${pct1(c.returns.q)}분 원가·반출비 ${won(c.returns.cogsLoss + c.returns.removal)})${c.billable < 1 && !I.saver ? ` · 월 20건 무료라 ${pct1(1 - c.billable)}는 무료` : ''}${I.saver ? ' · 세이버로 회수·재입고비 0' : ''}` : '반품률 0% — 반품 비용 없음';
      const rows = [
        ['매출 (공급가)', c.revenue, I.simplified ? '판매가 − 간이과세 부가세 약 1%' : `판매가 ${won(c.sold)} ÷ 1.1`],
        ['판매수수료', -c.commission, `${cat.r}% × ${won(c.sold)}`],
        ['입출고비', -c.wh, `${I.tier.name} · ${bandLabel(unitOf(cat).bands, c.sold)}${I.tier.extra ? ' + 추가 ' + won(I.tier.extra) : ''}`],
        ['배송비', -c.sh, '주문당 1회'],
        ['보관비 (기대값)', -c.storage, `${I.turnover}일 균등 판매, ${c.free}일 무료 후 ${c.storage ? '구간 요율' : '하루 0원 (반올림)'}`],
        ...(c.ad ? [['광고비', -c.ad, `매출의 ${I.adPct}%`]] : []),
        ...(c.inbound ? [['입고 운송비 등', -c.inbound, '개당, VAT 별도']] : []),
        ...(c.saverShare ? [['세이버 이용료 안분', -c.saverShare, `99,000원 ÷ 월 ${I.monthly}개`]] : []),
        ['매입원가', -c.cost, ctx.cost != null ? '수입 계산기 개당 원가 (관세·운임 안분, VAT 제외)' : 'VAT 제외'],
      ];
      const tbl = rows.map(([k, v, note]) => `<tr><th>${esc(k)}<small>${esc(note)}</small></th><td class="${v < 0 ? 'neg' : ''}">${v < 0 ? '−' : ''}${won(Math.abs(v))}</td></tr>`).join('');
      // 반품으로 매출이 빠지는 만큼 (1−r) 가중 — 표에는 항목별 금액, 합계는 기대값
      const bundle = [1, 2, 3, 4].map(n => {
        const dims = n === 1 ? I.dims : RgCalc.bundleDims(I.dims, n);
        const priceN = n === 1 ? I.price : (BP[n] || I.price * n);
        const B = { ...modelArgs(I, dims, I.wt * n, priceN, I.cost * n, n), inbound: I.inbound * n };
        const r = RgCalc.compute(B);
        return { n, dims, priceN, r, tier: B.tier, be: RgCalc.breakEven(B), logistics: r.wh + r.sh };
      });
      const bRows = bundle.map(b => `<tr><th>${b.n === 1 ? '낱개' : b.n + '개 묶음'}<small>${b.tier.name}${sizeMode === 'dims' ? ` · ${b.dims.map(d => Math.round(d)).join('×')}mm · ${Math.round(I.wt * b.n).toLocaleString('ko-KR')}g` : b.n === 1 ? '' : ' · 대표 크기로 어림'}</small></th>
        <td data-l="묶음 판매가">${b.n === 1 ? won(b.priceN) : `<input class="num-in bp" data-n="${b.n}" type="text" inputmode="numeric" value="${Math.round(b.priceN)}" aria-label="${b.n}개 묶음 판매가">`}</td>
        <td data-l="개당 물류비">${won(b.logistics / b.n)}</td><td data-l="개당 순이익" class="${b.r.expected < 0 ? 'neg' : ''}">${won(b.r.expected / b.n)}<small>${pct1(b.r.margin)}${b.n > 1 ? ` · 낱개 대비 ${b.r.expected / b.n - c.expected >= 0 ? '+' : '−'}${won(Math.abs(b.r.expected / b.n - c.expected))}` : ''}</small></td>
        <td data-l="손익분기">${b.be ? won(b.be) : '—'}</td></tr>`).join('');
      const bump = lastNum != null && Math.round(c.expected) !== lastNum; lastNum = Math.round(c.expected);
      out.innerHTML = `<section class="sheet ${tone}"><p class="sheet-label">${ctx.name ? esc(ctx.name) + ' · ' : ''}개당 순이익 (반품 반영 기대값, 부가세 별도)</p><div class="sheet-num${bump ? ' bump' : ''}"><span class="num">${Math.round(c.expected).toLocaleString('ko-KR')}</span><span class="pct">원</span></div>
        <p class="sheet-title">마진율 ${pct1(c.margin)} · ROI ${pct1(c.roi)} (원가 대비)${I.monthly ? ` · 월 ${I.monthly.toLocaleString('ko-KR')}개면 월 ${won(c.monthlyProfit)}` : ''}</p>
        <p class="sheet-text"><strong>손익분기 판매가 ${be ? won(be) : '없음 (원가 구조상 이익 불가)'}</strong>${m20 ? ` · 마진 20%는 ${won(m20)}, 30%는 ${won(m30)}` : ''}. 반품 없이 팔린 1건만 보면 ${won(c.keptProfit)} 남고, 반품이 ${pct1(c.returns.r)} 섞이면 기대값이 위 숫자입니다.</p>
        <div class="tbl-wrap"><table class="tbl mini rg"><thead><tr><th>항목</th><th>개당</th></tr></thead><tbody>${tbl}</tbody><tfoot><tr><th>반품 없이 팔린 1건 순이익</th><td class="${c.keptProfit < 0 ? 'neg' : ''}">${won(c.keptProfit)}</td></tr><tr><th>반품 ${pct1(c.returns.r)} 반영 조정<small>${esc(retLine)} · 반품 건은 매출·수수료·물류비가 사라지고 반품 비용만 남음</small></th><td class="neg">−${won(Math.abs(c.expected - c.keptProfit))}</td></tr><tr><th>기대 순이익 (개당)</th><td class="${c.expected < 0 ? 'neg' : ''}">${won(c.expected)}</td></tr><tr><th>부가세 <small>매출세액 ${won(c.vatOut)}${c.vatIn ? ` − 수수료·물류 매입세액 ${won(c.vatIn)}` : ''} (원가 매입세액은 별도)</small></th><td>${won(c.vatOut - c.vatIn)}</td></tr></tfoot></table></div>
        <h3 class="sub-h">낱개 vs 묶음</h3>
        <p class="sheet-text">입출고비는 판매 단위당, 배송비는 주문당이라 묶음이 개당 물류비를 줄입니다. 묶음 포장 크기는 ${sizeMode === 'dims' ? '낱개 치수' : '유형의 대표 크기'}를 가장 짧은 변으로 쌓아 추정했습니다(실제 포장이 다르면 유형이 달라질 수 있어요). 묶음 판매가는 직접 고쳐 보세요.</p>
        <div class="tbl-wrap"><table class="tbl spec biz bundle"><thead><tr><th>구성</th><th>판매가</th><th>개당 물류비</th><th>개당 순이익</th><th>손익분기</th></tr></thead><tbody>${bRows}</tbody></table></div>
        <p class="sheet-text tip">정산: 월정산은 월 마감 + 20영업일에 100%, 주정산은 주 마감 + 20영업일에 70% · 익익월 첫 영업일에 30%. 판매수수료·입출고·배송비는 정산에서 차감되고 VAT 세금계산서가 따로 발행됩니다.</p>
        <p class="sheet-actions"><button type="button" class="next rg-copy">결과 텍스트 복사</button></p>
        <p class="muted small basis">요금: 쿠팡 판매자센터 로켓그로스 비용/수수료 ${FEES.asof} (프로모션 ${FEES.promo_until}까지) · 반품률은 쿠팡이 공개하지 않아 카테고리 기본값(추정)이며 윙 &gt; 로켓그로스 &gt; 반품분석의 내 수치를 넣는 것이 정확합니다 · 재입고비는 기본 단가(2025-07 프로모션 종료 후 카테고리별 할인 미반영). 예상치이며 실제 청구는 윙 정산현황 기준입니다. 오류 제보: hello@jikguse.com</p></section>`;
      out.querySelectorAll('.bp').forEach(el => el.addEventListener('change', e => { BP[+el.dataset.n] = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; render(); }));
      const copy = out.querySelector('.rg-copy');
      copy.addEventListener('click', () => {
        const txt = [`[직구세 로켓그로스 순수익 계산 · jikguse.com/rocket/]`, `${ctx.name ? ctx.name + ' · ' : ''}${cat.p} · 수수료 ${cat.r}% · ${I.tier.name} · 판매가 ${won(I.price)} · 원가 ${won(I.cost)}`,
          ...rows.map(([k, v]) => `- ${k}: ${v < 0 ? '−' : ''}${won(Math.abs(v))}`),
          `반품 없이 팔린 1건 순이익 ${won(c.keptProfit)}`,
          `개당 순이익(반품 ${pct1(c.returns.r)} 반영) ${won(c.expected)} · 마진 ${pct1(c.margin)} · ROI ${pct1(c.roi)} · 손익분기 ${be ? won(be) : '없음'}`,
          ...bundle.slice(1).map(b => `- ${b.n}개 묶음 ${won(b.priceN)}: 개당 순이익 ${won(b.r.expected / b.n)} (${b.tier.name}, 손익분기 ${b.be ? won(b.be) : '없음'})`),
          `※ 예상치. 실제 청구는 윙 정산현황 기준.`].join('\n');
        navigator.clipboard.writeText(txt).then(() => { copy.textContent = '복사했어요'; setTimeout(() => { copy.textContent = '결과 텍스트 복사'; }, 1500); });
      });
    }

    load(o.key, o.ctx);
    return { load, reset, render, focus: () => catInput.focus() };
  }

  root.RgWidget = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
