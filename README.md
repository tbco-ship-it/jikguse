# 직구세 — 해외직구 관세·총비용 계산기

Static site. Rules in `data/rules.json` (see `data/RULES_DRAFT.md` for sources and open questions),
items in `data/items.json`, countries in `data/countries.json`, weekly customs FX in `data/fx.json`
(refreshed by `scripts/fetch_fx.py` from UNIPASS). Tax model: `scripts/model.py` mirrored in `static/calc.js`.

```
python3 -m venv .venv && .venv/bin/pip install jinja2
.venv/bin/python scripts/fetch_fx.py
.venv/bin/python scripts/build.py --base / --origin https://<domain>
```
