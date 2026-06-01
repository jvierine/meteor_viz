#!/usr/bin/env python3
"""Export the full MAARSY catalogue as shuffled half-float browser chunks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import h5py
import numpy as np


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


def export_chunks(input_path, output_dir, chunk_count, seed):
    input_path = Path(input_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with h5py.File(input_path, "r") as h:
        kepler = h["kepler"][()].astype(np.float32)
        epoch = h["kepler_epoch_unix_second"][()].astype(np.float64)
        mass_to_area = h["mass_to_area_kg_per_m2"][()].astype(np.float32)

    count = int(kepler.shape[0])
    epoch0 = float(np.nanmedian(epoch))
    epoch_day = ((epoch - epoch0) / 86400.0).astype(np.float32)
    q_au = perihelion_distance_au(kepler).astype(np.float32)
    n_members = np.ones(count, dtype=np.float32)
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
    )

    rng = np.random.default_rng(seed)
    order = rng.permutation(count)
    chunks = []
    for chunk_index, rows in enumerate(np.array_split(order, chunk_count)):
        name = f"maarsy_full_{chunk_index:02d}.f16"
        chunk = np.clip(table[rows], -FLOAT16_MAX, FLOAT16_MAX).astype("<f2", copy=False)
        (output_dir / name).write_bytes(chunk.tobytes())
        chunks.append({"file": name, "count": int(len(rows))})

    params = {
        "a_au": finite_range(kepler[:, 0]),
        "e": finite_range(kepler[:, 1]),
        "i_deg": finite_range(kepler[:, 2]),
        "omega_deg": finite_range(kepler[:, 3]),
        "Omega_deg": finite_range(kepler[:, 4]),
        "q_au": finite_range(q_au),
        "mass_to_area_kg_per_m2": finite_range(mass_to_area),
        "n_members": [1.0, 1.0],
    }
    metadata = {
        "source": str(input_path),
        "group": "full_catalog",
        "count": count,
        "fields": FIELDS,
        "recordFloat16Count": len(FIELDS),
        "recordFloat32Count": len(FIELDS),
        "epochUnixSecond0": epoch0,
        "parameters": params,
        "defaultColorParameter": "i_deg",
        "encoding": "float16-le",
        "float16FiniteClip": float(FLOAT16_MAX),
        "shuffleSeed": seed,
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
    parser.add_argument("--input", default="../data/maarsy_dataset.h5")
    parser.add_argument("--output-dir", default="data")
    parser.add_argument("--chunks", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260601)
    return parser.parse_args()


def main():
    args = parse_args()
    export_chunks(args.input, args.output_dir, args.chunks, args.seed)


if __name__ == "__main__":
    main()
