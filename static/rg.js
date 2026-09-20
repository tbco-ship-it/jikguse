// 로켓그로스 순수익 계산기 page: category picker (판매수수료·요금 그룹), size tier, result sheet, 묶음 비교. Model in rg-calc.js.
(async function () {
  const $ = id => document.getElementById(id);
  const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const num = el => { const n = parseFloat((el.value || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
  const pct1 = r => (Math.round(r * 1000) / 10).toLocaleString('ko-KR') + '%';
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const { RgCalc } = window;
  const out = $('result');
  const KEY = 'jikguse.rg';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
  const FIELDS = ['price', 'cost', 'd1', 'd2', 'd3', 'wt', 'turn', 'monthly', 'ret', 'unsell', 'ad', 'disc', 'inbound'];

  const FEES = await (await fetch(document.currentScript ? document.currentScript.dataset.fees : document.querySelector('script[data-fees]').dataset.fees)).json();
  let CATS = null;                       // [[path, rate, unitIdx, code], ...] lazy
  let cat = saved.cat || null;           // chosen entry
  const BP = saved.bp || {};             // 묶음 판매가 (사용자 수정분)
  const catInput = $('cat'), menu = $('cat-menu');
  const catsReady = () => CATS ? Promise.resolve(CATS) : fetch(catInput.dataset.src).then(r => r.json()).then(d => {
    CATS = d.cats.map(c => ({ p: c[0], r: c[1], u: c[2], code: c[3], leaf: c[0].split('>').pop(), s: c[0].toLowerCase().replace(/\s+/g, '') }));
    return CATS;
  });
  if (cat && !(FEES.units[cat.u] && typeof cat.r === 'number')) cat = null; // 저장된 선택이 새 요금표와 안 맞으면 버린다
  if (cat) catInput.value = cat.leaf;

  // ----- category combobox -----
  let items = [], active = -1;
  function search(q) {
    const toks = q.toLowerCase().split(/\s+/).map(t => t.replace(/\//g, '')).filter(Boolean);
    if (!toks.length) return [];
    const nq = toks.join('');
    const hits = [];
    for (const c of CATS) {
      const s = c.s.replace(/\//g, '');
      if (!toks.every(t => s.includes(t))) continue;
      const leaf = c.leaf.toLowerCase().replace(/[\s\/]/g, '');
      hits.push([leaf === nq ? 0 : leaf.includes(nq) ? 1 : 2, c]);
      if (hits.length > 600) break;
    }
    return hits.sort((a, b) => a[0] - b[0]).slice(0, 10).map(x => x[1]);
  }
  const unitOf = c => FEES.units[c.u];
  const open = q => {
    items = search(q);
    menu.innerHTML = items.length ? items.map((c, k) => `<li role="option" data-i="${k}" ${k === active ? 'aria-selected="true"' : ''}><b>${esc(c.leaf)}</b><small>${esc(c.p.split('>').slice(0, -1).join(' › '))}</small><small class="rate">수수료 ${c.r}%${unitOf(c).lowasp ? ' · 저가 할인 대상' : ''}</small></li>`).join('')
      : `<li class="empty">${q.trim() ? '검색 결과가 없어요. 상품 종류를 다른 말로 적어 보세요(예: 티셔츠, 토너, 사료).' : '상품 종류를 입력하면 쿠팡 카테고리를 찾아 드려요'}</li>`;
    menu.hidden = false; catInput.setAttribute('aria-expanded', 'true');
  };
  const close = () => { menu.hidden = true; active = -1; catInput.setAttribute('aria-expanded', 'false'); };
  const choose = c => { cat = c; catInput.value = c.leaf; catInput.title = c.p; close(); if (!$('ret').dataset.touched) $('ret').value = String(RgCalc.returnDefault(c.p) * 100); render(); };
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

  // ----- inputs -----
  for (const id of FIELDS) { if (saved[id] != null && saved[id] !== '') $(id).value = saved[id]; $(id).addEventListener('input', render); }
  $('ret').addEventListener('input', () => { $('ret').dataset.touched = '1'; });
  if (saved.retTouched) $('ret').dataset.touched = '1';
  $('saver').checked = !!saved.saver; $('simp').checked = !!saved.simp;
  $('saver').addEventListener('change', render); $('simp').addEventListener('change', render);
  // from /business/ result: #cost=6123&name=낚시 릴
  const fromHash = () => {
    const m = location.hash.match(/^#(.+)/); if (!m) return;
    const q = new URLSearchParams(m[1]);
    if (q.get('cost')) { $('cost').value = String(Math.round(+q.get('cost'))); $('cost-note').textContent = `사업자 수입 계산기에서 가져온 원가: ${q.get('name') || ''} 개당 ${won(+q.get('cost'))} (물품가 + 관세 + 운임·부가서비스 안분, 부가세 제외)`; }
    history.replaceState(null, '', location.pathname + location.search);
  };
  fromHash();
  $('reset').addEventListener('click', () => {
    localStorage.removeItem(KEY); cat = null; catInput.value = ''; for (const k of Object.keys(BP)) delete BP[k];
    for (const id of FIELDS) $(id).value = '';
    $('turn').value = '60'; $('monthly').value = '100'; $('unsell').value = '20'; $('ad').value = '0'; $('disc').value = '0'; $('inbound').value = '0';
    delete $('ret').dataset.touched; $('saver').checked = false; $('simp').checked = false;
    $('cost-note').innerHTML = $('cost-note').dataset.orig; render(); catInput.focus();
  });
  $('cost-note').dataset.orig = $('cost-note').innerHTML;

  function save() {
    const o = { cat, bp: BP, saver: $('saver').checked, simp: $('simp').checked, retTouched: !!$('ret').dataset.touched };
    for (const id of FIELDS) o[id] = $(id).value;
    localStorage.setItem(KEY, JSON.stringify(o));
  }

  function inputs() {
    const dims = [num($('d1')), num($('d2')), num($('d3'))], wt = num($('wt'));
    const tier = RgCalc.sizeTier(dims, wt);
    const cbm = dims[0] * dims[1] * dims[2] / 1e9;
    return { dims, wt, tier, cbm, price: num($('price')), cost: num($('cost')), turnover: num($('turn')) || 60, monthly: num($('monthly')),
      retRate: num($('ret')) / 100, unsellable: num($('unsell')) / 100, adPct: num($('ad')), sellerDisc: num($('disc')), inbound: num($('inbound')), saver: $('saver').checked, simplified: $('simp').checked };
  }
  const modelArgs = (I, dims, wt, price, cost, n) => {
    const tier = RgCalc.sizeTier(dims, wt), cbm = dims[0] * dims[1] * dims[2] / 1e9;
    return { ...I, table: unitOf(cat), rate: cat.r, sizeIdx: tier.i, extra: tier.extra, cbm, apparel: RgCalc.isApparel(cat.p), price, cost, tier, n };
  };

  function render() {
    save();
    const I = inputs();
    $('size-note').textContent = I.dims.some(Boolean) || I.wt
      ? `사이즈 유형: ${I.tier.name} — 세변 합 ${I.tier.cm}cm · ${I.wt.toLocaleString('ko-KR')}g · 부피 ${(I.cbm * 1000).toFixed(2)}ℓ(${I.cbm.toFixed(4)}㎥)${I.tier.extra ? ` · 특대형 초과 추가비용 ${won(I.tier.extra)}` : ''}`
      : '세변 합과 무게 둘 다 기준 안이어야 그 사이즈입니다. 극소형 80cm·2kg → 소형 100cm·5kg → 중형 120cm·10kg → 대형1 140cm·15kg → 대형2 160cm·20kg → 특대형 250cm·30kg.';
    $('cat-note').textContent = cat ? `${cat.p.replace(/>/g, ' › ')} · 판매수수료 ${cat.r}% (VAT 별도)${unitOf(cat).lowasp ? ' · 14,000원 미만 저가 상품 전용 할인 대상' : ''}${RgCalc.isApparel(cat.p) ? ' · 45일 무료 보관·의류 회수비 단가' : ''}` : '카테고리를 고르면 판매수수료율과 입출고·배송 요금 그룹이 정해집니다.';
    if (!cat || !I.price) {
      out.innerHTML = `<section class="sheet balanced quiet"><p class="sheet-label">개당 순이익</p><p class="sheet-title">카테고리·판매가·원가·크기를 넣으면 바로 계산됩니다</p><p class="sheet-text">쿠팡 판매자센터 요금표(${FEES.asof}) 기준 — 판매수수료, 입출고비, 배송비, 보관비, 반품 회수·재입고비, 광고비를 빼고 부가세는 따로 보여 줍니다.</p></section>`;
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
      ['매입원가', -c.cost, 'VAT 제외'],
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
    const bRows = bundle.map(b => `<tr><th>${b.n === 1 ? '낱개' : b.n + '개 묶음'}<small>${b.tier.name} · ${b.dims.map(d => Math.round(d)).join('×')}mm · ${Math.round(I.wt * b.n).toLocaleString('ko-KR')}g</small></th>
      <td data-l="묶음 판매가">${b.n === 1 ? won(b.priceN) : `<input class="num-in bp" id="bp${b.n}" type="text" inputmode="numeric" value="${Math.round(b.priceN)}" aria-label="${b.n}개 묶음 판매가">`}</td>
      <td data-l="개당 물류비">${won(b.logistics / b.n)}</td><td data-l="개당 순이익" class="${b.r.expected < 0 ? 'neg' : ''}">${won(b.r.expected / b.n)}<small>${pct1(b.r.margin)}${b.n > 1 ? ` · 낱개 대비 ${b.r.expected / b.n - c.expected >= 0 ? '+' : '−'}${won(Math.abs(b.r.expected / b.n - c.expected))}` : ''}</small></td>
      <td data-l="손익분기">${b.be ? won(b.be) : '—'}</td></tr>`).join('');
    out.innerHTML = `<section class="sheet ${tone}"><p class="sheet-label">개당 순이익 (반품 반영 기대값, 부가세 별도)</p><div class="sheet-num"><span class="num">${Math.round(c.expected).toLocaleString('ko-KR')}</span><span class="pct">원</span></div>
      <p class="sheet-title">마진율 ${pct1(c.margin)} · ROI ${pct1(c.roi)} (원가 대비)${I.monthly ? ` · 월 ${I.monthly.toLocaleString('ko-KR')}개면 월 ${won(c.monthlyProfit)}` : ''}</p>
      <p class="sheet-text"><strong>손익분기 판매가 ${be ? won(be) : '없음 (원가 구조상 이익 불가)'}</strong>${m20 ? ` · 마진 20%는 ${won(m20)}, 30%는 ${won(m30)}` : ''}. 반품 없이 팔린 1건만 보면 ${won(c.keptProfit)} 남고, 반품이 ${pct1(c.returns.r)} 섞이면 기대값이 위 숫자입니다.</p>
      <div class="tbl-wrap"><table class="tbl mini rg"><thead><tr><th>항목</th><th>개당</th></tr></thead><tbody>${tbl}</tbody><tfoot><tr><th>반품 없이 팔린 1건 순이익</th><td class="${c.keptProfit < 0 ? 'neg' : ''}">${won(c.keptProfit)}</td></tr><tr><th>반품 ${pct1(c.returns.r)} 반영 조정<small>${esc(retLine)} · 반품 건은 매출·수수료·물류비가 사라지고 반품 비용만 남음</small></th><td class="neg">−${won(Math.abs(c.expected - c.keptProfit))}</td></tr><tr><th>기대 순이익 (개당)</th><td class="${c.expected < 0 ? 'neg' : ''}">${won(c.expected)}</td></tr><tr><th>부가세 <small>매출세액 ${won(c.vatOut)}${c.vatIn ? ` − 수수료·물류 매입세액 ${won(c.vatIn)}` : ''} (원가 매입세액은 별도)</small></th><td>${won(c.vatOut - c.vatIn)}</td></tr></tfoot></table></div>
      <h3 class="sub-h">낱개 vs 묶음</h3>
      <p class="sheet-text">입출고비는 판매 단위당, 배송비는 주문당이라 묶음이 개당 물류비를 줄입니다. 묶음 포장 크기는 낱개 치수를 가장 짧은 변으로 쌓아 추정했습니다(실제 포장이 다르면 유형이 달라질 수 있어요). 묶음 판매가는 직접 고쳐 보세요.</p>
      <div class="tbl-wrap"><table class="tbl spec biz bundle"><thead><tr><th>구성</th><th>판매가</th><th>개당 물류비</th><th>개당 순이익</th><th>손익분기</th></tr></thead><tbody>${bRows}</tbody></table></div>
      <p class="sheet-text tip">정산: 월정산은 월 마감 + 20영업일에 100%, 주정산은 주 마감 + 20영업일에 70% · 익익월 첫 영업일에 30%. 판매수수료·입출고·배송비는 정산에서 차감되고 VAT 세금계산서가 따로 발행됩니다.</p>
      <p class="sheet-actions"><button type="button" class="next" id="copy">결과 텍스트 복사</button></p>
      <p class="muted small basis">요금: 쿠팡 판매자센터 로켓그로스 비용/수수료 ${FEES.asof} (프로모션 ${FEES.promo_until}까지) · 반품률은 쿠팡이 공개하지 않아 카테고리 기본값(추정)이며 윙 &gt; 로켓그로스 &gt; 반품분석의 내 수치를 넣는 것이 정확합니다 · 재입고비는 기본 단가(2025-07 프로모션 종료 후 카테고리별 할인 미반영). 예상치이며 실제 청구는 윙 정산현황 기준입니다. 오류 제보: hello@jikguse.com</p></section>`;
    for (const n of [2, 3, 4]) $('bp' + n).addEventListener('change', e => { BP[n] = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; render(); });
    $('copy').addEventListener('click', () => {
      const txt = [`[직구세 로켓그로스 순수익 계산 · jikguse.com/rocket/]`, `${cat.p} · 수수료 ${cat.r}% · ${I.tier.name} · 판매가 ${won(I.price)} · 원가 ${won(I.cost)}`,
        ...rows.map(([k, v]) => `- ${k}: ${v < 0 ? '−' : ''}${won(Math.abs(v))}`),
        `반품 없이 팔린 1건 순이익 ${won(c.keptProfit)}`,
        `개당 순이익(반품 ${pct1(c.returns.r)} 반영) ${won(c.expected)} · 마진 ${pct1(c.margin)} · ROI ${pct1(c.roi)} · 손익분기 ${be ? won(be) : '없음'}`,
        ...bundle.slice(1).map(b => `- ${b.n}개 묶음 ${won(b.priceN)}: 개당 순이익 ${won(b.r.expected / b.n)} (${b.tier.name}, 손익분기 ${b.be ? won(b.be) : '없음'})`),
        `※ 예상치. 실제 청구는 윙 정산현황 기준.`].join('\n');
      navigator.clipboard.writeText(txt).then(() => { $('copy').textContent = '복사했어요'; setTimeout(() => { $('copy').textContent = '결과 텍스트 복사'; }, 1500); });
    });
  }
  function bandLabel(bands, price) {
    const i = RgCalc.band(bands, price);
    const lo = bands[i], hi = bands[i + 1];
    return hi ? `${lo.toLocaleString('ko-KR')}~${hi.toLocaleString('ko-KR')}원 구간` : `${lo.toLocaleString('ko-KR')}원 이상 구간`;
  }
  render();
  if (cat) catsReady();
})();
