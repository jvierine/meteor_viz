#!/usr/bin/env python3
"""Export the full MAARSY catalogue as shuffled half-float browser chunks."""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

import h5py
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_sources import MAARSY_DATASET_URL, ensure_file


FIELDS = [
    "a_au",
    "e",
    "i_deg",
    "omega_deg",
    "Omega_deg",
    "nu_deg",
    "log10_mass_to_area_kg_per_m2",
]
FLOAT16_MAX = np.finfo(np.float16).max
DEFAULT_INPUT = ROOT / "data" / "maarsy_dataset.h5"
DEFAULT_OUTPUT_DIR = ROOT / "web" / "data"


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


def export_chunks(input_path, output_dir, chunk_count, seed):
    input_path = Path(input_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    ensure_file(input_path, MAARSY_DATASET_URL, label="MAARSY HDF5 catalogue")

    with h5py.File(input_path, "r") as h:
        kepler = h["kepler"][()].astype(np.float32)
        mass_to_area = h["mass_to_area_kg_per_m2"][()].astype(np.float32)

    count = int(kepler.shape[0])
    q_au = perihelion_distance_au(kepler).astype(np.float32)
    log_mass_to_area = np.clip(np.log10(np.maximum(mass_to_area, 1e-12)), -2.0, 0.0).astype(np.float32)
    table = np.column_stack(
        (
            kepler[:, 0],
            kepler[:, 1],
            kepler[:, 2],
            kepler[:, 3],
            kepler[:, 4],
            kepler[:, 5],
            log_mass_to_area,
        )
    )

    rng = np.random.default_rng(seed)
    order = rng.permutation(count)
    chunks = []
    for chunk_index, rows in enumerate(np.array_split(order, chunk_count)):
        name = f"maarsy_full_{chunk_index:02d}.js"
        chunk = np.clip(table[rows], -FLOAT16_MAX, FLOAT16_MAX).astype("<f2", copy=False)
        payload = {
            "id": chunk_index,
            "count": int(len(rows)),
            "base64Float16": base64.b64encode(chunk.tobytes()).decode("ascii"),
        }
        (output_dir / name).write_text(
            "window.METEOR_VIZ_CHUNK = "
            + json.dumps(payload, separators=(",", ":"))
            + ";\n"
        )
        chunks.append({"id": chunk_index, "count": int(len(rows))})

    params = {
        "a_au": finite_range(kepler[:, 0]),
        "e": finite_range(kepler[:, 1]),
        "i_deg": finite_range(kepler[:, 2]),
        "omega_deg": finite_range(kepler[:, 3]),
        "Omega_deg": finite_range(kepler[:, 4]),
        "q_au": finite_range(q_au),
        "log10_mass_to_area_kg_per_m2": [-2.0, 0.0],
    }
    metadata = {
        "count": count,
        "fields": FIELDS,
        "recordFloat16Count": len(FIELDS),
        "recordFloat32Count": len(FIELDS),
        "epochUnixSecond0": 1600056792.0,
        "parameters": params,
        "defaultColorParameter": "i_deg",
        "encoding": "base64-float16-le-script",
        "float16FiniteClip": float(FLOAT16_MAX),
        "shuffleSeed": seed,
        "chunkFilePrefix": "maarsy_full_",
        "chunkFileSuffix": ".js",
        "chunks": chunks,
    }

    manifest_path = output_dir / "maarsy_full_manifest.js"
    manifest_path.write_text(
        "window.METEOR_VIZ_CATALOG = "
        + json.dumps(metadata, separators=(",", ":"))
        + ";\n"
    )
    (output_dir / "maarsy_full_manifest.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"wrote {manifest_path}")
    print(f"wrote {len(chunks)} chunks from {count:,} rows")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(DEFAULT_INPUT))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--chunks", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260601)
    return parser.parse_args()


def main():
    args = parse_args()
    export_chunks(args.input, args.output_dir, args.chunks, args.seed)


if __name__ == "__main__":
    main()
