"""Build data/rg_fees.json + data/rg_cats.json for the 로켓그로스 calculator from the Wing crawl outputs.

Inputs (crawled 2026-09-20 from wing.coupang.com with the seller session; see RESEARCH/ROCKET_GROWTH_FEES_20260920.md):
  leaves.json      display leaf categories (ACTIVE) — code, path
  kan_map.jsonl    display code -> KAN category id
  kan_info.jsonl   KAN id -> 판매수수료율 (serviceFeeRatio), unit1/unit2 fee group
  fee_tables.jsonl unit1|unit2 -> lowasp/revamp warehousing-fee + fulfillment-fee tables (finalAmount after promotion, base before)

Usage: python scripts/build_rg.py <crawl_dir>
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent.parent / ".scratch/ori/rg"
SIZES = ["MINI", "SMALL", "MEDIUM", "LARGE1", "LARGE2", "XLARGE"]


def jsonl(p):
    return [json.loads(l) for l in (SRC / p).read_text().splitlines() if l.strip()]


def table(resp):
    """API response -> (bands, after[6][n], before[6])."""
    r = resp["feeRatesBySingleCategoryResponseV1"][0]
    after = r["calculatedFeesAfterPromotion"]["calculatedFees"]
    before = r["calculatedFeesBeforePromotion"]["calculatedFees"]
    by = {c["capacityType"]: c["feeByMinPrice"] for c in after}
    bands = [int(b["minPrice"]["amount"]) for b in by["MINI"]]
    rows = []
    for s in SIZES:
        fb = by[s]
        assert [int(b["minPrice"]["amount"]) for b in fb] == bands, s
        rows.append([int(b["configuredFee"]["finalAmount"]["amount"]) for b in fb])
    base = [int({c["capacityType"]: c for c in before}[s]["feeByMinPrice"][0]["configuredFee"]["finalAmount"]["amount"]) for s in SIZES]
    return bands, rows, base


def main():
    leaves = json.loads((SRC / "leaves.json").read_text())
    kan = {r["code"]: r["kan"] for r in jsonl("kan_map.jsonl") if r.get("kan")}
    info = {r["kan"]: r for r in jsonl("kan_info.jsonl") if r.get("rate") is not None and r.get("u1")}
    tables = {}
    for t in jsonl("fee_tables.jsonl"):
        lw, lf = t.get("lowasp/warehousing-fee"), t.get("lowasp/fulfillment-fee")
        rw, rf = t.get("revamp/warehousing-fee"), t.get("revamp/fulfillment-fee")
        if not all(x and "feeRatesBySingleCategoryResponseV1" in x for x in (lw, lf, rw, rf)):
            print("skip incomplete", t["u1"], t["u2"])
            continue
        if any(x["feeRatesBySingleCategoryResponseV1"][0]["calculatedFeesAfterPromotion"] is None for x in (lw, lf, rw, rf)):
            print("skip: no 로켓그로스 promo table (신선·냉장·여행·상품권 등)", t["u1"], t["u2"])
            continue
        b1, wh, base_wh = table(lw)
        b2, sh, base_sh = table(lf)
        assert b1 == b2
        rb, rwh, _ = table(rw)
        _, rsh, _ = table(rf)
        # 저가 상품 전용 할인 대상이면 lowasp 표가 revamp 표와 다르다 (구간 자체가 다름)
        lowasp = not (b1 == rb and wh == rwh and sh == rsh)
        tables[(t["u1"], t["u2"])] = {"u1": t["u1"], "u2": t["u2"], "bands": b1, "wh": wh, "sh": sh, "base_wh": base_wh, "base_sh": base_sh, "lowasp": lowasp}

    units = sorted(tables.values(), key=lambda u: (u["u1"], u["u2"]))
    uidx = {(u["u1"], u["u2"]): i for i, u in enumerate(units)}
    cats, miss = [], Counter()
    for l in leaves:
        if l["path"].split(">")[0] in ("파페치", "Old_2026 Fasttrack"):  # 명품 위탁·내부 테스트 트리, 로켓그로스 대상 아님
            continue
        k = kan.get(l["code"])
        i = info.get(k) if k else None
        if not i:
            miss["no_info"] += 1
            continue
        u = uidx.get((i["u1"], i["u2"]))
        if u is None:
            miss["no_table"] += 1
            continue
        cats.append([l["path"], i["rate"], u, l["code"]])
    print(f"leaves {len(leaves)} -> cats {len(cats)}, units {len(units)}, missing {dict(miss)}")
    rates = Counter(c[1] for c in cats)
    print("rate distribution:", rates.most_common(12))

    (ROOT / "data/rg_fees.json").write_text(json.dumps({
        "asof": "2026-09-20", "promo_until": "2027-01-31", "source": "wing.coupang.com 로켓그로스 비용/수수료 (accounting-fee API), 판매자센터 도움말 15892116953881",
        "sizes": SIZES, "units": units,
    }, ensure_ascii=False, separators=(",", ":")))
    (ROOT / "data/rg_cats.json").write_text(json.dumps({"asof": "2026-09-20", "cats": cats}, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
