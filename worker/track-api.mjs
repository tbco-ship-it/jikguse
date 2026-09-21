// jikguse-api (api.jikguse.com): the /track/ page's two upstreams, keys bound as Worker secrets so nothing reaches the browser.
//   GET /track?carrier=kr.cjlogistics&no=307786405384   → tracker.delivery Query.track (배송 구간)
//   GET /customs?no=307786405384&yy=2026                 → UNIPASS OpenAPI 화물통관 진행정보 API001, XML → JSON (통관 구간)
// Responses are cached 10 minutes per number; the number is never written anywhere but the cache key.
// Secrets: TD_CLIENT_ID / TD_CLIENT_SECRET (tracker.delivery, Free plan credentials expire every 21 days — renew in the console),
//          UNIPASS_KEY (optional until the UNIPASS OpenAPI application is approved; /customs answers { available: false } without it).
const ORIGINS = new Set(["https://jikguse.com", "https://www.jikguse.com", "https://tbco-ship-it.github.io", "http://localhost:8147", "http://127.0.0.1:8147"]);
const CARRIERS = new Set(["kr.cjlogistics", "kr.hanjin", "kr.lotte", "kr.logen", "kr.epost", "kr.kdexp"]);
const cors = (req) => { const o = req.headers.get("Origin") || ""; return { "Access-Control-Allow-Origin": ORIGINS.has(o) ? o : "https://jikguse.com", "Vary": "Origin", "Access-Control-Allow-Methods": "GET", "Cache-Control": "public, max-age=600" }; };
const json = (body, h, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...h, "content-type": "application/json; charset=utf-8" } });

const TRACK_QUERY = `query Track($carrierId: ID!, $trackingNumber: String!) {
  track(carrierId: $carrierId, trackingNumber: $trackingNumber) {
    lastEvent { time status { code name } description }
    events(last: 40) { edges { node { time status { code name } description } } }
  }
}`;
async function track(carrier, no, env) {
  const r = await fetch("https://apis.tracker.delivery/graphql", {
    method: "POST",
    headers: { "Authorization": `TRACKQL-API-KEY ${env.TD_CLIENT_ID}:${env.TD_CLIENT_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: TRACK_QUERY, variables: { carrierId: carrier, trackingNumber: no } }),
  });
  const j = await r.json().catch(() => ({}));
  const errs = j.errors || [];
  if (errs.some(e => e.extensions && e.extensions.code === "UNAUTHENTICATED")) return { error: "auth" };
  const tr = j.data && j.data.track;
  if (!tr) {
    const code = errs.length ? (errs[0].extensions && errs[0].extensions.code) || "upstream" : "upstream";
    if (code === "NOT_FOUND") return { found: false, events: [] }; // the carrier does not know this number — not a failure
    return { error: code, events: [] };
  }
  const events = (tr.events && tr.events.edges || []).map(e => e.node).map(n => ({ time: n.time, code: n.status && n.status.code, name: n.status && n.status.name, text: n.description || "" }));
  return { found: true, events, last: tr.lastEvent ? { time: tr.lastEvent.time, code: tr.lastEvent.status && tr.lastEvent.status.code, name: tr.lastEvent.status && tr.lastEvent.status.name, text: tr.lastEvent.description || "" } : null };
}

// UNIPASS answers flat XML: one <cargCsclPrgsInfoQryVo> (general info) and 0..n <cargCsclPrgsInfoDtlQryVo> (steps); on several matches
// ntceInfo starts with [N00] and the QryVo elements are a list to pick from. No DOMParser in Workers → tag-level regex is enough here.
const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const blocks = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map(m => m[1]);
const fields = block => { const o = {}; for (const m of block.matchAll(/<([A-Za-z]+)>([^<]*)<\/\1>/g)) o[m[1]] = unesc(m[2]).trim(); return o; };
export function parseCustomsXml(xml) {
  const notice = (blocks(xml, "ntceInfo")[0] || "").trim();
  const tcnt = (blocks(xml, "tCnt")[0] || "").trim();
  if (tcnt === "-1") return { error: notice || "upstream" };
  const heads = blocks(xml, "cargCsclPrgsInfoQryVo").map(fields);
  if (/^\[N00\]/.test(notice) || heads.length > 1) return { list: heads.map(h => ({ cargMtNo: h.cargMtNo, hblNo: h.hblNo, mblNo: h.mblNo, etprDt: h.etprDt, dsprNm: h.dsprNm, shcoFlco: h.shcoFlco })) };
  if (!heads.length) return { found: false, notice };
  const g = heads[0];
  const steps = blocks(xml, "cargCsclPrgsInfoDtlQryVo").map(fields).map(s => ({
    kind: s.cargTrcnRelaBsopTpcd || "", at: s.prcsDttm || s.rlbrDttm || "", shed: s.shedNm || "", text: s.rlbrCn || "", dclrNo: s.dclrNo || "", note: s.bfhnGdncCn || "",
    pck: s.pckGcnt ? `${s.pckGcnt}${s.pckUt || ""}` : "", wght: s.wght ? `${s.wght}${s.wghtUt || ""}` : "",
  })).map((s, i) => ({ ...s, i })).filter(s => s.kind || s.text)
    // oldest → newest; UNIPASS lists newest first, so on equal timestamps (심사완료 + 반출신고 in the same second) the later upstream row is the earlier step
    .sort((a, b) => (a.at > b.at ? 1 : a.at < b.at ? -1 : b.i - a.i)).map(({ i, ...s }) => s);
  return {
    found: true,
    general: { cargMtNo: g.cargMtNo, hblNo: g.hblNo, mblNo: g.mblNo, status: g.csclPrgsStts || "", progress: g.prgsStts || "", code: g.prgsStCd || "",
      cargoType: g.cargTp || "", blType: g.blPtNm || "", item: g.prnm || "", from: g.ldprNm || "", fromCountry: g.lodCntyCd || "", port: g.dsprNm || "", customs: g.etprCstm || "",
      arrived: g.etprDt || "", carrier: g.shcoFlco || "", vessel: g.shipNm || "", forwarder: g.frwrEntsConm || "", pck: g.pckGcnt ? `${g.pckGcnt}${g.pckUt || ""}` : "", wght: g.ttwg ? `${g.ttwg}${g.wghtUt || ""}` : "",
      managed: g.mtTrgtCargYnNm || "", updated: g.prcsDttm || "" },
    steps,
  };
}
async function customs(no, yy, env) {
  if (!env.UNIPASS_KEY) return { available: false };
  const call = async (params) => {
    const p = new URLSearchParams({ crkyCn: env.UNIPASS_KEY, ...params });
    const r = await fetch("https://unipass.customs.go.kr:38010/ext/rest/cargCsclPrgsInfoQry/retrieveCargCsclPrgsInfo?" + p, { headers: { "User-Agent": "Mozilla/5.0 (compatible; jikguse/1.0; +https://jikguse.com)" } });
    if (!r.ok) throw new Error("unipass " + r.status);
    return parseCustomsXml(await r.text());
  };
  let out = await call({ hblNo: no, blYy: yy });
  if (out.list) {
    // several arrivals share this HBL: take the latest arrival and ask again by 화물관리번호
    const pick = out.list.slice().sort((a, b) => (b.etprDt || "").localeCompare(a.etprDt || ""))[0];
    if (pick && pick.cargMtNo) out = { ...(await call({ cargMtNo: pick.cargMtNo })), others: out.list.length };
  }
  return { available: true, ...out };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url); const h = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    const no = (url.searchParams.get("no") || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 30);
    if (no.length < 8) return json({ error: "bad number" }, h, 400);
    let key, run;
    if (url.pathname === "/track") {
      const carrier = url.searchParams.get("carrier") || "kr.cjlogistics";
      if (!CARRIERS.has(carrier)) return json({ error: "unknown carrier" }, h, 400);
      key = `https://jikguse-api.cache/track/${carrier}/${no}`; run = () => track(carrier, no, env);
    } else if (url.pathname === "/customs") {
      const yy = url.searchParams.get("yy") || String(new Date().getUTCFullYear());
      if (!/^20\d\d$/.test(yy)) return json({ error: "bad year" }, h, 400);
      key = `https://jikguse-api.cache/customs/${yy}/${no}`; run = () => customs(no, yy, env);
    } else {
      return new Response("not found", { status: 404, headers: h });
    }
    const cache = caches.default; const ck = new Request(key, { method: "GET" });
    let res = await cache.match(ck);
    if (!res) {
      let body;
      try { body = await run(); } catch (e) { return json({ error: "upstream", detail: String(e && e.message || e).slice(0, 300) }, { ...h, "Cache-Control": "no-store" }, 502); }
      if (body.error === "auth") return json({ error: "auth" }, { ...h, "Cache-Control": "no-store" }, 502);
      res = json({ ...body, at: new Date().toISOString() }, h); ctx.waitUntil(cache.put(ck, res.clone()));
    }
    const out = new Response(res.body, res); for (const [k, v] of Object.entries(h)) out.headers.set(k, v); return out;
  }
};
