"use strict";

const DEG = Math.PI / 180;
const MU = 0.00029592115654562346;

const FIELD = {
  A: 0,
  E: 1,
  I: 2,
  OMEGA: 3,
  NODE: 4,
  NU: 5,
  MASS_TO_AREA: 6,
  Q: -1,
};

function keplerPositionFromTable(dataTable, stride, row, tDay, maxRadius) {
  const a = dataTable[row + FIELD.A];
  const e = dataTable[row + FIELD.E];
  const inc = dataTable[row + FIELD.I] * DEG;
  const argp = dataTable[row + FIELD.OMEGA] * DEG;
  const node = dataTable[row + FIELD.NODE] * DEG;
  const nu0 = dataTable[row + FIELD.NU] * DEG;
  const dt = tDay;
  const absA = Math.max(Math.abs(a), 1e-6);
  const cosNu0 = Math.cos(nu0);
  const sinNu0 = Math.sin(nu0);
  let xpf;
  let ypf;

  if (e < 0.999) {
    const root = Math.sqrt(Math.max(1 - e * e, 0));
    const E0 = Math.atan2(root * sinNu0, e + cosNu0);
    let M = E0 - e * Math.sin(E0) + Math.sqrt(MU / (absA * absA * absA)) * dt;
    M = ((((M + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    let E = e < 0.8 ? M : (M < 0 ? -Math.PI : Math.PI);
    for (let k = 0; k < 16; k++) {
      const delta = (E - e * Math.sin(E) - M) / Math.max(1 - e * Math.cos(E), 1e-12);
      E -= delta;
      if (Math.abs(delta) < 1e-13) break;
    }
    xpf = absA * (Math.cos(E) - e);
    ypf = absA * root * Math.sin(E);
  } else if (e > 1.001) {
    const denom0 = Math.max(1 + e * cosNu0, 1e-6);
    const sinhH0 = Math.sqrt(Math.max(e * e - 1, 0)) * sinNu0 / denom0;
    const H0 = Math.log(sinhH0 + Math.sqrt(sinhH0 * sinhH0 + 1));
    let M = e * Math.sinh(H0) - H0 + Math.sqrt(MU / (absA * absA * absA)) * dt;
    let H = Math.asinh(M / Math.max(e, 1.001));
    for (let k = 0; k < 16; k++) {
      const f = e * Math.sinh(H) - H - M;
      const fp = e * Math.cosh(H) - 1;
      H -= f / Math.max(fp, 1e-12);
    }
    xpf = absA * (e - Math.cosh(H));
    ypf = absA * Math.sqrt(Math.max(e * e - 1, 0)) * Math.sinh(H);
  } else {
    return null;
  }

  const co = Math.cos(node);
  const so = Math.sin(node);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const cw = Math.cos(argp);
  const sw = Math.sin(argp);
  const x = (co * cw - so * sw * ci) * xpf + (-co * sw - so * cw * ci) * ypf;
  const y = (so * cw + co * sw * ci) * xpf + (-so * sw + co * cw * ci) * ypf;
  const z = sw * si * xpf + cw * si * ypf;
  if (!Number.isFinite(x + y + z) || Math.hypot(x, y, z) > maxRadius) return null;
  return [x, y, z];
}

function segmentIsContinuous(a, b, maxRadius, trailDays, segmentCount) {
  if (!a || !b) return false;
  const jump = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const perSegmentLimit = Math.max(0.25, (2 * maxRadius * 1.1) / Math.max(8, segmentCount));
  const speedLimit = Math.max(0.25, trailDays * 0.04);
  return jump <= Math.min(maxRadius * 0.75, Math.max(perSegmentLimit, speedLimit));
}

function buildCumulativeWeights(indices, dataTable, stride, memberField = null) {
  const cumulative = new Float64Array(indices.length);
  let total = 0;
  for (let i = 0; i < indices.length; i++) {
    const row = indices[i] * stride;
    const members = memberField == null ? 1 : dataTable[row + memberField];
    total += Number.isFinite(members) && members > 0 ? members : 1;
    cumulative[i] = total;
  }
  return { cumulative, total };
}

function weightedChoice(indices, cumulative, total, randomValue) {
  if (!indices.length || total <= 0) return null;
  const target = Math.max(0, Math.min(total - Number.EPSILON, randomValue * total));
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (target < cumulative[mid]) hi = mid;
    else lo = mid + 1;
  }
  return indices[lo];
}

module.exports = {
  FIELD,
  buildCumulativeWeights,
  keplerPositionFromTable,
  segmentIsContinuous,
  weightedChoice,
};
