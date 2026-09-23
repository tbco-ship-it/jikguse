#!/usr/bin/env python3
"""Generate the static 직구세 site into dist/."""
import argparse
import hashlib
import json
import shutil
from datetime import date
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from model import RULES, compute, won

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SITE = "직구세"


def load():
    items = json.loads((ROOT / "data/items.json").read_text())
    cp = json.loads((ROOT / "data/coupang.json").read_text())
    for it in items:
        if it["slug"] in cp:
            it["cp"] = cp[it["slug"]]
    countries = json.loads((ROOT / "data/countries.json").read_text())
    fx = json.loads((ROOT / "data/fx.json").read_text())
    return items, countries, fx


def examples(item, country, fx):
    """Three worked examples at low/mid/high USD-equivalent prices, in shop currency."""
    out = []
    usd_rate = fx["rates"]["USD"] / fx["rates"][country["currency"]]
    for usd in item["ex"]:
        price = round(usd * usd_rate, -1 if country["currency"] in ("JPY",) else 0)
        ship = round(25 * usd_rate, -1 if country["currency"] in ("JPY",) else 0)
        out.append({"price": price, "ship": ship, "r": compute(item, country, price, ship, fx)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="/")
    ap.add_argument("--origin", default="https://jikguse.com")
    ap.add_argument("--cname", default="jikguse.com")
    ap.add_argument("--adsense-pub", default="pub-8425563704095379")
    ap.add_argument("--api", default="https://api.jikguse.com")  # jikguse-api Worker (worker/track-api.mjs) for /track/
    args = ap.parse_args()
    base = args.base if args.base.endswith("/") else args.base + "/"
    origin = args.origin.rstrip("/")

    items, countries, fx = load()
    h = hashlib.md5()
    for f in sorted((ROOT / "static").glob("*")):
        h.update(f.read_bytes())
    v = h.hexdigest()[:8]
    hv = hashlib.md5((ROOT / "data/hs.json").read_bytes() + (ROOT / "data/hs_req.json").read_bytes()).hexdigest()[:8]
    rg = json.loads((ROOT / "data/rg_fees.json").read_text())  # 로켓그로스 요금표 (scripts/build_rg.py)
    rv = hashlib.md5((ROOT / "data/rg_fees.json").read_bytes() + (ROOT / "data/rg_cats.json").read_bytes()).hexdigest()[:8]

    env = Environment(loader=FileSystemLoader(ROOT / "templates"), autoescape=select_autoescape(["html"]))
    env.filters["won"] = won
    env.filters["won_k"] = lambda n: won(round(n, -3))  # '약 155,000원' in titles — an exact-looking 155,016 next to '약' reads wrong
    env.filters["pct"] = lambda r: f"{r * 100:g}%"
    env.globals.update(site=SITE, base=base, origin=origin, today=date.today().isoformat(), v=v, hv=hv, rv=rv,
                       adsense_pub=args.adsense_pub, api=args.api.rstrip("/"), items=items, countries=countries, fx=fx, rules=RULES,
                       rg={"asof": rg["asof"], "promo_until": rg["promo_until"]})

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    shutil.copytree(ROOT / "static", DIST / "static")
    (DIST / "static/data.json").write_text(json.dumps({"items": items, "countries": countries, "fx": fx, "rules": RULES}, ensure_ascii=False, separators=(",", ":")))
    for f in ("hs.json", "hs_req.json", "rg_fees.json", "rg_cats.json"):  # business / rocket calculator tables, fetched lazily
        shutil.copy(ROOT / "data" / f, DIST / "static" / f)

    urls = []

    def write(path, template, **ctx):
        out = DIST / path
        out.mkdir(parents=True, exist_ok=True)
        (out / "index.html").write_text(env.get_template(template).render(path=path, **ctx))
        urls.append(path)

    write("", "index.html")
    write("business/", "business.html")
    write("rocket/", "rocket.html")
    write("track/", "track.html")
    for page in ("about", "methodology", "privacy", "terms", "contact"):
        write(f"{page}/", f"{page}.html")
    for g in ("list-clearance", "combined-tax", "fx", "fta"):
        write(f"guide/{g}/", f"guide_{g}.html")

    write("items/", "items_index.html")
    for it in items:
        us = next(c for c in countries if c["slug"] == "us")
        write(f"items/{it['slug']}/", "item.html", item=it, ex=examples(it, us, fx), us=us)
        for c in countries:
            write(f"items/{it['slug']}/from/{c['slug']}/", "item_country.html", item=it, country=c, ex=examples(it, c, fx))
    write("from/", "countries_index.html")
    for c in countries:
        limit_local = RULES["exemption_usd"] * fx["rates"]["USD"] / fx["rates"][c["currency"]]
        limit200_local = RULES["exemption_usd_us_courier"] * fx["rates"]["USD"] / fx["rates"][c["currency"]]
        write(f"from/{c['slug']}/", "country.html", country=c, limit_local=limit_local, limit200_local=limit200_local)

    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        # lastmod 없음: 빌드일은 내용이 바뀐 날이 아니다. 구글은 lastmod 가 "consistently and
        # verifiably accurate" 할 때만 쓴다(sitemaps/build-sitemap).
        sm.append(f"<url><loc>{origin}{base}{u}</loc></url>")
    sm.append("</urlset>")
    (DIST / "sitemap.xml").write_text("\n".join(sm))
    (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {origin}{base}sitemap.xml\n")
    (DIST / "404.html").write_text(env.get_template("404.html").render(path="404"))
    (DIST / ".nojekyll").write_text("")
    for f in (ROOT / "static").glob("naver*.html"):  # Naver Search Advisor ownership file at site root
        shutil.copy(f, DIST / f.name)
    key = (ROOT / "static/indexnow-key.txt").read_text().strip()
    (DIST / f"{key}.txt").write_text(key + "\n")
    if args.adsense_pub:
        (DIST / "ads.txt").write_text(f"google.com, {args.adsense_pub}, DIRECT, f08c47fec0942fa0\n")
    if args.cname:
        (DIST / "CNAME").write_text(args.cname + "\n")
    print(f"built {len(urls)} pages -> {DIST}")


if __name__ == "__main__":
    main()
