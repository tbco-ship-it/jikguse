// /rocket/ page glue: mount the 로켓그로스 widget (rg-widget.js), take a unit cost handed over in the hash (#cost=6123&name=낚시 릴 —
// older links from /business/ result rows), and run the Wing import:
//   · bookmarklet "윙 → 로켓그로스 계산기": opens this page in a new tab (synchronously, so the popup is allowed) and injects
//     static/wing-bm.js into the Wing tab; that script posts { type: 'jikguse-rg-wing', items } here and waits for 'jikguse-rg-got'.
//   · the store (localStorage 'jikguse.rg.wing') keeps every item + its daily series + dated stock snapshots; each item gets its own
//     widget slot 'jikguse.rg.p.<옵션ID>' picked with a chip. '직접 입력' is the plain slot 'jikguse.rg'.
//   · 내보내기/가져오기: one JSON file with every 'jikguse.rg*' key (slots, Wing store, 리드타임 기록장) — how records move between devices
//     until there is an account (owner 2026-09-21: device storage first, login only if visits justify it).
(async function () {
  const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const $ = id => document.getElementById(id);
  const host = $('rg-host'), base = host.dataset.base;
  const FEES = await (await fetch(host.dataset.fees)).json();
  const STORE_KEY = 'jikguse.rg.wing', MAX_SNAPS = 120;
  // Every stored item goes through this shape check — on receive from Wing and again on load, so a backup file edited by hand
  // (가져오기) cannot put markup where the chips expect numbers (GPT-6 Pro 2026-09-21: stored XSS via avail/inbound/d30.sold).
  const num = v => (v == null || v === '' ? null : (isFinite(+v) ? +v : null));
  const str = (v, n) => (v == null ? null : String(v).slice(0, n || 200));
  const box = b => b && typeof b === 'object' ? { sold: num(b.sold), gmv: num(b.gmv), views: num(b.views), canc: num(b.canc) } : null;
  const sanitizeItem = it => {
    if (!it || typeof it !== 'object' || it.id == null) return null;
    const u = {}; if (it.series && it.series.u && typeof it.series.u === 'object') for (const [d, q] of Object.entries(it.series.u)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && num(q) != null) u[d] = num(q);
    return {
      id: str(it.id, 40), pid: str(it.pid, 40), iid: str(it.iid, 40), name: str(it.name, 200), opt: str(it.opt, 200), reg: str(it.reg, 40), at: str(it.at, 40),
      avail: num(it.avail), inbound: num(it.inbound), doc: num(it.doc), ret30: num(it.ret30),
      price: it.price && typeof it.price === 'object' ? { list: num(it.price.list), final: num(it.price.final) } : null,
      cost: it.cost && typeof it.cost === 'object' ? { unit: num(it.cost.unit), take: num(it.cost.take), wh: num(it.cost.wh), ff: num(it.cost.ff), storageMonth: num(it.cost.storageMonth) } : null,
      rec: it.rec && typeof it.rec === 'object' ? { qty: num(it.rec.qty), days: num(it.rec.days) } : null,
      ret: it.ret && typeof it.ret === 'object' ? { rate: num(it.ret.rate), month: num(it.ret.month), units: num(it.ret.units), returns: num(it.ret.returns) } : null,
      cat: it.cat && typeof it.cat === 'object' ? { code: str(it.cat.code, 40), kan: str(it.cat.kan, 40), path: str(it.cat.path, 300) } : null,
      y: box(it.y), d7: box(it.d7), d30: box(it.d30),
      series: it.series && typeof it.series === 'object' ? { from: str(it.series.from, 20), to: str(it.series.to, 20), at: str(it.series.at, 40), u } : null,
      snaps: Array.isArray(it.snaps) ? it.snaps.filter(s => s && typeof s === 'object').map(s => ({ date: str(s.date, 20), avail: num(s.avail), inbound: num(s.inbound) })).slice(-MAX_SNAPS) : [],
    };
  };
  const sanitizeStore = st => {
    const out = { items: {}, at: str(st && st.at, 40), today: str(st && st.today, 20), vendor: str(st && st.vendor, 100), cur: str(st && st.cur, 40) };
    if (st && st.items && typeof st.items === 'object') for (const [k, v] of Object.entries(st.items)) { const it = sanitizeItem(v); if (it && it.id === String(k).slice(0, 40)) out.items[k] = it; }
    return out;
  };
  const load = () => { try { return sanitizeStore(JSON.parse(localStorage.getItem(STORE_KEY))); } catch (e) { return { items: {} }; } };
  const save = st => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); return true; } catch (e) { return false; } };
  const fmtAt = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  let store = load(), cur = null; // cur = 옵션ID string of the selected item, null = 직접 입력
  const chips = $('rg-chips'); // before mount: the widget's first render already calls onChange → paintChips
  const w = window.RgWidget.mount(host, { fees: FEES, catsUrl: host.dataset.cats, base, key: 'jikguse.rg', embedded: false, onChange: paintChips });

  // ----- bookmarklet -----
  const origin = location.origin + base;
  const BM = `(function(){var w=window.open(${JSON.stringify(origin + 'rocket/#wing')},'jikguse_rg');window.__jkRg={win:w,origin:${JSON.stringify(origin)}};var s=document.createElement('script');s.src=${JSON.stringify(location.origin + host.dataset.bm)}+'&t='+Date.now();document.body.appendChild(s)})()`;
  $('rg-bm').href = 'javascript:' + encodeURIComponent(BM);
  $('rg-bm').addEventListener('click', e => { e.preventDefault(); note('클릭이 아니라 북마크바로 끌어다 놓은 뒤, 쿠팡 윙 탭에서 그 북마크를 누르세요.'); });
  const noteEl = $('rg-import-note');
  function note(t, tone) { noteEl.hidden = !t; noteEl.textContent = t || ''; noteEl.className = `muted small${tone ? ' ' + tone : ''}`; }
  if (location.hash === '#wing') { note('윙 탭에서 읽는 중… 이 탭은 그대로 두세요. 몇 초 뒤 상품이 여기 나타납니다.'); history.replaceState(null, '', location.pathname + location.search); }

  // ----- receive -----
  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (!/^https:\/\/wing\.coupang\.com$/.test(e.origin)) return;
    if (d.type === 'jikguse-rg-wing-error') { note(`윙에서 읽지 못했어요: ${d.error || ''}`, 'neg'); return; }
    if (d.type !== 'jikguse-rg-wing' || !Array.isArray(d.items)) return;
    try { e.source.postMessage({ type: 'jikguse-rg-got' }, e.origin); } catch (err) { /* the Wing tab is gone */ }
    const today = d.today || window.RgStock.today();
    let fresh = 0;
    for (const raw of d.items) {
      const it = sanitizeItem(raw);
      if (!it) continue;
      const id = it.id, old = store.items[id] || {};
      // daily series: merge by date so an older, longer history survives a later short pull; today's partial row is replaced next time
      const u = Object.assign({}, old.series && old.series.u, it.series && it.series.u);
      const keys = Object.keys(u).sort(); while (keys.length > 400) delete u[keys.shift()];
      const snaps = (old.snaps || []).filter(s => s.date !== today).concat([{ date: today, avail: it.avail, inbound: it.inbound }]).slice(-MAX_SNAPS);
      store.items[id] = { ...it, id, series: { from: it.series ? it.series.from : old.series && old.series.from, to: it.series ? it.series.to : today, at: it.series && it.series.at || null, u }, snaps, at: d.at };
      fresh++;
    }
    store.at = d.at; store.today = today; store.vendor = d.vendor || store.vendor;
    if (!save(store)) note('브라우저 저장 공간이 꽉 차서 저장하지 못했어요 — 기록을 내보낸 뒤 다른 상품 기록을 지워 주세요.', 'neg');
    else note(`윙에서 ${fresh}개 상품을 가져왔어요 (${fmtAt(d.at)} · 일별 판매량 ${d.from} ~ ${d.today}).`);
    const ids = Object.keys(store.items);
    if (cur == null || !store.items[cur]) cur = pickFirst();
    paintChips(); select(cur);
    if (ids.length) $('rg-import').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const pickFirst = () => { const ids = Object.keys(store.items).sort((a, b) => (store.items[b].d30 && store.items[b].d30.sold || 0) - (store.items[a].d30 && store.items[a].d30.sold || 0)); return ids[0] || null; };

  // ----- chips -----
  function paintChips() {
    const ids = Object.keys(store.items).sort((a, b) => (store.items[b].d30 && store.items[b].d30.sold || 0) - (store.items[a].d30 && store.items[a].d30.sold || 0));
    chips.hidden = !ids.length;
    $('rg-import-at').textContent = store.at ? `마지막 가져오기 ${fmtAt(store.at)} · ${ids.length}개 상품` : '';
    if (!ids.length) return;
    const chip = (id, name, small, on) => `<button type="button" class="chip${on ? ' on' : ''}" role="tab" aria-selected="${on}" data-id="${esc(id == null ? '' : id)}" title="${esc(name)}"><span>${esc(name)}</span><small>${small}</small></button>`;
    chips.innerHTML = ids.map(id => {
      const it = store.items[id], ev = window.RgWidget.evaluate(FEES, JSON.parse(localStorage.getItem('jikguse.rg.p.' + id) || '{}'));
      const sold = it.d30 && it.d30.sold != null ? `30일 ${+it.d30.sold}개` : '', stock = `재고 ${+it.avail || 0}${it.inbound ? `+${+it.inbound}` : ''}`;
      return chip(id, [it.name, it.opt && it.opt !== '단일상품' ? it.opt : null].filter(Boolean).join(' · '), `${sold ? sold + ' · ' : ''}${stock}${ev.ok ? ` → 개당 <b class="${ev.c.expected < 0 ? 'neg' : ''}">${won(ev.c.expected)}</b>` : ' · 판매가 입력 전'}`, cur === id);
    }).join('') + chip(null, '직접 입력', '윙 상품이 아닌 계산', cur == null);
    chips.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { select(b.dataset.id || null); host.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  }
  function select(id) {
    cur = id && store.items[id] ? id : null;
    if (cur == null) w.load('jikguse.rg', {});
    else { const it = store.items[cur]; w.load('jikguse.rg.p.' + cur, { item: it, name: [it.name, it.opt && it.opt !== '단일상품' ? it.opt : null].filter(Boolean).join(' · '), at: fmtAt(it.at) }); }
    if (store.cur !== cur) { store.cur = cur; save(store); }
    paintChips();
  }

  // ----- export / import -----
  $('rg-export').addEventListener('click', () => {
    const data = { app: 'jikguse-rg', v: 1, at: new Date().toISOString(), keys: {} };
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('jikguse.rg')) data.keys[k] = localStorage.getItem(k); }
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('jikguse.biz.rg')) data.keys[k] = localStorage.getItem(k); } // /business/ item slots
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `jikguse-rocket-${window.RgStock.today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    note(`${Object.keys(data.keys).length}개 기록을 파일로 내보냈어요 — 다른 기기의 이 페이지에서 [가져오기]로 읽으면 같은 상태가 됩니다.`);
  });
  $('rg-import-btn').addEventListener('click', () => $('rg-import-file').click());
  $('rg-import-file').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || data.app !== 'jikguse-rg' || !data.keys) throw new Error('이 페이지에서 내보낸 파일이 아니에요');
      const n = Object.keys(data.keys).length;
      if (!confirm(`${n}개 기록을 가져와 이 기기의 같은 기록을 덮어씁니다 (파일에 없는 기록은 그대로). 계속할까요?`)) { e.target.value = ''; return; }
      for (const [k, v] of Object.entries(data.keys)) if (/^jikguse\.(rg|biz\.rg)/.test(k) && typeof v === 'string') localStorage.setItem(k, v);
      location.reload();
    } catch (err) { note(`가져오지 못했어요: ${err.message}`, 'neg'); e.target.value = ''; }
  });

  // ----- boot -----
  const m = location.hash.match(/^#(.+)/);
  if (m && m[1] !== 'wing') {
    const q = new URLSearchParams(m[1]);
    if (q.get('cost')) w.load('jikguse.rg', { cost: +q.get('cost'), note: `사업자 수입 계산기에서 가져온 원가: ${q.get('name') || ''} 개당 ${won(+q.get('cost'))} (물품가 + 관세 + 운임·부가서비스 안분, 부가세 제외)` });
    history.replaceState(null, '', location.pathname + location.search);
  } else if (Object.keys(store.items).length) { cur = store.cur && store.items[store.cur] ? store.cur : pickFirst(); select(cur); }
  else paintChips();
})();
