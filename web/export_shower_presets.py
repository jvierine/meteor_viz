#!/usr/bin/env python3
"""Export meteor-shower Keplerian filter presets for the browser viewer."""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_sources import IAU_STREAMS_URL, ensure_file


def number(text):
    text = text.strip()
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def circular_span(values, padding_deg):
    values = sorted(v % 360.0 for v in values if v is not None)
    if not values:
        return None
    if len(values) == 1:
        center = values[0]
        extent = padding_deg * 2
        return {"center": center, "extent": extent} if math.isfinite(center + extent) else None

    gaps = []
    for i, value in enumerate(values):
        nxt = values[(i + 1) % len(values)]
        if i == len(values) - 1:
            nxt += 360.0
        gaps.append((nxt - value, i))
    _, gap_index = max(gaps)
    start = values[(gap_index + 1) % len(values)]
    end = values[gap_index]
    if end < start:
        end += 360.0
    extent = min(360.0, end - start + padding_deg * 2)
    center = (start + end) * 0.5
    center = center % 360.0
    return {"center": center, "extent": extent} if math.isfinite(center + extent) else None


def range_span(values, padding, floor, ceiling):
    values = [v for v in values if v is not None and math.isfinite(v)]
    if not values:
        return None
    lo = min(values)
    hi = max(values)
    pad = max(padding, (hi - lo) * 0.15)
    lo = max(floor, lo - pad)
    hi = min(ceiling, hi + pad)
    return {"min": lo, "max": hi} if math.isfinite(lo + hi) else None


def export_presets(input_path, output_path):
    input_path = Path(input_path)
    output_path = Path(output_path)
    ensure_file(input_path, IAU_STREAMS_URL, label="IAU meteor shower catalog")

    groups = defaultdict(list)
    with input_path.open(errors="replace", newline="") as handle:
        for line in handle:
            if not line.startswith('"'):
                continue
            row = next(csv.reader([line], delimiter="|", quotechar='"'))
            if len(row) < 29 or row[4].strip() != "1":
                continue
            code = row[3].strip()
            name = row[6].strip()
            iau_no = row[1].strip()
            q = number(row[23])
            e = number(row[24])
            a = number(row[22])
            if a is None and q is not None and e is not None and 0 <= e < 1:
                a = q / max(1e-9, 1 - e)
            item = {
                "a": abs(a) if a is not None else None,
                "q": q,
                "e": e if e is None else min(max(e, 0.0), 1.0),
                "omega": number(row[25]),
                "Omega": number(row[26]),
                "i": number(row[27]),
            }
            if sum(v is not None for v in item.values()) >= 4:
                groups[(iau_no, code, name)].append(item)

    presets = []
    for (iau_no, code, name), rows in groups.items():
        filters = {
            "a_au": range_span([r["a"] for r in rows], 0.25, 0.0, 100.0),
            "q_au": range_span([r["q"] for r in rows], 0.03, 0.0, 100.0),
            "e": range_span([r["e"] for r in rows], 0.025, 0.0, 1.0),
            "i_deg": range_span([r["i"] for r in rows], 2.0, 0.0, 180.0),
            "omega_deg": circular_span([r["omega"] for r in rows], 4.0),
            "Omega_deg": circular_span([r["Omega"] for r in rows], 4.0),
        }
        filters = {key: value for key, value in filters.items() if value is not None}
        if len(filters) < 5:
            continue
        presets.append(
            {
                "id": f"{int(iau_no):03d}-{code}",
                "code": code,
                "name": name,
                "label": f"{code} - {name}",
                "solutions": len(rows),
                "filters": filters,
            }
        )

    presets.sort(key=lambda item: (item["code"], item["name"]))
    output_path.write_text(
        "window.METEOR_SHOWER_PRESETS = "
        + json.dumps(presets, separators=(",", ":"), allow_nan=False)
        + ";\n"
    )
    print(f"wrote {output_path} ({len(presets)} presets)")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(ROOT / "data" / "streamestablisheddata2026.txt"))
    parser.add_argument("--output", default=str(ROOT / "web" / "data" / "meteor_shower_presets.js"))
    return parser.parse_args()


def main():
    args = parse_args()
    export_presets(args.input, args.output)


if __name__ == "__main__":
    main()
