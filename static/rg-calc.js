// 쿠팡 로켓그로스 순수익 모델. Pure functions, no DOM; loaded by rg.js and scripts/test_rg.mjs.
// Rules: 판매자센터 도움말 15892116953881 (비용·판매수수료, 2025-01-06 개편 + 2025-04-01 프로모션 + 2025-09-05 저가상품 할인),
// 47891269252249 (세이버), 15892170571289 (정산). Tables (data/rg_fees.json) come from the Wing fee APIs — see RESEARCH/ROCKET_GROWTH_FEES_20260920.md.
//
//   사이즈 유형   = 세변합(cm)·무게(kg) 둘 다 충족하는 가장 작은 유형; 특대형 초과분은 추가비용 max(90cm당 1,000, 10kg당 1,000)
//   판매수수료    = 소비자 판매가(판매자 할인 적용 후) × 카테고리 수수료율 (VAT 별도)
//   입출고비      = 사이즈 × 판매가 구간 표 (수량 당),  배송비 = 같은 표 (주문 당; 극소형~대형1은 합포장 1회)
//   보관비        = round(부피㎥ × 일요율) × 보관일 — 무료기간(30/45, 세이버 60) 이후 구간 요율, 균등 판매 가정으로 기대값
//   반품          = 회수비(사이즈, 의류·신발·악세서리 별도) + 재입고비(판매가 구간) 또는 재판매 불가 시 원가 손실 + 반출비 300
//                   판매자당 월 20건 무료 → 월 반품 건수 중 초과분만 과금; 세이버면 전부 무료
//   반품 시 판매수수료·입출고·배송비는 청구되지 않음(환불) — 도움말 1.4
(function (root) {
  const SIZES = [
    { k: 'MINI', name: '극소형', cm: 80, kg: 2 }, { k: 'SMALL', name: '소형', cm: 100, kg: 5 }, { k: 'MEDIUM', name: '중형', cm: 120, kg: 10 },
    { k: 'LARGE1', name: '대형1', cm: 140, kg: 15 }, { k: 'LARGE2', name: '대형2', cm: 160, kg: 20 }, { k: 'XLARGE', name: '특대형', cm: 250, kg: 30 }
  ];
  // 도움말 1.2: 보관비 구간 요율(원/㎥·일). 1~30일 무료(프로모션), 의류·신발·악세서리는 45일까지.
  const STORAGE_TIERS = [[30, 1000], [45, 2000], [60, 2000], [120, 2500], [180, 3500], [Infinity, 5000]];
  const RETURN_PICKUP = { // 반품 회수비, 사이즈 순 — 기본 / 25-04-01~ 프로모션 (일반) / 의류·신발·악세서리
    base: [2200, 2400, 3000, 4000, 5500, 9500], general: [1012, 1162, 1687, 1950, 3075, 4200], apparel: [675, 775, 1050, 1100, 2050, 2800]
  };
  const RESTOCK = { bands: [0, 5000, 10000, 15000, 20000], base: [600, 800, 1200, 1600, 2000], promo: [300, 400, 600, 800, 1000] };
  const REMOVAL = 300, FREE_RETURNS = 20, SAVER = 99000, EXTRA = { cm: 90, kg: 10, won: 1000 };
  // 1차 카테고리별 반품률 기본값. 쿠팡은 공개하지 않는다 — 업계 조사 범위(의류 최고, 식품·도서 최저)를 보수적으로 둔 추정치.
  const RETURN_DEFAULTS = [
    ['패션의류잡화', 0.20], ['가구/홈데코', 0.08], ['가전/디지털', 0.08], ['스포츠/레져', 0.08], ['뷰티', 0.05], ['출산/유아동', 0.05],
    ['완구/취미', 0.05], ['자동차용품', 0.05], ['주방용품', 0.04], ['생활용품', 0.04], ['반려동물', 0.03], ['문구/오피스', 0.03],
    ['식품', 0.02], ['헬스/건강식품', 0.02], ['도서/음반/DVD', 0.02]
  ];
  const APPAREL_ROOTS = ['패션의류잡화']; // 45일 무료 보관·의류 회수비 단가 (도움말: 악세서리·의류·신발 1차 카테고리 기준)

  const r0 = n => Math.round(n);
  const band = (bands, price) => { let i = 0; for (let j = 0; j < bands.length; j++) if (price >= bands[j]) i = j; return i; };

  // dims in mm (any order), weight g → { i, name, cm, kg, extra } ; extra = 특대형 초과 추가비용(원)
  function sizeTier(dims, weightG) {
    const cm = dims.reduce((s, x) => s + (Number(x) || 0), 0) / 10, kg = (Number(weightG) || 0) / 1000;
    let i = SIZES.findIndex(s => cm <= s.cm && kg <= s.kg);
    let extra = 0;
    if (i < 0) {
      i = SIZES.length - 1;
      const a = Math.max(0, Math.ceil((cm - 250) / EXTRA.cm)) * EXTRA.won, b = Math.max(0, Math.ceil((kg - 30) / EXTRA.kg)) * EXTRA.won;
      extra = Math.max(a, b);
    }
    return { i, name: SIZES[i].name, cm: Math.round(cm * 10) / 10, kg, extra };
  }

  // fee table lookup: t = { bands:[...], wh:[6][n], sh:[6][n], base_wh:[6], base_sh:[6] }
  const lookup = (t, kind, sizeIdx, price) => t[kind][sizeIdx][band(t.bands, price)];

  // 기대 보관비(원/개): 부피 cbm, 무료 free일, 판매기간 T일(균등 판매). 일별 금액은 옵션 단위로 반올림(0.4원까지 0).
  function storageCost(cbm, free, T) {
    T = Math.max(1, Math.round(T || 0));
    let sum = 0;
    for (let d = 1; d <= T; d++) {
      if (d <= free) continue;
      const rate = STORAGE_TIERS.find(t => d <= t[0])[1];
      sum += r0(cbm * rate) * (T - d) / T; // 확률 (T-d)/T 로 d일째에도 재고인 단위
    }
    return sum;
  }

  // Core per-listing model. Inputs (all KRW, 판매가는 VAT 포함 소비자가):
  //   price, cost(매입원가·VAT 제외), rate(수수료 %), table, sizeIdx, extra, cbm, apparel(bool), lowasp(bool: 저가 할인 대상 카테고리)
  //   turnover(판매기간 일), monthly(월 판매량, 0=미정), retRate, unsellable(반품 중 재판매 불가 비율), adPct(매출 대비 광고 %),
  //   inbound(개당 입고 운송비 등 기타 비용, VAT 별도 — 반품돼도 이미 쓴 돈),
  //   sellerDisc(판매자 할인 %), saver(bool), simplified(간이과세자)
  function compute(x) {
    const P = Math.max(0, Number(x.price) || 0);
    const sold = P * (1 - (Number(x.sellerDisc) || 0) / 100);  // 판매자 할인 반영 소비자 판매가 = 수수료·정산 기준
    const feeBase = sold;                                       // 입출고/배송 구간도 판매가 기준
    const commission = sold * (Number(x.rate) || 0) / 100;
    const wh = lookup(x.table, 'wh', x.sizeIdx, feeBase) + (x.extra || 0);
    const sh = lookup(x.table, 'sh', x.sizeIdx, feeBase);
    const free = x.saver ? 60 : (x.apparel ? 45 : 30);
    const storage = storageCost(x.cbm || 0, free, x.turnover);
    const ad = sold * (Number(x.adPct) || 0) / 100;
    const inbound = Math.max(0, Number(x.inbound) || 0);
    const r = Math.min(0.95, Math.max(0, Number(x.retRate) || 0)), q = Math.min(1, Math.max(0, Number(x.unsellable) || 0));
    const monthly = Number(x.monthly) || 0;
    let billable = 1; // 월 20건 무료 초과분 비율
    if (x.saver) billable = 0;
    else if (monthly > 0 && r > 0) billable = Math.max(0, monthly * r - FREE_RETURNS) / (monthly * r);
    const pickup = (x.apparel ? RETURN_PICKUP.apparel : RETURN_PICKUP.general)[x.sizeIdx] * billable;
    const restock = RESTOCK.base[band(RESTOCK.bands, sold)] * billable; // 25-07-01 재입고 프로모션 종료 → 기본 단가로 보수적 계산
    const cost = Math.max(0, Number(x.cost) || 0);
    const perReturn = pickup + (1 - q) * restock + q * (cost + REMOVAL); // 재판매 불가분: 원가 손실 + 반출비
    // 일반과세자: 매출 공급가 = 판매가/1.1, 비용은 VAT 별도 금액 그대로. 간이과세자: 매출 ≈ 판매가×0.99, 비용은 VAT 포함(×1.1).
    const revenue = x.simplified ? sold * 0.99 : sold / 1.1;
    const feeMul = x.simplified ? 1.1 : 1;
    const fees = (commission + wh + sh + storage + ad + inbound) * feeMul;
    const saverShare = x.saver && monthly > 0 ? SAVER * feeMul / monthly : 0;
    const keptProfit = revenue - fees - cost - saverShare;
    const expected = (1 - r) * keptProfit - r * ((perReturn + storage + inbound) * feeMul + saverShare); // 반품 건도 보관·입고비·세이버는 든다
    const perSold = (1 - r) > 0 ? expected / (1 - r) : 0; // 실제 판매(유지) 1건당
    return {
      price: P, sold, revenue, commission, wh, sh, storage, ad, inbound, saverShare, cost, free, billable,
      returns: { r, q, pickup, restock, perReturn, cogsLoss: q * cost, removal: q * REMOVAL },
      keptProfit, expected, perSold,
      margin: sold > 0 ? expected / sold : 0, roi: cost > 0 ? expected / cost : 0,
      vatOut: x.simplified ? sold * 0.01 : sold / 11, vatIn: x.simplified ? 0 : (commission + wh + sh + storage + ad + inbound) * 0.1,
      monthly, monthlyProfit: monthly > 0 ? expected * monthly : 0, monthlyRevenue: monthly > 0 ? sold * monthly : 0
    };
  }

  // 손익분기 판매가 (기대 순이익 = 0) 와 목표 마진 판매가. 수수료 구간이 계단이라 10원 단위로 훑는다.
  function breakEven(x, targetMargin) {
    const m = targetMargin || 0;
    const f = p => { const c = compute({ ...x, price: p }); return c.expected - m * c.sold; };
    let lo = 0, hi = Math.max(10000, (Number(x.cost) || 0) * 10 + 100000);
    if (f(hi) < 0) return null;
    for (let step = 1000; step >= 10; step /= 10) { let p = lo; while (p + step <= hi && f(p + step) < 0) p += step; lo = p; hi = Math.min(hi, p + step); }
    return Math.ceil(hi / 10) * 10;
  }

  // 묶음(n개) 포장 치수 추정: 가장 짧은 변 방향으로 쌓는다. 실제 포장은 사용자가 고칠 수 있게 UI에서 노출.
  function bundleDims(dims, n) {
    const d = dims.map(Number).sort((a, b) => b - a);
    return [d[0], d[1], d[2] * n];
  }

  function returnDefault(path) {
    const top = String(path || '').split('>')[0];
    const hit = RETURN_DEFAULTS.find(([k]) => k === top);
    return hit ? hit[1] : 0.05;
  }
  const isApparel = path => APPAREL_ROOTS.includes(String(path || '').split('>')[0]);

  root.RgCalc = { SIZES, STORAGE_TIERS, RETURN_PICKUP, RESTOCK, REMOVAL, FREE_RETURNS, SAVER, RETURN_DEFAULTS, sizeTier, lookup, storageCost, compute, breakEven, bundleDims, returnDefault, isApparel, band };
})(typeof window !== 'undefined' ? window : globalThis);
