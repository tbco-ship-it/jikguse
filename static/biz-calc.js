// Business-import tax model (사업자 수입: 일반 수입신고). No 소액면세, no 목록통관, no 간이세율 — those exist only for
// 개인 자가사용. Pure functions, no DOM; loaded by biz.js and by scripts/test_biz.mjs.
//
//   과세가격(CIF) = 물품가 + 국제운임 + 보험료, 운임·보험은 품목별 물품가 비례 안분, 원 미만 절사 (관세법 제30조)
//   관세          = 과세가격 × 적용세율, 10원 미만 절사 (국고금관리법 제47조)
//   부가세        = (과세가격 + 관세) × 10%, 10원 미만 절사 — 사업자는 매입세액공제 대상
//   적용세율      = min(기본세율 A, WTO 협정세율 C) (관세법 제50조: 협정세율은 낮을 때만); 원산지증명(C/O)이 있으면
//                   원산지 국가에 적용되는 협정세율 중 가장 낮은 것이 그보다 낮을 때 그것
(function (root) {
  const AGREEMENTS = {
    A: '기본세율', C: 'WTO 협정세율', E1: '아·태무역협정(APTA)',
    FCN1: '한·중 FTA', FRCCN1: 'RCEP(중국)', FUS1: '한·미 FTA', FEU1: '한·EU FTA', FGB1: '한·영 FTA', FRCJP1: 'RCEP(일본)',
    FVN1: '한·베트남 FTA', FAS1: '한·아세안 FTA', FRCAS1: 'RCEP(아세안)', FAU1: '한·호주 FTA', FRCAU1: 'RCEP(호주)',
    FNZ1: '한·뉴질랜드 FTA', FRCNZ1: 'RCEP(뉴질랜드)', FCA1: '한·캐나다 FTA', FIN1: '한·인도 CEPA', FID1: '한·인도네시아 CEPA',
    FSG1: '한·싱가포르 FTA', FPH1: '한·필리핀 FTA', FKH1: '한·캄보디아 FTA', FTR1: '한·튀르키예 FTA', FCL1: '한·칠레 FTA',
    FPE1: '한·페루 FTA', FCO1: '한·콜롬비아 FTA', FIL1: '한·이스라엘 FTA', FEF1: '한·EFTA FTA'
  };
  // Origin country → agreement rate codes an importer with a certificate of origin can claim (관세청 관세율구분 코드).
  const ORIGINS = [
    { k: 'CN', name: '중국', codes: ['FCN1', 'FRCCN1', 'E1'] },
    { k: 'US', name: '미국', codes: ['FUS1'] },
    { k: 'EU', name: 'EU (독일·프랑스 등)', codes: ['FEU1'] },
    { k: 'JP', name: '일본', codes: ['FRCJP1'] },
    { k: 'VN', name: '베트남', codes: ['FVN1', 'FAS1', 'FRCAS1'] },
    { k: 'GB', name: '영국', codes: ['FGB1'] },
    { k: 'TH', name: '태국', codes: ['FAS1', 'FRCAS1'] },
    { k: 'ID', name: '인도네시아', codes: ['FID1', 'FAS1', 'FRCAS1'] },
    { k: 'MY', name: '말레이시아', codes: ['FAS1', 'FRCAS1'] },
    { k: 'PH', name: '필리핀', codes: ['FPH1', 'FAS1', 'FRCAS1'] },
    { k: 'SG', name: '싱가포르', codes: ['FSG1', 'FAS1', 'FRCAS1'] },
    { k: 'KH', name: '캄보디아', codes: ['FKH1', 'FAS1', 'FRCAS1'] },
    { k: 'AU', name: '호주', codes: ['FAU1', 'FRCAU1'] },
    { k: 'NZ', name: '뉴질랜드', codes: ['FNZ1', 'FRCNZ1'] },
    { k: 'CA', name: '캐나다', codes: ['FCA1'] },
    { k: 'IN', name: '인도', codes: ['FIN1', 'E1'] },
    { k: 'TR', name: '튀르키예', codes: ['FTR1'] },
    { k: 'CL', name: '칠레', codes: ['FCL1'] },
    { k: 'PE', name: '페루', codes: ['FPE1'] },
    { k: 'CO', name: '콜롬비아', codes: ['FCO1'] },
    { k: 'IL', name: '이스라엘', codes: ['FIL1'] },
    { k: 'CH', name: 'EFTA (스위스·노르웨이)', codes: ['FEF1'] },
    { k: 'TW', name: '대만 (협정 없음)', codes: [] },
    { k: 'HK', name: '홍콩 (협정 없음)', codes: [] },
    { k: 'XX', name: '기타 · 모름', codes: [] }
  ];
  const floor10 = n => Math.floor(n / 10) * 10;

  // entry: one record of hs.json codes[]; cols: hs.json cols. Returns the MFN rate, the best agreement rate for the
  // origin (if any), and which one applies given whether a certificate of origin is available.
  function rateFor(entry, cols, originKey, co) {
    const r = {};
    cols.forEach((c, i) => { r[c] = entry.r[i]; });
    const mfn = (r.C != null && r.C < r.A) ? { rate: r.C, code: 'C' } : { rate: r.A, code: 'A' };
    const origin = ORIGINS.find(o => o.k === originKey) || ORIGINS[ORIGINS.length - 1];
    let fta = null;
    for (const code of origin.codes) {
      const v = r[code];
      if (v != null && (fta === null || v < fta.rate)) fta = { rate: v, code };
    }
    const useFta = !!(co && fta && fta.rate < mfn.rate);
    const applied = useFta ? fta : mfn;
    return {
      mfn: { ...mfn, label: AGREEMENTS[mfn.code] },
      fta: fta && { ...fta, label: AGREEMENTS[fta.code] },
      applied: { ...applied, label: AGREEMENTS[applied.code] },
      useFta,
      stale: (entry.x || []).includes(applied.code) // agreement row expired in the source file — current staged rate may be lower
    };
  }

  // input: { fx: {USD: 1358.72, ...}, cur, lines: [{ entry, qty, price }], freight, freightCur, insurance, brokerageKrw,
  //          domesticKrw, origin, co, cols }. Amounts in `cur` (freight/insurance in `freightCur`; 'KRW' allowed).
  function compute(input) {
    const fx = c => (c === 'KRW' ? 1 : input.fx[c]);
    const goodsFx = fx(input.cur), frFx = fx(input.freightCur || input.cur);
    const lines = input.lines.filter(l => l.entry && l.qty > 0 && l.price > 0);
    const goods = lines.map(l => l.qty * l.price * goodsFx);
    const goodsSum = goods.reduce((s, v) => s + v, 0);
    const freightKrw = (input.freight || 0) * frFx, insKrw = (input.insurance || 0) * frFx;
    const out = lines.map((l, i) => {
      const share = goodsSum ? goods[i] / goodsSum : 0;
      const cif = Math.floor(goods[i] + (freightKrw + insKrw) * share);
      const rt = rateFor(l.entry, input.cols, input.origin, input.co);
      const duty = floor10(cif * rt.applied.rate / 100);
      const vat = floor10((cif + duty) * 0.1);
      return { entry: l.entry, qty: l.qty, price: l.price, goodsKrw: Math.floor(goods[i]), cif, rate: rt, duty, vat, specific: !!l.entry.u, req: !!l.entry.q };
    });
    const sum = k => out.reduce((s, x) => s + x[k], 0);
    const duty = sum('duty'), vat = sum('vat');
    const brokerage = input.brokerageKrw || 0, domestic = input.domesticKrw || 0;
    const landed = Math.floor(goodsSum + freightKrw + insKrw) + duty + vat + brokerage + domestic;
    return {
      lines: out,
      goodsKrw: Math.floor(goodsSum), freightKrw: Math.floor(freightKrw), insKrw: Math.floor(insKrw),
      cif: sum('cif'), duty, vat, tax: duty + vat, brokerage, domestic,
      landed,                 // 총 착지비용 (부가세 포함)
      landedNet: landed - vat, // 부가세 매입세액공제 후 실부담
      goodsUsd: input.fx.USD ? goodsSum / input.fx.USD : 0,
      ftaLines: out.filter(x => x.rate.useFta).length,
      staleLines: out.filter(x => x.rate.stale).length,
      specificLines: out.filter(x => x.specific).length,
      reqLines: out.filter(x => x.req).length
    };
  }

  // HS 6-digit (what forwarders' forms use) → the 10-digit rows under it. Resolved when there is one row, or when every
  // row carries identical rates and flags (then any row gives the same answer); otherwise the caller must let the user pick.
  function resolveH6(codes, h6) {
    const group = codes.filter(c => c.c.startsWith(h6));
    if (!group.length) return { entry: null, n: 0, same: false, group };
    const sig = c => [c.r.join(','), !!c.q, !!c.u].join('|');
    const same = group.every(c => sig(c) === sig(group[0]));
    return { entry: group.length === 1 || same ? group[0] : null, n: group.length, same, group };
  }

  // Parse text copied from any forwarder's application page (신청서조회 / 결제정보 / 견적 화면). Items are located by an HS
  // code in any common notation ("[620453]", "HS 6204.53", "6204.53.0000", "HS코드 620453") and read the nearest
  // 수량/qty and 단가/price (currency code, symbol or 원·元·달러 word). Shipping = 총배송요금 / 배송비 / 배송요금 / 운임 / 결제금액;
  // non-dutiable add-ons = 부가서비스·추가요금·통관대행·신고대행·서류작성·원산지증명·국내택배 amounts; C/O = a certificate line.
  // Verified layouts: QuickStar (scripts/fixtures/quickstar_*.txt). Other forwarders share the vocabulary but not the layout.
  function parseSheet(text) {
    const t = String(text || '').replace(/\r/g, '').replace(/[\u00a0\t]+/g, ' ');
    const num = s => parseFloat(String(s).replace(/,/g, ''));
    const SYM = { '¥': 'CNY', '￥': 'CNY', '元': 'CNY', '위안': 'CNY', '$': 'USD', '＄': 'USD', '달러': 'USD', '€': 'EUR', '유로': 'EUR', '£': 'GBP', '엔': 'JPY', '원': 'KRW' };
    const CODE = '(?:[A-Z]{3}|원|元|위안|달러|유로|엔)';
    const marks = [];
    const hsRe = /\[(\d{6})\]|(?:HS\s*(?:코드|code)?|품목\s*번호|세번|HSK)\s*[:：]?\s*(\d{4})[.\-\s]?(\d{2})(?:[.\-\s]?\d{2,4})?|(?<![\d.,])(\d{4})\.(\d{2})(?:\.(\d{2})(?:\.\d{2})?|(?![\d.,]|\s*(?:[A-Z]{3}|원|元|위안|달러|엔|유로|%)))/gi;
    let m;
    while ((m = hsRe.exec(t))) {
      const h6 = m[1] || (m[2] ? m[2] + m[3] : m[4] + m[5]);
      if (!marks.length || marks[marks.length - 1].at !== m.index) marks.push({ h6, at: m.index });
    }
    const lines = [];
    let cur = null, mixed = false; // mixed: lines quoted in more than one currency — caller should warn
    marks.forEach((p, i) => {
      const seg = t.slice(p.at, marks[i + 1] ? marks[i + 1].at : p.at + 800);
      const pm = seg.match(new RegExp('(?:단가|unit\\s*price|price|가격|금액)\\s*[:：]?\\s*([¥￥$＄€£]?)\\s*([\\d,]+(?:\\.\\d+)?)\\s*(' + CODE + ')?', 'i'))
        || seg.match(/([¥￥$＄€£])\s*([\d,]+(?:\.\d+)?)()/) || seg.match(/()(?<![\d.,])([\d,]+(?:\.\d+)?)\s*((?!KRW)[A-Z]{3}|元|위안|달러|유로|엔)\b/); // keyworded, symbol-prefixed, or code-suffixed
      const qm = seg.match(/(?:수량|qty|quantity|pcs|개수)\s*[:：]?\s*([\d,]+)/i) || seg.match(/(?<![\d.,])([\d,]+)\s*(?:개(?!월)|pcs|ea)(?![A-Za-z가-힣])/i);
      if (!pm || !qm) return;
      const price = num(pm[2]), qty = parseInt(qm[1].replace(/,/g, ''), 10);
      if (!(price > 0 && qty > 0)) return;
      const c = pm[3] ? (SYM[pm[3]] || pm[3].toUpperCase()) : (SYM[pm[1]] || null);
      if (c && c !== 'KRW') { cur = cur || c; if (c !== cur) mixed = true; }
      const dup = lines.find(l => l.h6 === p.h6 && l.price === price);
      if (dup) dup.qty += qty; else lines.push({ h6: p.h6, qty, price });
    });
    if (!cur) { const dm = t.match(new RegExp('(?:총구매비|해외구매비|상품금액|물품가|구매금액)\\s*[:：]?\\s*([¥￥$＄€£]?)\\s*[\\d,]+(?:\\.\\d+)?\\s*(' + CODE + ')?')); if (dm) cur = dm[2] ? (SYM[dm[2]] || dm[2].toUpperCase()) : (SYM[dm[1]] || null); if (cur === 'KRW') cur = null; }
    const goods = lines.reduce((s, l) => s + l.qty * l.price, 0);
    const decl = t.match(/(?:총구매비|해외구매비)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*([A-Z]{3})/);
    let totalKrw = 0, exclKrw = 0;
    const krw = '([\\d,]+)\\s*(?:KRW|원)';
    const pay = t.match(new RegExp('총\\s*배송\\s*(?:요금|비)\\s*[:：]?\\s*' + krw));
    if (pay) { // 결제정보 popup: itemised add-ons
      totalKrw = num(pay[1]);
      for (const mm of t.matchAll(new RegExp('(?:부가서비스\\[[^\\]]*\\]|추가요금)\\s*[:：]?\\s*' + krw, 'g'))) exclKrw += num(mm[1]);
    } else {
      const ship = t.match(new RegExp('(?:^|\\n)\\s*(?:배송비|배송요금|배송료|국제운임|운임|해외배송비)\\s*[:：]?\\s*\\n?\\s*' + krw)) || t.match(new RegExp('(?:총\\s*결제\\s*금액|결제금액|청구금액|총액)\\s*[:：]?\\s*\\n?\\s*' + krw));
      if (ship) totalKrw = num(ship[1]);
      const blk = t.match(/부가서비스\[출고\]([\s\S]*?)(?:\n운송방법|$)/);
      if (blk) for (const mm of blk[1].matchAll(/\)\s+([\d,]+)\s*(?:\n|$)/g)) exclKrw += num(mm[1]);
      else for (const mm of t.matchAll(new RegExp('(?:통관\\s*대행(?:료|비)?|신고\\s*대행(?:료|비)?|서류\\s*작성(?:비)?|원산지\\s*증명서?(?:\\s*발급)?(?:비|료)?|C/O(?:\\s*발급)?|국내\\s*(?:택배|배송)(?:비|료)?)\\s*[:：]?\\s*' + krw, 'gi'))) exclKrw += num(mm[1]);
    }
    if (exclKrw > totalKrw) exclKrw = 0; // add-ons read from somewhere that isn't the shipping bill — don't trust them
    const co = /\d\s*원산지증명서|원산지증명서 발급\([^)]*\)\s+[\d,]+\s*(?:\n|$)|(?:원산지\s*증명서?|C\/O)\s*(?:발급|있음|신청|포함|O|Y|✓)/i.test(t);
    return { lines, cur, goods: Math.round(goods * 100) / 100, declared: decl ? { amount: num(decl[1]), cur: decl[2] } : null,
      totalKrw, exclKrw, co, mixed, origin: cur === 'CNY' ? 'CN' : cur === 'JPY' ? 'JP' : null };
  }

  root.BizCalc = { AGREEMENTS, ORIGINS, rateFor, compute, floor10, resolveH6, parseSheet };
})(typeof window !== 'undefined' ? window : globalThis);
