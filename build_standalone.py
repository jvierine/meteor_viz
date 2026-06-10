#!/usr/bin/env python3
"""Build a single-file, no-backend version of the WebGL visualizer."""

from __future__ import annotations

import base64
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"


def parse_assignment(path: Path, prefix: str) -> dict:
    text = path.read_text()
    if not text.startswith(prefix) or not text.rstrip().endswith(";"):
        raise ValueError(f"{path} does not contain the expected JavaScript assignment")
    return json.loads(text[len(prefix) : text.rfind(";")])


def build_embedded_catalog() -> str:
    manifest = parse_assignment(WEB / "data" / "maarsy_full_manifest.js", "window.METEOR_VIZ_CATALOG = ")
    chunk_payloads = []
    for chunk in manifest["chunks"]:
        path = WEB / "data" / f"maarsy_full_{chunk['id']:02d}.js"
        payload = parse_assignment(path, "window.METEOR_VIZ_CHUNK = ")
        if payload["id"] != chunk["id"]:
            raise ValueError(f"{path} chunk id mismatch")
        chunk_payloads.append(base64.b64decode(payload["base64Float16"]))

    embedded = {
        "metadata": {key: value for key, value in manifest.items() if key != "chunks"},
        "base64Float16": base64.b64encode(b"".join(chunk_payloads)).decode("ascii"),
    }
    return "window.METEOR_VIZ_EMBEDDED_DATA = " + json.dumps(embedded, separators=(",", ":")) + ";\n"


def main():
    html = (WEB / "index.html").read_text()
    css = (WEB / "styles.css").read_text()
    data_js = build_embedded_catalog()
    tycho_js = (WEB / "data" / "tycho2_mag8_embedded.js").read_text()
    app_js = (WEB / "app.js").read_text()

    html = html.replace('<link rel="stylesheet" href="./styles.css">', f"<style>\n{css}\n</style>")
    html = html.replace('    <script src="./data/maarsy_full_manifest.js"></script>\n', "")
    html = html.replace('    <script src="./data/tycho2_mag8_embedded.js"></script>\n', "")
    html = html.replace('    <script src="./app.js"></script>', f"    <script>\n{data_js}\n</script>\n    <script>\n{app_js}\n</script>")
    html = html.replace(f"    <script>\n{data_js}\n</script>", f"    <script>\n{data_js}\n</script>\n    <script>\n{tycho_js}\n</script>")
    out = WEB / "standalone.html"
    out.write_text(html)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
