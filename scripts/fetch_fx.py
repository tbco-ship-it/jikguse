#!/usr/bin/env python3
"""Fetch this week's 관세청 과세환율 (수입) and write data/fx.json.

Two sources for the same 관세청 weekly rate (applies Sunday–Saturday):
- data.go.kr 관세청_관세환율정보(GW) API (15101230) — used when DATAGO_FX_KEY is
  set; reachable from GitHub runners.
- UNIPASS 주간환율조회 (no auth) — fallback; refuses non-Korean IPs.
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/fx.json"
WANT = ["USD", "JPY", "EUR", "GBP", "CNY", "HKD", "AUD", "CAD", "SGD", "TWD"]


def week_bounds(day: dt.date):
    start = day - dt.timedelta(days=(day.weekday() + 1) % 7)  # Sunday
    return start, start + dt.timedelta(days=6)


def fetch_datago(today: dt.date, key: str):
    url = ("https://apis.data.go.kr/1220000/retrieveTrifFxrtInfo/getRetrieveTrifFxrtInfo"
           f"?serviceKey={key}&aplyBgnDt={today:%Y%m%d}&weekFxrtTpcd=2")
    with urllib.request.urlopen(url, timeout=30) as r:
        xml = r.read().decode("utf-8")
    code = re.search(r"<resultCode>(\d+)</resultCode>", xml)
    if not code or code.group(1) != "00":
        raise RuntimeError(f"data.go.kr resultCode {code and code.group(1)}: {xml[:200]}")
    rates = {}
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
        f = dict(re.findall(r"<(\w+)>(.*?)</\1>", item))
        if f.get("currSgn") in WANT:
            rates[f["currSgn"]] = float(f["fxrt"])
    return rates, "관세청 관세환율정보 API(과세환율·수입, data.go.kr 15101230)"


def fetch_unipass(today: dt.date, start: dt.date, end: dt.date):
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
    return rates, "관세청 UNIPASS 주간환율(과세환율·수입)"


def main():
    today = dt.date.today()
    start, end = week_bounds(today)
    key = os.environ.get("DATAGO_FX_KEY")
    if key:
        try:
            rates, source = fetch_datago(today, key)
        except Exception as e:  # noqa: BLE001 — fall through to UNIPASS
            print(f"data.go.kr fetch failed ({e}); trying UNIPASS", file=sys.stderr)
            rates, source = fetch_unipass(today, start, end)
    else:
        rates, source = fetch_unipass(today, start, end)
    print("fx source:", source)
    if "USD" not in rates or "JPY" not in rates:
        sys.exit(f"unexpected payload: {list(rates)}")
    prev = json.loads(OUT.read_text()) if OUT.exists() else {}
    out = {"applies_from": start.isoformat(), "applies_to": end.isoformat(),
           "fetched": today.isoformat(), "rates": rates, "source": source}
    if prev.get("rates") == rates and prev.get("applies_from") == out["applies_from"]:
        print("fx unchanged", start)
        return
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print("fx updated", start, rates)


if __name__ == "__main__":
    main()
