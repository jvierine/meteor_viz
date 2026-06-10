#!/usr/bin/env python3
"""Embed the Tycho-2 magnitude-limited catalog for the standalone visualizer.

The raw Tycho-2 source catalog is maintained by ESA:
https://www.cosmos.esa.int/web/hipparcos/tycho-2

This script does not download or vendor the source catalog. Instead, point it at
the prefiltered `tycho2_mag8.bin.gz` and `tycho2_mag8.json` files generated from
that ESA catalog by your local preprocessing workflow.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "web" / "data"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-bin",
        required=True,
        help=(
            "Path to the prefiltered gzip-compressed Tycho-2 float32 catalog "
            "generated from ESA Tycho-2 source data."
        ),
    )
    parser.add_argument(
        "--input-meta",
        required=True,
        help="Path to the metadata JSON describing the prefiltered Tycho-2 export.",
    )
    parser.add_argument("--output-dir", default=str(OUT_DIR))
    return parser.parse_args()


def main():
    args = parse_args()
    source_bin = Path(args.input_bin)
    source_meta_path = Path(args.input_meta)
    out_dir = Path(args.output_dir)

    raw = gzip.decompress(source_bin.read_bytes())
    if raw[:8] != b"WISCAT1\0":
        raise ValueError("Tycho catalog has an unexpected magic header")
    count = int.from_bytes(raw[8:12], "little")
    stride = int.from_bytes(raw[12:16], "little")
    expected = 16 + count * stride * 4
    if stride != 3 or len(raw) != expected:
        raise ValueError(f"Tycho catalog dimensions are invalid: count={count} stride={stride} bytes={len(raw)}")

    source_meta = json.loads(source_meta_path.read_text())
    meta = {
        "source": str(source_bin),
        "count": count,
        "recordFloat32Count": stride,
        "fields": ["ra_hours", "dec_deg", "vt_mag"],
        "selection": source_meta.get("selection"),
        "maxMagnitudeExclusive": source_meta.get("maxMagnitudeExclusive"),
        "format": source_meta.get("format"),
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "tycho2_mag8.json").write_text(f"{json.dumps(meta, indent=2)}\n")
    encoded = base64.b64encode(raw[16:]).decode("ascii")
    js = (
        "window.TYCHO_STAR_CATALOG = "
        + json.dumps({"metadata": meta, "base64Float32": encoded}, separators=(",", ":"))
        + ";\n"
    )
    (out_dir / "tycho2_mag8_embedded.js").write_text(js)
    print(f"embedded {count} Tycho-2 stars")


if __name__ == "__main__":
    main()
