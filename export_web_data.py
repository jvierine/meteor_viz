#!/usr/bin/env python3
"""
Export the reduced MAARSY HDF5 catalogue to a compact browser format.

The WebGL viewer loads a raw Float32 table and a small JSON metadata file.
Keeping the browser-facing data flat avoids pulling an HDF5 parser into the
client and lets WebGL attach the columns as instanced vertex attributes.
"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

import h5py
import numpy as np

from reduce_maarsy_dataset import perihelion_distance_au


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


def finite_range(values):
    values = np.asarray(values)
    ok = np.isfinite(values)
    if not np.any(ok):
        return [None, None]
    return [float(np.nanmin(values[ok])), float(np.nanmax(values[ok]))]


def export_web_data(input_path, group_name, output_dir):
    input_path = Path(input_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with h5py.File(input_path, "r") as h:
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
    ).astype("<f4")

    bin_path = output_dir / f"{group_name}.bin"
    json_path = output_dir / f"{group_name}.json"
    js_path = output_dir / f"{group_name}_embedded.js"
    table.tofile(bin_path)

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
        "recordFloat32Count": int(table.shape[1]),
        "binary": bin_path.name,
        "epochUnixSecond0": epoch0,
        "parameters": params,
        "defaultColorParameter": "i_deg",
    }
    json_path.write_text(json.dumps(metadata, indent=2) + "\n")
    embedded = {
        "metadata": metadata,
        "base64Float32": base64.b64encode(table.tobytes()).decode("ascii"),
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
    parser.add_argument("--input", default="data/maarsy_dataset_jopek_dh_reduced.h5")
    parser.add_argument("--group", default="merge_factor_16")
    parser.add_argument("--output-dir", default="web/data")
    return parser.parse_args()


def main():
    args = parse_args()
    export_web_data(args.input, args.group, args.output_dir)


if __name__ == "__main__":
    main()
