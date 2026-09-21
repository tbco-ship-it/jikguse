// /track/: one number → 통관 (UNIPASS via api.jikguse.com/customs) + 배송 (tracker.delivery via /track), rendered as one stepper + two cards.
// The number lives in the URL hash (#no=…&c=…) so a result can be bookmarked/shared; recent numbers are kept only in this browser.
(function () {
  const M = window.TrackModel; if (!M) return;
  const $ = id => document.getElementById(id);
  const form = $('track-form'), out = $('result'), noEl = $('no'), carEl = $('carrier'), recentEl = $('recent'), goBtn = $('go');
  const API = form.dataset.api, BASE = form.dataset.base || '/';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const RECENT_KEY = 'jikguse.track.recent';
  let epoch = 0;

  M.CARRIERS.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; carEl.appendChild(o); });

  // ---- recent numbers (this device only) ----
  const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
  function remember(no, carrier, label) {
    const list = recent().filter(r => r.no !== no); list.unshift({ no, carrier, label: label || '', at: Date.now() });
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5))); } catch {}
    renderRecent();
  }
  function renderRecent() {
    const list = recent(); recentEl.hidden = !list.length;
    recentEl.innerHTML = list.map(r => `<button type="button" class="chip" data-no="${esc(r.no)}" data-c="${esc(r.carrier)}"><span>${esc(r.no)}</span><small>${esc(r.label || (M.CARRIERS.find(c => c.id === r.carrier) || {}).name || '')}</small></button>`).join('') + `<button type="button" class="chip clear" id="recent-clear"><span>지우기</span></button>`;
  }
  recentEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'recent-clear') { try { localStorage.removeItem(RECENT_KEY); } catch {} renderRecent(); return; }
    noEl.value = b.dataset.no; carEl.value = b.dataset.c || 'kr.cjlogistics'; go();
  });

  // ---- landing → result (same glide as the home page) ----
  function leaveLanding() {
    const html = document.documentElement; if (!html.classList.contains('landing')) return;
    const stage = $('stage'), hero = stage.firstElementChild, y0 = hero.getBoundingClientRect().top;
    html.classList.remove('landing');
    const dy = y0 - hero.getBoundingClientRect().top;
    if (dy > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stage.style.transition = 'none'; stage.style.transform = `translateY(${dy}px)`; void stage.offsetHeight;
      stage.style.transition = 'transform 1s cubic-bezier(.16,1,.3,1)'; stage.style.transform = 'translateY(0)';
      stage.addEventListener('transitionend', () => { stage.style.transition = ''; stage.style.transform = ''; }, { once: true });
    }
    if (window.__reveal) window.__reveal($('below'), true, 500);
  }
  function riseIn() {
    out.classList.remove('is-in'); out.classList.add('reveal');
    Array.from(out.children).forEach((el, i) => { el.classList.add('rv'); el.style.setProperty('--d', (i * 90) + 'ms'); });
    void out.offsetHeight; out.classList.add('is-in');
  }
  const bringIntoView = el => { if (innerWidth >= 900) return; setTimeout(() => { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop; y -= parseFloat(getComputedStyle(el).scrollMarginTop) || 0; scrollTo({ top: y, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, 60); };

  // ---- fetch ----
  const getJSON = async (path) => { const r = await fetch(API + path, { headers: { Accept: 'application/json' } }); const j = await r.json().catch(() => ({})); if (!r.ok && !j.error) j.error = 'http ' + r.status; return j; };
  async function go() {
    const no = M.clean(noEl.value), carrier = carEl.value;
    if (!M.valid(no)) { noEl.focus(); noEl.classList.add('shake'); setTimeout(() => noEl.classList.remove('shake'), 400); return; }
    noEl.value = no;
    const my = ++epoch;
    history.replaceState(null, '', `#no=${no}&c=${carrier}`);
    leaveLanding();
    goBtn.disabled = true; goBtn.textContent = '조회 중…';
    out.innerHTML = `<section class="sheet quiet"><p class="sheet-label">배송 현황</p><p class="sheet-title">${esc(no)} 조회 중…</p><p class="sheet-text">관세청과 택배사에 동시에 물어보고 있어요.</p></section>`;
    riseIn(); bringIntoView(out);
    const yy = String(new Date().getFullYear());
    const [c, d] = await Promise.all([getJSON(`/customs?no=${no}&yy=${yy}`).catch(e => ({ error: 'net' })), getJSON(`/track?carrier=${carrier}&no=${no}`).catch(e => ({ error: 'net' }))]);
    if (my !== epoch) return;
    // a January query for a December arrival: try last year's 입항 too
    let cc = c;
    if (cc && cc.available && cc.found === false && new Date().getMonth() < 2) { const p = await getJSON(`/customs?no=${no}&yy=${+yy - 1}`).catch(() => null); if (my !== epoch) return; if (p && p.found) cc = p; }
    goBtn.disabled = false; goBtn.textContent = '조회';
    render(no, carrier, cc, d);
    if ((cc && cc.found) || (d && d.events && d.events.length)) remember(no, carrier, cc && cc.found && cc.general.item ? cc.general.item : '');
  }

  // ---- render ----
  const carrierName = id => (M.CARRIERS.find(c => c.id === id) || {}).name || '택배사';
  function render(no, carrier, c, d) {
    const now = new Date();
    const st = M.stage(c, d);
    const events = (d && d.events || []).slice().sort((a, b) => new Date(a.time) - new Date(b.time));
    const lastEv = d && (d.last || events[events.length - 1]);
    const steps = (c && c.steps || []);
    const lastStep = steps[steps.length - 1];
    const known = st >= 0;

    // headline: where it is now + since when
    let title, text, cls = 'quiet';
    if (lastEv && M.DELIVERY[lastEv.code] != null) {
      const t = new Date(lastEv.time);
      title = `${M.DELIVERY_KO[lastEv.code] || lastEv.name || '배송 중'} · ${M.ago(t, now)}`;
      text = lastEv.code === 'DELIVERED' ? `${M.fmt(t)}에 배송이 완료됐어요.` : (lastEv.text || `${carrierName(carrier)}가 물품을 가지고 있어요.`);
      cls = lastEv.code === 'DELIVERED' ? 'balanced' : lastEv.code === 'ATTEMPT_FAIL' || lastEv.code === 'EXCEPTION' ? 'moderate' : 'quiet';
    } else if (c && c.found) {
      const g = M.explain(c.general.progress || c.general.status) || M.explain(lastStep && lastStep.kind);
      const t = M.dttm((lastStep && lastStep.at) || c.general.updated);
      const days = t ? (now - t) / 864e5 : 0;
      title = `${g ? g.label : (c.general.progress || c.general.status)} · ${M.ago(t, now)}`;
      text = g ? g.what : '관세청에 등록된 단계입니다.';
      if (st === 1) text = `통관은 끝났어요. ${carrierName(carrier)} 집화 스캔이 찍히면 배송 구간이 채워집니다.`;
      else if (days >= 3) { text += ` 이 단계에서 ${Math.floor(days)}일째 멈춰 있어요 — 보통보다 긴 편이라 특송·배대지 업체에 확인해 볼 만합니다.`; cls = 'mild'; }
    } else if (c && c.available === false && !(d && d.events && d.events.length)) {
      title = '아직 정보가 없어요'; text = '택배사 조회에 이 번호가 없습니다. 통관 조회는 준비 중이라, 관세청 유니패스에서 바로 확인할 수 있어요.';
    } else if ((c && c.error) || (d && d.error)) {
      title = '조회가 잠시 안 돼요'; text = '관세청 또는 택배사 서버가 응답하지 않습니다. 잠시 후 다시 눌러 주세요.'; cls = 'moderate';
    } else {
      title = '아직 등록 전이에요'; text = '관세청과 택배사 어디에도 이 번호가 없어요. 특송업체가 통관목록을 내기 전이거나(보통 출항 전후), 번호가 다른 구간의 것일 수 있어요. 하루쯤 뒤에 다시 확인해 보세요.';
    }

    // stepper
    const stepper = `<ol class="steps" aria-label="진행 단계">${M.STAGES.map((s, i) => `<li class="${i < st ? 'done' : i === st ? 'now' : ''}"><span class="dot"></span><span class="lbl">${s}</span></li>`).join('')}</ol>`;

    // customs card
    let cust;
    const uniLink = `https://unipass.customs.go.kr/csp/index.do?tgMenuId=MYC_MNU_00000450&hblNo=${encodeURIComponent(no)}&blYy=${now.getFullYear()}`;
    if (c && c.found) {
      const g = c.general;
      const meta = [g.item && `품명 ${g.item}`, g.from && `${g.from}${g.fromCountry ? ' (' + g.fromCountry + ')' : ''} → ${g.port || '한국'}`, g.arrived && `입항 ${M.fmtDay(M.dttm(g.arrived))}`, g.blType, g.carrier].filter(Boolean);
      const rows = steps.slice().reverse().map((s, i) => {
        const e = M.explain(s.kind || s.text); const t = M.dttm(s.at);
        return `<li class="${i === 0 ? 'now' : ''}"><div class="when">${esc(M.fmt(t))}</div><div class="what"><b>${esc(e ? e.label : s.kind)}</b>${e && e.label !== s.kind ? ` <small class="muted">${esc(s.kind)}</small>` : ''}${s.text ? `<div class="muted small">${esc(s.text)}</div>` : ''}${s.shed ? `<div class="muted small">${esc(s.shed)}</div>` : ''}${i === 0 && e && st <= 1 ? `<p class="why">${esc(e.what)}${e.next ? ` <span class="nx">다음은? ${esc(e.next)}</span>` : ''}</p>` : ''}</div></li>`;
      }).join('');
      cust = `<section class="card tl"><div class="sub-row"><h2 class="card-title">통관 <small class="muted">관세청 UNI-PASS</small></h2><span class="pill ${st >= 1 ? 'ok' : ''}">${esc(g.status || g.progress)}</span></div><p class="muted small meta">${esc(meta.join(' · '))}</p><ol class="tl-list">${rows}</ol>${c.others ? `<p class="muted small">같은 번호로 입항 기록이 ${c.others}건 있어 가장 최근 것을 보여 줍니다.</p>` : ''}${M.taxLikely(c) ? `<p class="sheet-actions"><a class="next" href="${BASE}">예상 관세·부가세 계산하기</a></p>` : ''}<p class="muted small"><a href="${uniLink}" target="_blank" rel="noopener">유니패스에서 원문 보기</a></p></section>`;
    } else if (c && c.available === false) {
      cust = `<section class="card tl"><h2 class="card-title">통관 <small class="muted">관세청 UNI-PASS</small></h2><p class="muted">통관 조회는 준비 중입니다. <a href="${uniLink}" target="_blank" rel="noopener">유니패스 수입화물 진행정보</a>에서 같은 번호로 바로 볼 수 있어요.</p></section>`;
    } else if (c && c.error) {
      cust = `<section class="card tl"><h2 class="card-title">통관 <small class="muted">관세청 UNI-PASS</small></h2><p class="muted">관세청 서버가 응답하지 않아요. <a href="${uniLink}" target="_blank" rel="noopener">유니패스에서 직접 보기</a></p></section>`;
    } else {
      cust = `<section class="card tl"><h2 class="card-title">통관 <small class="muted">관세청 UNI-PASS</small></h2><p class="muted">관세청에 이 번호(H B/L)로 등록된 화물이 없어요. 해외에서 오는 특송 송장이 아니거나, 특송업체가 아직 통관목록을 내기 전일 수 있습니다. 국내 택배 송장이라면 아래 배송 구간만 보면 됩니다.</p></section>`;
    }

    // delivery card
    let deliv;
    if (events.length) {
      const rows = events.slice().reverse().map((e, i) => { const t = new Date(e.time); return `<li class="${i === 0 ? 'now' : ''}"><div class="when">${esc(M.fmt(t))}</div><div class="what"><b>${esc(M.DELIVERY_KO[e.code] || e.name || e.code)}</b>${e.name && M.DELIVERY_KO[e.code] && e.name !== M.DELIVERY_KO[e.code] ? ` <small class="muted">${esc(e.name)}</small>` : ''}${e.text ? `<div class="muted small">${esc(e.text)}</div>` : ''}</div></li>`; }).join('');
      deliv = `<section class="card tl"><div class="sub-row"><h2 class="card-title">배송 <small class="muted">${esc(carrierName(carrier))}</small></h2><span class="pill ${lastEv && lastEv.code === 'DELIVERED' ? 'ok' : ''}">${esc(M.DELIVERY_KO[lastEv.code] || lastEv.name || '')}</span></div><ol class="tl-list">${rows}</ol></section>`;
    } else if (d && d.error) {
      deliv = `<section class="card tl"><h2 class="card-title">배송 <small class="muted">${esc(carrierName(carrier))}</small></h2><p class="muted">택배 조회가 잠시 안 돼요. 잠시 후 다시 시도해 주세요.</p></section>`;
    } else {
      deliv = `<section class="card tl"><h2 class="card-title">배송 <small class="muted">${esc(carrierName(carrier))}</small></h2><p class="muted">${st >= 1 ? '통관은 끝났고 아직 택배사 집화 스캔 전이에요. 보통 반출 당일~다음 날 찍힙니다.' : st >= 0 ? '통관이 끝나고 택배사가 물품을 인수하면 여기에 찍혀요. 그 전에는 택배사 조회에 "정보 없음"으로 나오는 게 정상입니다.' : '택배사에 아직 이 번호가 없어요. 택배사를 잘못 골랐다면 위에서 바꿔 다시 조회해 보세요.'}</p></section>`;
    }

    out.innerHTML = `<section class="sheet ${cls}"><p class="sheet-label">${esc(no)} · 지금</p><p class="sheet-title">${esc(title)}</p><p class="sheet-text">${esc(text)}</p>${stepper}</section>${cust}${deliv}<p class="muted small fetched">${known ? '' : ''}조회 시각 ${M.fmt(now)} · 10분 간격 갱신 · <button type="button" class="link-btn" id="re">다시 조회</button></p>`;
    $('re').addEventListener('click', go);
    riseIn();
  }

  // ---- glossary (below the fold, for people who want to read the whole path) ----
  const gl = $('glossary');
  if (gl) gl.innerHTML = `<dl class="gloss">${M.GLOSSARY.filter(g => g.what).map(g => `<div><dt>${esc(g.label)}</dt><dd>${esc(g.what)}${g.next ? ` <span class="nx">다음은? ${esc(g.next)}</span>` : ''}</dd></div>`).join('')}</dl>`;

  form.addEventListener('submit', e => { e.preventDefault(); go(); });
  noEl.addEventListener('input', () => { const v = noEl.value; if (/[^0-9A-Za-z\- ]/.test(v)) noEl.value = v.replace(/[^0-9A-Za-z\- ]/g, ''); });
  renderRecent();
  const h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const q = new URLSearchParams(location.search);
  const start = h.get('no') || q.get('no');
  if (start) { noEl.value = start; const c = h.get('c') || q.get('c'); if (c && M.CARRIERS.some(x => x.id === c)) carEl.value = c; go(); }
  else noEl.focus({ preventScroll: true });
})();
