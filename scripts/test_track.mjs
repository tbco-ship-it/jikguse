// node scripts/test_track.mjs — the /track/ model (static/track-model.js) and the Worker's UNIPASS XML parser (worker/track-api.mjs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
new Function(readFileSync(join(ROOT, 'static/track-model.js'), 'utf8'))();
const M = globalThis.TrackModel;
const { parseCustomsXml } = await import(join(ROOT, 'worker/track-api.mjs'));

// --- UNIPASS XML (sample from 관세청 OPEN API 연계 가이드 v3.6, masked values as published) ---
const SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><cargCsclPrgsInfoQryRtnVo><ntceInfo/><cargCsclPrgsInfoQryVo><csclPrgsStts>수입신고수리</csclPrgsStts><prnm>MAG****LAY</prnm><dsprNm>인천공항</dsprNm><etprDt>20180916</etprDt><prgsStCd>CAGE12</prgsStCd><cargTp>수입 일반화물</cargTp><pckGcnt>6</pckGcnt><etprCstm>인천세관</etprCstm><hblNo>605118340404</hblNo><prcsDttm>20180917110044</prcsDttm><ttwg>1009</ttwg><wghtUt>KG</wghtUt><cargMtNo>18XJ****0002</cargMtNo><mblNo>94000499505</mblNo><blPtNm>Consol</blPtNm><lodCntyCd>TH</lodCntyCd><prgsStts>반출완료</prgsStts><shcoFlco>타이에어****티드</shcoFlco><pckUt>CT</pckUt><shipNatNm>태국</shipNatNm><agnc/></cargCsclPrgsInfoQryVo><tCnt>8</tCnt>
<cargCsclPrgsInfoDtlQryVo><shedNm>(주) ****공</shedNm><prcsDttm>20180917110044</prcsDttm><dclrNo>0407****0162</dclrNo><rlbrDttm>20180917105954</rlbrDttm><wght>1009</wght><bfhnGdncCn/><wghtUt>KG</wghtUt><pckGcnt>6</pckGcnt><cargTrcnRelaBsopTpcd>반출신고</cargTrcnRelaBsopTpcd><pckUt>CT</pckUt><rlbrCn>수입신고 수리후 반출</rlbrCn></cargCsclPrgsInfoDtlQryVo>
<cargCsclPrgsInfoDtlQryVo><shedNm>(주) ****공</shedNm><prcsDttm>20180916201500</prcsDttm><cargTrcnRelaBsopTpcd>반입신고</cargTrcnRelaBsopTpcd><rlbrCn>&lt;반입&gt; 6CT</rlbrCn></cargCsclPrgsInfoDtlQryVo>
<cargCsclPrgsInfoDtlQryVo><prcsDttm>20180916183000</prcsDttm><cargTrcnRelaBsopTpcd>입항보고</cargTrcnRelaBsopTpcd></cargCsclPrgsInfoDtlQryVo></cargCsclPrgsInfoQryRtnVo>`;
const c = parseCustomsXml(SAMPLE);
assert.equal(c.found, true);
assert.equal(c.general.status, '수입신고수리');
assert.equal(c.general.progress, '반출완료');
assert.equal(c.general.hblNo, '605118340404');
assert.equal(c.general.pck, '6CT');
assert.equal(c.general.wght, '1009KG');
assert.deepEqual(c.steps.map(s => s.kind), ['입항보고', '반입신고', '반출신고'], 'steps sorted oldest → newest');
const tie = parseCustomsXml('<x><ntceInfo/><cargCsclPrgsInfoQryVo><hblNo>1</hblNo></cargCsclPrgsInfoQryVo><tCnt>2</tCnt><cargCsclPrgsInfoDtlQryVo><prcsDttm>20260915162808</prcsDttm><cargTrcnRelaBsopTpcd>반출신고</cargTrcnRelaBsopTpcd></cargCsclPrgsInfoDtlQryVo><cargCsclPrgsInfoDtlQryVo><prcsDttm>20260915162808</prcsDttm><cargTrcnRelaBsopTpcd>통관목록심사완료</cargTrcnRelaBsopTpcd></cargCsclPrgsInfoDtlQryVo></x>');
assert.deepEqual(tie.steps.map(s => s.kind), ['통관목록심사완료', '반출신고'], 'same-second rows keep upstream (newest-first) order reversed');
assert.equal(c.steps[1].text, '<반입> 6CT', 'entities unescaped');
assert.equal(c.steps[2].dclrNo, '0407****0162');

assert.deepEqual(parseCustomsXml('<cargCsclPrgsInfoQryRtnVo><ntceInfo>존재하지 않는 인증키입니다.</ntceInfo><tCnt>-1</tCnt></cargCsclPrgsInfoQryRtnVo>'), { error: '존재하지 않는 인증키입니다.' });
assert.deepEqual(parseCustomsXml('<cargCsclPrgsInfoQryRtnVo><ntceInfo/><tCnt>0</tCnt></cargCsclPrgsInfoQryRtnVo>'), { found: false, notice: '' });
const multi = parseCustomsXml('<cargCsclPrgsInfoQryRtnVo><ntceInfo>[N00]조회결과가 여러건입니다</ntceInfo><cargCsclPrgsInfoQryVo><cargMtNo>A1</cargMtNo><hblNo>X</hblNo><etprDt>20260301</etprDt></cargCsclPrgsInfoQryVo><cargCsclPrgsInfoQryVo><cargMtNo>A2</cargMtNo><hblNo>X</hblNo><etprDt>20260915</etprDt></cargCsclPrgsInfoQryVo><tCnt>2</tCnt></cargCsclPrgsInfoQryRtnVo>');
assert.equal(multi.list.length, 2); assert.equal(multi.list[1].cargMtNo, 'A2');

// --- model: stepper + explanations ---
assert.equal(M.customsPhase(c), 1, '반출완료 → cleared');
assert.equal(M.stage(c, { events: [] }), 1, 'cleared, no scans yet → 통관 완료');
assert.equal(M.stage(c, { last: { code: 'AT_PICKUP' } }), 2);
assert.equal(M.stage(c, { last: { code: 'IN_TRANSIT' } }), 3);
assert.equal(M.stage(c, { last: { code: 'OUT_FOR_DELIVERY' } }), 3);
assert.equal(M.stage(null, { last: { code: 'DELIVERED' } }), 4, 'delivered without customs data');
assert.equal(M.stage({ available: false }, { events: [] }), -1, 'nothing known');
assert.equal(M.stage({ found: true, general: { status: '반입신고', progress: '반입' }, steps: [{ kind: '반입신고' }] }, { events: [] }), 0);
assert.equal(M.taxLikely(c), true, '수입신고수리 → tax path');
assert.equal(M.taxLikely({ found: true, general: { status: '통관목록 심사완료', progress: '반출완료' } }), false, '목록통관 → no tax');
assert.equal(M.explain('반출신고').label, '반출');
assert.equal(M.explain('수입신고수리').phase, 1);
assert.equal(M.explain('수입신고').phase, 0, "'수입신고' must not match the 수리 entry");
assert.equal(M.explain('통관목록접수').label, '목록통관 접수');
assert.equal(M.explain('하선신고 수리').label, '하선신고 수리');
assert.equal(M.explain('전혀 모르는 단계'), null);
assert.equal(M.fmt(M.dttm('20260916140531')), '9/16 14:05');
assert.equal(M.fmtDay(M.dttm('20260916')), '9/16');
assert.equal(M.ago(new Date(Date.now() - 3 * 36e5)), '3시간 전');
assert.equal(M.clean(' 3077-8640 5384 '), '307786405384');
assert.equal(M.valid('1234567'), false); assert.equal(M.valid('12345678'), true);
console.log('test_track ok');

// real UNIPASS step names seen on 2026-09-21 (해상특송, 인천항 4부두)
for (const [name, label, phase] of [['통관목록접수', '목록통관 접수', 0], ['입항적재화물목록 제출', '적하목록 제출', 0], ['입항적재화물목록 심사완료', '적하목록 심사 완료', 0], ['입항보고 수리', '입항 보고', 0], ['입항적재화물목록 운항정보 정정', '운항정보 정정', 0], ['하선신고 수리', '하선신고 수리', 0], ['반입신고', '보세창고 반입', 0], ['통관목록심사완료', '목록통관 완료', 1], ['반출신고', '반출', 1], ['하선신고 수리완료', '하선신고 수리', 0], ['반출완료', '반출', 1]]) {
  const g = M.explain(name); assert.ok(g, name); assert.equal(g.label, label, name); assert.equal(g.phase, phase, name);
}
const live = { found: true, general: { status: '통관목록접수', progress: '하선신고 수리완료' }, steps: [{ kind: '통관목록접수' }, { kind: '하선신고 수리' }] };
assert.equal(M.customsPhase(live), 0); assert.equal(M.taxLikely(live), false);
const cleared = { found: true, general: { status: '통관목록심사완료', progress: '반출완료' }, steps: [{ kind: '반출신고' }] };
assert.equal(M.customsPhase(cleared), 1); assert.equal(M.stage(cleared, { events: [] }), 1);
console.log('test_track real-names ok');
