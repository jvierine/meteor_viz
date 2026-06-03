#!/usr/bin/env python3
"""Embed the Tycho-2 magnitude-limited catalog for the standalone visualizer."""

from __future__ import annotations

import base64
import gzip
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE_ROOT = Path("/home/j/src/widefield-star-calibrator")
SOURCE_BIN = SOURCE_ROOT / "data" / "tycho2_mag8.bin.gz"
SOURCE_META = SOURCE_ROOT / "data" / "tycho2_mag8.json"
OUT_DIR = ROOT / "web" / "data"


def main():
    raw = gzip.decompress(SOURCE_BIN.read_bytes())
    if raw[:8] != b"WISCAT1\0":
        raise ValueError("Tycho catalog has an unexpected magic header")
    count = int.from_bytes(raw[8:12], "little")
    stride = int.from_bytes(raw[12:16], "little")
    expected = 16 + count * stride * 4
    if stride != 3 or len(raw) != expected:
        raise ValueError(f"Tycho catalog dimensions are invalid: count={count} stride={stride} bytes={len(raw)}")

    source_meta = json.loads(SOURCE_META.read_text())
    meta = {
        "source": str(SOURCE_BIN),
        "count": count,
        "recordFloat32Count": stride,
        "fields": ["ra_hours", "dec_deg", "vt_mag"],
        "selection": source_meta.get("selection"),
        "maxMagnitudeExclusive": source_meta.get("maxMagnitudeExclusive"),
        "format": source_meta.get("format"),
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "tycho2_mag8.json").write_text(f"{json.dumps(meta, indent=2)}\n")
    encoded = base64.b64encode(raw[16:]).decode("ascii")
    js = (
        "window.TYCHO_STAR_CATALOG = "
        + json.dumps({"metadata": meta, "base64Float32": encoded}, separators=(",", ":"))
        + ";\n"
    )
    (OUT_DIR / "tycho2_mag8_embedded.js").write_text(js)
    print(f"embedded {count} Tycho-2 stars")


if __name__ == "__main__":
    main()
