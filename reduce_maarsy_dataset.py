#!/usr/bin/env python3
"""
Reduce the MAARSY meteor orbit catalogue by iterative Jopek D_H pairing.

The reducer builds an approximate nearest-neighbour graph in an orbital
feature space, scores candidate pairs with the exact Jopek D_H criterion, and
greedily merges disjoint nearest pairs.  Repeating this in powers of two gives
cluster centres with averaged metadata.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import h5py
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from astropy import units as u
from astropy.coordinates import (
    CartesianDifferential,
    CartesianRepresentation,
    HCRS,
    HeliocentricMeanEcliptic,
    get_body_barycentric_posvel,
    solar_system_ephemeris,
)
from astropy.time import Time
from scipy.spatial import cKDTree


AU_M = 149_597_870_700.0


def wrap_deg(x):
    return np.mod(x, 360.0)


def angle_diff_rad(a, b):
    return np.angle(np.exp(1j * (a - b)))


def circular_mean_deg(sin_sum, cos_sum):
    return wrap_deg(np.rad2deg(np.arctan2(sin_sum, cos_sum)))


def perihelion_distance_au(kep):
    a = np.abs(kep[:, 0])
    e = kep[:, 1]
    q = np.where(e <= 1.0, a * (1.0 - e), a * (e - 1.0))
    return np.maximum(q, 1e-12)


def orbital_vectors(kep):
    inc = np.deg2rad(kep[:, 2])
    argp = np.deg2rad(kep[:, 3])
    raan = np.deg2rad(kep[:, 4])

    sin_i = np.sin(inc)
    cos_i = np.cos(inc)
    sin_o = np.sin(raan)
    cos_o = np.cos(raan)
    sin_w = np.sin(argp)
    cos_w = np.cos(argp)

    # Unit angular momentum vector.
    h = np.column_stack((sin_i * sin_o, -sin_i * cos_o, cos_i))

    # Unit vector toward perihelion in the ecliptic frame.
    peri = np.column_stack(
        (
            cos_o * cos_w - sin_o * sin_w * cos_i,
            sin_o * cos_w + cos_o * sin_w * cos_i,
            sin_w * sin_i,
        )
    )
    return h, peri


def jopek_dh(kep_a, kep_b):
    """Jopek D_H distance for rows [a, e, i, omega, Omega, anomaly]."""
    ea = kep_a[:, 1]
    eb = kep_b[:, 1]
    qa = perihelion_distance_au(kep_a)
    qb = perihelion_distance_au(kep_b)

    ia = np.deg2rad(kep_a[:, 2])
    ib = np.deg2rad(kep_b[:, 2])
    oma = np.deg2rad(kep_a[:, 3])
    omb = np.deg2rad(kep_b[:, 3])
    Oma = np.deg2rad(kep_a[:, 4])
    Omb = np.deg2rad(kep_b[:, 4])

    dO = angle_diff_rad(Omb, Oma)
    two_sin_i_half_sq = (
        (2.0 * np.sin(0.5 * (ib - ia))) ** 2
        + np.sin(ia) * np.sin(ib) * (2.0 * np.sin(0.5 * dO)) ** 2
    )
    two_sin_i_half_sq = np.maximum(two_sin_i_half_sq, 0.0)
    I = 2.0 * np.arcsin(np.clip(0.5 * np.sqrt(two_sin_i_half_sq), 0.0, 1.0))

    denom = np.cos(0.5 * I)
    denom = np.where(np.abs(denom) < 1e-12, np.nan, denom)
    s_ba = np.cos(0.5 * (ib + ia)) * np.sin(0.5 * dO) / denom
    s_ba = np.clip(np.nan_to_num(s_ba, nan=0.0), -1.0, 1.0)
    pi_ba = angle_diff_rad(omb, oma) + 2.0 * np.arcsin(s_ba)

    qsum = np.maximum(qa + qb, 1e-12)
    d2 = (
        (eb - ea) ** 2
        + ((qb - qa) / qsum) ** 2
        + two_sin_i_half_sq
        + ((0.5 * (eb + ea)) ** 2) * ((2.0 * np.sin(0.5 * pi_ba)) ** 2)
    )
    return np.sqrt(np.maximum(d2, 0.0))


def neighbour_features(kep):
    q = perihelion_distance_au(kep)
    h, peri = orbital_vectors(kep)
    e = np.clip(kep[:, 1], 0.0, 5.0)
    # log(q) behaves like the relative q term in D_H for close pairs.
    log_q = np.log(q)
    return np.column_stack((e, log_q, h, peri * e[:, None])).astype(np.float32)


def merge_indices_from_candidates(kep, k_neighbors):
    n = kep.shape[0]
    features = neighbour_features(kep)
    tree = cKDTree(features, compact_nodes=False, balanced_tree=True)
    _, nn = tree.query(features, k=min(k_neighbors + 1, n), workers=-1)
    if nn.ndim == 1:
        nn = nn[:, None]

    left_parts = []
    right_parts = []
    all_i = np.arange(n, dtype=np.int32)
    for col in range(1, nn.shape[1]):
        j = nn[:, col].astype(np.int32, copy=False)
        mask = all_i < j
        left_parts.append(all_i[mask])
        right_parts.append(j[mask])

    if not left_parts:
        return np.empty((0, 2), dtype=np.int32), np.arange(n, dtype=np.int32), np.empty(0)

    left = np.concatenate(left_parts)
    right = np.concatenate(right_parts)
    dist = jopek_dh(kep[left], kep[right]).astype(np.float32)
    order = np.argsort(dist, kind="stable")

    used = np.zeros(n, dtype=bool)
    pairs = []
    pair_dist = []
    for idx in order:
        a = int(left[idx])
        b = int(right[idx])
        if not used[a] and not used[b]:
            used[a] = True
            used[b] = True
            pairs.append((a, b))
            pair_dist.append(float(dist[idx]))

    leftovers = np.flatnonzero(~used).astype(np.int32)
    return np.asarray(pairs, dtype=np.int32), leftovers, np.asarray(pair_dist)


def complete_pairs(kep, pairs, leftovers, pair_dist):
    if len(leftovers) < 2:
        return pairs, leftovers, pair_dist

    # Pair any unmatched centres by sorted neighbour-feature order.  This is a
    # rare fallback after greedy candidate matching leaves isolated points.
    lf = leftovers
    features = neighbour_features(kep[lf])
    order = np.lexsort(features.T[::-1])
    lf = lf[order]
    extra = lf[: (len(lf) // 2) * 2].reshape(-1, 2)
    extra_dist = jopek_dh(kep[extra[:, 0]], kep[extra[:, 1]])
    carry = lf[(len(lf) // 2) * 2 :]

    if len(pairs) == 0:
        pairs = extra.astype(np.int32)
        pair_dist = extra_dist
    else:
        pairs = np.vstack((pairs, extra.astype(np.int32)))
        pair_dist = np.concatenate((pair_dist, extra_dist))
    return pairs, carry.astype(np.int32), pair_dist


def merge_round(state, k_neighbors):
    kep = state["kepler"]
    pairs, leftovers, pair_dist = merge_indices_from_candidates(kep, k_neighbors)
    pairs, carry, pair_dist = complete_pairs(kep, pairs, leftovers, pair_dist)

    pair_count = len(pairs)
    carry_count = len(carry)
    out_n = pair_count + carry_count
    out = {}
    weights = state["n_members"].astype(np.float64)
    new_weight = np.empty(out_n, dtype=np.int64)

    out_kep = np.empty((out_n, 6), dtype=np.float64)
    out_std = np.empty((out_n, 6), dtype=np.float64)
    out_epoch = np.empty(out_n, dtype=np.float64)
    out_m2a = np.empty(out_n, dtype=np.float64)
    out_rep_idx = np.empty(out_n, dtype=np.int64)
    out_rep_event = np.empty(out_n, dtype=state["representative_event_id"].dtype)

    if pair_count:
        a = pairs[:, 0]
        b = pairs[:, 1]
        wa = weights[a]
        wb = weights[b]
        w = wa + wb
        new_weight[:pair_count] = w.astype(np.int64)

        linear_cols = [0, 1, 2]
        out_kep[:pair_count, linear_cols] = (
            state["kepler"][a][:, linear_cols] * wa[:, None]
            + state["kepler"][b][:, linear_cols] * wb[:, None]
        ) / w[:, None]

        for col in [3, 4, 5]:
            sin_sum = state["angle_sin"][:, col][a] + state["angle_sin"][:, col][b]
            cos_sum = state["angle_cos"][:, col][a] + state["angle_cos"][:, col][b]
            out_kep[:pair_count, col] = circular_mean_deg(sin_sum, cos_sum)

        out_std[:pair_count] = (state["kepler_std"][a] * wa[:, None] + state["kepler_std"][b] * wb[:, None]) / w[:, None]
        out_epoch[:pair_count] = (state["kepler_epoch_unix_second"][a] * wa + state["kepler_epoch_unix_second"][b] * wb) / w
        out_m2a[:pair_count] = (state["mass_to_area_kg_per_m2"][a] * wa + state["mass_to_area_kg_per_m2"][b] * wb) / w
        choose_a = state["representative_source_index"][a] <= state["representative_source_index"][b]
        out_rep_idx[:pair_count] = np.where(
            choose_a,
            state["representative_source_index"][a],
            state["representative_source_index"][b],
        )
        out_rep_event[:pair_count] = np.where(
            choose_a,
            state["representative_event_id"][a],
            state["representative_event_id"][b],
        )

    if carry_count:
        sl = slice(pair_count, out_n)
        out_kep[sl] = state["kepler"][carry]
        out_std[sl] = state["kepler_std"][carry]
        out_epoch[sl] = state["kepler_epoch_unix_second"][carry]
        out_m2a[sl] = state["mass_to_area_kg_per_m2"][carry]
        new_weight[sl] = state["n_members"][carry]
        out_rep_idx[sl] = state["representative_source_index"][carry]
        out_rep_event[sl] = state["representative_event_id"][carry]

    angle_sin = np.zeros((out_n, 6), dtype=np.float64)
    angle_cos = np.zeros((out_n, 6), dtype=np.float64)
    if pair_count:
        a = pairs[:, 0]
        b = pairs[:, 1]
        angle_sin[:pair_count] = state["angle_sin"][a] + state["angle_sin"][b]
        angle_cos[:pair_count] = state["angle_cos"][a] + state["angle_cos"][b]
    if carry_count:
        sl = slice(pair_count, out_n)
        angle_sin[sl] = state["angle_sin"][carry]
        angle_cos[sl] = state["angle_cos"][carry]

    out["kepler"] = out_kep
    out["kepler_std"] = out_std
    out["kepler_epoch_unix_second"] = out_epoch
    out["mass_to_area_kg_per_m2"] = out_m2a
    out["n_members"] = new_weight
    out["representative_source_index"] = out_rep_idx
    out["representative_event_id"] = out_rep_event
    out["angle_sin"] = angle_sin
    out["angle_cos"] = angle_cos
    stats = {
        "pair_count": pair_count,
        "carry_count": carry_count,
        "min_dh": float(np.min(pair_dist)) if len(pair_dist) else math.nan,
        "median_dh": float(np.median(pair_dist)) if len(pair_dist) else math.nan,
        "p95_dh": float(np.quantile(pair_dist, 0.95)) if len(pair_dist) else math.nan,
        "max_dh": float(np.max(pair_dist)) if len(pair_dist) else math.nan,
    }
    return out, stats


def load_initial_state(path):
    with h5py.File(path, "r") as h:
        kep = h["kepler"][()]
        n = kep.shape[0]
        state = {
            "kepler": kep,
            "kepler_std": h["kepler_std"][()],
            "kepler_epoch_unix_second": h["kepler_epoch_unix_second"][()],
            "mass_to_area_kg_per_m2": h["mass_to_area_kg_per_m2"][()],
            "representative_event_id": h["event_id"][()],
            "representative_source_index": np.arange(n, dtype=np.int64),
            "n_members": np.ones(n, dtype=np.int64),
        }

    angle_sin = np.zeros((n, 6), dtype=np.float64)
    angle_cos = np.zeros((n, 6), dtype=np.float64)
    for col in [3, 4, 5]:
        radians = np.deg2rad(state["kepler"][:, col])
        angle_sin[:, col] = np.sin(radians)
        angle_cos[:, col] = np.cos(radians)
    state["angle_sin"] = angle_sin
    state["angle_cos"] = angle_cos
    return state


def write_level(group, state, stats):
    for key in [
        "kepler",
        "kepler_std",
        "kepler_epoch_unix_second",
        "mass_to_area_kg_per_m2",
        "n_members",
        "representative_source_index",
        "representative_event_id",
    ]:
        group.create_dataset(key, data=state[key], compression="gzip", compression_opts=4)
    q = perihelion_distance_au(state["kepler"])
    group.create_dataset("perihelion_distance_au", data=q, compression="gzip", compression_opts=4)
    for key, value in stats.items():
        group.attrs[key] = value


def signed_semimajor_axis_m(kep):
    a = np.abs(kep[:, 0]) * AU_M
    return np.where(kep[:, 1] > 1.0, -a, a)


def kepler_to_state(kep):
    a = signed_semimajor_axis_m(kep)
    e = kep[:, 1]
    inc = np.deg2rad(kep[:, 2])
    argp = np.deg2rad(kep[:, 3])
    raan = np.deg2rad(kep[:, 4])
    nu = np.deg2rad(kep[:, 5])

    mu = 1.32712440018e20
    p = a * (1.0 - e * e)
    valid = np.isfinite(p) & (p > 0.0) & np.isfinite(nu)
    r = np.full(len(kep), np.nan)
    r[valid] = p[valid] / (1.0 + e[valid] * np.cos(nu[valid]))
    valid &= r > 0.0

    x_pf = np.column_stack((r * np.cos(nu), r * np.sin(nu), np.zeros(len(kep))))
    v_pf = np.full((len(kep), 3), np.nan)
    v_scale = np.full(len(kep), np.nan)
    v_scale[valid] = np.sqrt(mu / p[valid])
    v_pf[:, 0] = -v_scale * np.sin(nu)
    v_pf[:, 1] = v_scale * (e + np.cos(nu))
    v_pf[:, 2] = 0.0

    cos_O, sin_O = np.cos(raan), np.sin(raan)
    cos_i, sin_i = np.cos(inc), np.sin(inc)
    cos_w, sin_w = np.cos(argp), np.sin(argp)

    out_x = np.full((len(kep), 3), np.nan)
    out_v = np.full((len(kep), 3), np.nan)
    r11 = cos_O * cos_w - sin_O * sin_w * cos_i
    r12 = -cos_O * sin_w - sin_O * cos_w * cos_i
    r21 = sin_O * cos_w + cos_O * sin_w * cos_i
    r22 = -sin_O * sin_w + cos_O * cos_w * cos_i
    r31 = sin_w * sin_i
    r32 = cos_w * sin_i
    out_x[:, 0] = r11 * x_pf[:, 0] + r12 * x_pf[:, 1]
    out_x[:, 1] = r21 * x_pf[:, 0] + r22 * x_pf[:, 1]
    out_x[:, 2] = r31 * x_pf[:, 0] + r32 * x_pf[:, 1]
    out_v[:, 0] = r11 * v_pf[:, 0] + r12 * v_pf[:, 1]
    out_v[:, 1] = r21 * v_pf[:, 0] + r22 * v_pf[:, 1]
    out_v[:, 2] = r31 * v_pf[:, 0] + r32 * v_pf[:, 1]
    return out_x, out_v, valid


def earth_velocity_ecliptic(epochs_unix):
    epochs = Time(epochs_unix, format="unix", scale="utc")
    earth_v = np.empty((len(epochs_unix), 3), dtype=np.float64)
    sun_lon = np.empty(len(epochs_unix), dtype=np.float64)
    with solar_system_ephemeris.set("builtin"):
        for i, epoch in enumerate(epochs):
            sun_pos, sun_vel = get_body_barycentric_posvel("sun", epoch)
            earth_pos, earth_vel = get_body_barycentric_posvel("earth", epoch)
            rel_pos = (earth_pos.xyz - sun_pos.xyz).to(u.m)
            rel_vel = (earth_vel.xyz - sun_vel.xyz).to(u.m / u.s)
            rep = CartesianRepresentation(rel_pos).with_differentials(CartesianDifferential(rel_vel))
            hcrs = HCRS(rep, obstime=epoch)
            ecl = hcrs.transform_to(HeliocentricMeanEcliptic(obstime=epoch, equinox=Time("J2000")))
            earth_v[i] = ecl.cartesian.differentials["s"].d_xyz.to_value(u.m / u.s)

            sun = HCRS(CartesianRepresentation((-rel_pos).to(u.m)), obstime=epoch)
            sun_ecl = sun.transform_to(HeliocentricMeanEcliptic(obstime=epoch, equinox=Time("J2000")))
            sun_lon[i] = sun_ecl.lon.deg
    return earth_v, sun_lon


def sun_centered_radiants(kep, epochs_unix):
    _, meteor_v, valid = kepler_to_state(kep)
    earth_v, sun_lon = earth_velocity_ecliptic(epochs_unix)
    radiant_vec = -(meteor_v - earth_v)
    norm = np.linalg.norm(radiant_vec, axis=1)
    valid &= np.isfinite(norm) & (norm > 0.0)
    lon = wrap_deg(np.rad2deg(np.arctan2(radiant_vec[:, 1], radiant_vec[:, 0])))
    lat = np.rad2deg(np.arcsin(np.clip(radiant_vec[:, 2] / norm, -1.0, 1.0)))
    sun_centered_lon = np.rad2deg(np.angle(np.exp(1j * np.deg2rad(lon + sun_lon + 180.0))))
    return sun_centered_lon, lat, norm / 1000.0, valid


def plot_radiants(kep, epochs, weights, out_png):
    slon, slat, speed, valid = sun_centered_radiants(kep, epochs)
    fig, ax = plt.subplots(figsize=(10, 5), subplot_kw={"projection": "mollweide"})
    x = np.deg2rad(slon[valid])
    y = np.deg2rad(slat[valid])
    sc = ax.scatter(x, y, c=speed[valid], s=np.clip(np.sqrt(weights[valid]), 1, 12), alpha=0.55, cmap="turbo", linewidths=0)
    ax.grid(True, alpha=0.3)
    ax.set_xlabel("Sun-centered ecliptic longitude")
    ax.set_ylabel("Ecliptic latitude")
    ax.set_title("Merged MAARSY sun-centered radiant distribution")
    cb = fig.colorbar(sc, ax=ax, pad=0.08, shrink=0.85)
    cb.set_label("Geocentric radiant speed (km/s)")
    fig.tight_layout()
    fig.savefig(out_png, dpi=180)
    plt.close(fig)
    return {
        "valid": int(np.count_nonzero(valid)),
        "invalid": int(len(valid) - np.count_nonzero(valid)),
        "speed_median_km_s": float(np.nanmedian(speed[valid])) if np.any(valid) else math.nan,
    }


def plot_orbital_summary(state, out_png):
    kep = state["kepler"]
    q = perihelion_distance_au(kep)
    weights = state["n_members"]
    fig, axes = plt.subplots(2, 2, figsize=(10, 8))
    axes[0, 0].scatter(kep[:, 1], q, s=np.clip(np.sqrt(weights), 1, 10), alpha=0.4)
    axes[0, 0].set_xlabel("eccentricity")
    axes[0, 0].set_ylabel("perihelion distance q (AU)")
    axes[0, 0].set_ylim(0, np.nanpercentile(q, 99.5))
    axes[0, 1].hist(kep[:, 2], bins=90, weights=weights, color="0.2")
    axes[0, 1].set_xlabel("inclination (deg)")
    axes[0, 1].set_ylabel("weighted count")
    axes[1, 0].hist(kep[:, 3], bins=90, weights=weights, color="0.2")
    axes[1, 0].set_xlabel("argument of perihelion (deg)")
    axes[1, 0].set_ylabel("weighted count")
    axes[1, 1].hist(kep[:, 4], bins=90, weights=weights, color="0.2")
    axes[1, 1].set_xlabel("longitude of ascending node (deg)")
    axes[1, 1].set_ylabel("weighted count")
    fig.suptitle("Merged MAARSY orbital-element summary")
    fig.tight_layout()
    fig.savefig(out_png, dpi=180)
    plt.close(fig)


def write_report(report_path, input_path, output_path, levels, stats_by_level, final_state, radiant_stats, radiant_png, orbit_png):
    lines = [
        "# MAARSY Jopek D_H Reduction Report",
        "",
        f"Input file: `{input_path}`",
        f"Output file: `{output_path}`",
        "",
        "## Method",
        "",
        "The reducer ignores anomaly for similarity and uses the five orbital elements used by meteor D-criteria: perihelion distance `q`, eccentricity `e`, inclination `i`, argument of perihelion `omega`, and longitude of ascending node `Omega`.",
        "",
        "Jopek's `D_H` criterion was implemented as the Southworth-Hawkins form with the perihelion-distance term normalized by `(q_B + q_A)`, following Rozek, Breiter & Jopek 2011, section 2: <https://academic.oup.com/mnras/article/412/2/987/1079008>.",
        "",
        "Because an exact all-pairs search over roughly 1.6 million meteors would require trillions of comparisons, each round builds a KD-tree in a smooth orbital feature embedding, scores KD-tree candidate edges with exact `D_H`, then greedily merges disjoint closest pairs. Any rare unmatched leftovers are paired by feature order, and a final odd object is carried forward unchanged.",
        "",
        "Cluster centres are weighted means of scalar datasets. Angular columns `omega`, `Omega`, and anomaly are circular means. The anomaly is not used when choosing similar meteors, but it is retained as an averaged output column for compatibility.",
        "",
        "The HDF5 output stores one group per saved merge factor, e.g. `merge_factor_128`. Each group contains `kepler`, `kepler_std`, `kepler_epoch_unix_second`, `mass_to_area_kg_per_m2`, `n_members`, `representative_source_index`, `representative_event_id`, and `perihelion_distance_au`.",
        "",
        "## Reduction Levels",
        "",
        "| Merge factor | Centres | Pair count | Carry count | Median pair D_H | 95% pair D_H | Max pair D_H |",
        "|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for level in levels:
        s = stats_by_level[level]
        lines.append(
            f"| {level} | {s['centres']} | {s['pair_count']} | {s['carry_count']} | "
            f"{s['median_dh']:.6g} | {s['p95_dh']:.6g} | {s['max_dh']:.6g} |"
        )
    q = perihelion_distance_au(final_state["kepler"])
    lines += [
        "",
        "## Final Level Summary",
        "",
        f"Final merge factor: `{levels[-1]}`",
        f"Final centres: `{len(final_state['kepler'])}`",
        f"Members per centre: median `{np.median(final_state['n_members']):.1f}`, min `{np.min(final_state['n_members'])}`, max `{np.max(final_state['n_members'])}`",
        f"Weighted median eccentricity: `{weighted_quantile(final_state['kepler'][:, 1], final_state['n_members'], 0.5):.6g}`",
        f"Weighted median perihelion distance: `{weighted_quantile(q, final_state['n_members'], 0.5):.6g} AU`",
        f"Radiants computed for `{radiant_stats['valid']}` centres; `{radiant_stats['invalid']}` centres had invalid two-body states.",
        f"Median geocentric radiant speed among valid centres: `{radiant_stats['speed_median_km_s']:.3f} km/s`",
        "",
        "## Figures",
        "",
        f"![Sun-centered radiant distribution]({radiant_png.name})",
        "",
        f"![Orbital summary]({orbit_png.name})",
        "",
        "## Notes",
        "",
        "The original request said `N=16` should yield about 10,000 meteors. With 1,599,393 inputs, `N=16` yields about 100,000 centres; the report therefore includes powers of two through `N=128`, which gives about 12,500 centres.",
    ]
    report_path.write_text("\n".join(lines) + "\n")


def weighted_quantile(values, weights, q):
    order = np.argsort(values)
    values = values[order]
    weights = weights[order]
    cdf = np.cumsum(weights)
    return float(values[np.searchsorted(cdf, q * cdf[-1], side="left")])


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", default="/home/j/src/meteor_viz/data/maarsy_dataset.h5")
    p.add_argument("--output", default="/home/j/src/meteor_viz/data/maarsy_dataset_jopek_dh_reduced.h5")
    p.add_argument("--report", default="/home/j/src/meteor_viz/reports/maarsy_dataset_jopek_dh_reduction.md")
    p.add_argument("--max-factor", type=int, default=128, help="largest power-of-two merge factor to write")
    p.add_argument("--start-factor", type=int, default=16, help="first power-of-two merge factor to report")
    p.add_argument("--k-neighbors", type=int, default=8, help="KD-tree candidate neighbours per centre")
    return p.parse_args()


def main():
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    state = load_initial_state(input_path)
    total = len(state["kepler"])
    levels = []
    stats_by_level = {}

    with h5py.File(output_path, "w") as out:
        out.attrs["source_file"] = str(input_path)
        out.attrs["source_count"] = total
        out.attrs["similarity"] = "Jopek D_H"
        out.attrs["kepler_columns"] = "a_au,e,i_deg,omega_deg,Omega_deg,anomaly_deg"
        out.attrs["note"] = "Anomaly is averaged for compatibility but is not used for similarity."

        factor = 1
        while factor < args.max_factor:
            factor *= 2
            print(f"merge factor {factor}: input centres {len(state['kepler'])}", flush=True)
            state, stats = merge_round(state, args.k_neighbors)
            stats["centres"] = len(state["kepler"])
            print(
                f"merge factor {factor}: output centres {stats['centres']}, "
                f"median D_H {stats['median_dh']:.6g}, p95 {stats['p95_dh']:.6g}",
                flush=True,
            )
            if factor >= args.start_factor:
                levels.append(factor)
                stats_by_level[factor] = stats
                write_level(out.create_group(f"merge_factor_{factor}"), state, stats)

    radiant_png = report_path.parent / "maarsy_dataset_jopek_dh_radiants.png"
    orbit_png = report_path.parent / "maarsy_dataset_jopek_dh_orbits.png"
    radiant_stats = plot_radiants(
        state["kepler"],
        state["kepler_epoch_unix_second"],
        state["n_members"],
        radiant_png,
    )
    plot_orbital_summary(state, orbit_png)
    write_report(report_path, input_path, output_path, levels, stats_by_level, state, radiant_stats, radiant_png, orbit_png)
    print(f"wrote {output_path}")
    print(f"wrote {report_path}")


if __name__ == "__main__":
    main()
