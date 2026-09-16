"""Tax model for 해외직구 landed cost. Mirrored in static/calc.js — keep in sync.

Inputs are in the shop's currency; fx is the weekly 관세청 과세환율 (KRW per unit;
JPY is per 1 yen). All outputs in KRW, rounded to won.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES = json.loads((ROOT / "data/rules.json").read_text())


def to_krw(amount, currency, fx):
    return amount * fx["rates"][currency]


def to_usd(amount, currency, fx):
    return to_krw(amount, currency, fx) / fx["rates"]["USD"]


def compute(item, country, price, shipping, fx, *, method=None, fta=False, courier=True, forwarder_krw=0):
    """Return a dict with clearance type, exemption, tax lines and total."""
    method = method or RULES["default_method"]
    cur = country["currency"]
    price_krw = to_krw(price, cur, fx)
    ship_krw = to_krw(shipping, cur, fx)
    price_usd = to_usd(price, cur, fx)

    excluded = item["excluded"]
    limit = RULES["exemption_usd_us_courier"] if (country["courier200"] and courier and not excluded) else RULES["exemption_usd"]
    clearance = "일반통관" if excluded else "목록통관"
    exempt = price_usd <= limit
    fta_ok = fta and country["fta"] and item["group"] != "tobacco"

    lines = []
    taxable = 0.0
    if not exempt:
        taxable = price_krw + ship_krw
        if item["group"] == "alcohol":
            a = RULES["alcohol"][item["alcohol"]]
            duty = 0.0 if fta_ok else taxable * a["duty"]
            liquor = (taxable + duty) * a["liquor"]
            edu = liquor * a["edu"]
            vat = (taxable + duty + liquor + edu) * RULES["vat"]
            lines = [("관세", duty, a["duty"]), ("주세", liquor, a["liquor"]), ("교육세", edu, a["edu"]), ("부가세", vat, RULES["vat"])]
            method_used = "alcohol"
        elif item["group"] == "tobacco":
            lines = []
            method_used = "unsupported"
        elif item["duty"] == 0 or fta_ok or method == "general" or price_usd > RULES["simplified_cap_usd"]:
            # 제96조②: 무세·감면(FTA) 물품과 고가품은 간이세율 미적용 → 일반세율
            duty = 0.0 if (fta_ok or item["duty"] == 0) else taxable * item["duty"]
            vat_rate = 0.0 if item["slug"] in RULES.get("vat_exempt_items", []) else RULES["vat"]
            lines = [("관세", duty, 0.0 if fta_ok else item["duty"])]
            ict = RULES.get("consumption_tax", {})
            lux_items = [x for k, v in RULES["luxury"].items() if not k.startswith("_") for x in v["items"]]
            excise = edu = 0.0
            if item["slug"] in lux_items and (taxable + duty) > ict.get("threshold_krw", 2_000_000):
                excise = (taxable + duty - ict["threshold_krw"]) * ict["rate"]
                edu = excise * ict["edu"]
                lines += [("개별소비세 (기준 초과분)", excise, ict["rate"]), ("교육세", edu, ict["edu"])]
            vat = (taxable + duty + excise + edu) * vat_rate
            lines.append(("부가세", vat, vat_rate))
            method_used = "general"
        else:
            lux = next((v for k, v in RULES["luxury"].items() if not k.startswith("_") and item["slug"] in v["items"]), None)
            if lux and taxable > lux["threshold_krw"]:
                tax = lux["base_krw"] + (taxable - lux["threshold_krw"]) * lux["over_rate"]
                lines = [("간이세율 (개별소비세 대상 고가품)", tax, lux["over_rate"])]
                method_used = "simplified_luxury"
            else:
                rate = RULES["simplified_rates"][item["group"]]
                lines = [("간이세율 (관세·부가세 통합)", taxable * rate, rate)]
                method_used = "simplified"
    else:
        method_used = "exempt"

    tax_total = sum(v for _, v, _ in lines)
    total = price_krw + ship_krw + tax_total + forwarder_krw
    return {
        "clearance": clearance,
        "exempt": exempt,
        "limit_usd": limit,
        "price_usd": round(price_usd, 2),
        "price_krw": round(price_krw),
        "ship_krw": round(ship_krw),
        "taxable_krw": round(taxable),
        "lines": [(n, round(v), r) for n, v, r in lines],
        "tax_total": round(tax_total),
        "forwarder_krw": round(forwarder_krw),
        "total": round(total),
        "method": method_used,
        "fta_applied": fta_ok and not exempt,
        "tax_rate_effective": round(tax_total / (price_krw + ship_krw) * 100, 1) if (price_krw + ship_krw) else 0,
    }


def won(n):
    return f"{int(round(n)):,}원"
