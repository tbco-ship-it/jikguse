#!/usr/bin/env python3
"""Build data/hs.json (HS 10-digit tariff table for the business calculator) from 관세청 files on data.go.kr.

Sources (file data, download from the dataset page; keep the xlsx outside the repo):
  15051179 관세청_품목번호별 관세율표   — sheet '2.12' (2026-02-11 revision), one row per HS × 관세율구분
  15130660 관세청_HS부호 단위별 품목명 — 2/4/6/8/10-digit Korean + English names
  15049721 관세청_표준품명             — standard product names per HS (search keywords)
  law.go.kr 「관세법 제226조에 따른 세관장확인물품 및 확인방법 지정고시」 첨부 '개정전문(별표 2의2. HSK 10단위로 연계되는
           물품의 수입요건)_260716.xlsx' (행정규칙 2100000282502, 2026-07-16) → data/hs_req.json (HS → 법령·요건 문구)

  python scripts/build_hs.py <tariff.xlsx> <unit_names.xlsx> <std_names.xlsx> <annex2-2.xlsx>

Rate columns kept (관세율구분 codes as printed by 관세청): A 기본세율, C WTO 협정세율, E1 아·태협정, and the FTA/RCEP
codes per partner. The calculator applies min(A, C) as the MFN rate and, when the importer has a certificate of
origin, the lowest agreement rate available for the declared origin. Rows with 단위당세액 (종량세) are flagged 'u'
so the page can say the duty is specific, not ad valorem. Rows valid on the build date only.
"""
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
COLS = ["A", "C", "E1", "FCN1", "FRCCN1", "FUS1", "FEU1", "FGB1", "FRCJP1", "FVN1", "FAS1", "FRCAS1", "FAU1", "FRCAU1",
        "FNZ1", "FRCNZ1", "FCA1", "FIN1", "FID1", "FSG1", "FPH1", "FKH1", "FTR1", "FCL1", "FPE1", "FCO1", "FIL1", "FEF1"]


def sheet_rows(path, sheet=None):
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    return rows[0], rows[1:]


def requirements(annex_xlsx):
    """별표 2의2: one row per HS × 관계법령 with the requirement text. Codes are printed as 0101.21-1000."""
    _, rows = sheet_rows(annex_xlsx)
    req = defaultdict(list)
    for code, _name, text, law in rows:
        hs = "".join(ch for ch in str(code or "") if ch.isdigit())
        if len(hs) != 10 or not law:
            continue
        text = " ".join((text or "").split())
        law = law.strip()
        if [law, text] not in req[hs]:
            req[hs].append([law, text])
    return req


def main(tariff_xlsx, names_xlsx, std_xlsx, annex_xlsx):
    today = date.today().strftime("%Y%m%d")
    _, rows = sheet_rows(tariff_xlsx, "2.12")
    rates = defaultdict(dict)   # hs -> code -> rate
    stale = defaultdict(dict)   # hs -> code -> last rate whose row expired before today (한·EU/영 rows are staged to 06-30)
    unit = set()
    for hs, kind, rate, per_unit, _base, _cg, use, start, end in rows:
        if kind not in COLS or use:  # 용도세율 rows need an end-use declaration — not a general importer's rate
            continue
        if start <= today <= end:
            rates[hs][kind] = float(rate)
            if per_unit not in (None, 0, "0"):
                unit.add(hs)
        elif end < today:
            stale[hs][kind] = float(rate)
    # An expired agreement row is kept as a conservative estimate (FTA rates only step down); a non-zero one is
    # flagged so the page can say the current staged rate may be lower and must be checked.
    expired = defaultdict(list)
    for hs, kinds in stale.items():
        for kind, rate in kinds.items():
            if kind not in rates[hs]:
                rates[hs][kind] = rate
                if rate > 0:
                    expired[hs].append(kind)

    wb = openpyxl.load_workbook(names_xlsx, read_only=True)
    names = {}
    for ws in wb.worksheets:
        for code, ko, en in list(ws.iter_rows(values_only=True))[1:]:
            if code:
                names[str(code)] = (ko or "", en or "")

    _, srows = sheet_rows(std_xlsx)
    std = defaultdict(list)
    for r in srows:
        hs, ko = str(r[2]), r[4]
        if ko and ko != "기타" and ko not in std[hs]:
            std[hs].append(ko)

    h4 = {k: v[0] for k, v in names.items() if len(k) == 4}
    h6 = {k: v[0] for k, v in names.items() if len(k) in (5, 6)}
    codes = []
    for hs in sorted(rates):
        if "A" not in rates[hs]:
            continue
        ko, en = names.get(hs, ("", ""))
        parent = names.get(hs[:8], ("",))[0] if hs[:8] in names and hs[:8] != hs else ""
        r = [rates[hs].get(c) for c in COLS]
        entry = {"c": hs, "n": ko, "e": en, "r": r}
        if parent and parent != ko:
            entry["p"] = parent
        if std.get(hs):
            entry["k"] = std[hs][:6]
        if hs in unit:
            entry["u"] = 1
        if expired.get(hs):
            entry["x"] = sorted(expired[hs])
        codes.append(entry)

    out = {
        "source": "관세청 품목번호별 관세율표 2026-02-11(data.go.kr 15051179) · HS부호 단위별 품목명 2026-01-01(15130660) · 표준품명 2026-01-01(15049721)",
        "built": date.today().isoformat(),
        "cols": COLS,
        "h4": h4,
        "h6": h6,
        "codes": codes,
    }
    req = requirements(annex_xlsx)
    known = {c["c"] for c in codes}
    for c in codes:
        if c["c"] in req:
            c["q"] = 1  # 세관장확인 대상 — detail in hs_req.json
    path = ROOT / "data/hs.json"
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    rpath = ROOT / "data/hs_req.json"
    rpath.write_text(json.dumps({"source": "관세법 제226조에 따른 세관장확인물품 및 확인방법 지정고시 별표 2의2 (2026-07-16 개정)", "req": {k: v for k, v in req.items() if k in known}}, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(codes)} codes, {len(unit)} specific-duty, {sum(1 for c in codes if 'x' in c)} with expired agreement rows, "
          f"{sum(1 for c in codes if 'q' in c)} with 세관장확인 ({len(set(req) - known)} annex codes not in tariff table) -> {path} ({path.stat().st_size // 1024} KB), {rpath} ({rpath.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main(*sys.argv[1:5])
