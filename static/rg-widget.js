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
// 윙 실적 진단 (rg-wing.js): the 상품 관리 row pasted from Wing is an observation, not an input. It checks the picked 사이즈 유형·
// 카테고리 against 쿠팡 예상 비용(개당) and prints 판매 속도·재고 소진·다음 수입 발주 수량. Its measured 월 판매량·반품률 land in the
// form only where the seller never typed (SRC tracks who wrote each of 월 판매량·반품률·할인: 'user' | 'wing' | default) and only
// when the pasted screen prices this product (판매가 칸 == 최종구매가); otherwise they are offered with an explicit apply button.
// 판매가·할인 are never written by the program (owner 2026-09-21). Wing's 매출 is 단품 × 표시가, so no real selling price is derived
// from it (the old 실판매가 row invented a 42.5% discount on a bundled product). The headline is always the seller's own settings;
// a 유형·카테고리 that matches 쿠팡 비용 is a preview until '바꾸기' commits the same patch. (GPT-6 Pro review 2026-09-21.)
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
  <p class="muted small rg-price-note" hidden></p>
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
  <p class="muted small rg-wing-src" hidden></p>
  <div class="rg-wing-paste">
  <p class="muted small">이미 파는 상품이면 ${o.embedded ? `<a href="${o.base}rocket/">로켓그로스 계산기</a>의 북마클릿으로 윙 재고현황 전체를 한 번에 가져오거나, ` : ''}윙 › 로켓그로스 › <b>재고현황</b>에서 그 상품의 판매량 숫자(지난 30일)를 눌러 판매 상세를 펼치고, <b>상품 줄부터 펼쳐진 상세 끝(반품률)까지</b> 드래그해 복사한 뒤 붙여 넣으세요. 실제 판매 속도·재고·반품률로 위 계산을 실적 기준으로 바꾸고, 아래 재고·발주 계획까지 이어집니다. 붙여 넣은 내용은 이 기기에만 저장됩니다.</p>
  <div class="paste"><textarea class="rg-wing-in" rows="4" spellcheck="false" placeholder="어제 2 · 지난 7일 49 · 지난 30일 294 · 판매가능 106 · 입고중 100 · 판매가 9,800 · 매출 1,666,000원 · 조회 수 2,509 · 반품률 9.8% …"></textarea>
  <div class="paste-actions"><button type="button" class="next rg-wing-go">진단하기</button><span class="muted small rg-wing-note"></span></div></div>
  </div>
  <div class="rg-wing-out" aria-live="polite"></div>
</div>
<div class="calc card rg-plan">
  <div class="sub-row"><h2 class="card-title">재고·발주 계획</h2></div>
  <p class="muted small">지금 재고가 이 속도로 언제 떨어지고, 1688 주문을 늦어도 언제 넣어야 하는지. 재고는 윙에서 가져오면 채워지고 직접 고치면 그 값이 우선입니다. 속도는 지난 7일·30일·90일 셋을 다 보고 30일 속도로 예측하되, 셋이 크게 다르면 범위로 보여 줍니다.</p>
  <div class="row">
    <label class="field"><span>현재 재고 <small class="muted">(판매가능, 개)</small></span><input data-p="avail" class="num-in" type="text" inputmode="numeric" placeholder="0" autocomplete="off"></label>
    <label class="field"><span>입고중 <small class="muted">(쿠팡으로 가는 중, 개)</small></span><input data-p="inbound" class="num-in" type="text" inputmode="numeric" placeholder="0" autocomplete="off"></label>
  </div>
  <details class="more rg-stages"><summary>리드타임 단계별 일수 <small class="muted rg-lead-sum"></small></summary>
    <p class="muted small">1688 주문부터 쿠팡 입고 완료까지, 단계마다 걸리는 날. 아래 기록장에 주문 ${root.RgStock.MIN_SAMPLES}건 이상 쌓이면 실제 중앙값이 기본값을 대신하고, 직접 적은 값이 항상 우선입니다.</p>
    <div class="row stages">${root.RgStock.STAGES.slice(0, -1).map(st => `<label class="field"><span>${st.label} → ${st.next} <small class="muted rg-stage-src" data-k="${st.k}"></small></span><input data-s="${st.k}" class="num-in" type="text" inputmode="numeric" placeholder="${st.d}" autocomplete="off"></label>`).join('')}</div>
    <div class="row">
      <label class="field"><span>발주 여유 <small class="muted">(품절 며칠 전에 도착시킬지, 일)</small></span><input data-s="buffer" class="num-in" type="text" inputmode="numeric" value="7" autocomplete="off"></label>
      <label class="field"><span>재고 커버 <small class="muted">(입고 뒤 며칠치를 둘지, 일)</small></span><input data-s="cover" class="num-in" type="text" inputmode="numeric" value="30" autocomplete="off"></label>
    </div>
  </details>
  <div class="rg-plan-out" aria-live="polite"></div>
</div>
<div class="calc card rg-log">
  <div class="sub-row"><h2 class="card-title">리드타임 기록장</h2><button type="button" class="link-btn rg-log-add">+ 주문 추가</button></div>
  <p class="muted small">주문 건마다 단계 날짜를 찍어 두면 진행 중인 주문은 위 재고 예측에 "곧 들어올 수량"으로 잡히고, 단계별 실제 일수가 리드타임 기본값이 됩니다. 모든 상품의 주문이 한 곳에 모이고, 이 기기에만 저장됩니다.</p>
  <div class="rg-log-list"></div>
  <p class="muted small rg-log-sum"></p>
</div>`;

  const numv = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
  const modelArgs = (fees, I, cat, table, dims, wt, price, cost, n) => {
    const RgCalc = root.RgCalc, tier = RgCalc.sizeTier(dims, wt), cbm = dims[0] * dims[1] * dims[2] / 1e9;
    return { ...I, table, rate: cat.r, sizeIdx: tier.i, extra: tier.extra, cbm, apparel: RgCalc.isApparel(cat.p), price, cost, tier, n, promoOver: RgCalc.promoOver(fees) };
  };
  const TRACKED = ['monthly', 'ret', 'disc']; // fields whose writer matters (SRC)
  // Saved-slot migration, one path for the widget (applyState) and the 사업자 합계 (evaluate on a raw slot) so both see the same numbers:
  // pre-src saves carried retTouched/discTouched; a discount the seller never typed came from the 2026-09-20 auto-fill (25% · 42.5%) → 0.
  function normalize(s) {
    s = s || {};
    const src = Object.assign({}, s.src);
    if (!s.src) { if (s.discTouched) src.disc = 'user'; if (s.retTouched) src.ret = 'user'; }
    const out = { ...s, src };
    if (src.disc !== 'user' && numv(s.disc) > 0 && s.wing && s.wing.text) out.disc = DEFAULTS.disc;
    return out;
  }
  // State = what save() writes (form field strings + cat/sizeMode/tierIdx/saver/simp/src). ctx.cost overrides the saved cost (imported 원가).
  function evaluate(FEES, s, ctx) {
    const RgCalc = root.RgCalc; s = normalize(s); ctx = ctx || {};
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
    const A = modelArgs(FEES, I, cat, FEES.units[cat.u], dims, wt, I.price, I.cost, 1);
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
    const catNote = q('.rg-cat-note'), sizeNote = q('.rg-size-note'), costNote = q('.rg-cost-note'), priceNote = q('.rg-price-note');
    const catField = q('.cat-field'), priceField = q('.price-field'), sizeBlock = q('.size-block'), tiers = q('.tiers'), dimsRow = q('.row.dims'), dimsToggle = q('.rg-dims-toggle');
    const costNoteOrig = costNote.innerHTML;
    const wingIn = q('.rg-wing-in'), wingGo = q('.rg-wing-go'), wingNote = q('.rg-wing-note'), wingClear = q('.rg-wing-clear'), wingOut = q('.rg-wing-out'), wingSrc = q('.rg-wing-src'), wingPaste = q('.rg-wing-paste');
    const PF = { avail: q('[data-p="avail"]'), inbound: q('[data-p="inbound"]') }, planOut = q('.rg-plan-out'), leadSum = q('.rg-lead-sum');
    const SF = {}; host.querySelectorAll('[data-s]').forEach(el => { SF[el.dataset.s] = el; });
    const logList = q('.rg-log-list'), logSum = q('.rg-log-sum'), logAdd = q('.rg-log-add');
    const RgStock = root.RgStock;
    // 리드타임 기록장 + stage overrides are one store for every product (localStorage 'jikguse.rg.lead'), not per slot
    const LEAD_KEY = 'jikguse.rg.lead';
    const leadLoad = () => { let L = {}; try { L = JSON.parse(localStorage.getItem(LEAD_KEY)) || {}; } catch (e) { /* fresh */ } return Object.assign({ orders: [], stages: {}, buffer: '7', cover: '30' }, L); };
    let LEAD = leadLoad();
    const leadSave = () => { try { localStorage.setItem(LEAD_KEY, JSON.stringify(LEAD)); } catch (e) { /* storage blocked */ } };
    for (const k in SF) SF[k].value = k === 'buffer' || k === 'cover' ? LEAD[k] : (LEAD.stages[k] != null ? LEAD.stages[k] : '');
    let W = null, WTEXT = ''; // parsed Wing row (RgWing.parse().w) for the current slot + the exact text it came from (edited text ≠ W)
    const wingIsThis = () => !!(ctx && ctx.item); // a 북마클릿 item is this product by construction (slot keyed by its 옵션ID); a paste is not
    let KEY = o.key, cat = null, catAuto = false, BP = {}, SRC = {}, ctx = {}, epoch = 0; // epoch: bumped on load/reset so late async answers are dropped
    let sizeMode = 'tier', tierIdx = null; // 'tier' = picked a 쿠팡 유형 (default) · 'dims' = typed mm/g
    let lastNum = null; // last headline number, to pulse the sheet when an input changes it
    let CATS = null, catsP = null;
    const catsReady = () => catsP || (catsP = fetch(o.catsUrl).then(r => r.json()).then(d => {
      CATS = d.cats.map(c => ({ p: c[0], r: c[1], u: c[2], code: c[3], leaf: c[0].split('>').pop(), s: c[0].toLowerCase().replace(/\s+/g, '') }));
      return CATS;
    }).catch(e => { catsP = null; throw e; }));
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
    const choose = (c, auto) => { cat = c; catAuto = !!auto; catInput.value = c.leaf; catInput.title = c.p; close(); if (!SRC.ret) F.ret.value = String(RgCalc.returnDefault(c.p) * 100); render(); };
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
    // the writer is recorded BEFORE render() saves — a separate listener registered after render ran second, so the first 할인/반품률
    // keystroke was saved as untouched and a reload could wipe it (GPT-6 Pro review 2026-09-21)
    for (const f of FIELDS) F[f].addEventListener('input', () => { if (TRACKED.includes(f)) SRC[f] = 'user'; render(); });
    saver.addEventListener('change', render); simp.addEventListener('change', render);
    q('.rg-reset').addEventListener('click', () => { reset(); catInput.focus(); });
    for (const k in PF) PF[k].addEventListener('input', () => { SRC[k] = 'user'; render(); });
    for (const k in SF) SF[k].addEventListener('input', () => { if (k === 'buffer' || k === 'cover') LEAD[k] = SF[k].value; else LEAD.stages[k] = SF[k].value; leadSave(); render(); });
    logAdd.addEventListener('click', () => addOrder(null));
    wingGo.addEventListener('click', () => {
      if (!root.RgWing) return;
      const r = root.RgWing.parse(wingIn.value); W = r.ok ? r.w : null; WTEXT = W ? wingIn.value : '';
      wingNote.textContent = r.ok ? (r.missing.length ? `읽었어요 · 못 찾은 것: ${r.missing.join(' · ')}` : '') : (wingIn.value.trim() ? '판매량(어제·지난 7일·30일)을 못 찾았어요 — 재고현황의 상품 줄을 통째로 복사해 주세요. 계속 안 되면 hello@jikguse.com 으로 화면 텍스트를 보내 주세요.' : '');
      if (W) fillFromWing();
      render();
      if (W) wingOut.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    wingIn.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) wingGo.click(); });
    // an edited paste is a draft: the old parse must not keep describing text that no longer says that
    wingIn.addEventListener('input', () => { if (W && wingIn.value !== WTEXT) { W = null; WTEXT = ''; wingNote.textContent = '내용이 바뀌었어요 — 진단하기를 다시 눌러 주세요'; render(); } });
    wingClear.addEventListener('click', () => { wingIn.value = ''; W = null; WTEXT = ''; wingNote.textContent = ''; render(); }); // text + parse only; inputs stay
    const wingMonthly = () => W && (W.d30.sold != null ? W.d30.sold : W.d7.sold != null ? Math.round(W.d7.sold / 7 * 30) : null);
    const wingMonthlyEst = () => !!W && W.d30.sold == null && W.d7.sold != null; // 7일 × 30/7 is an estimate, not a measurement
    const wingRet = () => W && W.ret.rate != null ? Math.round(W.ret.rate * 10) / 10 : null;
    const wingFinal = () => W ? (W.price.final != null ? W.price.final : W.price.list) : null; // 최종구매가, else 표시가 (자동조정 없음)
    // 'same' = the pasted screen prices this product (판매가 칸, 할인 반영 == 최종구매가) · 'off' = differs · 'unknown' = no price read
    const wingPriceMatch = () => { const fin = wingFinal(), sold = numv(F.price.value) * (1 - numv(F.disc.value) / 100); return !(fin > 0) || !(sold > 0) ? 'unknown' : Math.abs(sold - fin) <= 1 ? 'same' : 'off'; };
    // 판매가·할인 칸은 건드리지 않는다 — 판매가는 항상 사용자가 낱개에 적은 금액 (오너 2026-09-21: 윙 표시가 9,800 → 최종구매가 7,350 을 할인율로 역산해 넣지 말 것).
    // 월 판매량 ← 지난 30일, 반품률 ← 반품률(월): only into fields the seller never typed, only when the screen is verifiably this product.
    function fillFromWing() {
      if (W && W.stock) { // 재고 is not price-dependent: any never-typed stock field takes the Wing count
        if (SRC.avail !== 'user' && W.stock.avail != null) { PF.avail.value = String(W.stock.avail); SRC.avail = 'wing'; }
        if (SRC.inbound !== 'user' && W.stock.inbound != null) { PF.inbound.value = String(W.stock.inbound); SRC.inbound = 'wing'; }
      }
      // a 북마클릿 item is this product, but its 30-day volume happened at the Wing price: once the seller types a different 판매가 the
      // numbers are an offer ([위 칸에 넣기]), not an auto-fill (GPT-6 Pro 2026-09-21). A paste needs the exact price match.
      const match = wingPriceMatch();
      if (wingIsThis() ? match === 'off' : match !== 'same') return;
      applyWing({ monthly: SRC.monthly !== 'user', ret: SRC.ret !== 'user' });
    }
    function applyWing(which) {
      const m = wingMonthly(), r = wingRet();
      if (which.monthly && m != null) { F.monthly.value = String(m); SRC.monthly = 'wing'; }
      if (which.ret && r != null) { F.ret.value = String(r); SRC.ret = 'wing'; }
    }

    function save() { if (!KEY) return; try { localStorage.setItem(KEY, JSON.stringify(state())); } catch (e) { /* storage blocked/full — the calculation still shows */ } }
    function applyState(raw) {
      const s = normalize(raw);
      cat = s.cat && FEES.units[s.cat.u] && typeof s.cat.r === 'number' ? s.cat : null; // 저장된 선택이 새 요금표와 안 맞으면 버린다
      catInput.value = cat ? cat.leaf : ''; catInput.title = cat ? cat.p : ''; catAuto = !!(cat && s.catAuto);
      BP = s.bp || {}; SRC = s.src; saver.checked = !!s.saver; simp.checked = !!s.simp;
      const wg = s.wing || {}; wingIn.value = wg.text || '';
      WTEXT = wg.parsed != null ? wg.parsed : (wg.text || ''); // pre-parsed saves: the text was what got parsed
      W = wg.text && wg.text === WTEXT && root.RgWing ? (r => r.ok ? r.w : null)(root.RgWing.parse(wg.text)) : null; if (!W) WTEXT = '';
      wingNote.textContent = W || !wg.text ? '' : '내용이 바뀌었어요 — 진단하기를 다시 눌러 주세요';
      if (ctx.item && root.RgWing) { W = root.RgWing.fromItem(ctx.item); WTEXT = ''; wingIn.value = ''; } // 북마클릿 item outranks a paste in this slot
      wingPaste.hidden = !!ctx.item; wingSrc.hidden = !ctx.item;
      for (const f of FIELDS) F[f].value = s[f] != null && s[f] !== '' ? s[f] : (DEFAULTS[f] || '');
      const pl = s.plan || {}; for (const k in PF) PF[k].value = pl[k] != null ? pl[k] : '';
      // pre-src saves: the old auto-fill wrote 월 판매량·반품률 with no marker — the ones still equal to the Wing values were its (once, at migration)
      if (!raw || !raw.src) { if (W && wingMonthly() != null && F.monthly.value === String(wingMonthly())) SRC.monthly = 'wing'; if (W && SRC.ret === 'user' && wingRet() != null && numv(F.ret.value) === wingRet()) SRC.ret = 'wing'; }
      tierIdx = Number.isInteger(s.tierIdx) && RgCalc.SIZES[s.tierIdx] ? s.tierIdx : null;
      sizeMode = s.sizeMode === 'dims' || (!s.sizeMode && ['d1', 'd2', 'd3', 'wt'].some(f => F[f].value)) ? 'dims' : 'tier'; // pre-toggle saves had dims only
      showDims(sizeMode === 'dims');
      lastNum = null;
    }
    // Switch the saved-state slot; ctx.cost (per-unit landed cost) is linked — the cost box shows it read-only so the widget, the item
    // chips and the whole-shipment total can never disagree on 원가; ctx.note replaces the cost hint.
    function load(key, c) {
      KEY = key; ctx = c || {}; epoch++;
      let s = {}; try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* fresh */ }
      applyState(s);
      F.cost.readOnly = ctx.cost != null;
      if (ctx.cost != null) F.cost.value = String(Math.round(ctx.cost));
      costNote.innerHTML = ctx.note != null ? esc(ctx.note) : costNoteOrig;
      if (ctx.item) { fillFromWing(); matchFromItem(); }
      render();
      if (cat) catsReady(); else matchFromQuery();
    }
    // No category saved for this slot but the sheet gave a 품명 → pick one; if none fits, leave the 품명 in the box to search from.
    function matchFromQuery() {
      if (!ctx.query) return;
      const ep = epoch, query = ctx.query, hs = ctx.hs;
      catsReady().then(() => {
        if (epoch !== ep || cat) return; // slot switched or reset meanwhile (A→B→A included) — stale answer
        const c = autoMatch(query, hs);
        if (c) choose(c, true); else { catInput.value = query; render(); }
      }).catch(() => {});
    }
    // 북마클릿 item carries Wing's own 노출 카테고리 코드 → the exact 카테고리 (rg_cats code column) when the slot has none saved
    function matchFromItem() {
      if (!ctx.item || cat) return;
      const ep = epoch, code = ctx.item.cat && ctx.item.cat.code;
      catsReady().then(() => {
        if (epoch !== ep || cat) return;
        const c = (code && CATS.find(x => String(x.code) === String(code))) || (ctx.item.cat && ctx.item.cat.path ? CATS.find(x => x.p === ctx.item.cat.path) : null);
        if (c) choose(c, true); else if (ctx.query) matchFromQuery();
      }).catch(() => {});
    }
    function reset() {
      if (KEY) localStorage.removeItem(KEY);
      epoch++;
      applyState({});
      if (ctx.cost != null) F.cost.value = String(Math.round(ctx.cost)); // the imported cost is context, not input — keep it
      if (ctx.item) { fillFromWing(); matchFromItem(); }
      render();
      matchFromQuery();
    }

    function state() {
      const s = { cat, catAuto, bp: BP, saver: saver.checked, simp: simp.checked, src: SRC, sizeMode, tierIdx, wing: { text: wingIn.value, parsed: WTEXT }, plan: { avail: PF.avail.value, inbound: PF.inbound.value } };
      for (const f of FIELDS) s[f] = F[f].value;
      return s;
    }
    const args = (I, dims, wt, price, cost, n) => modelArgs(FEES, I, cat, unitOf(cat), dims, wt, price, cost, n);
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
      priceNote.hidden = !(I.price > 0 && I.sellerDisc > 0);
      if (!priceNote.hidden) priceNote.textContent = `판매자 즉시할인 ${I.sellerDisc}% 적용 → 수수료·정산 기준가 ${won(I.price * (1 - I.sellerDisc / 100))} (아래 '판매 조건 자세히'의 판매자 즉시할인 칸 · 0으로 두면 판매가 그대로)`;
      // 판매가 is the seller's own entry (owner 2026-09-21) — a 북마클릿 item only offers Wing's price behind an explicit button
      const wfin = ctx.item && W ? wingFinal() : null;
      if (wfin > 0 && !(I.price > 0)) {
        priceNote.hidden = false;
        priceNote.innerHTML = `윙 최종구매가 ${won(wfin)}${W.price.list && W.price.list !== wfin ? ` (표시가 ${won(W.price.list)})` : ''} — 판매가는 직접 적는 칸이라 자동으로 넣지 않아요. <button type="button" class="link-btn rg-price-use">윙 판매가 ${won(wfin)} 넣기</button>`;
        priceNote.querySelector('.rg-price-use').addEventListener('click', () => { F.price.value = String(wfin); render(); F.price.focus(); });
      }
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
        drawWing(ev); drawPlan(ev); drawLog();
        return;
      }
      const A = ev.A, c = ev.c;
      const be = RgCalc.breakEven(A), m20 = RgCalc.breakEven(A, 0.2), m30 = RgCalc.breakEven(A, 0.3);
      const tone = c.expected <= 0 ? 'severe' : c.margin < 0.1 ? 'moderate' : 'balanced';
      const retLine = c.returns.r > 0 ? `반품 ${pct1(c.returns.r)} 반영: 반품 1건당 ${won(c.returns.perReturn)}(회수 ${won(c.returns.pickup)} + 재입고 ${won((1 - c.returns.q) * c.returns.restock)} + 재판매 불가 ${pct1(c.returns.q)}분 원가·반출비 ${won(c.returns.cogsLoss + c.returns.removal)})${c.billable < 1 && !I.saver ? ` · 월 20건 무료라 ${pct1(1 - c.billable)}는 무료` : ''}${I.saver ? ' · 세이버로 회수·재입고비 0' : ''}` : '반품률 0% — 반품 비용 없음';
      const rows = [
        ['매출 (공급가)', c.revenue, `${I.sellerDisc > 0 ? `판매가 ${won(I.price)} − 즉시할인 ${I.sellerDisc}% = ${won(c.sold)}` : `판매가 ${won(c.sold)}`}${I.simplified ? ' − 간이과세 납부세액 1.5% (소매 부가가치율 15%)' : ' ÷ 1.1'}`],
        ['판매수수료', -c.commission, `${cat.r}% × ${won(c.sold)}`],
        ['입출고비', -c.wh, `${I.tier.name} · ${bandLabel(unitOf(cat).bands, c.sold)}${I.tier.extra ? ' + 추가 ' + won(I.tier.extra) : ''}`],
        ['배송비', -c.sh, '주문당 1회'],
        ['보관비 (기대값)', -c.storage, `${I.turnover}일 균등 판매, ${c.free}일 무료 후 ${c.storage ? '구간 요율' : '하루 0원 (반올림)'}`],
        ...(c.ad ? [['광고비', -c.ad, `매출의 ${I.adPct}%`]] : []),
        ...(c.inbound ? [['입고 운송비 등', -c.inbound, '개당, VAT 별도']] : []),
        ...(c.saverShare ? [['세이버 이용료 안분', -c.saverShare, `99,000원 ÷ 월 ${I.monthly}개`]] : []),
        ['매입원가', -c.cost, I.simplified ? `VAT 제외 ${won(c.costNet)} × 1.1 − 세금계산서 공제 0.5% — 간이과세자는 매입(수입) 부가세를 못 돌려받아요` : ctx.cost != null ? '수입 계산기 개당 원가 (관세·운임 안분, VAT 제외)' : 'VAT 제외'],
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
        <p class="muted small basis">요금: 쿠팡 판매자센터 로켓그로스 비용/수수료 ${FEES.asof} ${c.promoOver ? `· <strong>프로모션 요금이 ${FEES.promo_until}에 끝나 기본 단가표(입출고·배송)로 계산 중입니다 — 쿠팡이 새 프로모션을 공지했으면 hello@jikguse.com 으로 알려 주세요</strong>` : `(프로모션 ${FEES.promo_until}까지)`} · 반품률은 쿠팡이 공개하지 않아 카테고리 기본값(추정)이며 윙 &gt; 로켓그로스 &gt; 반품분석의 내 수치를 넣는 것이 정확합니다 · 재입고비는 기본 단가(2025-07 프로모션 종료 후 카테고리별 할인 미반영). 예상치이며 실제 청구는 윙 정산현황 기준입니다. 오류 제보: hello@jikguse.com</p></section>`;
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
      drawWing(ev); drawPlan(ev); drawLog();
    }

    // ----- 윙 실적 진단 -----
    const n1 = x => (Math.round(x * 10) / 10).toLocaleString('ko-KR');
    const cnt = x => Math.round(x).toLocaleString('ko-KR') + '개';
    const signPct = r => (r >= 0 ? '+' : '−') + pct1(Math.abs(r));
    const signed = v => `${v < 0 ? '−' : ''}${won(Math.abs(v))}`;
    const ro = w => { const c = w.charCodeAt(w.length - 1); if (c < 0xac00 || c > 0xd7a3) return /[0-9]$/.test(w) ? (/[136780]$/.test(w) ? '으로' : '로') : '로'; const f = (c - 0xac00) % 28; return f === 0 || f === 8 ? '로' : '으로'; };
    const srcLabel = f => SRC[f] === 'user' ? '직접 입력' : SRC[f] === 'wing' ? '윙에서 넣음' : f === 'ret' ? '카테고리 추정치' : '기본값';
    // 월 순이익 for a different 월 판매량 = the whole model re-run at that volume (반품 무료 20건·세이버 안분 depend on it) — never 개당 × other units
    const profitAt = units => { const e = evaluate(FEES, { ...state(), monthly: String(units) }); return e.ok ? e.c.monthlyProfit : null; };
    const stagesNow = () => RgStock.medians(LEAD.orders, LEAD.stages);
    function drawWing(ev) {
      wingClear.hidden = !wingIn.value.trim();
      F.monthly.closest('.field').classList.toggle('wing', !!W && SRC.monthly === 'wing');
      F.ret.closest('.field').classList.toggle('wing', !!W && SRC.ret === 'wing');
      if (ctx.item) wingSrc.innerHTML = `윙 북마클릿으로 가져온 실적 · ${W && W.at ? `윙 집계 ${esc(String(W.at).slice(0, 16).replace('T', ' '))}` : ''}${ctx.at ? ` · 가져온 시각 ${esc(ctx.at)}` : ''} · 일별 판매량 ${W && W.series ? Object.keys(W.series).length + '일치' : '없음'}. 새 숫자가 필요하면 윙에서 북마클릿을 다시 누르세요.`;
      if (!W) { wingOut.innerHTML = ''; return; }
      const RgWing = root.RgWing, I = ev.I;
      const list = W.price.list, fin = wingFinal(), match = wingPriceMatch();
      // 쿠팡 예상 비용은 최종구매가(7,350) 기준이고, 이 계산기의 판매가는 사용자가 낱개에 적은 금액이다. 둘이 같다고 확인될 때만 유형·카테고리 대조가 뜻이 있다.
      const soldNow = I.price * (1 - I.sellerDisc / 100), basis = soldNow;
      const canCompare = ev.ok && match === 'same' && W.cost.unit != null;
      const perUnit = ev.ok ? ev.c.expected : null;
      const lead = RgStock.totalLead(stagesNow()), cover = numv(LEAD.cover);
      const d = RgWing.diagnose(W, { lead, cover, perUnit });
      const inf = canCompare ? RgWing.inferTier(W.cost.unit, basis, cat.r, unitOf(cat)) : null;
      if (canCompare && !CATS) catsReady().then(() => render()).catch(() => {});
      const fix = canCompare && CATS ? RgWing.inferFees(W.cost.unit, basis, FEES, CATS, W.name) : null;
      const fixTier = fix ? fix.tierIdx : inf ? inf.i : null;
      const tierOff = fixTier != null && fixTier !== I.tier.i; // 쿠팡 비용과 맞는 유형이 지금 고른 유형이 아니다
      const rateOff = !!fix && (fix.rate !== cat.r || !fix.units.includes(cat.u)); // 수수료율(카테고리)이 쿠팡 등록과 다르다
      const fixCat = rateOff && fix.cat ? fix.cat : null;
      const catOff = fix ? rateOff : !!inf && Math.abs(inf.gap) > 0.15; // 원 단위 재현이 안 되면 15% 넘게 어긋날 때만 의심
      // the recommendation is one patch — previewed and committed as the same object (카테고리만 바뀌면 사이즈 모드는 건드리지 않는다)
      const patch = {};
      if (tierOff) { patch.tierIdx = fixTier; patch.sizeMode = 'tier'; }
      if (fixCat) { patch.cat = fixCat; if (!SRC.ret) patch.ret = String(RgCalc.returnDefault(fixCat.p) * 100); }
      const evFix = Object.keys(patch).length ? evaluate(FEES, { ...state(), ...patch }) : null;
      const perUnitFix = evFix && evFix.ok ? evFix.c.expected : null;
      const fixLabel = [tierOff ? RgCalc.SIZES[fixTier].name : null, fixCat ? `${fixCat.leaf}(${fixCat.r}%)` : null].filter(Boolean).join(' · ');
      const patchLabel = fixLabel + (patch.ret != null && numv(patch.ret) !== numv(F.ret.value) ? ` · 반품률 ${patch.ret}%(카테고리 기본값)` : ''); // every field the patch changes is named on the button
      const nowLabel = ev.ok ? `${I.tier.name} · ${cat.leaf}(${cat.r}%)` : '';
      const tone = perUnit != null && perUnit < 0 ? 'severe' : tierOff || catOff || (d.trend != null && d.trend < -0.3) ? 'moderate' : 'balanced';
      // 윙 값 vs 현재 입력 — differences are offered, never pushed (판매가 칸이 최종구매가와 같고 직접 친 적이 없는 칸만 붙여넣을 때 채워진다)
      const wm = wingMonthly(), wr = wingRet();
      const offer = { monthly: wm != null && numv(F.monthly.value) !== wm, ret: wr != null && numv(F.ret.value) !== wr };
      const rows = [];
      // 값은 항상 이 계산기의 판매가(사용자가 낱개에 적은 금액, 할인 반영) — 윙 표시가·최종구매가는 설명줄에만 (오너 2026-09-21)
      rows.push(['판매가', I.price > 0 ? (I.sellerDisc > 0 ? `${won(I.price)} − ${I.sellerDisc}% = ${won(soldNow)}` : won(I.price)) : '위 판매가 칸 비어 있음',
        `${list ? `윙 표시가 ${won(list)}${W.price.final != null && W.price.final < list ? ` · 최종구매가 ${won(W.price.final)} (자동조정 할인)` : ''}` : '윙 화면에서 판매가를 못 읽었어요'} · ${match === 'same' ? '위 판매가 칸과 같아요' : match === 'off' ? `이 계산기는 위 판매가 칸 ${won(soldNow)}으로 계산합니다 — 윙 최종구매가와 달라 쿠팡 예상 비용과의 대조는 건너뜁니다` : '판매가를 대조할 수 없어 쿠팡 예상 비용과의 대조는 건너뜁니다'} · ${d.revIsList === true ? `윙 매출 ${won(W.d30.rev)} = 단품 ${cnt(d.revUnits)}${d.revInferred ? '(역산)' : ''} × 표시가 — 할인·번들 매출은 이 집계에 없어 실판매가는 못 구합니다` : d.revIsList === false ? `윙 매출 ${won(W.d30.rev)} ÷ ${cnt(d.revUnits)} = ${won(d.revPerUnit)} — 윙 매출은 단품 판매분만 표시가로 집계해서 번들이 섞이면 낮게 나옵니다. 실판매가로 쓰지 마세요` : '매출 박스가 없어요'}`]);
      if (wm != null) rows.push(['월 판매량', `${cnt(wm)}${wingMonthlyEst() ? ' (7일 환산 추정)' : ' (지난 30일)'}`, offer.monthly ? `위 월 판매량 칸은 ${cnt(numv(F.monthly.value))} (${srcLabel('monthly')}) — 그대로 계산합니다` : `위 월 판매량 칸과 같아요 (${srcLabel('monthly')})`]);
      if (d.rate != null) rows.push(['판매 속도', `하루 ${n1(d.rate)}개`, `${W.d7.sold != null ? `지난 7일 ${cnt(W.d7.sold)}` : ''}${W.d30.sold != null ? ` · 30일 ${cnt(W.d30.sold)} (하루 ${n1(d.rate30)}개)` : ''}${d.trend != null ? ` → 최근 7일이 30일 평균보다 ${signPct(d.trend)}` : ''}${W.y.sold != null ? ` · 어제 ${cnt(W.y.sold)}` : ''}`]);
      if (d.cvr.d7 != null || d.cvr.d30 != null) rows.push(['구매 전환율', pct1(d.cvr.d7 != null ? d.cvr.d7 : d.cvr.d30), `${d.cvr.d7 != null ? `7일 조회 ${W.d7.views.toLocaleString('ko-KR')} → 구매 ${W.d7.sold}` : ''}${d.cvr.d30 != null ? ` · 30일 ${pct1(d.cvr.d30)} (조회 ${W.d30.views.toLocaleString('ko-KR')})` : ''}`]);
      if (d.bundleShare != null) rows.push(['번들 비중 (30일)', pct1(d.bundleShare), `단품 ${cnt(W.d30.single)} · 번들 ${cnt(W.d30.bundle)} — 묶음이 많이 팔리면 위 낱개 vs 묶음 표의 묶음 판매가를 실제 값으로 맞춰 보세요`]);
      if (W.stock.avail != null) rows.push(['재고', cnt(d.stock.total), `판매가능 ${cnt(W.stock.avail)}${W.stock.availDays != null ? ` (쿠팡 표시 ${W.stock.availDays}일)` : ''}${W.stock.inbound != null ? ` + 입고중 ${cnt(W.stock.inbound)}` : ''}${W.stock.recommend != null ? ` · 쿠팡 입고권장 ${cnt(W.stock.recommend)}` : ''} — 품절일·발주 마감은 아래 재고·발주 계획에`]);
      if (wr != null) rows.push(['반품률', pct1(W.ret.rate / 100), `${W.ret.note ? `${W.ret.note} · ` : W.ret.month != null ? `${W.ret.month}월 실측 · ` : ''}${offer.ret ? `위 반품률 칸은 ${numv(F.ret.value)}% (${srcLabel('ret')}) — 그대로 계산합니다` : `위 반품률 칸과 같아요 (${srcLabel('ret')})`}`]);
      if (W.cost.unit != null) {
        const mine = canCompare ? ev.c.commission + ev.c.wh + ev.c.sh : null;
        const storageNote = W.cost.storageMonth != null ? ` · 이번달 누적보관비 ${won(W.cost.storageMonth)}` : '';
        rows.push(['쿠팡 예상 비용 (개당)', won(W.cost.unit), mine == null ? `${!ev.ok ? '카테고리·판매가·사이즈 유형을 넣으면 계산기 비용과 대조합니다' : match === 'off' ? `쿠팡은 최종구매가 ${won(fin)} 기준으로 이 값을 냅니다 — 판매가 칸에 ${won(fin)}을 넣으면 수수료율·사이즈 유형을 대조해 드려요` : '윙 화면의 판매가를 못 읽어 대조하지 않습니다'}${storageNote}`
          : `이 계산기의 판매수수료 + 입출고비 + 배송비 (판매가 ${won(basis)} 기준) ${won(mine)} → 차이 ${signPct((mine - W.cost.unit) / W.cost.unit)}${
            fix ? ` — 지금 요금표에서는 수수료 ${fix.rate}% × ${won(basis)} + ${RgCalc.SIZES[fix.tierIdx].name} 입출고·배송비가 원 단위까지 맞아요${tierOff || rateOff ? `. 지금은 ${nowLabel}${rateOff && !fixCat ? ` — 위 카테고리 칸에서 수수료 ${fix.rate}% 카테고리를 골라 주세요` : ''}` : ' · 카테고리(수수료율)·사이즈 유형이 쿠팡 비용과 맞아요'}`
            : tierOff && !catOff ? ` — 쿠팡 비용은 ${RgCalc.SIZES[inf.i].name}(${won(inf.est)})과 맞는데 지금은 ${I.tier.name}으로 되어 있어요` : tierOff ? ` — 가장 가까운 유형은 ${RgCalc.SIZES[inf.i].name}(${won(inf.est)})이지만 그래도 ${signPct(inf.gap)} 차이. 지금은 ${I.tier.name}이고, 카테고리(수수료율)도 실제 등록과 다른지 확인하세요` : catOff ? ' — 어느 사이즈 유형으로도 안 맞아요. 카테고리(수수료율)가 실제 등록과 다른지 확인하세요' : ` — 원 단위까지 맞는 조합은 못 찾았지만 ${inf ? RgCalc.SIZES[inf.i].name : I.tier.name} 기준 ${signPct(inf ? inf.gap : (mine - W.cost.unit) / W.cost.unit)} 차이라 대체로 맞는 설정이에요`}${storageNote}`]);
      }
      const tbl = rows.map(([k, v, note]) => `<tr><th>${esc(k)}<small>${esc(note)}</small></th><td>${esc(v)}</td></tr>`).join('');
      // 머리 숫자 = 지금 입력 그대로 (월 판매량 칸 × 개당). 쿠팡 비용과 맞는 다른 설정, 윙 판매량, 7일 속도는 전부 "미적용 미리보기"로 따로.
      const mo = ev.ok && I.monthly > 0 ? ev.c.monthlyProfit : null;
      const paceProfit = ev.ok && d.paceUnits != null && Math.round(d.paceUnits) !== Math.round(I.monthly) ? profitAt(d.paceUnits) : null;
      const wingMo = ev.ok && offer.monthly && wm > 0 ? profitAt(wm) : null;
      const head = mo != null
        ? `<div class="sheet-num"><span class="num">${mo < 0 ? '−' : ''}${Math.round(Math.abs(mo)).toLocaleString('ko-KR')}</span><span class="pct">원/월</span></div><p class="sheet-title">월 판매량 ${cnt(I.monthly)}${SRC.monthly === 'wing' ? ' (윙 지난 30일)' : ''} × 개당 순이익 ${signed(perUnit)}${perUnit < 0 ? ' — 적자입니다' : ''} · ${nowLabel}</p>${
            wingMo != null ? `<p class="sheet-text">윙 ${wingMonthlyEst() ? '7일 환산' : '지난 30일'} ${cnt(wm)}로 보면 월 ${signed(wingMo)} (미적용)</p>` : ''}${
            paceProfit != null ? `<p class="sheet-text">최근 7일 속도(하루 ${n1(d.rate)}개)가 이어지면 월 ${cnt(d.paceUnits)} → ${signed(paceProfit)} (미적용)</p>` : ''}${
            perUnitFix != null ? `<p class="sheet-text"><strong>쿠팡이 이 상품에 매기는 비용(${won(W.cost.unit)})은 ${fixLabel}과 맞아요</strong> — 그 설정이면 개당 ${signed(perUnitFix)} → 월 ${signed(evFix.c.monthlyProfit)} (미적용${patchLabel !== fixLabel ? ` · 바꾸면 반품률도 ${patch.ret}% 카테고리 기본값으로` : ''} · 아래 버튼으로 바꾸면 위 계산기도 같은 숫자가 됩니다)</p>` : ''}`
        : ev.ok ? `<p class="sheet-title">개당 순이익 ${signed(perUnit)} · 월 판매량 칸이 비어 있어 월 순이익은 계산하지 않았어요</p>`
        : d.rate != null ? `<p class="sheet-title">하루 ${n1(d.rate)}개 (월 ${cnt(d.monthlyUnits)})</p><p class="sheet-text">위에 카테고리·판매가·사이즈 유형을 넣으면 월 순이익 전망과 품절로 놓치는 순이익까지 계산됩니다.</p>`
        : `<p class="sheet-title">최근 판매가 없어 속도·재고 예측은 못 합니다</p>`;
      const useBtn = offer.monthly || offer.ret ? `<button type="button" class="next alt rg-wing-use">${[offer.monthly ? `월 판매량 ${cnt(wm)}` : null, offer.ret ? `반품률 ${wr}%` : null].filter(Boolean).join(' · ')} 위 칸에 넣기</button>` : '';
      const fixBtn = evFix ? `<button type="button" class="next alt rg-wing-tier">${patchLabel}${ro(patchLabel !== fixLabel ? '기본값' : fixCat ? fixCat.leaf : RgCalc.SIZES[fixTier].name)} 바꾸기</button>` : '';
      const undo = SRC.monthly === 'wing' || SRC.ret === 'wing' ? `<button type="button" class="link-btn rg-wing-drop">윙에서 넣은 ${[SRC.monthly === 'wing' ? '월 판매량' : null, SRC.ret === 'wing' ? '반품률' : null].filter(Boolean).join('·')} 되돌리기</button>` : '';
      const actions = useBtn || fixBtn || undo ? `<p class="sheet-actions">${useBtn}${fixBtn}${undo}</p>` : '';
      const other = match === 'off' ? `<p class="sheet-text"><strong>붙여넣은 윙 화면의 최종구매가는 ${won(fin)}, 이 품목 판매가 칸은 ${won(soldNow)}입니다.</strong> 다른 상품의 화면이면 아래 월 판매량·반품률도 이 품목 것이 아니에요 — 위 칸에는 넣지 않았습니다.</p>` : '';
      wingOut.innerHTML = `<section class="sheet ${tone}"><p class="sheet-label">${W.name ? esc(W.name) + ' · ' : ''}윙 실적 진단</p>${other}${head}
        <div class="tbl-wrap"><table class="tbl mini rg"><tbody>${tbl}</tbody></table></div>${actions}
        <p class="muted small basis">붙여넣은 윙 화면은 참고 자료입니다 — 판매가·할인은 절대 바꾸지 않고, 월 판매량·반품률은 직접 친 적 없는 칸에만(판매가 칸이 윙 최종구매가와 같을 때) 들어가며 그 외에는 버튼으로만 넣습니다. 판매 속도는 최근 7일 판매량(없으면 30일) 기준. 월 순이익 = 월 판매량 칸 × 개당 순이익(반품 반영, 부가세 별도). 쿠팡 예상 비용(개당)은 최종구매가 × 수수료율 + 입출고비 + 배송비와 원 단위로 맞아, 사이즈 유형·카테고리 검증에 씁니다.</p></section>`;
      const ub = wingOut.querySelector('.rg-wing-use');
      if (ub) ub.addEventListener('click', () => { applyWing(offer); render(); });
      // undo = the fields this widget filled from Wing go back to defaults; a value the seller typed (even if equal to Wing's) is never touched
      const db = wingOut.querySelector('.rg-wing-drop');
      if (db) db.addEventListener('click', () => {
        if (SRC.monthly === 'wing') { F.monthly.value = DEFAULTS.monthly; delete SRC.monthly; }
        if (SRC.ret === 'wing') { F.ret.value = cat ? String(RgCalc.returnDefault(cat.p) * 100) : ''; delete SRC.ret; }
        render();
      });
      const tb = wingOut.querySelector('.rg-wing-tier');
      if (tb) tb.addEventListener('click', () => { // commit exactly the previewed patch
        if (patch.tierIdx != null) { tierIdx = patch.tierIdx; sizeMode = 'tier'; showDims(false); }
        if (patch.cat) { cat = patch.cat; catAuto = false; catInput.value = cat.leaf; catInput.title = cat.p; close(); }
        if (patch.ret != null) F.ret.value = patch.ret;
        render();
        (patch.cat ? catField : sizeBlock).scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }

    // ----- 재고·발주 계획 -----
    const fmtD = x => { const d = RgStock.parse(x); return d ? `${d.getMonth() + 1}월 ${d.getDate()}일(${'일월화수목금토'[d.getDay()]})` : '—'; };
    // Speed source, best first: the 북마클릿 daily series (7·30·90일 windows) › a pasted row's 7일·30일 counts › a 월 판매량 the seller typed
    function planRates() {
      if (W && W.series && Object.keys(W.series).length) { const v = RgStock.velocity(W.series, { reg: W.reg }); return { rates: { d7: v.d7.rate, d30: v.d30.rate, d90: v.d90.rate }, v, src: 'series' }; }
      if (W && (W.d30.sold != null || W.d7.sold != null)) return { rates: { d7: W.d7.sold != null ? W.d7.sold / 7 : null, d30: W.d30.sold != null ? W.d30.sold / 30 : null, d90: null }, v: null, src: 'wing' };
      const m = numv(F.monthly.value);
      if (m > 0 && SRC.monthly === 'user') return { rates: { d30: m / 30 }, v: null, src: 'monthly' }; // the default 100 is not a measurement
      return { rates: {}, v: null, src: null };
    }
    const myOrders = () => LEAD.orders.filter(x => x.key === KEY);
    function drawPlan(ev) {
      const st = stagesNow(), lead = RgStock.totalLead(st), today = RgStock.today();
      leadSum.textContent = `(합계 ${lead}일)`;
      host.querySelectorAll('.rg-stage-src').forEach(el => { const x = st.find(y => y.k === el.dataset.k); el.textContent = !x ? '' : x.src === 'user' ? '· 직접 입력' : x.src === 'log' ? `· 기록 ${x.n}건 중앙값 ${x.d}일` : `· 기본 ${x.d}일${x.n ? `, 기록 ${x.n}건(${x.median}일)` : ''}`; });
      for (const k in PF) PF[k].closest('.field').classList.toggle('wing', SRC[k] === 'wing');
      const { rates, v, src } = planRates();
      const avail = numv(PF.avail.value), inbound = numv(PF.inbound.value);
      const prog = myOrders().map(x => ({ o: x, e: RgStock.eta(x, st, today) })).filter(x => x.e.stage && !x.e.done && numv(x.o.qty) > 0);
      // an order already at 입고 요청 is what Wing reports as 입고중 — when Wing gave an 입고중 count, those orders are not added again (GPT-6 Pro 2026-09-21)
      const dupReq = inbound > 0 ? prog.filter(x => x.e.stage.k === 'req') : [];
      const arrivals = prog.filter(x => !dupReq.includes(x)).map(x => ({ date: x.e.eta, qty: numv(x.o.qty) }));
      const cover = numv(LEAD.cover), buffer = numv(LEAD.buffer);
      const f = RgStock.forecast({ today, avail, inbound, rates, lead, cover, buffer, arrivals });
      const perUnit = ev.ok ? ev.c.expected : null;
      if (!src) {
        planOut.innerHTML = `<section class="sheet balanced quiet"><p class="sheet-label">품절 예측</p><p class="sheet-title">판매 속도를 알면 계산됩니다</p><p class="sheet-text">${o.embedded ? '윙에서 파는 상품이면 위 칸에 윙 재고현황 줄을 붙여 넣거나, ' : '윙에서 파는 상품이면 위 북마클릿으로 가져오거나 재고현황 줄을 붙여 넣고, '}아직 안 파는 상품이면 '판매 조건 자세히'의 월 판매량 칸에 예상 수량을 적으세요.</p></section>`;
        return;
      }
      const srcLine = src === 'series' ? `윙 일별 판매량 (${v.born ? `${fmtD(v.born)}부터` : ''} 어제까지)` : src === 'wing' ? '붙여 넣은 윙 화면의 지난 7일·30일 판매량' : `직접 적은 월 판매량 ${cnt(numv(F.monthly.value))} ÷ 30`;
      const rateName = { d7: '지난 7일', d30: '지난 30일', d90: '지난 90일' };
      const main = f.main, stockLine = `재고 ${cnt(avail)}${inbound ? ` + 입고중 ${cnt(inbound)}` : ''}${f.arriving ? ` + 진행 중 주문 ${cnt(f.arriving)}` : ''}`;
      const empty = !(avail > 0 || inbound > 0);
      let head, tone = 'balanced';
      if (!main) { head = `<p class="sheet-title">속도가 0이라 품절 예측이 없어요</p>`; }
      else if (!main.date) { head = `<div class="sheet-num"><span class="num">2년+</span></div><p class="sheet-title">${rateName[f.base]} 속도 하루 ${n1(f.rate)}개로는 2년 안에 품절되지 않아요 · ${stockLine}</p>`; }
      else {
        const dLeft = main.days;
        tone = f.past ? 'severe' : dLeft <= lead + buffer + 7 ? 'moderate' : 'balanced';
        head = `<div class="sheet-num"><span class="num">${esc(fmtD(main.date))}</span><span class="pct">품절</span></div>
          <p class="sheet-title">${dLeft}일 뒤 · ${rateName[f.base]} 속도 하루 ${n1(f.rate)}개 기준 · ${stockLine}${f.range && f.spread > 7 ? ` · 속도에 따라 <b>${fmtD(f.range.from)} ~ ${fmtD(f.range.to)}</b>` : ''}</p>
          <p class="sheet-text"><strong>${f.past ? `1688 주문 마감 ${fmtD(f.orderBy)} — 이미 지났어요. 지금 주문하면 ${fmtD(RgStock.addDays(today, lead))} 입고, ${f.gap > 0 ? `${f.gap}일 품절` : '품절은 없음'}.` : `${fmtD(f.orderBy)}까지 1688 주문 (D-${RgStock.daysBetween(today, f.orderBy)})`}</strong> — 리드타임 ${lead}일${buffer ? ` + 여유 ${buffer}일` : ''}${f.past ? '' : `이면 ${fmtD(RgStock.addDays(f.orderBy, lead))}에 들어옵니다`}.</p>`;
      }
      const need = Math.ceil(f.rate * (lead + cover));
      const qtyLine = f.qty == null ? '' : f.qty > 0 ? `<p class="sheet-text">필요 수량 <strong>${cnt(f.qty)}</strong> = 하루 ${n1(f.rate)}개 × (리드타임 ${lead} + 커버 ${cover})일 ${cnt(need)} − ${cnt(f.stock0)}${f.arriving ? ` − 들어올 ${cnt(f.arriving)}` : ''}${perUnit != null ? ` · 지금 설정의 개당 순이익으로 ${signed(f.qty * perUnit)}` : ''}${W && W.stock && W.stock.recommend != null ? ` · 쿠팡 입고권장 ${cnt(W.stock.recommend)}` : ''}</p>`
        : `<p class="sheet-text">지금은 발주 수량 <strong>없음</strong> — 리드타임 ${lead} + 커버 ${cover}일치(${cnt(need)})보다 재고${f.arriving ? '와 들어올 수량' : ''}가 많아요. 발주 마감일에 다시 보세요.</p>`;
      const pending = myOrders().map(x => ({ o: x, e: RgStock.eta(x, st, today) })).filter(x => x.e.stage && !x.e.done);
      const progHtml = pending.length ? `<p class="sheet-text">진행 중 주문: ${pending.map(x => `${numv(x.o.qty) > 0 ? cnt(numv(x.o.qty)) : '수량 미입력(예측에 못 넣음)'} — ${x.e.stage.label} ${fmtD(x.o.dates[x.e.stage.k])} → 예상 입고 ${fmtD(x.e.eta)}${x.e.late ? ' (예정일 지남, 오늘로 잡음 — 확인 필요)' : ''}${dupReq.includes(x) ? ' · 윙 입고중에 이미 포함된 물량으로 보고 따로 더하지 않음' : ''}`).join(' · ')}</p>` : '';
      const vt = v ? `<div class="tbl-wrap"><table class="tbl mini rg"><thead><tr><th>기간</th><th>판매</th><th>하루</th></tr></thead><tbody>${['d7', 'd30', 'd90'].map(k => `<tr class="${k === f.base ? 'on' : ''}"><th>${rateName[k]}<small>${v[k].days < { d7: 7, d30: 30, d90: 90 }[k] ? `${v[k].days}일치만 있음` : `${v[k].days}일`}</small></th><td>${cnt(v[k].units)}</td><td>${v[k].rate != null ? n1(v[k].rate) + '개' : '—'}</td></tr>`).join('')}</tbody></table></div>` : '';
      let chart = '';
      if (v) {
        const wk = RgStock.weekly(W.series, today, 13), mx = Math.max(1, ...wk.map(x => x.units)), H = 72, Wd = 20, G = 6;
        chart = `<figure class="bars"><svg viewBox="0 0 ${wk.length * (Wd + G)} ${H + 18}" role="img" aria-label="최근 13주 주간 판매량">${wk.map((x, i) => { const h = Math.round(x.units / mx * H); return `<rect x="${i * (Wd + G)}" y="${H - h}" width="${Wd}" height="${h}" rx="3"><title>${x.from} ~ ${x.to}: ${x.units}개</title></rect><text x="${i * (Wd + G) + Wd / 2}" y="${H - h - 3}" text-anchor="middle">${x.units || ''}</text>`; }).join('')}<text x="0" y="${H + 14}" class="ax">13주 전</text><text x="${wk.length * (Wd + G) - G}" y="${H + 14}" text-anchor="end" class="ax">지난주</text></svg><figcaption class="muted small">주간 판매량 (어제까지, 7일 단위)</figcaption></figure>`;
      }
      const empties = empty && SRC.avail !== 'user' ? `<p class="sheet-text">재고 칸이 비어 있어 0개로 계산했어요 — 위 현재 재고 칸에 판매가능 수량을 적어 주세요.</p>` : '';
      planOut.innerHTML = `<section class="sheet ${tone}"><p class="sheet-label">${ctx.name || (W && W.name) ? esc((ctx.name || W.name)) + ' · ' : ''}품절 예측</p>${head}${empties}${qtyLine}${progHtml}${chart}${vt}
        <p class="sheet-actions"><button type="button" class="next alt rg-plan-add">${f.qty > 0 ? `${cnt(f.qty)} 주문 기록 추가` : '주문 기록 추가'} (오늘 1688 주문)</button></p>
        <p class="muted small basis">속도: ${srcLine}. 예측은 ${rateName[f.base] || '가능한'} 속도가 이어진다는 가정이고, 7·30·90일 속도의 품절일이 7일 넘게 벌어지면 범위로 적습니다. 입고중과 진행 중 주문은 예상 입고일에 재고로 더합니다. 발주 마감 = 품절일 − 리드타임 − 여유. 필요 수량 = 속도 × (리드타임 + 커버) − 지금 재고 − 그 기간 안에 들어올 수량(그 뒤 도착분은 안 뺌).</p></section>`;
      const ab = planOut.querySelector('.rg-plan-add');
      if (ab) ab.addEventListener('click', () => addOrder({ qty: f.qty > 0 ? f.qty : null }));
    }

    // ----- 리드타임 기록장 -----
    function addOrder(pre) {
      const o2 = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), key: KEY, name: String(ctx.name || (W && W.name) || (cat && cat.leaf) || '').slice(0, 60), qty: pre && pre.qty ? String(pre.qty) : '', dates: { order: RgStock.today() } };
      LEAD.orders.push(o2); leadSave(); render();
      const el = logList.querySelector(`.order[data-id="${o2.id}"]`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); const qi = el.querySelector('[data-f="qty"]'); if (qi && !o2.qty) setTimeout(() => qi.focus(), 400); }
    }
    function drawLog() {
      const st = stagesNow(), today = RgStock.today();
      const orders = LEAD.orders.slice().sort((a, b) => ((b.dates && b.dates.order) || '').localeCompare((a.dates && a.dates.order) || ''));
      if (!orders.length) logList.innerHTML = `<p class="muted small empty">아직 기록이 없어요. [+ 주문 추가]를 누르면 오늘이 1688 주문일로 들어가고, 이후 단계는 그날그날 날짜만 고르면 됩니다.</p>`;
      else logList.innerHTML = orders.map(x => {
        const e = RgStock.eta(x, st, today), mine = x.key === KEY;
        const status = e.done ? `완료 · 1688 주문 → 쿠팡 입고 ${RgStock.daysBetween(x.dates.order, x.dates.fc) != null ? RgStock.daysBetween(x.dates.order, x.dates.fc) + '일' : ''}` : e.stage ? `${e.stage.label} 단계 · 예상 입고 ${fmtD(e.eta)}${e.late ? ' (예정일 지남)' : ''} · 남은 ${e.remaining}일` : '1688 주문일부터 적어 주세요';
        return `<div class="order${mine ? ' mine' : ''}" data-id="${esc(x.id)}">
          <div class="order-head"><input class="num-in o-name" data-f="name" type="text" value="${esc(x.name || '')}" placeholder="상품명" aria-label="상품명"><span class="money"><span class="unit">개</span><input class="num-in o-qty" data-f="qty" type="text" inputmode="numeric" value="${esc(x.qty || '')}" placeholder="수량" aria-label="수량"></span><button type="button" class="link-btn o-del">삭제</button></div>
          <div class="row dates">${RgStock.STAGES.map(sx => `<label class="field"><span>${sx.label}</span><input class="num-in" type="date" data-d="${sx.k}" value="${esc((x.dates && x.dates[sx.k]) || '')}"></label>`).join('')}</div>
          <p class="muted small o-status">${mine ? '<b>이 상품</b> · ' : ''}${status}</p></div>`;
      }).join('');
      logList.querySelectorAll('.order').forEach(el => {
        const x = LEAD.orders.find(y => y.id === el.dataset.id); if (!x) return;
        el.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('change', () => { x[inp.dataset.f] = inp.value; leadSave(); render(); }));
        el.querySelectorAll('[data-d]').forEach(inp => inp.addEventListener('change', () => { x.dates = x.dates || {}; x.dates[inp.dataset.d] = inp.value; leadSave(); render(); }));
        el.querySelector('.o-del').addEventListener('click', () => { LEAD.orders = LEAD.orders.filter(y => y.id !== x.id); leadSave(); render(); });
      });
      logSum.textContent = orders.length ? `단계별 일수: ${st.map(x => `${x.label}→${x.next} ${x.d}일(${x.src === 'log' ? `기록 ${x.n}건` : x.src === 'user' ? '직접' : '기본'})`).join(' · ')} · 합계 ${RgStock.totalLead(st)}일` : '';
    }

    load(o.key, o.ctx);
    return { load, reset, render, focus: () => catInput.focus(), addOrder };
  }

  root.RgWidget = { mount, evaluate };
})(typeof window !== 'undefined' ? window : globalThis);
