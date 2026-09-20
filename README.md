# 직구세 — 해외직구 관세·총비용 계산기

Static site. Rules in `data/rules.json` (see `data/RULES_DRAFT.md` for sources and open questions),
items in `data/items.json`, countries in `data/countries.json`, weekly customs FX in `data/fx.json`
(refreshed by `scripts/fetch_fx.py` from UNIPASS). Tax model: `scripts/model.py` mirrored in `static/calc.js`.
Business calculator (`/business/`): model in `static/biz-calc.js` (tests `node scripts/test_biz.mjs`), HS 10-digit rates in `data/hs.json` +
세관장확인 requirements in `data/hs_req.json`, both built by `scripts/build_hs.py` from 관세청 files (see its docstring for sources).

```
python3 -m venv .venv && .venv/bin/pip install jinja2
.venv/bin/python scripts/fetch_fx.py
.venv/bin/python scripts/build.py --base / --origin https://<domain>
```
