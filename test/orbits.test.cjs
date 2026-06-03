"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { FIELD, buildCumulativeWeights, keplerPositionFromTable, segmentIsContinuous, weightedChoice } = require("../web/orbits.cjs");

const STRIDE = 10;

function row(values) {
  const table = new Float32Array(STRIDE);
  table[FIELD.A] = values.a;
  table[FIELD.E] = values.e;
  table[FIELD.I] = values.i || 0;
  table[FIELD.OMEGA] = values.omega || 0;
  table[FIELD.NODE] = values.node || 0;
  table[FIELD.NU] = values.nu || 0;
  table[FIELD.EPOCH_DAY] = values.epoch || 0;
  return table;
}

function loadBrowserCatalogue() {
  const root = path.resolve(__dirname, "..");
  const meta = JSON.parse(fs.readFileSync(path.join(root, "web/data/merge_factor_16.json"), "utf8"));
  const raw = fs.readFileSync(path.join(root, "web/data/merge_factor_16.bin"));
  const table = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  return { root, meta, table, stride: meta.recordFloat32Count, count: meta.count };
}

function keplerRow(table, rowOffset) {
  return Array.from(table.slice(rowOffset, rowOffset + 6));
}

function runAppHelperCheck(source) {
  const root = path.resolve(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "web/app.js"), "utf8").replace(/\nmain\(\)\.catch\([\s\S]*$/, "");
  const stub = {
    addEventListener() {},
    append() {},
    setAttribute() {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    value: "",
    textContent: "",
    innerHTML: "",
    min: "0",
    max: "100",
  };
  const document = {
    querySelector(selector) {
      if (selector === "#radius") return { ...stub, value: "85" };
      if (selector.startsWith("[data-filter-value=")) return { ...stub };
      return { ...stub };
    },
    createElement() {
      return { ...stub };
    },
  };
  return vm.runInNewContext(`${app}\n${source}`, {
    Array,
    Float32Array,
    Map,
    Math,
    Number,
    Uint8Array,
    Uint16Array,
    document,
    performance: { now() { return 0; } },
    requestAnimationFrame() {},
    window: { METEOR_SHOWER_PRESETS: [] },
  });
}

test("elliptic orbit propagation remains continuous over a one month trail", () => {
  const table = row({ a: 1.4, e: 0.35, i: 28, omega: 70, node: 110, nu: 15 });
  let prev = null;
  for (let t = 0; t <= 30; t += 1) {
    const pos = keplerPositionFromTable(table, STRIDE, 0, t, 10);
    assert.ok(pos, `position exists at day ${t}`);
    if (prev) {
      assert.ok(segmentIsContinuous(prev, pos, 10, 30, 16), `continuous at day ${t}`);
    }
    prev = pos;
  }
});

test("hyperbolic orbit propagation does not emit non-finite positions", () => {
  const table = row({ a: 2.0, e: 1.2, i: 65, omega: 130, node: 250, nu: 20 });
  for (let t = -15; t <= 30; t += 1) {
    const pos = keplerPositionFromTable(table, STRIDE, 0, t, 100);
    if (!pos) continue;
    assert.ok(pos.every(Number.isFinite), `finite at day ${t}`);
  }
});

test("continuity guard rejects disturbing cross-screen jumps", () => {
  assert.equal(segmentIsContinuous([0, 0, 0], [9, 0, 0], 10, 30, 16), false);
  assert.equal(segmentIsContinuous([0, 0, 0], [0.2, 0.1, 0], 10, 30, 16), true);
});

test("newly selected meteors do not draw pre-selection trail segments", () => {
  const table = row({ a: 1.0, e: 0.1, i: 5, omega: 30, node: 40, nu: 0 });
  const startedAt = 10;
  const animationTime = 12;
  const trailDays = 30;
  const segmentCount = 16;
  let drawable = 0;
  for (let s = 1; s < segmentCount; s++) {
    const phase0 = (s - 1) / (segmentCount - 1);
    const phase1 = s / (segmentCount - 1);
    const t0 = animationTime - (1 - phase0) * trailDays;
    const t1 = animationTime - (1 - phase1) * trailDays;
    const a = t0 >= startedAt ? keplerPositionFromTable(table, STRIDE, 0, t0, 10) : null;
    const b = t1 >= startedAt ? keplerPositionFromTable(table, STRIDE, 0, t1, 10) : null;
    if (segmentIsContinuous(a, b, 10, trailDays, segmentCount)) drawable += 1;
  }
  assert.ok(drawable < segmentCount - 1, "pre-selection trail is forgotten");
  assert.ok(drawable > 0, "new trail starts growing after selection");
});

test("representative meteor sampling is weighted by merged member count", () => {
  const table = new Float32Array(3 * STRIDE);
  table[FIELD.MEMBERS] = 1;
  table[STRIDE + FIELD.MEMBERS] = 16;
  table[2 * STRIDE + FIELD.MEMBERS] = 3;
  const indices = [0, 1, 2];
  const { cumulative, total } = buildCumulativeWeights(indices, table, STRIDE);
  assert.deepEqual(Array.from(cumulative), [1, 17, 20]);
  assert.equal(total, 20);
  assert.equal(weightedChoice(indices, cumulative, total, 0.00), 0);
  assert.equal(weightedChoice(indices, cumulative, total, 0.05), 1);
  assert.equal(weightedChoice(indices, cumulative, total, 0.84), 1);
  assert.equal(weightedChoice(indices, cumulative, total, 0.86), 2);
});

test("meteor shower inclination presets with min/max are applied as angle limits", () => {
  const range = runAppHelperCheck(`
    const param = FILTER_PARAMS.find((item) => item.key === "i_deg");
    filters.set(param.key, defaultFilterRange(param));
    setFilterRange(param, { min: 160.9, max: 168.1 });
    filters.get(param.key);
  `);
  assert.equal(range.center, 164.5);
  assert.ok(Math.abs(range.extent - 7.2) < 1e-12, `unexpected extent ${range.extent}`);
});

test("JavaScript Kepler propagation matches pyorb on sampled catalogue rows", () => {
  const { root, table, stride, count } = loadBrowserCatalogue();
  const times = [-30, -15, -3, 0, 3, 15, 30];
  const rows = [];
  const step = Math.max(1, Math.floor(count / 1536));
  for (let i = 0; i < count; i += step) {
    const rowOffset = i * stride;
    const e = table[rowOffset + FIELD.E];
    if (Math.abs(e - 1) <= 1e-3) continue;
    rows.push({ index: i, kep: keplerRow(table, rowOffset), epochDay: table[rowOffset + FIELD.EPOCH_DAY] });
  }
  const py = spawnSync("python", [path.join(root, "test/pyorb_reference.py")], {
    input: JSON.stringify({ times, rows }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(py.status, 0, py.stderr || py.stdout);
  const reference = JSON.parse(py.stdout);
  let compared = 0;
  for (let r = 0; r < rows.length; r++) {
    const rowOffset = rows[r].index * stride;
    for (let t = 0; t < times.length; t++) {
      const expected = reference[r][t];
      if (!expected) continue;
      const actual = keplerPositionFromTable(table, stride, rowOffset, times[t], 1e6);
      assert.ok(actual, `JS returned null for row=${rows[r].index} t=${times[t]} kep=${rows[r].kep.join(",")}`);
      const err = Math.hypot(actual[0] - expected[0], actual[1] - expected[1], actual[2] - expected[2]);
      assert.ok(
        err < 1e-6,
        `JS/pyorb mismatch row=${rows[r].index} t=${times[t]} err=${err} ` +
          `js=[${actual.map((v) => v.toPrecision(10)).join(",")}] pyorb=[${expected.map((v) => v.toPrecision(10)).join(",")}] ` +
          `kep=[${rows[r].kep.map((v) => v.toPrecision(10)).join(",")}]`
      );
      compared += 1;
    }
  }
  assert.ok(compared > 5000, `too few pyorb comparisons: ${compared}`);
});

test("exported browser catalogue does not draw unsafe trail jumps", () => {
  const { table, stride, count } = loadBrowserCatalogue();
  const segmentCount = 16;
  const trailDays = 30;
  const maxRadius = 100;
  const step = 1;
  let suppressed = 0;
  let compared = 0;

  for (let i = 0; i < count; i += step) {
    const rowOffset = i * stride;
    let prev = null;
    for (let s = 0; s < segmentCount; s++) {
      const t = (s / (segmentCount - 1)) * trailDays;
      const pos = keplerPositionFromTable(table, stride, rowOffset, t, maxRadius);
      if (prev && pos) {
        compared += 1;
        const jump = Math.hypot(pos[0] - prev[0], pos[1] - prev[1], pos[2] - prev[2]);
        if (!segmentIsContinuous(prev, pos, maxRadius, trailDays, segmentCount)) {
          suppressed += 1;
        } else {
          assert.ok(
            jump <= Math.max(0.25, (2 * maxRadius * 1.1) / segmentCount),
            `guard allowed a long drawn segment row=${i} segment=${s} jump=${jump.toFixed(3)} ` +
              `kep=[${Array.from(table.slice(rowOffset, rowOffset + 6)).map((v) => v.toFixed(6)).join(", ")}]`
          );
        }
      }
      prev = pos;
    }
  }
  assert.ok(compared > 500000, `too few trail segments checked: ${compared}`);
  assert.ok(suppressed >= 0);
});
