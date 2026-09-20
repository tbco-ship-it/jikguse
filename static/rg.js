// /rocket/ page glue: mount the 로켓그로스 widget (rg-widget.js) and take a unit cost handed over in the hash
// (#cost=6123&name=낚시 릴 — older links from /business/ result rows).
(async function () {
  const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const host = document.getElementById('rg-host');
  const FEES = await (await fetch(host.dataset.fees)).json();
  const w = window.RgWidget.mount(host, { fees: FEES, catsUrl: host.dataset.cats, base: host.dataset.base, key: 'jikguse.rg', embedded: false });
  const m = location.hash.match(/^#(.+)/);
  if (m) {
    const q = new URLSearchParams(m[1]);
    if (q.get('cost')) w.load('jikguse.rg', { cost: +q.get('cost'), note: `사업자 수입 계산기에서 가져온 원가: ${q.get('name') || ''} 개당 ${won(+q.get('cost'))} (물품가 + 관세 + 운임·부가서비스 안분, 부가세 제외)` });
    history.replaceState(null, '', location.pathname + location.search);
  }
})();
