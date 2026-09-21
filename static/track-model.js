// 배송추적 model (/track/): pure functions, no DOM — loaded by track.js and by scripts/test_track.mjs.
// Turns the two upstream answers (UNIPASS 통관 steps, tracker.delivery 택배 events) into one stepper + plain-Korean explanations.
(function (root) {
  // Where a parcel is, in five steps a shopper understands. Delivery events (택배사 스캔) settle the later steps; customs the earlier ones.
  const STAGES = ['통관 진행', '통관 완료', '택배 인수', '배송 중', '배송 완료'];
  const CARRIERS = [
    { id: 'kr.cjlogistics', name: 'CJ대한통운' }, { id: 'kr.hanjin', name: '한진택배' }, { id: 'kr.lotte', name: '롯데택배' },
    { id: 'kr.logen', name: '로젠택배' }, { id: 'kr.epost', name: '우체국택배' }, { id: 'kr.kdexp', name: '경동택배' },
  ];
  const DELIVERY = { INFORMATION_RECEIVED: 2, AT_PICKUP: 2, IN_TRANSIT: 3, OUT_FOR_DELIVERY: 3, ATTEMPT_FAIL: 3, AVAILABLE_FOR_PICKUP: 3, EXCEPTION: 3, DELIVERED: 4 };
  const DELIVERY_KO = { INFORMATION_RECEIVED: '송장 등록', AT_PICKUP: '집화', IN_TRANSIT: '이동 중', OUT_FOR_DELIVERY: '배송 출발', ATTEMPT_FAIL: '배송 실패', AVAILABLE_FOR_PICKUP: '수령 대기', EXCEPTION: '문제 발생', DELIVERED: '배송 완료', UNKNOWN: '' };

  // 통관 step names as UNIPASS writes them (cargTrcnRelaBsopTpcd / csclPrgsStts), matched by substring in this order.
  // what = what just happened, next = what usually follows and how long it tends to take (typical 특송·해상특송 cases, not a promise).
  const GLOSSARY = [
    { k: ['수입신고수리', '수입신고 수리', '신고수리'], phase: 1, label: '수입신고 수리', what: '세관 심사가 끝나 물품을 국내로 들여도 된다는 결정이 났습니다. 세금이 있었다면 납부가 끝났거나 납부 대상으로 확정된 상태예요.', next: '보통 당일~1일 안에 창고에서 반출되고 택배사가 인수합니다.' },
    { k: ['반출완료', '반출승인', '반출신고', '반출'], phase: 1, label: '반출', what: '보세창고에서 물품이 나왔습니다. 통관은 끝났고 이제 국내 배송 차례예요.', next: '택배사 집화 스캔이 찍히면 아래 배송 구간이 채워집니다. 보통 반출 당일~다음 날.' },
    { k: ['통관목록심사완료', '통관목록 심사완료', '목록통관 완료', '목록통관수리', '목록통관 수리'], phase: 1, label: '목록통관 완료', what: '150달러(미국 200달러) 이하 자가사용 물품이라 수입신고 없이 목록만 심사해 통관이 끝났습니다. 세금은 없습니다.', next: '보통 당일 창고 반출 → 택배사 인수.' },
    { k: ['통관목록접수', '통관목록 접수', '목록통관 접수', '목록통관'], phase: 0, label: '목록통관 접수', what: '특송업체가 낸 통관목록(물품명·가격·수취인)이 세관에 접수됐습니다. 세관은 이 목록으로 면세 여부와 검사 대상을 가립니다.', next: '문제가 없으면 보통 반나절~1일 안에 심사가 끝나 반출됩니다. 금액이 한도를 넘거나 합산과세 대상이면 수입신고로 넘어가고 세금이 붙습니다.' },
    { k: ['수입신고'], phase: 0, label: '수입신고', what: '관세사·특송업체가 세관에 정식 수입신고를 넣었습니다. 면세 한도를 넘었거나 목록통관 제외 품목일 때 이 단계가 나옵니다.', next: '세관 심사 후 수리까지 보통 반나절~2일. 세금이 있으면 이 단계에서 관세·부가세 고지가 나옵니다 — 아래 계산기로 예상 세액을 확인해 두세요.' },
    { k: ['검사'], phase: 0, label: '세관 검사', what: '세관이 물품을 직접 열어 보는 검사 대상으로 뽑혔습니다. 무작위 선별이거나 신고 내용 확인이 필요한 경우예요.', next: '검사 완료까지 보통 1~3일. 서류 보완 요청이 오면 특송업체가 연락합니다.' },
    { k: ['반입신고', '반입'], phase: 0, label: '보세창고 반입', what: '물품이 세관이 지정한 보세창고(장치장)에 들어갔습니다. 이제부터 세관 심사가 시작됩니다.', next: '목록통관이면 반나절~1일, 수입신고 건이면 1~2일 뒤 반출되는 경우가 많습니다.' },
    { k: ['하선신고', '하선'], phase: 0, label: '하선신고 수리', what: '배에서 화물을 내려도 된다는 승인이 났습니다.', next: '항구에서 보세창고로 옮겨 반입되기까지 보통 반나절~1일.' },
    { k: ['하기신고', '하기'], phase: 0, label: '하기신고 수리', what: '항공기에서 화물을 내려도 된다는 승인이 났습니다.', next: '공항 보세창고 반입까지 보통 몇 시간.' },
    { k: ['운항정보 정정', '운항정보정정'], phase: 0, label: '운항정보 정정', what: '선사가 이 배의 입항 정보(도착 일시·항차 등)를 고쳐 냈습니다. 화물 자체와는 무관한 서류 정정이에요.', next: '' },
    { k: ['적재화물목록 심사완료', '적하목록 심사완료', '적재화물목록심사완료'], phase: 0, label: '적하목록 심사 완료', what: '세관이 이 배(항공기)의 화물 목록을 확인했습니다. 내 물건이 세관 시스템에 정식으로 잡힌 상태예요.', next: '입항 보고 → 하선 승인 → 창고 반입까지 보통 1일 안팎(중국 해상특송 기준).' },
    { k: ['적재화물목록', '적하목록'], phase: 0, label: '적하목록 제출', what: '선사·항공사가 이 배(항공기)에 실린 화물 목록을 세관에 냈습니다. 통관 절차의 첫 기록이에요.', next: '입항 보고까지 배는 보통 1~3일(중국 해상특송 기준), 항공은 당일.' },
    { k: ['입항보고', '입항 보고'], phase: 0, label: '입항 보고', what: '물품을 실은 배(또는 항공기)가 한국 항구·공항에 도착했습니다.', next: '하선(하기) 승인 → 보세창고 반입 순서로 보통 1일 안에 진행됩니다.' },
    { k: ['보세운송'], phase: 0, label: '보세운송', what: '통관 전 상태로 다른 보세구역(예: 다른 도시 창고)으로 옮기는 중입니다.', next: '도착 창고 반입 후 심사가 이어집니다. 보통 1~2일.' },
    { k: ['취하', '반송', '폐기'], phase: 0, label: '통관 중단', what: '신고가 취하됐거나 반송·폐기 절차로 넘어갔습니다. 특송업체나 관세사에 확인이 필요합니다.', next: '' },
  ];
  const explain = name => { const n = String(name || ''); for (const g of GLOSSARY) if (g.k.some(k => n.includes(k))) return g; return null; };

  // Parse UNIPASS timestamps ('20260916140531', '20260916') into a local Date, or null.
  const dttm = s => { const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null; };
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => d ? `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  const fmtDay = d => d ? `${d.getMonth() + 1}/${d.getDate()}` : '';
  const ago = (d, now) => { if (!d) return ''; const h = ((now || new Date()) - d) / 36e5; return h < 1 ? '방금' : h < 24 ? `${Math.floor(h)}시간 전` : h < 24 * 30 ? `${Math.floor(h / 24)}일 전` : fmtDay(d); };

  // Customs phase from the general status + steps: 1 = cleared (수리/반출), 0 = in progress, -1 = nothing yet.
  function customsPhase(c) {
    if (!c || !c.found) return -1;
    const g = explain(c.general && (c.general.progress || c.general.status));
    if (g && g.phase === 1) return 1;
    const last = (c.steps || []).slice(-1)[0];
    const s = last && explain(last.kind || last.text);
    if (s && s.phase === 1) return 1;
    return 0;
  }
  const taxLikely = c => !!(c && c.found && /수입신고/.test((c.general && (c.general.progress + ' ' + c.general.status)) || '') && !/목록/.test((c.general && c.general.status) || ''));

  // Combined stepper index (0..4) or -1 when neither side knows the number yet.
  function stage(c, d) {
    const last = d && (d.last || (d.events || []).slice(-1)[0]);
    if (last && DELIVERY[last.code] != null) return DELIVERY[last.code];
    return customsPhase(c);
  }
  // 12-digit CJ numbers are the common case; anything 8–30 alphanumerics is passed through (한진 12, 롯데 12, 우체국 13, 로젠 11).
  const clean = s => String(s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 30);
  const valid = s => clean(s).length >= 8;

  root.TrackModel = { STAGES, CARRIERS, DELIVERY, DELIVERY_KO, GLOSSARY, explain, dttm, fmt, fmtDay, ago, customsPhase, taxLikely, stage, clean, valid };
})(typeof window !== 'undefined' ? window : globalThis);
