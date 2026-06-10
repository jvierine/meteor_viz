#!/usr/bin/env python3
"""
Export the reduced MAARSY HDF5 catalogue to a compact browser format.

The WebGL viewer loads a compact table and a small JSON metadata file.
Keeping the browser-facing data flat avoids pulling an HDF5 parser into the
client and lets WebGL attach the columns as instanced vertex attributes.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

import h5py
import numpy as np


ROOT = Path(__file__).resolve().parent
REDUCED_INPUT_URL = "https://zenodo.org/records/17139689/files/maarsy_dataset.h5?download=1"
FIELDS = [
    "a_au",
    "e",
    "i_deg",
    "omega_deg",
    "Omega_deg",
    "nu_deg",
    "epoch_day",
    "mass_to_area_kg_per_m2",
    "n_members",
    "q_au",
]
FLOAT16_MAX = np.finfo(np.float16).max


def finite_range(values):
    values = np.asarray(values)
    ok = np.isfinite(values)
    if not np.any(ok):
        return [None, None]
    return [float(np.nanmin(values[ok])), float(np.nanmax(values[ok]))]


def perihelion_distance_au(kepler):
    a = np.abs(kepler[:, 0])
    e = kepler[:, 1]
    q = np.where(e <= 1.0, a * (1.0 - e), a * (e - 1.0))
    return np.maximum(q, 1e-12)


def export_web_data(input_path, group_name, output_dir):
    input_path = Path(input_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        raise FileNotFoundError(
            f"{input_path} does not exist.\n"
            "This script expects a reduced MAARSY HDF5 file, which is not shipped in the repo.\n"
            f"Download the full source dataset from:\n  {REDUCED_INPUT_URL}\n"
            "Then prepare the reduced input with your external reduction workflow and rerun this export."
        )

    with h5py.File(input_path, "r") as h:
        if group_name not in h:
            available = ", ".join(sorted(h.keys()))
            raise KeyError(
                f"Group '{group_name}' was not found in {input_path}.\n"
                "This usually means you pointed the script at the raw MAARSY source file rather than the reduced export.\n"
                f"Available top-level entries: {available}"
            )
        group = h[group_name]
        kepler = group["kepler"][()].astype(np.float64)
        epoch = group["kepler_epoch_unix_second"][()].astype(np.float64)
        mass_to_area = group["mass_to_area_kg_per_m2"][()].astype(np.float64)
        n_members = group["n_members"][()].astype(np.float64)

    epoch0 = float(np.nanmedian(epoch))
    epoch_day = (epoch - epoch0) / 86400.0
    q_au = perihelion_distance_au(kepler)
    table = np.column_stack(
        (
            kepler[:, 0],
            kepler[:, 1],
            kepler[:, 2],
            kepler[:, 3],
            kepler[:, 4],
            kepler[:, 5],
            epoch_day,
            mass_to_area,
            n_members,
            q_au,
        )
    ).astype(np.float32)
    half_table = np.clip(table, -FLOAT16_MAX, FLOAT16_MAX).astype("<f2", copy=False)

    bin_path = output_dir / f"{group_name}.bin"
    json_path = output_dir / f"{group_name}.json"
    js_path = output_dir / f"{group_name}_embedded.js"
    half_table.tofile(bin_path)

    params = {
        "a_au": finite_range(kepler[:, 0]),
        "e": finite_range(kepler[:, 1]),
        "i_deg": finite_range(kepler[:, 2]),
        "omega_deg": finite_range(kepler[:, 3]),
        "Omega_deg": finite_range(kepler[:, 4]),
        "q_au": finite_range(q_au),
        "mass_to_area_kg_per_m2": finite_range(mass_to_area),
        "n_members": finite_range(n_members),
    }
    metadata = {
        "source": str(input_path),
        "group": group_name,
        "count": int(table.shape[0]),
        "fields": FIELDS,
        "recordFloat16Count": int(table.shape[1]),
        "recordFloat32Count": int(table.shape[1]),
        "binary": bin_path.name,
        "encoding": "float16-le",
        "epochUnixSecond0": epoch0,
        "parameters": params,
        "defaultColorParameter": "i_deg",
    }
    json_path.write_text(json.dumps(metadata, indent=2) + "\n")
    embedded = {
        "metadata": metadata,
        "base64Float16": base64.b64encode(half_table.tobytes()).decode("ascii"),
    }
    js_path.write_text(
        "window.METEOR_VIZ_EMBEDDED_DATA = "
        + json.dumps(embedded, separators=(",", ":"))
        + ";\n"
    )
    print(f"wrote {json_path}")
    print(f"wrote {bin_path}")
    print(f"wrote {js_path}")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(ROOT / "data" / "maarsy_dataset_jopek_dh_reduced.h5"))
    parser.add_argument("--group", default="merge_factor_16")
    parser.add_argument("--output-dir", default=str(ROOT / "web" / "data"))
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        export_web_data(args.input, args.group, args.output_dir)
    except (FileNotFoundError, KeyError) as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
