#!/usr/bin/env python3
"""Build a single-file, no-backend version of the WebGL visualizer."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"


def main():
    html = (WEB / "index.html").read_text()
    css = (WEB / "styles.css").read_text()
    data_js = (WEB / "data" / "merge_factor_16_embedded.js").read_text()
    tycho_js = (WEB / "data" / "tycho2_mag8_embedded.js").read_text()
    app_js = (WEB / "app.js").read_text()

    html = html.replace('<link rel="stylesheet" href="./styles.css">', f"<style>\n{css}\n</style>")
    html = html.replace('    <script src="./data/merge_factor_128_embedded.js"></script>\n', "")
    html = html.replace('    <script src="./data/tycho2_mag8_embedded.js"></script>\n', "")
    html = html.replace('    <script src="./app.js"></script>', f"    <script>\n{data_js}\n</script>\n    <script>\n{app_js}\n</script>")
    html = html.replace(f"    <script>\n{data_js}\n</script>", f"    <script>\n{data_js}\n</script>\n    <script>\n{tycho_js}\n</script>")
    out = WEB / "standalone.html"
    out.write_text(html)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
