#!/usr/bin/env python3
"""Reference Kepler propagation for the JavaScript orbit tests."""

from __future__ import annotations

import json
import math
import sys

import numpy as np
import pyorb


MU = pyorb.get_G(length="AU", mass="Msol", time="d")


def propagate(kep, epoch_day, times):
    a, e, inc, argp, node, nu0 = [float(x) for x in kep]
    if not all(math.isfinite(x) for x in (a, e, inc, argp, node, nu0)):
        return [None for _ in times]
    if abs(a) < 1e-9 or e < 0 or abs(e - 1.0) <= 1e-3:
        return [None for _ in times]

    a_abs = abs(a)
    if e > 1.0:
        nu_signed = ((nu0 + 180.0) % 360.0) - 180.0
        nu_rad = math.radians(nu_signed)
        denom = 1.0 + e * math.cos(nu_rad)
        if denom <= 0:
            return [None for _ in times]
        sinh_h0 = math.sqrt(e * e - 1.0) * math.sin(nu_rad) / denom
        h0 = math.asinh(sinh_h0)
        mean0 = math.degrees(e * math.sinh(h0) - h0)
    else:
        try:
            mean0 = pyorb.kepler.true_to_mean(nu0, e, degrees=True)
        except Exception:
            return [None for _ in times]
        if not math.isfinite(float(mean0)):
            return [None for _ in times]

    out = []
    mean_motion = math.sqrt(MU / (a_abs * a_abs * a_abs))
    for t in times:
        mean = float(mean0) + mean_motion * (float(t) - float(epoch_day)) * 180.0 / math.pi
        if e < 1.0:
            mean = ((mean + 180.0) % 360.0) - 180.0
        try:
            nu = pyorb.kepler.mean_to_true(mean, e, degrees=True)
            cart = pyorb.kepler.kep_to_cart(np.array([a_abs, e, inc, argp, node, nu], dtype=float), mu=MU, degrees=True)
            pos = [float(cart[0]), float(cart[1]), float(cart[2])]
        except Exception:
            pos = None
        if pos is None or not all(math.isfinite(x) for x in pos):
            out.append(None)
        else:
            out.append(pos)
    return out


def main():
    request = json.loads(sys.stdin.read())
    times = request["times"]
    rows = request["rows"]
    json.dump([propagate(row["kep"], row.get("epochDay", 0.0), times) for row in rows], sys.stdout)


if __name__ == "__main__":
    main()
