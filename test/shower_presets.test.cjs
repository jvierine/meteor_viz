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
