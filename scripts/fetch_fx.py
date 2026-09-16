#!/usr/bin/env python3
"""Fetch this week's 관세청 과세환율 (수입) from UNIPASS and write data/fx.json.

The weekly rate applies Sunday–Saturday. Endpoint discovered from the public
주간환율조회 page; no auth needed.
"""
import datetime as dt
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/fx.json"
WANT = ["USD", "JPY", "EUR", "GBP", "CNY", "HKD", "AUD", "CAD", "SGD", "TWD"]


def week_bounds(day: dt.date):
    start = day - dt.timedelta(days=(day.weekday() + 1) % 7)  # Sunday
    return start, start + dt.timedelta(days=6)


def main():
    today = dt.date.today()
    start, end = week_bounds(today)
    url = ("https://unipass.customs.go.kr/clip/com/bsopcomn/baseinfo/retrieveCOM0101049Q.do"
           f"?pageIndex=1&pageUnit=100&aplyBgnDt={today:%Y-%m-%d}&aplyStrtDd={start:%Y%m%d}"
           f"&aplyEndDd={end:%Y%m%d}&currCd=&summary=01&pagePerRecord=100")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    rates = {}
    for it in data.get("items", []):
        if it.get("currCd") in WANT:
            rates[it["currCd"]] = float(it["weekFxrtIm"])
    if "USD" not in rates or "JPY" not in rates:
        sys.exit(f"unexpected payload: {list(rates)}")
    prev = json.loads(OUT.read_text()) if OUT.exists() else {}
    out = {"applies_from": start.isoformat(), "applies_to": end.isoformat(),
           "fetched": today.isoformat(), "rates": rates,
           "source": "관세청 UNIPASS 주간환율(과세환율·수입)"}
    if prev.get("rates") == rates and prev.get("applies_from") == out["applies_from"]:
        print("fx unchanged", start)
        return
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print("fx updated", start, rates)


if __name__ == "__main__":
    main()
