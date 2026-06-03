"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

test("matching meteoroids are cloned with fresh orbital phases when fewer than requested", () => {
  const result = runAppHelperCheck(`
    const oldRandom = Math.random;
    const values = [0.1, 0.25, 0.2, 0.4, 0.3, 0.6, 0.4, 0.8];
    Math.random = () => values.shift() ?? 0.5;
    try {
      metadata = { chunks: [{ count: 1 }] };
      meteorCount = 4;
      drawLimitEl.value = "4";
      activeSlots = [{
        meteor: { record: new Float32Array([1, 0.1, 2, 3, 4, 5, 6]), meanAnomalyOffset: 0 },
        startedAt: -1,
        expiresAt: 1,
      }];
      duplicateActiveSlotsToDrawCount(10, -1);
      ({
        count: activeSlots.length,
        uniqueRecords: activeSlots.every((slot, index) => index === 0 || slot.meteor.record !== activeSlots[0].meteor.record),
        offsets: activeSlots.slice(1).map((slot) => slot.meteor.meanAnomalyOffset),
      });
    } finally {
      Math.random = oldRandom;
    }
  `);
  assert.equal(result.count, 4);
  assert.equal(result.uniqueRecords, true);
  assert.equal(result.offsets.length, 3);
  assert.ok(result.offsets.every((offset) => offset > 0), `expected randomized offsets, got ${result.offsets}`);
});
