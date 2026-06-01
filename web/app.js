"use strict";

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
const COLOR_PARAMS = [
  ["a_au", "a (AU)", FIELD.A, "AU"],
  ["e", "Eccentricity", FIELD.E, ""],
  ["i_deg", "i (°)", FIELD.I, "°"],
  ["omega_deg", "ω (°)", FIELD.OMEGA, "°"],
  ["Omega_deg", "Ω (°)", FIELD.NODE, "°"],
  ["q_au", "q (AU)", FIELD.Q, "AU"],
  ["log10_mass_to_area_kg_per_m2", "log₁₀(m/A) (kg·m⁻²)", FIELD.MASS_TO_AREA, "log₁₀(kg·m⁻²)", [-2, 0]],
];
const FILTER_PARAMS = [
  { key: "a_au", label: "a (AU)", field: FIELD.A, type: "range", min: 0, max: 100, step: 0.5, unit: "AU" },
  { key: "e", label: "e", field: FIELD.E, type: "range", min: 0, max: 1, step: 0.01, unit: "" },
  { key: "i_deg", label: "i (°)", field: FIELD.I, type: "angle", min: 0, max: 180, center: 90, extent: 180, step: 1, unit: "°", wrap: false },
  { key: "omega_deg", label: "ω (°)", field: FIELD.OMEGA, type: "angle", min: 0, max: 360, center: 180, extent: 360, step: 1, unit: "°", wrap: true },
  { key: "Omega_deg", label: "Ω (°)", field: FIELD.NODE, type: "angle", min: 0, max: 360, center: 180, extent: 360, step: 1, unit: "°", wrap: true },
  { key: "q_au", label: "q (AU)", field: FIELD.Q, type: "range", min: 0, max: 100, step: 0.5, unit: "AU" },
];

const canvas = document.querySelector("#scene");
const panelEl = document.querySelector(".panel");
const statusEl = document.querySelector("#status");
const countEl = document.querySelector("#count");
const colorParamEl = document.querySelector("#colorParam");
const speedEl = document.querySelector("#speed");
const trailEl = document.querySelector("#trail");
const cycleDaysEl = document.querySelector("#cycleDays");
const drawLimitEl = document.querySelector("#drawLimit");
const alphaEl = document.querySelector("#alpha");
const starVisibilityEl = document.querySelector("#starVisibility");
const planetSizeEl = document.querySelector("#planetSize");
const radiusEl = document.querySelector("#radius");
const randomizeMeanAnomalyEl = document.querySelector("#randomizeMeanAnomaly");
const showEarthOrbitBlipsEl = document.querySelector("#showEarthOrbitBlips");
const filterControlsEl = document.querySelector("#filterControls");
const showerPresetEl = document.querySelector("#showerPreset");
const playPauseEl = document.querySelector("#playPause");
const resetViewEl = document.querySelector("#resetView");
const musicToggleEl = document.querySelector("#musicToggle");
const compactToggleEl = document.querySelector("#compactToggle");
const timeReadoutEl = document.querySelector("#timeReadout");
const axisReadoutEl = document.querySelector("#axisReadout");
const rangeReadoutEl = document.querySelector("#rangeReadout");
const visibleCountEl = document.querySelector("#visibleCount");
const drawnCountEl = document.querySelector("#drawnCount");
const legendMinEl = document.querySelector("#legendMin");
const legendMaxEl = document.querySelector("#legendMax");
const sliderReadouts = [
  { el: speedEl, valueEl: document.querySelector("#speedValue"), unit: "d·s⁻¹", decimals: 0 },
  { el: trailEl, valueEl: document.querySelector("#trailValue"), unit: "d", decimals: 0 },
  { el: cycleDaysEl, valueEl: document.querySelector("#cycleDaysValue"), unit: "d", decimals: 0 },
  { el: drawLimitEl, valueEl: document.querySelector("#drawLimitValue"), unit: "", decimals: 0 },
  { el: alphaEl, valueEl: document.querySelector("#alphaValue"), unit: "x", decimals: 2 },
  { el: starVisibilityEl, valueEl: document.querySelector("#starVisibilityValue"), unit: "x", decimals: 2 },
  { el: planetSizeEl, valueEl: document.querySelector("#planetSizeValue"), unit: "px", decimals: 0 },
  { el: radiusEl, valueEl: document.querySelector("#radiusValue"), unit: "AU", decimals: 0 },
];

const DEG = Math.PI / 180;
const MU = 0.00029592115654562346;
const DEFAULT_AXIS_LIMIT_AU = 85;

let gl;
let program;
let guideBuffer;
let trailPositionBuffer;
let trailColorBuffer;
let blipPositionBuffer;
let blipColorBuffer;
let planetOrbitPositionBuffer;
let planetOrbitColorBuffer;
let planetPointPositionBuffer;
let planetPointColorBuffer;
let sunPointPositionBuffer;
let sunPointColorBuffer;
let starPositionBuffer;
let starColorBuffer;
let dataTable;
let starTable;
let metadata;
let starMetadata;
let meteorCount = 0;
let chunkMeteorCount = 0;
let activeChunkIndex = -1;
let nextChunkIndex = 0;
let chunkSearchPromise = null;
let chunkSearchGeneration = 0;
let chunksSearchedForFilter = 0;
let starCount = 0;
let stride = 0;
let starStride = 0;
let segmentCount = 16;
let trailPositions;
let trailColors;
let blipPositions;
let blipColors;
let planetOrbitPositions;
let planetOrbitColors;
let planetPointPositions;
let planetPointColors;
let sunPointPositions;
let sunPointColors;
let starPositions;
let starColors;
let meteorColors;
let animationTimeDay = 0;
let previousFrameMs = performance.now();
let paused = false;
let colorRange = [0, 1];
let trailVertexCount = 0;
let trailDrawVertexCount = 0;
let blipPointCount = 0;
let planetOrbitVertexCount = 0;
let planetPointCount = 0;
let guideLineVertexCount = 0;
let guidePointStart = 0;
let visibleMeteorCount = 0;
const MAX_DRAWN_METEORS = 20000;
let activeSlots = [];
let candidateIndices = [];
let matchingMeteorCount = 0;
let lastFilterSignature = "";
let audioContext = null;
let musicMaster = null;
let musicDelay = null;
let musicFeedback = null;
let musicFilter = null;
let musicTimer = null;
let musicStep = 0;
const filters = new Map();

const camera = { yaw: 0.78, pitch: 0.36, roll: 0, distance: 153 };
const pointer = { active: false, button: 0, x: 0, y: 0 };

const J2000_UNIX_SECOND = 946728000;
const PLANET_ORBIT_STEPS = 240;
const SUN_POINT_SIZE_PX = 7;
const EARTH_ORBIT_BLIP_DISTANCE_AU = 0.1;
const BLIP_POINT_SIZE_PX = 13;
const STAR_RADIUS = 80;
const STAR_POINT_SCALE = 1.15;
const STAR_LIMITING_MAG = 8.0;
const J2000_OBLIQUITY = 23.4392911 * Math.PI / 180;
const PLANETS = [
  { name: "Mercury", a: 0.38709893, e: 0.20563069, i: 7.00487, L: 252.25084, peri: 77.45645, node: 48.33167, color: [0.78, 0.72, 0.62] },
  { name: "Venus", a: 0.72333199, e: 0.00677323, i: 3.39471, L: 181.97973, peri: 131.53298, node: 76.68069, color: [1.0, 0.78, 0.42] },
  { name: "Earth", a: 1.00000011, e: 0.01671022, i: 0.00005, L: 100.46435, peri: 102.94719, node: -11.26064, color: [0.3, 0.66, 1.0] },
  { name: "Mars", a: 1.52366231, e: 0.09341233, i: 1.85061, L: -4.56813, peri: -23.94363, node: 49.57854, color: [1.0, 0.36, 0.22] },
  { name: "Jupiter", a: 5.20336301, e: 0.04839266, i: 1.3053, L: 34.40438, peri: 14.75385, node: 100.55615, color: [0.95, 0.72, 0.52] },
  { name: "Saturn", a: 9.53707032, e: 0.0541506, i: 2.48446, L: 49.94432, peri: 92.43194, node: 113.71504, color: [0.95, 0.84, 0.55] },
  { name: "Uranus", a: 19.19126393, e: 0.04716771, i: 0.76986, L: 313.23218, peri: 170.96424, node: 74.22988, color: [0.55, 0.93, 0.95] },
  { name: "Neptune", a: 30.06896348, e: 0.00858587, i: 1.76917, L: -55.12003, peri: 44.97135, node: 131.72169, color: [0.32, 0.48, 1.0] },
];

const vertexSource = `#version 300 es
in vec3 aPosition;
in vec4 aColor;
uniform mat4 uProjection;
uniform mat4 uView;
uniform float uPointSize;
uniform float uAlphaScale;
uniform bool uStarMode;
out vec4 vColor;
out float vStarMag;
out float vStarAlpha;
void main() {
  vColor = vec4(aColor.rgb, aColor.a * uAlphaScale);
  vStarMag = aColor.a;
  vStarAlpha = clamp(0.18 + 0.82 * (${STAR_LIMITING_MAG.toFixed(1)} - aColor.a + 0.5) / max(1.0, ${STAR_LIMITING_MAG.toFixed(1)} + 1.0), 0.16, 1.0);
  gl_Position = uProjection * uView * vec4(aPosition, 1.0);
  if (uStarMode) {
    float size = 2.4 + 12.5 * pow(10.0, -0.13 * (aColor.a + 1.0));
    gl_PointSize = clamp(size * uPointSize, 2.5, 26.0 * uPointSize);
  } else {
    gl_PointSize = uPointSize;
  }
}`;

const fragmentSource = `#version 300 es
precision highp float;
uniform bool uPointMode;
uniform bool uSoftPoint;
uniform bool uStarMode;
uniform float uAlphaScale;
in vec4 vColor;
in float vStarMag;
in float vStarAlpha;
out vec4 outColor;
void main() {
  float alpha = vColor.a;
  if (uPointMode) {
    vec2 p = gl_PointCoord - vec2(0.5);
    if (uStarMode) {
      float r = length(p);
      if (r > 0.5) discard;
      float core = exp(-r * r / 0.010);
      float halo = exp(-r * r / 0.085);
      float edge = smoothstep(0.5, 0.42, r);
      alpha = clamp(2.30 * core + 0.84 * halo, 0.0, 1.0) * edge * vStarAlpha * uAlphaScale;
      vec3 coolWhite = vec3(0.78, 0.88, 1.0);
      vec3 warmWhite = vec3(1.0, 0.96, 0.84);
      vec3 color = mix(warmWhite, coolWhite, clamp((2.5 - vStarMag) / 4.0, 0.0, 1.0));
      outColor = vec4(min(color * 2.0, vec3(1.0)), alpha);
      return;
    } else {
      float r = length(p) * 2.0;
      if (r > 1.0) discard;
      if (uSoftPoint) {
        float core = exp(-1.45 * r * r);
        float halo = exp(-0.28 * r * r) * 0.48;
        alpha *= min(1.0, core + halo);
      }
    }
  }
  outColor = vec4(vColor.rgb, alpha);
}`;

function createShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const kind = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
    throw new Error(`${kind} shader compile failed: ${gl.getShaderInfoLog(shader) || "no compiler log"}`);
  }
  return shader;
}

function createProgram() {
  const p = gl.createProgram();
  gl.attachShader(p, createShader(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(p, createShader(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || "Program link failed");
  }
  return p;
}

function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function rotateAround(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot(axis, v);
  const cr = cross(axis, v);
  return [
    v[0] * c + cr[0] * s + axis[0] * d * (1 - c),
    v[1] * c + cr[1] * s + axis[1] * d * (1 - c),
    v[2] * c + cr[2] * s + axis[2] * d * (1 - c),
  ];
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function lookAt(eye, center, up) {
  const z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0];
  m[1] = y[0];
  m[2] = z[0];
  m[4] = x[1];
  m[5] = y[1];
  m[6] = z[1];
  m[8] = x[2];
  m[9] = y[2];
  m[10] = z[2];
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  m[15] = 1;
  return m;
}

function matrices() {
  const axisLimit = Number(radiusEl.value);
  camera.distance = Math.max(camera.distance, Math.max(0.08, axisLimit * 0.01));
  const cp = Math.cos(camera.pitch);
  const eye = [
    camera.distance * cp * Math.cos(camera.yaw),
    camera.distance * cp * Math.sin(camera.yaw),
    camera.distance * Math.sin(camera.pitch),
  ];
  const forward = normalize([-eye[0], -eye[1], -eye[2]]);
  let up = Math.abs(dot(forward, [0, 0, 1])) > 0.96 ? [0, 1, 0] : [0, 0, 1];
  up = rotateAround(up, forward, camera.roll);
  return {
    projection: perspective((45 * Math.PI) / 180, canvas.width / canvas.height, 0.01, Math.max(200, axisLimit * 8)),
    view: lookAt(eye, [0, 0, 0], up),
  };
}

function skyViewMatrix(view) {
  const out = new Float32Array(view);
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  return out;
}

function turbo(x) {
  x = Math.max(0, Math.min(1, x));
  const r = 0.13572138 + x * (4.6153926 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))));
  const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))));
  const b = 0.1066733 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))));
  return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
}

function percentile(values, q) {
  const finite = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return 0;
  return finite[Math.floor(q * (finite.length - 1))];
}

function unitHtml(unit) {
  return String(unit)
    .replace(/\^(-?\d+)/g, "<sup>$1</sup>")
    .replace(/⁻/g, "<sup>-")
    .replace(/¹/g, "1</sup>")
    .replace(/²/g, "2</sup>")
    .replace(/³/g, "3</sup>");
}

function formatValue(value, unit) {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  const text = abs >= 1000 || abs < 0.01 ? value.toExponential(2) : value.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2);
  return unit ? `${text} ${unit}` : text;
}

function formatValueHtml(value, unit) {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  const text = abs >= 1000 || abs < 0.01 ? value.toExponential(2) : value.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2);
  return unit ? `${text} ${unitHtml(unit)}` : text;
}

function formatSliderValue(item) {
  const value = Number(item.el.value);
  const fixed = value.toFixed(item.decimals);
  const text = item.decimals > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
  return item.unit ? `${text} ${item.unit}` : text;
}

function updateSliderReadouts() {
  for (const item of sliderReadouts) {
    if (item.valueEl) item.valueEl.textContent = formatSliderValue(item);
  }
}

function selectedParam() {
  return COLOR_PARAMS.find((p) => p[0] === colorParamEl.value) || COLOR_PARAMS[0];
}

function perihelionDistanceFromRecord(record) {
  const a = Math.abs(record[FIELD.A]);
  const e = record[FIELD.E];
  return Math.max(e <= 1 ? a * (1 - e) : a * (e - 1), 1e-12);
}

function recordValue(record, field) {
  if (field === FIELD.Q) return perihelionDistanceFromRecord(record);
  return record[field];
}

function valueForField(row, field) {
  if (field === FIELD.Q) {
    const a = Math.abs(dataTable[row + FIELD.A]);
    const e = dataTable[row + FIELD.E];
    return Math.max(e <= 1 ? a * (1 - e) : a * (e - 1), 1e-12);
  }
  return dataTable[row + field];
}

function angularDistanceDeg(value, center) {
  return Math.abs((((value - center + 540) % 360) + 360) % 360 - 180);
}

function passesFilters(row) {
  for (const param of FILTER_PARAMS) {
    const range = filters.get(param.key);
    const value = valueForField(row, param.field);
    if (!Number.isFinite(value)) return false;
    if (param.type === "angle") {
      const distance = param.wrap ? angularDistanceDeg(value, range.center) : Math.abs(value - range.center);
      if (distance > range.extent * 0.5) return false;
    } else if (value < range.min || value > range.max) {
      return false;
    }
  }
  return true;
}

function displayFilterValue(value, unit) {
  const decimals = unit === "AU" || unit === "km·s⁻¹" ? 1 : unit === "" ? 2 : 0;
  return `${Number(value).toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
}

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function defaultFilterRange(param) {
  return param.type === "angle" ? { center: param.center, extent: param.extent } : { min: param.min, max: param.max };
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function setAxisLimit(value, fitCamera = false) {
  const min = Number(radiusEl.min);
  const max = Number(radiusEl.max);
  const requested = Number(value);
  const axisLimit = Number.isFinite(requested) ? Math.max(min, Math.min(max, Math.round(requested))) : DEFAULT_AXIS_LIMIT_AU;
  radiusEl.value = axisLimit;
  updateSliderReadouts();
  if (fitCamera) camera.distance = Math.max(0.5, axisLimit * 1.35);
}

function axisLimitForPreset(preset) {
  const presetFilters = preset && preset.filters && typeof preset.filters === "object" ? preset.filters : {};
  const aMax = finiteNumber(presetFilters.a_au && presetFilters.a_au.max);
  const eMax = finiteNumber(presetFilters.e && presetFilters.e.max);
  const qMax = finiteNumber(presetFilters.q_au && presetFilters.q_au.max);
  const candidates = [];

  if (aMax !== null && eMax !== null) candidates.push(Math.abs(aMax) * (1 + Math.max(0, Math.min(1, eMax))));
  if (aMax !== null) candidates.push(Math.abs(aMax) * 1.3);
  if (qMax !== null) candidates.push(qMax * 3);
  if (qMax !== null && eMax !== null && eMax < 0.985) candidates.push((qMax * (1 + eMax)) / Math.max(0.015, 1 - eMax));

  const outerDistance = Math.max(...candidates.filter((candidate) => Number.isFinite(candidate) && candidate > 0));
  if (!Number.isFinite(outerDistance)) return DEFAULT_AXIS_LIMIT_AU;
  return Math.max(4, Math.min(100, outerDistance * 1.18));
}

function updateFilterReadout(param) {
  const range = filters.get(param.key);
  const valueEl = document.querySelector(`[data-filter-value="${param.key}"]`);
  if (!valueEl) return;
  if (param.type === "angle") {
    valueEl.textContent = `${displayFilterValue(range.center, param.unit)} ± ${displayFilterValue(range.extent * 0.5, param.unit)}`;
  } else {
    valueEl.textContent = `${displayFilterValue(range.min, param.unit)} - ${displayFilterValue(range.max, param.unit)}`;
  }
}

function syncFilterInputs(param) {
  const range = filters.get(param.key);
  for (const key of Object.keys(range)) {
    const el = document.querySelector(`[data-filter="${param.key}"][data-side="${key}"]`);
    if (el) el.value = range[key];
  }
  updateFilterReadout(param);
}

function setFilterValue(param, side, value) {
  const range = filters.get(param.key);
  range[side] = finiteOr(value, range[side]);
  if (param.type === "range" && range.min > range.max) {
    if (side === "min") range.max = range.min;
    else range.min = range.max;
  }
  syncFilterInputs(param);
}

function setFilterRange(param, presetRange) {
  const range = defaultFilterRange(param);
  if (!presetRange) {
    filters.set(param.key, range);
    syncFilterInputs(param);
    return;
  }
  if (param.type === "angle") {
    let center = Number(presetRange.center);
    let extent = Number(presetRange.extent);
    const min = Number(presetRange.min);
    const max = Number(presetRange.max);
    if ((!Number.isFinite(center) || !Number.isFinite(extent)) && Number.isFinite(min) && Number.isFinite(max)) {
      center = (min + max) * 0.5;
      extent = Math.abs(max - min);
    }
    if (Number.isFinite(center) && Number.isFinite(extent)) {
      range.center = Math.max(param.min, Math.min(param.max, center));
      range.extent = Math.max(0, Math.min(param.max - param.min, extent));
    }
  } else {
    const min = Number(presetRange.min);
    const max = Number(presetRange.max);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      range.min = Math.max(param.min, Math.min(param.max, min));
      range.max = Math.max(param.min, Math.min(param.max, max));
      if (range.min > range.max) [range.min, range.max] = [range.max, range.min];
    }
  }
  filters.set(param.key, range);
  syncFilterInputs(param);
}

function applyShowerPreset(presetId) {
  const preset = (window.METEOR_SHOWER_PRESETS || []).find((item) => item.id === presetId);
  for (const param of FILTER_PARAMS) setFilterRange(param, null);
  if (!preset) {
    colorParamEl.value = "i_deg";
    updateColors();
    setAxisLimit(DEFAULT_AXIS_LIMIT_AU, true);
  } else {
    colorParamEl.value = "log10_mass_to_area_kg_per_m2";
    updateColors();
    const presetFilters = preset.filters && typeof preset.filters === "object" ? preset.filters : {};
    for (const param of FILTER_PARAMS) setFilterRange(param, presetFilters[param.key]);
    setAxisLimit(axisLimitForPreset(preset), true);
  }
  lastFilterSignature = "";
}

function filterSignature(maxRadius) {
  const parts = [maxRadius.toFixed(2)];
  for (const param of FILTER_PARAMS) {
    const range = filters.get(param.key);
    if (param.type === "angle") parts.push(`${param.key}:${range.center}:${range.extent}`);
    else parts.push(`${param.key}:${range.min}:${range.max}`);
  }
  return parts.join("|");
}

function exponentialLifetime(meanDays) {
  return -meanDays * Math.log(Math.max(1e-9, 1 - Math.random()));
}

function desiredDrawCount() {
  const drawLimit = Math.min(MAX_DRAWN_METEORS, Math.max(1, Number(drawLimitEl.value)));
  return Math.min(drawLimit, meteorCount);
}

function randomCandidate() {
  if (!candidateIndices.length) return null;
  const slot = Math.floor(Math.random() * candidateIndices.length);
  const index = candidateIndices[slot];
  candidateIndices[slot] = candidateIndices[candidateIndices.length - 1];
  candidateIndices.pop();
  return index;
}

function sampledMeteorFromCurrentChunk() {
  const index = randomCandidate();
  if (index == null) return null;
  const row = index * stride;
  const record = dataTable.slice(row, row + stride);
  return {
    record,
    meanAnomalyOffset: randomizeMeanAnomalyEl.checked ? Math.random() * Math.PI * 2 : 0,
  };
}

function rebuildCandidatePool(maxRadius) {
  candidateIndices = [];
  for (let i = 0; i < chunkMeteorCount; i++) {
    const row = i * stride;
    if (!passesFilters(row)) continue;
    candidateIndices.push(i);
  }
  matchingMeteorCount += candidateIndices.length;
  visibleMeteorCount = matchingMeteorCount;
}

function fillActiveSlotsFromCurrentChunk(meanDays, startedAt) {
  const drawCount = desiredDrawCount();
  while (activeSlots.length < drawCount) {
    const meteor = sampledMeteorFromCurrentChunk();
    if (!meteor) break;
    activeSlots.push({
      meteor,
      startedAt,
      expiresAt: animationTimeDay + exponentialLifetime(meanDays),
    });
  }
}

async function searchChunksForMoreMeteors(meanDays, startedAt, generation) {
  if (chunkSearchPromise) return chunkSearchPromise;
  chunkSearchPromise = (async () => {
    while (generation === chunkSearchGeneration && activeSlots.length < desiredDrawCount() && chunksSearchedForFilter < metadata.chunks.length) {
      await loadCatalogChunk(nextChunkIndex, { updateStatus: false });
      if (generation !== chunkSearchGeneration) break;
      chunksSearchedForFilter += 1;
      rebuildCandidatePool(Number(radiusEl.value));
      fillActiveSlotsFromCurrentChunk(meanDays, startedAt);
    }
    if (generation === chunkSearchGeneration) {
      const count = activeSlots.length.toLocaleString();
      const requested = desiredDrawCount().toLocaleString();
      statusEl.textContent =
        activeSlots.length < desiredDrawCount()
          ? `Found ${count} meteoroids matching the current filters across all chunks.`
          : `Showing ${count} filtered meteoroids from streamed chunks.`;
    }
  })().finally(() => {
    chunkSearchPromise = null;
  });
  return chunkSearchPromise;
}

function requestMoreMatchingMeteors(meanDays, startedAt) {
  if (chunkSearchPromise || chunksSearchedForFilter >= metadata.chunks.length) return;
  searchChunksForMoreMeteors(meanDays, startedAt, chunkSearchGeneration).catch((error) => {
    console.error(error);
    statusEl.textContent = error.message;
  });
}

function resetActiveSlots() {
  activeSlots = [];
  matchingMeteorCount = 0;
  chunksSearchedForFilter = 0;
  candidateIndices = [];
  chunkSearchGeneration += 1;
}

function updateActiveSlots(meanDays) {
  const drawCount = desiredDrawCount();
  if (activeSlots.length > drawCount) activeSlots.length = drawCount;
  for (const slot of activeSlots) {
    if (animationTimeDay >= slot.expiresAt) {
      const meteor = sampledMeteorFromCurrentChunk();
      if (!meteor) {
        requestMoreMatchingMeteors(meanDays, animationTimeDay);
        continue;
      }
      slot.meteor = meteor;
      slot.startedAt = animationTimeDay;
      slot.expiresAt = animationTimeDay + exponentialLifetime(meanDays);
    }
  }
  if (activeSlots.length < drawCount) requestMoreMatchingMeteors(meanDays, animationTimeDay);
}

function midiToHz(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function createTone(frequency, startTime, duration, gain, type = "sine", detune = 0) {
  const osc = audioContext.createOscillator();
  const amp = audioContext.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);
  osc.detune.setValueAtTime(detune, startTime);
  amp.gain.setValueAtTime(0, startTime);
  amp.gain.linearRampToValueAtTime(gain, startTime + 0.08);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.58), startTime + duration * 0.45);
  amp.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(amp);
  amp.connect(musicFilter);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

function playAmbientStep() {
  if (!audioContext || !musicMaster) return;
  const now = audioContext.currentTime + 0.05;
  const progression = [
    [57, 64, 69, 76],
    [53, 60, 67, 72],
    [55, 62, 69, 74],
    [52, 59, 64, 71],
  ];
  const chord = progression[Math.floor(musicStep / 4) % progression.length];
  const beat = musicStep % 4;

  if (beat === 0) {
    for (const note of chord) {
      createTone(midiToHz(note), now, 7.6, 0.018, "sine", -4);
      createTone(midiToHz(note + 12), now + 0.04, 7.2, 0.007, "triangle", 5);
    }
  }

  const sparkle = chord[(musicStep * 2 + 1) % chord.length] + 24;
  createTone(midiToHz(sparkle), now + 0.08, 1.8, 0.012, "triangle", 0);
  if (musicStep % 2 === 1) createTone(midiToHz(sparkle + 7), now + 0.62, 1.35, 0.007, "sine", 0);
  musicStep += 1;
}

function startPlanetariumMusic() {
  if (musicTimer) return;
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    musicMaster = audioContext.createGain();
    musicFilter = audioContext.createBiquadFilter();
    musicDelay = audioContext.createDelay(8);
    musicFeedback = audioContext.createGain();

    musicMaster.gain.value = 0.16;
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = 2400;
    musicFilter.Q.value = 0.5;
    musicDelay.delayTime.value = 0.42;
    musicFeedback.gain.value = 0.28;

    musicFilter.connect(musicMaster);
    musicFilter.connect(musicDelay);
    musicDelay.connect(musicFeedback);
    musicFeedback.connect(musicDelay);
    musicDelay.connect(musicMaster);
    musicMaster.connect(audioContext.destination);
  }
  audioContext.resume();
  const now = audioContext.currentTime;
  musicMaster.gain.cancelScheduledValues(now);
  musicMaster.gain.setTargetAtTime(0.16, now, 0.6);
  musicStep = 0;
  playAmbientStep();
  musicTimer = window.setInterval(playAmbientStep, 1900);
  musicToggleEl.setAttribute("aria-pressed", "true");
  musicToggleEl.setAttribute("aria-label", "Stop planetarium music");
  musicToggleEl.classList.add("toggle-on");
}

function stopPlanetariumMusic() {
  if (musicTimer) window.clearInterval(musicTimer);
  musicTimer = null;
  if (musicMaster && audioContext) {
    const now = audioContext.currentTime;
    musicMaster.gain.cancelScheduledValues(now);
    musicMaster.gain.setTargetAtTime(0.0001, now, 0.7);
  }
  musicToggleEl.setAttribute("aria-pressed", "false");
  musicToggleEl.setAttribute("aria-label", "Play planetarium music");
  musicToggleEl.classList.remove("toggle-on");
}

function togglePlanetariumMusic() {
  if (musicTimer) stopPlanetariumMusic();
  else startPlanetariumMusic();
}

function setControlsCompact(compact) {
  panelEl.classList.toggle("compact", compact);
  compactToggleEl.textContent = compact ? "▸" : "▾";
  compactToggleEl.setAttribute("aria-expanded", String(!compact));
  compactToggleEl.setAttribute("aria-label", compact ? "Expand controls" : "Compact controls");
}

function planetElements(planet) {
  return {
    a: planet.a,
    e: planet.e,
    inc: planet.i * DEG,
    argp: ((planet.peri - planet.node) % 360) * DEG,
    node: planet.node * DEG,
    mean0: ((planet.L - planet.peri) % 360) * DEG,
  };
}

function positionFromElements(elements, meanAnomaly) {
  const { a, e, inc, argp, node } = elements;
  let M = ((meanAnomaly + Math.PI) % (2 * Math.PI)) - Math.PI;
  let E = M;
  for (let k = 0; k < 7; k++) E -= (E - e * Math.sin(E) - M) / Math.max(1 - e * Math.cos(E), 1e-6);

  const root = Math.sqrt(Math.max(1 - e * e, 0));
  const xpf = a * (Math.cos(E) - e);
  const ypf = a * root * Math.sin(E);
  const co = Math.cos(node);
  const so = Math.sin(node);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const cw = Math.cos(argp);
  const sw = Math.sin(argp);
  return [
    (co * cw - so * sw * ci) * xpf + (-co * sw - so * cw * ci) * ypf,
    (so * cw + co * sw * ci) * xpf + (-so * sw + co * cw * ci) * ypf,
    sw * si * xpf + cw * si * ypf,
  ];
}

function planetPosition(planet, tDay) {
  const elements = planetElements(planet);
  const meanMotion = Math.sqrt(MU / (elements.a * elements.a * elements.a));
  return positionFromElements(elements, elements.mean0 + meanMotion * tDay);
}

function starDirection(raHours, decDeg) {
  const ra = raHours * 15 * DEG;
  const dec = decDeg * DEG;
  const cd = Math.cos(dec);
  const xEq = cd * Math.cos(ra);
  const yEq = cd * Math.sin(ra);
  const zEq = Math.sin(dec);
  const ce = Math.cos(J2000_OBLIQUITY);
  const se = Math.sin(J2000_OBLIQUITY);
  return [
    xEq,
    ce * yEq + se * zEq,
    -se * yEq + ce * zEq,
  ];
}

function setupStarBuffers() {
  starCount = starMetadata.count;
  starStride = starMetadata.recordFloat32Count;
  starPositions = new Float32Array(starCount * 3);
  starColors = new Float32Array(starCount * 4);
  for (let i = 0; i < starCount; i++) {
    const row = i * starStride;
    const direction = starDirection(starTable[row], starTable[row + 1]);
    starPositions.set([direction[0] * STAR_RADIUS, direction[1] * STAR_RADIUS, direction[2] * STAR_RADIUS], i * 3);
    const mag = starTable[row + 2];
    starColors.set([1, 1, 1, mag], i * 4);
  }
  starPositionBuffer = gl.createBuffer();
  starColorBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, starPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, starPositions, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, starColorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, starColors, gl.STATIC_DRAW);
}

function column(index) {
  const out = new Float32Array(chunkMeteorCount);
  for (let i = 0; i < chunkMeteorCount; i++) out[i] = valueForField(i * stride, index);
  return out;
}

function updateColors() {
  const param = selectedParam();
  const values = column(param[2]);
  colorRange = param[4] ? param[4] : [percentile(values, 0.02), percentile(values, 0.98)];
  if (colorRange[0] === colorRange[1]) colorRange[1] = colorRange[0] + 1;
  meteorColors = new Float32Array(chunkMeteorCount * 3);
  for (let i = 0; i < chunkMeteorCount; i++) {
    const v = valueForField(i * stride, param[2]);
    const c = turbo((v - colorRange[0]) / (colorRange[1] - colorRange[0]));
    meteorColors.set(c, i * 3);
  }
  legendMinEl.innerHTML = formatValueHtml(colorRange[0], param[3]);
  legendMaxEl.innerHTML = formatValueHtml(colorRange[1], param[3]);
  rangeReadoutEl.innerHTML = `${formatValueHtml(colorRange[0], param[3])} - ${formatValueHtml(colorRange[1], param[3])}`;
}

function colorForRecord(record) {
  const param = selectedParam();
  const value = recordValue(record, param[2]);
  return turbo((value - colorRange[0]) / (colorRange[1] - colorRange[0]));
}

function keplerPosition(record, tDay, maxRadius, meanAnomalyOffset = 0) {
  const a = recordValue(record, FIELD.A);
  const e = recordValue(record, FIELD.E);
  const inc = recordValue(record, FIELD.I) * DEG;
  const argp = recordValue(record, FIELD.OMEGA) * DEG;
  const node = recordValue(record, FIELD.NODE) * DEG;
  const nu0 = recordValue(record, FIELD.NU) * DEG;
  const dt = tDay;
  const absA = Math.max(Math.abs(a), 1e-6);
  const cosNu0 = Math.cos(nu0);
  const sinNu0 = Math.sin(nu0);
  let xpf;
  let ypf;

  if (e < 0.999) {
    const root = Math.sqrt(Math.max(1 - e * e, 0));
    const E0 = Math.atan2(root * sinNu0, e + cosNu0);
    let M = E0 - e * Math.sin(E0) + meanAnomalyOffset + Math.sqrt(MU / (absA * absA * absA)) * dt;
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

function segmentIsContinuous(a, b, maxRadius, trailDays) {
  if (!a || !b) return false;
  const jump = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const perSegmentLimit = Math.max(0.25, (2 * maxRadius * 1.1) / Math.max(8, segmentCount));
  const speedLimit = Math.max(0.25, trailDays * 0.04);
  return jump <= Math.min(maxRadius * 0.75, Math.max(perSegmentLimit, speedLimit));
}

function solarDistanceAlpha(a, b) {
  const mx = (a[0] + b[0]) * 0.5;
  const my = (a[1] + b[1]) * 0.5;
  const mz = (a[2] + b[2]) * 0.5;
  return Math.min(4, Math.max(0.08, Math.hypot(mx, my, mz)));
}

function orbitalVelocityTailScale(record, tDay, maxRadius, meanAnomalyOffset) {
  const pos = keplerPosition(record, tDay, maxRadius, meanAnomalyOffset);
  if (!pos) return 1;
  const r = Math.max(1e-6, Math.hypot(pos[0], pos[1], pos[2]));
  const a = Math.max(1e-6, Math.abs(recordValue(record, FIELD.A)));
  const e = recordValue(record, FIELD.E);
  const speedSq = MU * (e > 1 ? 2 / r + 1 / a : 2 / r - 1 / a);
  const speed = Math.sqrt(Math.max(speedSq, 1e-10));
  const earthCircularSpeed = Math.sqrt(MU);
  return Math.min(24, Math.max(0.04, earthCircularSpeed / speed));
}

function distanceToEarthOrbit(pos) {
  const rho = Math.hypot(pos[0], pos[1]);
  return Math.hypot(rho - 1, pos[2]);
}

function rebuildGeometry() {
  const maxRadius = Number(radiusEl.value);
  const trailDays = Number(trailEl.value);
  const alphaScale = Number(alphaEl.value);
  const planetDay = (metadata.epochUnixSecond0 - J2000_UNIX_SECOND) / 86400 + animationTimeDay;
  const meanLifetimeDays = Math.max(1, Number(cycleDaysEl.value));
  const signature = filterSignature(maxRadius);
  const far = 1e6;
  let vp = 0;
  let vc = 0;
  let bp = 0;
  let bc = 0;
  blipPointCount = 0;

  if (signature !== lastFilterSignature) {
    resetActiveSlots();
    chunksSearchedForFilter = chunkMeteorCount > 0 ? 1 : 0;
    rebuildCandidatePool(maxRadius);
    fillActiveSlotsFromCurrentChunk(meanLifetimeDays, animationTimeDay - Number(trailEl.value));
    if (activeSlots.length < desiredDrawCount()) requestMoreMatchingMeteors(meanLifetimeDays, animationTimeDay);
    lastFilterSignature = signature;
  } else {
    updateActiveSlots(meanLifetimeDays);
  }

  for (const slot of activeSlots) {
    const record = slot.meteor.record;
    const meanAnomalyOffset = slot.meteor.meanAnomalyOffset || 0;
    const color = colorForRecord(record);
    const currentPos = showEarthOrbitBlipsEl.checked ? keplerPosition(record, animationTimeDay, maxRadius, meanAnomalyOffset) : null;
    if (showEarthOrbitBlipsEl.checked && currentPos) {
      const earthOrbitDistance = distanceToEarthOrbit(currentPos);
      if (earthOrbitDistance <= EARTH_ORBIT_BLIP_DISTANCE_AU) {
        const closeness = 1 - earthOrbitDistance / EARTH_ORBIT_BLIP_DISTANCE_AU;
        const pulse = 0.58 + 0.42 * Math.sin(performance.now() * 0.012 + blipPointCount * 0.73);
        blipPositions.set(currentPos, bp);
        blipColors.set([1.0, 0.9, 0.32, Math.min(1, (0.32 + 0.68 * closeness) * pulse)], bc);
        bp += 3;
        bc += 4;
        blipPointCount += 1;
      }
    }
    const scaledTrailDays = trailDays * orbitalVelocityTailScale(record, animationTimeDay, maxRadius, meanAnomalyOffset);
    let prev = null;
    for (let s = 0; s < segmentCount; s++) {
      const phase = s / (segmentCount - 1);
      const sampleTime = animationTimeDay - (1 - phase) * scaledTrailDays;
      const pos = sampleTime >= slot.startedAt ? keplerPosition(record, sampleTime, maxRadius, meanAnomalyOffset) : null;
      if (s > 0) {
        const continuous = segmentIsContinuous(prev, pos, maxRadius, scaledTrailDays);
        const a = continuous ? prev : [far, far, far];
        const b = continuous ? pos : [far, far, far];
        trailPositions.set(a, vp);
        trailPositions.set(b, vp + 3);
        vp += 6;
        const distanceAlpha = continuous ? solarDistanceAlpha(prev, pos) : 0;
        const alpha = Math.min(0.95, (0.015 + 0.145 * phase) * alphaScale * distanceAlpha);
        trailColors.set([color[0], color[1], color[2], continuous ? alpha : 0], vc);
        trailColors.set([color[0], color[1], color[2], continuous ? alpha : 0], vc + 4);
        vc += 8;
      }
      prev = pos;
    }
  }
  trailDrawVertexCount = activeSlots.length * (segmentCount - 1) * 2;

  let pp2 = 0;
  let pc2 = 0;
  let op = 0;
  let oc = 0;
  for (const planet of PLANETS) {
    const elements = planetElements(planet);
    for (let s = 0; s < PLANET_ORBIT_STEPS; s++) {
      const m0 = (s / PLANET_ORBIT_STEPS) * Math.PI * 2;
      const m1 = ((s + 1) / PLANET_ORBIT_STEPS) * Math.PI * 2;
      const a = positionFromElements(elements, m0);
      const b = positionFromElements(elements, m1);
      const show = Math.hypot(...a) <= maxRadius || Math.hypot(...b) <= maxRadius;
      planetOrbitPositions.set(show ? a : [far, far, far], op);
      planetOrbitPositions.set(show ? b : [far, far, far], op + 3);
      op += 6;
      planetOrbitColors.set([...planet.color, show ? 1.0 : 0], oc);
      planetOrbitColors.set([...planet.color, show ? 1.0 : 0], oc + 4);
      oc += 8;
    }
    const cur = planetPosition(planet, planetDay);
    const show = Math.hypot(...cur) <= maxRadius;
    planetPointPositions.set(show ? cur : [far, far, far], pp2);
    pp2 += 3;
    planetPointColors.set([1, 1, 1, show ? 1.0 : 0], pc2);
    pc2 += 4;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, trailPositionBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, trailPositions);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailColorBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, trailColors);
  gl.bindBuffer(gl.ARRAY_BUFFER, blipPositionBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, blipPositions);
  gl.bindBuffer(gl.ARRAY_BUFFER, blipColorBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, blipColors);
  gl.bindBuffer(gl.ARRAY_BUFFER, planetOrbitPositionBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, planetOrbitPositions);
  gl.bindBuffer(gl.ARRAY_BUFFER, planetOrbitColorBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, planetOrbitColors);
  gl.bindBuffer(gl.ARRAY_BUFFER, planetPointPositionBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, planetPointPositions);
  gl.bindBuffer(gl.ARRAY_BUFFER, planetPointColorBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, planetPointColors);
  gl.bindBuffer(gl.ARRAY_BUFFER, sunPointPositionBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, sunPointPositions);
  gl.bindBuffer(gl.ARRAY_BUFFER, sunPointColorBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, sunPointColors);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function bindBuffers(positionBuffer, colorBuffer) {
  const posLoc = gl.getAttribLocation(program, "aPosition");
  const colorLoc = gl.getAttribLocation(program, "aColor");
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.enableVertexAttribArray(colorLoc);
  gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);
}

function drawGuide(m) {
  bindBuffers(guideBuffer.positions, guideBuffer.colors);
  gl.uniform1f(gl.getUniformLocation(program, "uAlphaScale"), 1);
  gl.uniform1i(gl.getUniformLocation(program, "uSoftPoint"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "uStarMode"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "uPointMode"), 0);
  gl.drawArrays(gl.LINES, 0, guideLineVertexCount);
  gl.uniform1i(gl.getUniformLocation(program, "uPointMode"), 1);
  gl.drawArrays(gl.POINTS, guidePointStart, 1);
}

function render(nowMs) {
  const dt = Math.min(0.1, (nowMs - previousFrameMs) / 1000);
  previousFrameMs = nowMs;
  if (!paused) animationTimeDay += dt * Number(speedEl.value);
  axisReadoutEl.textContent = `${Number(radiusEl.value).toFixed(0)} AU`;
  timeReadoutEl.textContent = `${animationTimeDay.toFixed(1)} d`;

  resize();
  rebuildGeometry();
  visibleCountEl.textContent = visibleMeteorCount.toLocaleString();
  drawnCountEl.textContent = activeSlots.length.toLocaleString();
  const m = matrices();
  const skyView = skyViewMatrix(m.view);
  gl.clearColor(0.01, 0.012, 0.018, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(program);
  gl.uniformMatrix4fv(gl.getUniformLocation(program, "uProjection"), false, m.projection);
  gl.uniform1f(gl.getUniformLocation(program, "uAlphaScale"), 1);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);

  gl.disable(gl.DEPTH_TEST);
  gl.uniformMatrix4fv(gl.getUniformLocation(program, "uView"), false, skyView);
  bindBuffers(starPositionBuffer, starColorBuffer);
  gl.uniform1f(gl.getUniformLocation(program, "uPointSize"), STAR_POINT_SCALE * (window.devicePixelRatio || 1));
  gl.uniform1f(gl.getUniformLocation(program, "uAlphaScale"), Number(starVisibilityEl.value));
  gl.uniform1i(gl.getUniformLocation(program, "uSoftPoint"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "uStarMode"), 1);
  gl.uniform1i(gl.getUniformLocation(program, "uPointMode"), 1);
  gl.drawArrays(gl.POINTS, 0, starCount);

  gl.enable(gl.DEPTH_TEST);
  gl.uniformMatrix4fv(gl.getUniformLocation(program, "uView"), false, m.view);
  gl.uniform1f(gl.getUniformLocation(program, "uAlphaScale"), 1);
  gl.uniform1i(gl.getUniformLocation(program, "uSoftPoint"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "uStarMode"), 0);
  drawGuide(m);
  bindBuffers(planetOrbitPositionBuffer, planetOrbitColorBuffer);
  gl.uniform1i(gl.getUniformLocation(program, "uPointMode"), 0);
  gl.drawArrays(gl.LINES, 0, planetOrbitVertexCount);
  bindBuffers(trailPositionBuffer, trailColorBuffer);
  gl.uniform1i(gl.getUniformLocation(program, "uPointMode"), 0);
  gl.drawArrays(gl.LINES, 0, trailDrawVertexCount);

  gl.disable(gl.DEPTH_TEST);
  bindBuffers(blipPositionBuffer, blipColorBuffer);
  gl.uniform1f(gl.getUniformLocation(program, "uPointSize"), BLIP_POINT_SIZE_PX * (window.devicePixelRatio || 1));
  gl.uniform1i(gl.getUniformLocation(program, "uSoftPoint"), 1);
  gl.uniform1i(gl.getUniformLocation(program, "uPointMode"), 1);
  gl.drawArrays(gl.POINTS, 0, blipPointCount);
  gl.uniform1i(gl.getUniformLocation(program, "uSoftPoint"), 0);

  bindBuffers(sunPointPositionBuffer, sunPointColorBuffer);
  gl.uniform1f(gl.getUniformLocation(program, "uPointSize"), SUN_POINT_SIZE_PX * (window.devicePixelRatio || 1));
  gl.uniform1i(gl.getUniformLocation(program, "uPointMode"), 1);
  gl.drawArrays(gl.POINTS, 0, 1);

  bindBuffers(planetPointPositionBuffer, planetPointColorBuffer);
  gl.uniform1f(gl.getUniformLocation(program, "uPointSize"), Number(planetSizeEl.value) * (window.devicePixelRatio || 1));
  gl.uniform1i(gl.getUniformLocation(program, "uPointMode"), 1);
  gl.drawArrays(gl.POINTS, 0, planetPointCount);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  requestAnimationFrame(render);
}

function setupBuffers() {
  trailVertexCount = MAX_DRAWN_METEORS * (segmentCount - 1) * 2;
  planetOrbitVertexCount = PLANETS.length * PLANET_ORBIT_STEPS * 2;
  planetPointCount = PLANETS.length;
  trailPositions = new Float32Array(trailVertexCount * 3);
  trailColors = new Float32Array(trailVertexCount * 4);
  blipPositions = new Float32Array(MAX_DRAWN_METEORS * 3);
  blipColors = new Float32Array(MAX_DRAWN_METEORS * 4);
  planetOrbitPositions = new Float32Array(planetOrbitVertexCount * 3);
  planetOrbitColors = new Float32Array(planetOrbitVertexCount * 4);
  planetPointPositions = new Float32Array(planetPointCount * 3);
  planetPointColors = new Float32Array(planetPointCount * 4);
  sunPointPositions = new Float32Array([0, 0, 0]);
  sunPointColors = new Float32Array([1, 0.86, 0.22, 1]);
  trailPositionBuffer = gl.createBuffer();
  trailColorBuffer = gl.createBuffer();
  blipPositionBuffer = gl.createBuffer();
  blipColorBuffer = gl.createBuffer();
  planetOrbitPositionBuffer = gl.createBuffer();
  planetOrbitColorBuffer = gl.createBuffer();
  planetPointPositionBuffer = gl.createBuffer();
  planetPointColorBuffer = gl.createBuffer();
  sunPointPositionBuffer = gl.createBuffer();
  sunPointColorBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, trailPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, trailPositions.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailColorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, trailColors.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, blipPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, blipPositions.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, blipColorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, blipColors.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, planetOrbitPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, planetOrbitPositions.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, planetOrbitColorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, planetOrbitColors.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, planetPointPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, planetPointPositions.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, planetPointColorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, planetPointColors.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, sunPointPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, sunPointPositions, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, sunPointColorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, sunPointColors, gl.STATIC_DRAW);

  const guidePos = [];
  const guideCol = [];
  const rings = [1, 5, 10, 30, 100];
  for (const radius of rings) {
    for (let i = 0; i < 240; i++) {
      const t0 = (i / 240) * Math.PI * 2;
      const t1 = ((i + 1) / 240) * Math.PI * 2;
      guidePos.push(Math.cos(t0) * radius, Math.sin(t0) * radius, 0);
      guidePos.push(Math.cos(t1) * radius, Math.sin(t1) * radius, 0);
      const alpha = radius === 1 ? 0.42 : 0.18;
      guideCol.push(0.35, 0.42, 0.48, alpha);
      guideCol.push(0.35, 0.42, 0.48, alpha);
    }
  }
  guideLineVertexCount = guidePos.length / 3;
  guidePointStart = guideLineVertexCount;
  guidePos.push(0, 0, 0);
  guideCol.push(1, 0.88, 0.38, 0.85);
  guideBuffer = {
    positions: gl.createBuffer(),
    colors: gl.createBuffer(),
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, guideBuffer.positions);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(guidePos), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, guideBuffer.colors);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(guideCol), gl.STATIC_DRAW);
}

function setupControls() {
  updateSliderReadouts();
  for (const item of sliderReadouts) item.el.addEventListener("input", updateSliderReadouts);
  for (const [key, label] of COLOR_PARAMS) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = label;
    colorParamEl.append(option);
  }
  colorParamEl.value = metadata.defaultColorParameter || "i_deg";
  colorParamEl.addEventListener("change", updateColors);
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All meteors";
  showerPresetEl.append(allOption);
  for (const preset of window.METEOR_SHOWER_PRESETS || []) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = `${preset.label} (${preset.solutions})`;
    showerPresetEl.append(option);
  }
  showerPresetEl.addEventListener("change", () => applyShowerPreset(showerPresetEl.value));
  for (const param of FILTER_PARAMS) {
    const range = param.type === "angle" ? { center: param.center, extent: param.extent } : { min: param.min, max: param.max };
    filters.set(param.key, range);
    const wrap = document.createElement("div");
    wrap.className = "filter";
    const controls =
      param.type === "angle"
        ? `
        <label class="filter-slider-row"><span>Center</span><input data-filter="${param.key}" data-side="center" type="range" min="${param.min}" max="${param.max}" step="${param.step}" value="${param.center}"></label>
        <label class="filter-slider-row"><span>Extent</span><input data-filter="${param.key}" data-side="extent" type="range" min="0" max="${param.max - param.min}" step="${param.step}" value="${param.extent}"></label>
      `
        : `
        <label class="filter-slider-row"><span>Min</span><input data-filter="${param.key}" data-side="min" type="range" min="${param.min}" max="${param.max}" step="${param.step}" value="${param.min}"></label>
        <label class="filter-slider-row"><span>Max</span><input data-filter="${param.key}" data-side="max" type="range" min="${param.min}" max="${param.max}" step="${param.step}" value="${param.max}"></label>
      `;
    wrap.innerHTML = `
      <div class="filter-head">
        <span>${param.label}</span>
        <span class="filter-value" data-filter-value="${param.key}"></span>
      </div>
      <div class="filter-sliders">
        ${controls}
      </div>
    `;
    filterControlsEl.append(wrap);
    updateFilterReadout(param);
  }
  filterControlsEl.addEventListener("input", (event) => {
    const input = event.target.closest("[data-filter]");
    if (!input) return;
    const param = FILTER_PARAMS.find((item) => item.key === input.dataset.filter);
    setFilterValue(param, input.dataset.side, input.value);
  });
  playPauseEl.addEventListener("click", () => {
    paused = !paused;
    playPauseEl.textContent = paused ? "Play" : "Pause";
  });
  resetViewEl.addEventListener("click", () => {
    camera.yaw = 0.78;
    camera.pitch = 0.36;
    camera.roll = 0;
    camera.distance = Math.max(0.5, Number(radiusEl.value) * 1.8);
  });
  randomizeMeanAnomalyEl.addEventListener("input", () => {
    lastFilterSignature = "";
  });
  compactToggleEl.addEventListener("click", () => setControlsCompact(!panelEl.classList.contains("compact")));
  musicToggleEl.addEventListener("click", togglePlanetariumMusic);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    pointer.active = true;
    pointer.button = event.button;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointer.active) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pointer.button === 2) {
      camera.roll += dx * 0.008;
    } else {
      camera.yaw -= dx * 0.006;
      camera.pitch = Math.max(-1.48, Math.min(1.48, camera.pitch + dy * 0.006));
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    pointer.active = false;
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      camera.distance = Math.max(0.08, Math.min(300, camera.distance * Math.exp(event.deltaY * 0.001)));
    },
    { passive: false }
  );
}

function halfToFloat(h) {
  const sign = (h & 0x8000) ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const fraction = h & 0x03ff;
  if (exponent === 0) {
    return fraction === 0 ? sign * 0 : sign * Math.pow(2, -14) * (fraction / 1024);
  }
  if (exponent === 31) {
    return fraction === 0 ? sign * Infinity : NaN;
  }
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

function decodeFloat16Table(buffer) {
  const input = new Uint16Array(buffer);
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) output[i] = halfToFloat(input[i]);
  return output;
}

function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function catalogChunkPath(index) {
  const prefix = metadata.chunkFilePrefix || "maarsy_full_";
  const suffix = metadata.chunkFileSuffix || ".js";
  return `./data/${prefix}${String(index).padStart(2, "0")}${suffix}`;
}

function loadChunkScript(index) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    window.METEOR_VIZ_CHUNK = null;
    script.src = catalogChunkPath(index);
    script.async = true;
    script.onload = () => {
      const chunk = window.METEOR_VIZ_CHUNK;
      script.remove();
      if (!chunk || chunk.id !== index) reject(new Error(`Catalogue chunk ${index + 1} did not load correctly`));
      else resolve(chunk);
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`Could not load catalogue chunk ${index + 1}`));
    };
    document.head.append(script);
  });
}

async function loadCatalogChunk(index, options = {}) {
  const updateStatus = options.updateStatus !== false;
  const chunk = metadata.chunks[index];
  if (updateStatus) statusEl.textContent = `Loading catalogue chunk ${index + 1} / ${metadata.chunks.length}...`;
  const payload = await loadChunkScript(index);
  const bytes = bytesFromBase64(payload.base64Float16);
  const table = decodeFloat16Table(bytes.buffer);
  if (table.length !== chunk.count * stride) throw new Error(`Catalogue chunk ${index + 1} length does not match metadata`);
  dataTable = table;
  chunkMeteorCount = chunk.count;
  activeChunkIndex = index;
  nextChunkIndex = (index + 1) % metadata.chunks.length;
  if (updateStatus) lastFilterSignature = "";
  updateColors();
  if (updateStatus) statusEl.textContent = `Streaming full catalogue chunk ${index + 1} / ${metadata.chunks.length}.`;
}

async function loadData() {
  if (!window.METEOR_VIZ_CATALOG) throw new Error("Meteor catalogue manifest is missing");
  if (!window.TYCHO_STAR_CATALOG) throw new Error("Embedded Tycho star catalogue is missing");
  metadata = window.METEOR_VIZ_CATALOG;
  stride = metadata.recordFloat32Count;
  meteorCount = metadata.count;

  starMetadata = window.TYCHO_STAR_CATALOG.metadata;
  const starBinary = atob(window.TYCHO_STAR_CATALOG.base64Float32);
  const starBytes = new Uint8Array(starBinary.length);
  for (let i = 0; i < starBinary.length; i++) starBytes[i] = starBinary.charCodeAt(i);
  starTable = new Float32Array(starBytes.buffer);
  if (starTable.length !== starMetadata.count * starMetadata.recordFloat32Count) throw new Error("Tycho data length does not match metadata");

  await loadCatalogChunk(0);
}

async function main() {
  gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
  if (!gl) {
    statusEl.textContent = "WebGL2 is not available in this browser.";
    return;
  }
  await loadData();
  program = createProgram();
  setupStarBuffers();
  setupBuffers();
  setupControls();
  updateColors();
  gl.enable(gl.DEPTH_TEST);
  countEl.textContent = meteorCount.toLocaleString();
  statusEl.textContent = "Drag to look, right-drag to roll, wheel to zoom.";
  requestAnimationFrame(render);
}

main().catch((error) => {
  console.error(error);
  statusEl.textContent = error.message;
});
