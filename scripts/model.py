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
    # 면세 판정 금액 = 물품대금 + 발송국 내 운임·세금(현지 배송비). 국제운송비·보험료는 제외 (관세청 소액면세 기준).
    threshold_usd = to_usd(price + shipping, cur, fx)

    excluded = item["excluded"]
    limit = RULES["exemption_usd_us_courier"] if (country["courier200"] and courier and not excluded) else RULES["exemption_usd"]
    clearance = "일반통관" if excluded else "목록통관"
    exempt = threshold_usd <= limit
    fta_ok = fta and country["fta"] and item["group"] != "tobacco"
    ict = RULES["consumption_tax"]

    lines = []
    taxable = 0.0
    method_used = "exempt"
    if item["group"] == "alcohol":
        # 관세청 조회기: "주류는 150달러 이하 면세이면 관세, 부가세만 면세이고, 주세, 교육세는 부과"
        a = RULES["alcohol"][item["alcohol"]]
        taxable = price_krw + ship_krw
        duty = 0.0 if (exempt or fta_ok) else taxable * a["duty"]
        liquor = (taxable + duty) * a["liquor"]
        edu = liquor * a["edu"]
        vat = 0.0 if exempt else (taxable + duty + liquor + edu) * RULES["vat"]
        lines = [("관세", duty, 0.0 if (exempt or fta_ok) else a["duty"]), ("주세", liquor, a["liquor"]), ("교육세", edu, a["edu"]), ("부가세", vat, 0.0 if exempt else RULES["vat"])]
        method_used = "alcohol_exempt_partial" if exempt else "alcohol"
    elif exempt:
        method_used = "exempt"
    elif item["group"] == "tobacco":
        method_used = "unsupported"
    else:
        taxable = price_krw + ship_krw
        use_simplified = (method == "simplified" and item["duty"] > 0 and not fta_ok and taxable <= RULES["simplified_cap_krw"])
        if use_simplified:
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
            duty = 0.0 if (fta_ok or item["duty"] == 0) else taxable * item["duty"]
            vat_rate = 0.0 if item["slug"] in RULES.get("vat_exempt_items", []) else RULES["vat"]
            lines = [("관세", duty, 0.0 if fta_ok else item["duty"])]
            excise = edu = 0.0
            thr = ict["thresholds_krw"].get(item["slug"])
            if thr and (taxable + duty) > thr:
                excise = (taxable + duty - thr) * ict["rate"]
                edu = excise * ict["edu"]
                lines += [("개별소비세 (기준 초과분)", excise, ict["rate"]), ("교육세", edu, ict["edu"])]
            vat = (taxable + duty + excise + edu) * vat_rate
            lines.append(("부가세", vat, vat_rate))
            method_used = "general"

    tax_total = sum(v for _, v, _ in lines)
    total = price_krw + ship_krw + tax_total + forwarder_krw
    return {
        "clearance": clearance,
        "exempt": exempt and item["group"] != "alcohol",
        "partial_exempt": exempt and item["group"] == "alcohol",
        "limit_usd": limit,
        "price_usd": round(price_usd, 2),
        "threshold_usd": round(threshold_usd, 2),
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
