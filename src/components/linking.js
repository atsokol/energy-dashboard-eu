// Links between controls and charts: the regions and country remembered across pages, a month
// shared by several month controls, and an hour-of-day brush shared by the hourly charts and the price vs
// residual load scatter. d3 is passed in (a page global), as in charts.js.

import {REGIONS, ZONE_KEYS, zoneByKey} from "./zones.js";

// ---------------------------------------------------------------------------------------------
// Country, remembered across pages and visits
// ---------------------------------------------------------------------------------------------

const ZONE_KEY = "energy-dashboard-eu:zone";
const REGIONS_KEY = "energy-dashboard-eu:regions";

/**
 * The country picked last on any page if it is among `keys` (the zones on show), else `fallback`
 * if it is, else the first of `keys`. Storage can be blocked: never throws.
 */
export function savedZone(fallback, keys = ZONE_KEYS) {
  try {
    const zone = localStorage.getItem(ZONE_KEY);
    if (keys.includes(zone)) return zone;
  } catch {}
  return keys.includes(fallback) ? fallback : keys[0];
}

/**
 * Store every country picked on `input` (an Inputs.select of zone keys) so the other pages and
 * the next visit start on it, and follow a change made in another open tab of the site when the
 * input offers that country. The select is rebuilt whenever the regions change; a replaced one
 * (no longer in the page) ignores other tabs.
 */
export function rememberZone(input) {
  input.addEventListener("input", () => {
    try { localStorage.setItem(ZONE_KEY, input.value); } catch {}
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== ZONE_KEY || !zoneByKey.has(event.newValue) || event.newValue === input.value) return;
    if (!input.isConnected || ![...input.querySelectorAll("option")].some((o) => o.textContent === zoneByKey.get(event.newValue).name)) return;
    input.value = event.newValue;
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
  return input;
}

// ---------------------------------------------------------------------------------------------
// Regions, remembered across pages and visits
// ---------------------------------------------------------------------------------------------

function savedRegions() {
  try {
    const saved = JSON.parse(localStorage.getItem(REGIONS_KEY));
    if (Array.isArray(saved)) return REGIONS.filter((r) => saved.includes(r));
  } catch {}
  return REGIONS;
}

/**
 * The region checkboxes shown at the top of every page (`Inputs` is the page global). Ticking a
 * region on one page ticks it on the others, in other open tabs too, and on the next visit.
 * Pass the value through zonesIn: no region ticked shows every zone.
 */
export function regionInput(Inputs) {
  const input = Inputs.checkbox(REGIONS, {value: savedRegions(), label: "Regions"});
  input.addEventListener("input", () => {
    try { localStorage.setItem(REGIONS_KEY, JSON.stringify(input.value)); } catch {}
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== REGIONS_KEY) return;
    const next = savedRegions();
    if (next.join() === input.value.join()) return;
    input.value = next;
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
  return input;
}

// ---------------------------------------------------------------------------------------------
// One month for several controls
// ---------------------------------------------------------------------------------------------

/**
 * A value shared by the controls joined with linkValue. With `storageKey` it is remembered in
 * localStorage (when `valid`), so other pages and the next visit start on it, and it follows a
 * change made in another open tab.
 */
export function sharedValue(initial, {storageKey = null, valid = () => true} = {}) {
  const link = {value: initial, members: new Map(), storageKey};
  if (!storageKey) return link;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved != null && valid(saved)) link.value = saved;
  } catch {}
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey && event.newValue != null && valid(event.newValue)) setShared(link, event.newValue, null, false);
  });
  return link;
}

/** Set `link` to `value` and move every member but `from` that offers it. */
function setShared(link, value, from, store = true) {
  if (value === link.value) return;
  link.value = value;
  if (store && link.storageKey) try { localStorage.setItem(link.storageKey, value); } catch {}
  for (const [key, {input, fromLink}] of link.members) {
    const v = key === from ? undefined : fromLink(value);
    if (v === undefined || input.value === v) continue;
    input.value = v;
    input.dispatchEvent(new Event("input", {bubbles: true}));
  }
}

/**
 * Join `input` (any element with a settable `value` that fires "input") to `link` under `key`;
 * joining again under the same key (the control's cell re-ran) replaces the old one. The control
 * starts on the shared value and moves with it. `toLink` maps the control's value to the shared
 * one (null: a value of its own, such as "All months", that moves nothing); `fromLink` maps back
 * (undefined: not offered); `accepts` is a shortcut for a control that offers only some values.
 */
export function linkValue(link, key, input, {accepts = () => true, toLink = (v) => v, fromLink = (v) => v} = {}) {
  const from = (v) => (accepts(v) ? fromLink(v) : undefined);
  link.members.set(key, {input, fromLink: from});
  const start = from(link.value);
  if (start !== undefined && input.value !== start) input.value = start;
  input.addEventListener("input", () => {
    if (link.members.get(key)?.input !== input) return; // replaced by a newer control
    const value = toLink(input.value);
    if (value != null) setShared(link, value, key);
  });
  return input;
}

/**
 * The period type, month ("01"-"12") and year shared by the price and spread pages and
 * remembered between visits. They start on the last complete month before `anchor`.
 */
export function periodLinks(anchor) {
  const last = new Date(Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
  return {
    kind: sharedValue("month", {storageKey: "energy-dashboard-eu:period-kind", valid: (k) => ["year", "month", "week", "day"].includes(k)}),
    month: sharedValue(last.slice(5), {storageKey: "energy-dashboard-eu:month", valid: (m) => /^(0[1-9]|1[0-2])$/.test(m)}),
    year: sharedValue(last.slice(0, 4), {storageKey: "energy-dashboard-eu:year", valid: (y) => /^\d{4}$/.test(y)})
  };
}

/**
 * Join a map's period select (`options` from listPeriods for `kind`) to the shared month and
 * year: a month period follows both, a year period the year; weeks and days stay on their own.
 */
export function linkPeriod(links, input, kind, options) {
  links.month.members.delete("period");
  links.year.members.delete("period");
  const find = (key) => options.find((p) => p.key === key);
  if (kind === "month") {
    linkValue(links.month, "period", input, {toLink: (p) => p.key.slice(5, 7), fromLink: (m) => find(`${input.value.key.slice(0, 4)}-${m}-01`)});
    linkValue(links.year, "period", input, {toLink: (p) => p.key.slice(0, 4), fromLink: (y) => find(`${y}-${input.value.key.slice(5, 7)}-01`)});
  } else if (kind === "year") {
    linkValue(links.year, "period", input, {toLink: (p) => p.key.slice(0, 4), fromLink: (y) => find(`${y}-01-01`)});
  }
  return input;
}

/**
 * Shared brush state. `sel` is null, {kind: "hours", h0, h1} (local hours, inclusive) from an
 * hourly chart, or {kind: "box", x0, x1, y0, y1} in a scatter's plotted units. `weights` is the
 * emphasis of each hour 0-23 (0-1) that the hourly charts draw, or null for none; for a box it
 * comes from `weigh`, set by the scatter that owns the box. `views` maps a chart id to its
 * redraw, so a chart drawn again replaces its old self.
 */
export function linkedBrush() {
  const bus = {sel: null, source: null, weights: null, weigh: null, views: new Map()};
  bus.set = (sel, source) => {
    bus.sel = sel;
    bus.source = source;
    bus.notify();
  };
  bus.notify = () => {
    const s = bus.sel;
    bus.weights = !s ? null
      : s.kind === "hours" ? Array.from({length: 24}, (_, h) => (h >= s.h0 && h <= s.h1 ? 1 : 0))
      : bus.weigh?.() ?? null;
    for (const redraw of bus.views.values()) redraw();
  };
  return bus;
}

/**
 * A d3 brush drawn as an outline: the default grey fill would dull the colours it picks out, and
 * the veil or the greyed dots already mark what is left out.
 */
export function outlineBrush(g) {
  g.select(".selection").attr("fill", "none").attr("stroke", "var(--theme-foreground-muted)").attr("stroke-dasharray", "4,3");
}

/** The plot's own SVG inside a Plot figure (not a legend swatch's). */
export function plotSvg(chart) {
  return chart.tagName?.toLowerCase() === "svg" ? chart : chart.querySelector(":scope > svg");
}

/**
 * Add a horizontal brush over the hour axis of a Plot chart (x: local hour 0-23), joined to
 * `bus` under `id`. Dragging selects whole hours and moves the same selection onto every other
 * hourly chart on the bus; hours outside it, or with few of a scatter box's dots, are veiled.
 * A click clears it. Returns the chart.
 */
export function brushHours(d3, chart, bus, id) {
  const svg = plotSvg(chart);
  if (!bus || !svg || !chart.scale) return chart;
  const x = chart.scale("x"), y = chart.scale("y");
  const [l, r] = d3.extent(x.range), [t, b] = d3.extent(y.range);
  const half = Math.abs(x.apply(1) - x.apply(0)) / 2;
  const left = (h) => Math.max(l, x.apply(h) - half), right = (h) => Math.min(r, x.apply(h) + half);
  // Under the tooltip, so a tip over a veiled hour stays readable.
  const veil = d3.create("svg:g").attr("pointer-events", "none");
  svg.insertBefore(veil.node(), svg.querySelector("g[aria-label='tip']"));
  const rects = veil.selectAll("rect").data(d3.range(24)).join("rect")
    .attr("x", left).attr("width", (h) => right(h) - left(h)).attr("y", t).attr("height", b - t)
    .attr("fill", "var(--theme-background)").attr("fill-opacity", 0);
  const brush = d3.brushX().extent([[l, t], [r, b]]);
  const g = d3.select(svg).append("g").call(brush).call(outlineBrush);
  const token = {};
  let quiet = false;
  brush.on("brush end", ({selection, sourceEvent}) => {
    if (quiet || !sourceEvent) return;
    if (!selection) return bus.set(null, token);
    const [a, c] = selection.map((px) => x.invert(px));
    let h0 = Math.ceil(a - 1e-9), h1 = Math.floor(c + 1e-9);
    if (h0 > h1) h0 = h1 = Math.round((a + c) / 2);
    if (bus.sel?.kind === "hours" && bus.sel.h0 === h0 && bus.sel.h1 === h1 && bus.source === token) return;
    bus.set({kind: "hours", h0, h1}, token);
  });
  const redraw = () => {
    const w = bus.weights;
    rects.attr("fill-opacity", (h) => (w ? (1 - w[h]) * 0.75 : 0));
    quiet = true;
    const s = bus.sel;
    if (s?.kind !== "hours") g.call(brush.move, null);
    else if (bus.source !== token) g.call(brush.move, [left(s.h0), right(s.h1)]);
    quiet = false;
  };
  bus.views.set(id, redraw);
  redraw();
  return chart;
}
