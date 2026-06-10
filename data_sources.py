#!/usr/bin/env python3
"""Helpers for fetching large or external catalog inputs on demand."""

from __future__ import annotations

import shutil
import tempfile
import urllib.request
from pathlib import Path


MAARSY_DATASET_URL = "https://zenodo.org/records/17139689/files/maarsy_dataset.h5?download=1"
MPC_NEA_URL = "https://www.minorplanetcenter.net/iau/MPCORB/NEA.txt"
MPC_COMET_ELS_URL = "https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt"
IAU_STREAMS_URL = "https://www.ta3.sk/IAUC22DB/MDC2022/Etc/streamestablisheddata2026.txt"

TEMP_DOWNLOAD_SUFFIXES = (".crdownload", ".part", ".tmp")


def active_partial_download(path: Path) -> Path | None:
    for suffix in TEMP_DOWNLOAD_SUFFIXES:
        candidate = path.with_name(path.name + suffix)
        if candidate.exists():
            return candidate
    return None


def download_file(url: str, destination: Path, *, label: str) -> Path:
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)

    headers = {"User-Agent": "meteor-viz/1.0 (+https://github.com/)"}
    request = urllib.request.Request(url, headers=headers)

    with urllib.request.urlopen(request, timeout=60) as response:
        with tempfile.NamedTemporaryFile(
            dir=destination.parent, prefix=f".{destination.name}.", suffix=".tmp", delete=False
        ) as handle:
            tmp_path = Path(handle.name)
            with handle:
                shutil.copyfileobj(response, handle)

    tmp_path.replace(destination)
    print(f"downloaded {label} to {destination}")
    return destination


def ensure_file(
    destination: Path,
    url: str,
    *,
    label: str,
    allow_existing_partial: bool = False,
) -> Path:
    destination = Path(destination)
    if destination.exists():
        return destination

    partial = active_partial_download(destination)
    if partial and not allow_existing_partial:
        raise FileNotFoundError(
            f"{destination} is missing, but {partial.name} exists. Finish the current download before rerunning."
        )

    return download_file(url, destination, label=label)
