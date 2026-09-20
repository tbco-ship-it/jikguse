// 로켓그로스 순수익 계산기 widget: form (category picker, size tier, sale terms) + result sheet + 묶음 비교, mounted into any
// container. Used standalone on /rocket/ (rg.js) and embedded under the 사업자 수입 계산기 result (biz.js), so one code path
// serves both — a fee-table or model change cannot drift between the two pages. Model in rg-calc.js.
//
//   RgWidget.mount(root, { fees, catsUrl, base, key, embedded, onChange })  → { load(key, ctx), reset(), render }
//   RgWidget.evaluate(fees, savedState, ctx) → { ok, needs, I, c } — runs the model on a saved slot without mounting (the 사업자
//   page sums every item's slot into a whole-shipment total).
//   load(key, { cost, name, note, query, hs }) switches the saved-state slot (localStorage key) and, when given, sets the unit cost;
//   query (the 품명 typed on the forwarder sheet) + hs (its HS code, chapter → likely 1차 카테고리) pick a Coupang category
//   automatically when the slot has none saved.
// 윙 실적 진단 (rg-wing.js): the 상품 관리 row pasted from Wing fills 월 판매량·반품률 with measured values, checks the picked
// 사이즈 유형·카테고리 against 쿠팡 예상 비용(개당) and prints 판매 속도·재고 소진·다음 수입 발주 수량. Wing's 매출 is 단품 × 표시가,
// so no real selling price is derived from it (2026-09-21: the old 실판매가 row invented a 42.5% discount on a bundled product).
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
  <h3 class="sub-h">사이즈 유형 <small class="muted">(판매 단위 1개, 포장 포함 · 쿠팡이 입출고·배송비를 매기는 6단계)</small></h3>
  <div class="tiers" role="radiogroup" aria-label="사이즈 유형">${root.RgCalc.SIZES.map((sz, i) => `<button type="button" class="tier" role="radio" aria-checked="false" data-i="${i}"><b>${sz.name}</b><small>${i ? '~' : ''}${sz.cm}cm · ${sz.kg}kg</small><small class="fee">물류비 —</small></button>`).join('')}</div>
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
<div class="result rg-result" aria-live="polite"></div>
<div class="calc card rg-wing">
  <div class="sub-row"><h2 class="card-title">윙 실적으로 진단 <small class="muted">(선택)</small></h2><button type="button" class="link-btn rg-wing-clear" hidden>지우기</button></div>
  <p class="muted small">이미 파는 상품이면 윙 › 로켓그로스 › <b>재고현황</b>에서 그 상품의 판매량 숫자(지난 30일)를 눌러 판매 상세를 펼치고, <b>상품 줄부터 펼쳐진 상세 끝(반품률)까지</b> 드래그해 복사한 뒤 붙여 넣으세요. 실제 판매가·판매 속도·재고·반품률로 위 계산을 실적 기준으로 바꾸고, 다음 수입 발주 수량까지 계산합니다. 붙여 넣은 내용은 이 기기에만 저장됩니다.</p>
  <div class="paste"><textarea class="rg-wing-in" rows="4" spellcheck="false" placeholder="어제 2 · 지난 7일 49 · 지난 30일 294 · 판매가능 106 · 입고중 100 · 판매가 9,800 · 매출 1,666,000원 · 조회 수 2,509 · 반품률 9.8% …"></textarea>
  <div class="paste-actions"><button type="button" class="next rg-wing-go">진단하기</button><span class="muted small rg-wing-note"></span></div></div>
  <div class="row rg-wing-opts" hidden>
    <label class="field"><span>수입 리드타임 <small class="muted">(발주 → 쿠팡 입고까지, 일)</small></span><input data-w="lead" class="num-in" type="text" inputmode="numeric" value="25" autocomplete="off"></label>
    <label class="field"><span>재고 여유 <small class="muted">(입고 뒤 며칠치 더 둘지, 일)</small></span><input data-w="cover" class="num-in" type="text" inputmode="numeric" value="30" autocomplete="off"></label>
  </div>
  <div class="rg-wing-out" aria-live="polite"></div>
</div>`;

  const numv = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
  const modelArgs = (I, cat, table, dims, wt, price, cost, n) => {
    const RgCalc = root.RgCalc, tier = RgCalc.sizeTier(dims, wt), cbm = dims[0] * dims[1] * dims[2] / 1e9;
    return { ...I, table, rate: cat.r, sizeIdx: tier.i, extra: tier.extra, cbm, apparel: RgCalc.isApparel(cat.p), price, cost, tier, n };
  };
  // State = what save() writes (form field strings + cat/sizeMode/tierIdx/saver/simp). ctx.cost overrides the saved cost (imported 원가).
  function evaluate(FEES, s, ctx) {
    const RgCalc = root.RgCalc; s = s || {}; ctx = ctx || {};
    const cat = s.cat && FEES.units[s.cat.u] && typeof s.cat.r === 'number' ? s.cat : null;
    const sizeMode = s.sizeMode === 'dims' || (!s.sizeMode && ['d1', 'd2', 'd3', 'wt'].some(f => s[f])) ? 'dims' : 'tier';
    const tierIdx = Number.isInteger(s.tierIdx) && RgCalc.SIZES[s.tierIdx] ? s.tierIdx : null;
    let dims, wt, tier = null;
    if (sizeMode === 'dims') { dims = [numv(s.d1), numv(s.d2), numv(s.d3)]; wt = numv(s.wt); if (dims.some(Boolean) || wt) tier = RgCalc.sizeTier(dims, wt); }
    else { const r = tierIdx != null ? RgCalc.tierDims(tierIdx) : { dims: [0, 0, 0], wt: 0 }; dims = r.dims; wt = r.wt; if (tierIdx != null) tier = RgCalc.sizeTier(dims, wt); }
    const I = { dims, wt, tier, cbm: dims[0] * dims[1] * dims[2] / 1e9, price: numv(s.price), cost: ctx.cost != null ? Math.round(ctx.cost) : numv(s.cost),
      turnover: numv(s.turn) || 60, monthly: numv(s.monthly), retRate: numv(s.ret) / 100, unsellable: numv(s.unsell) / 100, adPct: numv(s.ad), sellerDisc: numv(s.disc),
      inbound: numv(s.inbound), saver: !!s.saver, simplified: !!s.simp, cat, sizeMode, tierIdx };
    const needs = { cat: !cat, price: !I.price, size: !tier };
    if (needs.cat || needs.price || needs.size) return { ok: false, needs, I };
    const A = modelArgs(I, cat, FEES.units[cat.u], dims, wt, I.price, I.cost, 1);
    return { ok: true, needs, I, A, c: RgCalc.compute(A) };
  }

  let seq = 0;
  function mount(host, o) {
    const { RgCalc } = root;
    const FEES = o.fees;
    const id = 'rg' + (++seq);
    host.innerHTML = formHtml(o, id);
    const q = s => host.querySelector(s);
    const F = {}; FIELDS.forEach(f => { F[f] = q(`[data-f="${f}"]`); });
    const out = q('.rg-result'), catInput = q('.rg-cat'), menu = q(`#${id}-menu`), saver = q('.rg-saver'), simp = q('.rg-simp');
    const catNote = q('.rg-cat-note'), sizeNote = q('.rg-size-note'), costNote = q('.rg-cost-note');
    const catField = q('.cat-field'), priceField = q('.price-field'), sizeBlock = q('.size-block'), tiers = q('.tiers'), dimsRow = q('.row.dims'), dimsToggle = q('.rg-dims-toggle');
    const costNoteOrig = costNote.innerHTML;
    const wingIn = q('.rg-wing-in'), wingGo = q('.rg-wing-go'), wingNote = q('.rg-wing-note'), wingClear = q('.rg-wing-clear'), wingOpts = q('.rg-wing-opts'), wingOut = q('.rg-wing-out');
    const WF = { lead: q('[data-w="lead"]'), cover: q('[data-w="cover"]') };
    let W = null; // parsed Wing row (RgWing.parse().w) for the current slot
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
    WF.lead.addEventListener('input', render); WF.cover.addEventListener('input', render);
    wingGo.addEventListener('click', () => { if (!root.RgWing) return; const r = root.RgWing.parse(wingIn.value); W = r.ok ? r.w : null; wingNote.textContent = r.ok ? (r.missing.length ? `읽었어요 · 못 찾은 것: ${r.missing.join(' · ')}` : '') : (wingIn.value.trim() ? '판매량(어제·지난 7일·30일)을 못 찾았어요 — 재고현황의 상품 줄을 통째로 복사해 주세요. 계속 안 되면 hello@jikguse.com 으로 화면 텍스트를 보내 주세요.' : ''); if (W) fillFromWing(); render(); if (W) wingOut.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    wingIn.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) wingGo.click(); });
    wingClear.addEventListener('click', () => { wingIn.value = ''; W = null; wingNote.textContent = ''; render(); });
    // measured values replace the estimates: 월 판매량 ← 지난 30일 판매량, 반품률 ← 반품률(월)
    const wingMonthly = () => W && (W.d30.sold != null ? W.d30.sold : W.d7.sold != null ? Math.round(W.d7.sold / 7 * 30) : null);
    const wingRet = () => W && W.ret.rate != null ? Math.round(W.ret.rate * 10) / 10 : null;
    // 최종구매가 < 표시가 = 판매자 할인 (정산현황에서 '판매자 할인쿠폰'으로 차감되는 판매자 부담, 2026-09-21 확인) → 모델의 sellerDisc
    const wingDisc = () => W && W.price.list > 0 && W.price.final != null && W.price.final < W.price.list ? Math.round((1 - W.price.final / W.price.list) * 1000) / 10 : null;
    function fillFromWing() {
      const m = wingMonthly(), r = wingRet(), dc = wingDisc();
      if (m != null) F.monthly.value = String(m);
      if (r != null) { F.ret.value = String(r); retTouched = true; }
      if (W.price.list > 0 && !numv(F.price.value)) F.price.value = String(W.price.list);
      if (dc != null) F.disc.value = String(dc);
    }

    function save() { if (KEY) localStorage.setItem(KEY, JSON.stringify(state())); }
    function applyState(s) {
      cat = s.cat && FEES.units[s.cat.u] && typeof s.cat.r === 'number' ? s.cat : null; // 저장된 선택이 새 요금표와 안 맞으면 버린다
      catInput.value = cat ? cat.leaf : ''; catInput.title = cat ? cat.p : ''; catAuto = !!(cat && s.catAuto);
      BP = s.bp || {}; retTouched = !!s.retTouched; saver.checked = !!s.saver; simp.checked = !!s.simp;
      const wg = s.wing || {}; wingIn.value = wg.text || ''; WF.lead.value = wg.lead || '25'; WF.cover.value = wg.cover || '30';
      W = wg.text && root.RgWing ? (r => r.ok ? r.w : null)(root.RgWing.parse(wg.text)) : null; wingNote.textContent = '';
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

    function state() {
      const s = { cat, catAuto, bp: BP, saver: saver.checked, simp: simp.checked, retTouched, sizeMode, tierIdx, wing: { text: wingIn.value, lead: WF.lead.value, cover: WF.cover.value } };
      for (const f of FIELDS) s[f] = F[f].value;
      return s;
    }
    const args = (I, dims, wt, price, cost, n) => modelArgs(I, cat, unitOf(cat), dims, wt, price, cost, n);
    function bandLabel(bands, price) {
      const i = RgCalc.band(bands, price);
      const lo = bands[i], hi = bands[i + 1];
      return hi ? `${lo.toLocaleString('ko-KR')}~${hi.toLocaleString('ko-KR')}원 구간` : `${lo.toLocaleString('ko-KR')}원 이상 구간`;
    }

    function render() { draw(); if (o.onChange) o.onChange(); }
    // 유형별 입출고+배송비: 카테고리(요금 그룹)와 판매가(구간)가 정해지면 6개 버튼에 다 적어 비교하게 한다
    function paintFees(I) {
      const t = cat && I.price ? unitOf(cat) : null, sold = I.price * (1 - I.sellerDisc / 100);
      tiers.querySelectorAll('.tier').forEach(b => {
        const i = +b.dataset.i, el = b.querySelector('.fee');
        if (!t) { el.textContent = '물류비 —'; b.title = '카테고리·판매가를 넣으면 유형별 입출고+배송비가 표시됩니다'; return; }
        const wh = RgCalc.lookup(t, 'wh', i, sold), sh = RgCalc.lookup(t, 'sh', i, sold);
        el.textContent = `물류비 ${(wh + sh).toLocaleString('ko-KR')}`; b.title = `입출고 ${won(wh)} + 배송 ${won(sh)} (판매가 ${won(sold)} 구간)`;
      });
    }
    function draw() {
      save();
      const ev = evaluate(FEES, state()), I = ev.I;
      paintTiers(I.tier ? I.tier.i : -1);
      paintFees(I);
      sizeNote.textContent = !I.tier ? SIZE_HELP
        : sizeMode === 'dims' ? `사이즈 유형: ${I.tier.name} — 세변 합 ${I.tier.cm}cm · ${I.wt.toLocaleString('ko-KR')}g · 부피 ${(I.cbm * 1000).toFixed(2)}ℓ(${I.cbm.toFixed(4)}㎥)${I.tier.extra ? ` · 특대형 초과 추가비용 ${won(I.tier.extra)}` : ''}`
        : `${I.tier.name}: 세변 합 ${RgCalc.SIZES[I.tier.i].cm}cm · ${RgCalc.SIZES[I.tier.i].kg}kg까지.${ev.ok ? ` 이 유형·판매가 구간의 물류비 = 입출고 ${won(ev.c.wh)} + 배송 ${won(ev.c.sh)}.` : ' 입출고·배송비는 유형으로 정해지고,'} 보관비와 묶음 유형은 이 유형의 대표 크기(${I.dims.join('×')}mm · ${(I.wt / 1000).toLocaleString('ko-KR')}kg)로 어림합니다.`;
      catNote.textContent = cat ? `${catAuto && ctx.query ? `신청서 품명 '${ctx.query}' → 자동 매칭 · 다르면 위 칸에서 바꾸세요 · ` : ''}${cat.p.replace(/>/g, ' › ')} · 판매수수료 ${cat.r}% (VAT 별도)${unitOf(cat).lowasp ? ' · 14,000원 미만 저가 상품 전용 할인 대상' : ''}${RgCalc.isApparel(cat.p) ? ' · 45일 무료 보관·의류 회수비 단가' : ''}`
        : ctx.query && catInput.value === ctx.query ? `신청서 품명 '${ctx.query}'에 딱 맞는 쿠팡 카테고리가 없어요 — 상품 종류를 다른 말로 적어 골라 주세요(예: 청소포, 안경 액세서리).` : CAT_HELP;
      // what the seller still has to type is marked; placeholders talk until then
      const needs = ev.needs;
      catField.classList.toggle('need', needs.cat); priceField.classList.toggle('need', needs.price); sizeBlock.classList.toggle('need', needs.size);
      catInput.placeholder = PH.cat[needs.cat ? 0 : 1]; F.price.placeholder = PH.price[needs.price ? 0 : 1];
      if (needs.cat || needs.price || needs.size) {
        const miss = [needs.cat && '카테고리', needs.price && '판매가', needs.size && '사이즈 유형'].filter(Boolean).join('·');
        out.innerHTML = `<section class="sheet balanced quiet"><p class="sheet-label">개당 순이익</p><p class="sheet-title">${miss}${/[가]$/.test(miss) ? '를' : '을'} 넣으면 바로 계산됩니다</p><p class="sheet-text">쿠팡 판매자센터 요금표(${FEES.asof}) 기준 — 판매수수료, 입출고비, 배송비, 보관비, 반품 회수·재입고비, 광고비를 빼고 부가세는 따로 보여 줍니다.</p></section>`;
        lastNum = null;
        drawWing(ev);
        return;
      }
      const A = ev.A, c = ev.c;
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
        const B = { ...args(I, dims, I.wt * n, priceN, I.cost * n, n), inbound: I.inbound * n };
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
      drawWing(ev);
    }

    // ----- 윙 실적 진단 -----
    const n1 = x => (Math.round(x * 10) / 10).toLocaleString('ko-KR');
    const cnt = x => Math.round(x).toLocaleString('ko-KR') + '개';
    const signPct = r => (r >= 0 ? '+' : '−') + pct1(Math.abs(r));
    function drawWing(ev) {
      wingClear.hidden = !wingIn.value.trim();
      wingOpts.hidden = !W;
      F.monthly.closest('.field').classList.toggle('wing', !!W && wingMonthly() != null && F.monthly.value === String(wingMonthly()));
      F.ret.closest('.field').classList.toggle('wing', !!W && wingRet() != null && numv(F.ret.value) === wingRet());
      F.disc.closest('.field').classList.toggle('wing', !!W && wingDisc() != null && numv(F.disc.value) === wingDisc());
      if (!W) { wingOut.innerHTML = ''; return; }
      const RgWing = root.RgWing, I = ev.I;
      const list = W.price.list, basis = W.price.final || list; // 쿠팡 예상 비용은 최종구매가 기준 (2,678 = 7,350 × 7.8% + 극소형 980 + 1,125)
      const perUnit = ev.ok ? ev.c.expected : null;
      const lead = numv(WF.lead.value) || 25, cover = numv(WF.cover.value) || 0;
      const d = RgWing.diagnose(W, { lead, cover, perUnit });
      // 사이즈 유형·카테고리 대조: 쿠팡 예상 비용을 이 카테고리 요금표로 역산해 가장 가까운 유형을 찾는다
      const inf = ev.ok && W.cost.unit != null ? RgWing.inferTier(W.cost.unit, basis, cat.r, unitOf(cat)) : null;
      const tierOff = inf && inf.i !== I.tier.i; // 쿠팡 비용에 가장 가까운 유형이 지금 고른 유형이 아니다
      const catOff = inf && Math.abs(inf.gap) > 0.15; // 어느 유형으로도 안 맞으면 수수료율(카테고리)이 다르다
      const tone = perUnit != null && perUnit < 0 ? 'severe' : tierOff || catOff || (d.shortage > 0) || (d.trend != null && d.trend < -0.3) ? 'moderate' : 'balanced';
      const rows = [];
      const dc = wingDisc();
      if (list) rows.push(['판매가', won(list), `${dc != null ? `최종구매가 ${won(W.price.final)} = 판매자 할인 ${dc}% (정산에서 '판매자 할인쿠폰'으로 빠지는 판매자 부담) → ${numv(F.disc.value) === dc ? '위 판매자 즉시할인 칸에 넣었어요' : '위 판매자 즉시할인 칸은 직접 고친 값이 우선입니다'} · ` : ''}${d.revIsList === true ? `윙 매출 ${won(W.d30.rev)} = 단품 ${cnt(d.revUnits)}${d.revInferred ? '(역산)' : ''} × 표시가 — 할인·번들 매출은 이 집계에 없어 실판매가는 못 구합니다` : d.revIsList === false ? `윙 매출 ${won(W.d30.rev)} ÷ ${cnt(d.revUnits)} = ${won(d.revPerUnit)} — 윙 매출은 단품 판매분만 표시가로 집계해서 번들이 섞이면 낮게 나옵니다. 실판매가로 쓰지 마세요` : '매출 박스가 없어요'}`]);
      if (d.rate != null) rows.push(['판매 속도', `하루 ${n1(d.rate)}개`, `${W.d7.sold != null ? `지난 7일 ${cnt(W.d7.sold)}` : ''}${W.d30.sold != null ? ` · 30일 ${cnt(W.d30.sold)} (하루 ${n1(d.rate30)}개)` : ''}${d.trend != null ? ` → 최근 7일이 30일 평균보다 ${signPct(d.trend)}` : ''}${W.y.sold != null ? ` · 어제 ${cnt(W.y.sold)}` : ''}`]);
      if (d.cvr.d7 != null || d.cvr.d30 != null) rows.push(['구매 전환율', pct1(d.cvr.d7 != null ? d.cvr.d7 : d.cvr.d30), `${d.cvr.d7 != null ? `7일 조회 ${W.d7.views.toLocaleString('ko-KR')} → 구매 ${W.d7.sold}` : ''}${d.cvr.d30 != null ? ` · 30일 ${pct1(d.cvr.d30)} (조회 ${W.d30.views.toLocaleString('ko-KR')})` : ''}`]);
      if (d.bundleShare != null) rows.push(['번들 비중 (30일)', pct1(d.bundleShare), `단품 ${cnt(W.d30.single)} · 번들 ${cnt(W.d30.bundle)} — 묶음이 많이 팔리면 위 낱개 vs 묶음 표의 묶음 판매가를 실제 값으로 맞춰 보세요`]);
      if (W.stock.avail != null) rows.push(['재고', d.daysTotal != null ? `${n1(d.daysTotal)}일치` : cnt(d.stock.total), `판매가능 ${cnt(W.stock.avail)}${W.stock.availDays != null ? ` (쿠팡 표시 ${W.stock.availDays}일)` : ''}${W.stock.inbound != null ? ` + 입고중 ${cnt(W.stock.inbound)}` : ''} = ${cnt(d.stock.total)}${d.daysAvail != null ? ` · 지금 속도로 판매가능분은 ${n1(d.daysAvail)}일, 입고중까지 ${n1(d.daysTotal)}일` : ''}`]);
      if (d.reorderQty != null) rows.push(['다음 수입 발주', d.reorderQty > 0 ? cnt(d.reorderQty) : '아직 필요 없음', `${d.shortage > 0 ? `지금 발주해도 도착 전 ${n1(d.gapDays)}일 품절 · 못 파는 ${cnt(d.shortage)}${d.lostProfit != null ? ` = 놓치는 순이익 ${won(d.lostProfit)}` : ''} · ` : `리드타임 ${lead}일 안에 품절 없음 · `}리드타임 ${lead}일 + 여유 ${cover}일 = ${cnt(d.rate * (lead + cover))} 필요 − 재고 ${cnt(d.stock.total)}${W.stock.recommend != null ? ` · 쿠팡 입고권장 ${cnt(W.stock.recommend)}` : ''}`]);
      if (W.ret.rate != null) rows.push(['반품률', pct1(W.ret.rate / 100), `${W.ret.month != null ? `${W.ret.month}월 실측 · ` : ''}${F.ret.closest('.field').classList.contains('wing') ? '위 반품률 칸에 넣었어요 (카테고리 추정치 대신)' : '위 반품률 칸은 직접 고친 값이 우선입니다'}`]);
      if (W.cost.unit != null) {
        const evB = ev.ok ? evaluate(FEES, { ...state(), price: String(basis), disc: '0' }) : null;
        const mine = evB && evB.ok ? evB.c.commission + evB.c.wh + evB.c.sh : null;
        const storageNote = W.cost.storageMonth != null ? ` · 이번달 누적보관비 ${won(W.cost.storageMonth)}` : '';
        rows.push(['쿠팡 예상 비용 (개당)', won(W.cost.unit), mine == null ? `카테고리·사이즈 유형을 넣으면 계산기 비용과 대조합니다${storageNote}`
          : `이 계산기의 판매수수료 + 입출고비 + 배송비 (${W.price.final ? '최종구매가' : '표시가'} ${won(basis)} 기준) ${won(mine)} → 차이 ${signPct((mine - W.cost.unit) / W.cost.unit)}${
            tierOff && !catOff ? ` — 쿠팡 비용은 ${RgCalc.SIZES[inf.i].name}(${won(inf.est)})과 맞는데 지금은 ${I.tier.name}으로 되어 있어요` : tierOff ? ` — 가장 가까운 유형은 ${RgCalc.SIZES[inf.i].name}(${won(inf.est)})이지만 그래도 ${signPct(inf.gap)} 차이. 지금은 ${I.tier.name}이고, 카테고리(수수료율)도 실제 등록과 다른지 확인하세요` : catOff ? ' — 어느 사이즈 유형으로도 안 맞아요. 카테고리(수수료율)가 실제 등록과 다른지 확인하세요' : ' — 카테고리·사이즈가 실제와 맞아요'}${storageNote}`]);
      }
      const tbl = rows.map(([k, v, note]) => `<tr><th>${esc(k)}<small>${esc(note)}</small></th><td>${esc(v)}</td></tr>`).join('');
      const head = d.monthlyProfit != null
        ? `<div class="sheet-num"><span class="num">${d.monthlyProfit < 0 ? '−' : ''}${Math.round(Math.abs(d.monthlyProfit)).toLocaleString('ko-KR')}</span><span class="pct">원/월</span></div><p class="sheet-title">지금 속도(하루 ${n1(d.rate)}개 · 월 ${cnt(d.monthlyUnits)}) × 개당 순이익 ${perUnit < 0 ? '−' : ''}${won(Math.abs(perUnit))}${perUnit < 0 ? ' — 지금 입력으로는 적자입니다' : ''}</p>`
        : d.rate != null ? `<p class="sheet-title">하루 ${n1(d.rate)}개 (월 ${cnt(d.monthlyUnits)})</p><p class="sheet-text">위에 카테고리·판매가·사이즈 유형을 넣으면 월 순이익 전망과 품절로 놓치는 순이익까지 계산됩니다.</p>`
        : `<p class="sheet-title">최근 판매가 없어 속도·재고 예측은 못 합니다</p>`;
      const apply = tierOff ? `<p class="sheet-actions"><button type="button" class="next alt rg-wing-tier">사이즈 유형을 ${RgCalc.SIZES[inf.i].name}으로 바꾸기</button></p>` : '';
      wingOut.innerHTML = `<section class="sheet ${tone}"><p class="sheet-label">${W.name ? esc(W.name) + ' · ' : ''}윙 실적 진단</p>${head}
        <div class="tbl-wrap"><table class="tbl mini rg"><tbody>${tbl}</tbody></table></div>${apply}
        <p class="muted small basis">속도·재고 예측은 최근 7일 판매량(없으면 30일)이 이어진다는 가정입니다. 발주 수량 = 하루 판매량 × (리드타임 + 여유) − (판매가능 + 입고중). 쿠팡 예상 비용(개당)은 최종구매가 × 수수료율 + 입출고비 + 배송비와 원 단위로 맞아, 사이즈 유형·카테고리 검증에 씁니다.</p></section>`;
      const tb = wingOut.querySelector('.rg-wing-tier');
      if (tb) tb.addEventListener('click', () => { tierIdx = inf.i; sizeMode = 'tier'; showDims(false); render(); sizeBlock.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    }

    load(o.key, o.ctx);
    return { load, reset, render, focus: () => catInput.focus() };
  }

  root.RgWidget = { mount, evaluate };
})(typeof window !== 'undefined' ? window : globalThis);
