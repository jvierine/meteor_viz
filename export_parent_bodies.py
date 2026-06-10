#!/usr/bin/env python3
"""Export meteor-shower parent-body orbits for the browser visualizer."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from pathlib import Path

from data_sources import IAU_STREAMS_URL, MPC_COMET_ELS_URL, MPC_NEA_URL, ensure_file


ROOT = Path(__file__).resolve().parent
DEFAULT_STREAMS = ROOT / "data" / "streamestablisheddata2026.txt"
DEFAULT_NEA = ROOT / "data" / "NEA.txt"
DEFAULT_COMETS = ROOT / "data" / "CometEls.txt"
DEFAULT_OUTPUT = ROOT / "web" / "data" / "parent_body_orbits.js"


def clean_name(value: str) -> str:
    return " ".join(value.replace("\x00", " ").split())


def lookup_keys(value: str) -> set[str]:
    value = clean_name(value)
    if not value:
        return set()
    lower = value.lower()
    keys = {lower}
    keys.add(re.sub(r"[^a-z0-9]+", "", lower))
    keys.add(re.sub(r"\((\d+)\)", r"\1", lower))
    if m := re.search(r"\((\d+)\)\s*(.+)", value):
        keys.add(m.group(1).lower())
        keys.add(f"{m.group(1)} {m.group(2)}".lower())
        keys.add(re.sub(r"[^a-z0-9]+", "", f"{m.group(1)} {m.group(2)}".lower()))
    if m := re.match(r"(\d+)\s+(.+)", value):
        keys.add(m.group(1).lower())
        keys.add(f"({m.group(1)}) {m.group(2)}".lower())
        keys.add(re.sub(r"[^a-z0-9]+", "", f"{m.group(1)} {m.group(2)}".lower()))
    return {key for key in keys if key}


def to_float(value: str) -> float | None:
    try:
        out = float(value.strip())
    except ValueError:
        return None
    return out if math.isfinite(out) else None


def add_lookup(index: dict[str, dict], body: dict) -> None:
    for value in (body["designation"], body["name"]):
        for key in lookup_keys(value):
            index.setdefault(key, body)


def parse_nea(path: Path) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for line in path.read_text(errors="replace").splitlines():
        if len(line) < 104:
            continue
        a = to_float(line[92:103])
        e = to_float(line[70:79])
        inc = to_float(line[59:68])
        argp = to_float(line[37:46])
        node = to_float(line[48:57])
        mean_anomaly = to_float(line[26:35])
        if None in (a, e, inc, argp, node):
            continue
        if not (a and a > 0 and 0 <= e < 1):
            continue
        designation = clean_name(line[:7])
        name = clean_name(line[166:194]) if len(line) >= 194 else designation
        body = {
            "source": "NEA",
            "designation": designation,
            "name": name or designation,
            "a_au": a,
            "e": e,
            "i_deg": inc,
            "omega_deg": argp,
            "Omega_deg": node,
            "M_deg": mean_anomaly or 0.0,
        }
        add_lookup(index, body)
    return index


def parse_comets(path: Path) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for line in path.read_text(errors="replace").splitlines():
        parts = line.split()
        if len(parts) < 9:
            continue
        q = to_float(parts[4])
        e = to_float(parts[5])
        argp = to_float(parts[6])
        node = to_float(parts[7])
        inc = to_float(parts[8])
        if None in (q, e, inc, argp, node):
            continue
        if not (q and q > 0 and 0 <= e < 1):
            continue
        a = q / (1 - e)
        if not math.isfinite(a) or a <= 0 or a > 100:
            continue
        name = clean_name(line[102:158]) if len(line) >= 158 else clean_name(" ".join(parts[11:]))
        designation = clean_name(parts[0])
        body = {
            "source": "CometEls",
            "designation": designation,
            "name": name or designation,
            "a_au": a,
            "e": e,
            "i_deg": inc,
            "omega_deg": argp,
            "Omega_deg": node,
            "M_deg": 0.0,
        }
        add_lookup(index, body)
    return index


def parse_shower_parents(path: Path) -> dict[str, list[str]]:
    parents: dict[str, list[str]] = {}
    for line in path.read_text(errors="replace").splitlines():
        if not line.startswith('"'):
            continue
        row = next(csv.reader([line], delimiter="|", quotechar='"'))
        if len(row) <= 31:
            continue
        code = clean_name(row[3])
        parent = clean_name(row[31])
        if not code or not parent:
            continue
        parents.setdefault(code, [])
        if parent not in parents[code]:
            parents[code].append(parent)
    return parents


def export_parent_bodies(stream_path: Path, nea_path: Path, comet_path: Path, output_path: Path) -> tuple[int, int]:
    ensure_file(stream_path, IAU_STREAMS_URL, label="IAU meteor shower catalog")
    ensure_file(nea_path, MPC_NEA_URL, label="MPC NEA orbit catalog")
    ensure_file(comet_path, MPC_COMET_ELS_URL, label="MPC comet orbit catalog")

    object_index: dict[str, dict] = {}
    object_index.update(parse_comets(comet_path))
    object_index.update(parse_nea(nea_path))
    shower_parent_names = parse_shower_parents(stream_path)

    bodies: list[dict] = []
    body_ids: dict[str, str] = {}
    by_shower: dict[str, list[str]] = {}
    missing: dict[str, list[str]] = {}

    for shower_code, parent_names in sorted(shower_parent_names.items()):
        for parent_name in parent_names:
            body = None
            for key in lookup_keys(parent_name):
                body = object_index.get(key)
                if body:
                    break
            if not body:
                missing.setdefault(shower_code, []).append(parent_name)
                continue
            stable_key = f"{body['source']}:{body['designation']}:{body['name']}"
            body_id = body_ids.get(stable_key)
            if body_id is None:
                body_id = f"parent-{len(bodies)}"
                body_ids[stable_key] = body_id
                bodies.append({"id": body_id, **body})
            by_shower.setdefault(shower_code, [])
            if body_id not in by_shower[shower_code]:
                by_shower[shower_code].append(body_id)

    payload = {
        "bodies": bodies,
        "byShower": by_shower,
        "missing": missing,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        "window.PARENT_BODY_ORBITS = "
        + json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        + ";\n",
        encoding="utf-8",
    )
    return len(bodies), sum(len(v) for v in by_shower.values())


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Export meteor-shower parent bodies. Missing input catalogs are fetched "
            "from the IAU Meteor Data Center and the Minor Planet Center."
        )
    )
    parser.add_argument("--streams", default=str(DEFAULT_STREAMS))
    parser.add_argument("--nea", default=str(DEFAULT_NEA))
    parser.add_argument("--comets", default=str(DEFAULT_COMETS))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()
    body_count, link_count = export_parent_bodies(Path(args.streams), Path(args.nea), Path(args.comets), Path(args.output))
    print(f"wrote {args.output} with {body_count} parent bodies and {link_count} shower links")


if __name__ == "__main__":
    main()
