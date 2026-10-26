// Chart builders shared by the dashboard pages.
//
// d3 and Plot are passed in rather than imported (same convention as axes.js and tooltips.js):
// they are page globals, and the smoke-test harness supplies its own copies.

import {timeAxis} from "./axes.js";
import {multiSeriesTip} from "./tooltips.js";
import {ZONES, zoneByIso, zoneByKey} from "./zones.js";

// Sequential blue ramp (validated reference palette, steps 100 → 700) for magnitude on the maps.
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const ACCENT = "#2a78d6";
const BAND = "#9ec5f4";
const SOURCE = "Source: ENTSO-E Transparency Platform via entsoemcp.com";

// Validated categorical palette, in its CVD-safe order.
const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

// Hue slot per selected zone, kept for the life of the page. Eighteen zones cannot each own one of
// eight hues without collisions, so a zone takes the first free slot when it is selected and keeps
// it until deselected: adding or removing a country never repaints the others, and up to eight
// selected countries are always distinct. A ninth reuses a hue (its direct label still names it).
const slots = new Map();

/** Plot colour scale (domain: display names) for the selected zone keys, with stable hues. */
export function seriesColors(keys) {
  for (const k of [...slots.keys()]) if (!keys.includes(k)) slots.delete(k);
  for (const k of ZONES.map((z) => z.key).filter((k) => keys.includes(k))) {
    if (slots.has(k)) continue;
    const used = new Set(slots.values());
    const free = CATEGORICAL.findIndex((_, i) => !used.has(i));
    slots.set(k, free === -1 ? slots.size % CATEGORICAL.length : free);
  }
  const present = ZONES.filter((z) => keys.includes(z.key));
  return {domain: present.map((z) => z.name), range: present.map((z) => CATEGORICAL[slots.get(z.key)])};
}

// Label anchors where a shape's centroid lands somewhere unhelpful (Croatia's sits in Bosnia, and
// Slovenia's and Croatia's collide at their shared border).
const LABEL_AT = {SI: [14.4, 46.2], HR: [17.0, 45.45], GR: [22.2, 39.6], DE_LU: [10.3, 51.0]};

/**
 * Nudge end-of-line labels apart vertically so none sit closer than `gap` px, working in data
 * units via the plot's own vertical scale factor. Returns copies with `labelY` set.
 */
function separateLabels(points, {yMax, plotHeight, gap = 11}) {
  const perPx = yMax / plotHeight;
  const sorted = [...points].sort((a, b) => a.ma - b.ma).map((d) => ({...d, labelY: d.ma}));
  for (let i = 1; i < sorted.length; i++) {
    const min = sorted[i - 1].labelY + gap * perPx;
    if (sorted[i].labelY < min) sorted[i].labelY = min;
  }
  return sorted;
}

const fmt1 = (x) => x.toFixed(1);

/**
 * Choropleth of one value per zone. Returns the Plot figure; its `value` is the hovered zone's
 * key (or null), which the pages use to make a click on the map select that country.
 */
export function zoneMap({d3, Plot, geo, values, selected, width, title, subtitle, label, format = fmt1}) {
  const byZone = new Map(values.map((d) => [d.zone, d.value]));
  const inScope = geo.features.filter((f) => zoneByIso.has(f.properties.id));
  const context = geo.features.filter((f) => !zoneByIso.has(f.properties.id));
  const zoneOf = (f) => zoneByIso.get(f.properties.id).key;
  const valued = inScope.filter((f) => byZone.has(zoneOf(f)));
  const missing = inScope.filter((f) => !byZone.has(zoneOf(f)));

  const labels = ZONES.map((z) => {
    const feature = inScope.find((f) => f.properties.id === z.iso[0]);
    const [lon, lat] = LABEL_AT[z.key] ?? d3.geoCentroid(feature);
    const v = byZone.get(z.key);
    return {zone: z.key, lon, lat, text: `${z.short}\n${v === undefined ? "n/a" : format(v)}`, dark: v !== undefined};
  });

  const extent = d3.extent(values, (d) => d.value);
  const w = Math.min(width, 800);
  const plot = Plot.plot({
    title, subtitle, caption: SOURCE,
    width: w,
    height: Math.round(Math.min(w * 0.95, 680)),
    projection: {type: "conic-equal-area", parallels: [40, 58], rotate: [-18, 0], domain: {type: "FeatureCollection", features: inScope}, inset: 6},
    color: {
      type: "linear", legend: true, label,
      domain: extent[0] === extent[1] ? [extent[0] - 1, extent[1] + 1] : extent,
      interpolate: d3.piecewise(d3.interpolateLab, RAMP)
    },
    marks: [
      Plot.geo(context, {fill: "var(--theme-foreground-faintest)", stroke: "var(--theme-background)", strokeWidth: 0.5, clip: "frame"}),
      Plot.geo(missing, {fill: "var(--theme-foreground-faintest)", stroke: "var(--theme-foreground-muted)", strokeWidth: 0.5}),
      Plot.geo(valued, {
        fill: (f) => byZone.get(zoneOf(f)),
        stroke: "var(--theme-background)", strokeWidth: 1,
        channels: {Country: (f) => zoneByIso.get(f.properties.id).name, [label]: (f) => byZone.get(zoneOf(f))},
        tip: {format: {fill: false, [label]: format}}
      }),
      Plot.geo(inScope.filter((f) => zoneOf(f) === selected), {stroke: "currentColor", strokeWidth: 2.5}),
      Plot.text(labels, {
        x: "lon", y: "lat", text: "text", fontSize: w < 500 ? 8 : 10, lineHeight: 1.1,
        fontWeight: (d) => (d.zone === selected ? "bold" : "normal"),
        fill: "var(--theme-foreground)", stroke: "var(--theme-background)", strokeWidth: 3, paintOrder: "stroke"
      })
    ]
  });
  plot.style.cursor = "pointer";
  return plot;
}

/** Zone key of a map feature — e.g. of a map's `value`, the feature under the pointer. */
export const zoneOfFeature = (f) => zoneByIso.get(f?.properties?.id)?.key ?? null;

/**
 * Make a click on `map` select the hovered zone in `input`, so the map and the input are one
 * control: an Inputs.select takes the zone; with `toggle`, an Inputs.checkbox adds or removes it.
 * Returns the map for use as a display expression.
 */
export function linkMapToInput(map, input, {toggle = false} = {}) {
  map.addEventListener("click", () => {
    const zone = zoneOfFeature(map.value);
    if (!zone) return;
    if (toggle) {
      input.value = input.value.includes(zone) ? input.value.filter((z) => z !== zone) : [...input.value, zone];
    } else if (input.value !== zone) {
      input.value = zone;
    } else {
      return;
    }
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
  return map;
}

/** Monthly average price of one zone, with every other zone in scope as grey context. */
export function monthlyPriceChart({d3, Plot, rows, zone, width}) {
  const data = rows.map((d) => ({...d, date: new Date(d.month + "T00:00:00Z")}));
  const own = data.filter((d) => d.zone === zone);
  const others = data.filter((d) => d.zone !== zone);
  const name = zoneByKey.get(zone).name;
  return Plot.plot({
    title: `Monthly average day-ahead price — ${name}`,
    subtitle: "Hour-weighted average of the hourly DAM clearing price per calendar month; other zones in scope in grey",
    caption: SOURCE,
    width: Math.min(width, 800), height: 300, marginLeft: 50, marginRight: 30,
    x: timeAxis(width, d3),
    y: {nice: true, grid: true, label: "EUR / MWh", zero: true},
    marks: [
      Plot.lineY(others, {x: "date", y: "value", z: "zone", stroke: "var(--theme-foreground-faint)", strokeWidth: 1, strokeOpacity: 0.6}),
      Plot.lineY(own, {x: "date", y: "value", stroke: ACCENT, strokeWidth: 2}),
      Plot.dot(own, {
        x: "date", y: "value", fill: ACCENT, r: 2.5,
        tip: {format: {x: (d) => d3.utcFormat("%B %Y")(d), y: fmt1}}
      })
    ]
  });
}

/**
 * Intraday volatility: P10-P90 band and median of the hourly price by local hour of day, one panel
 * per year. Panels wrap three to a row so each year stays wide enough to read on any screen.
 */
export function volatilityChart({d3, Plot, rows, zone, width}) {
  const years = [...new Set(rows.map((d) => d.year))].sort();
  const cols = width < 500 ? 2 : 3;
  const pos = new Map(years.map((y, i) => [y, {col: i % cols, row: Math.floor(i / cols)}]));
  const data = rows.map((d) => ({...d, ...pos.get(d.year)}));
  const rowsN = Math.ceil(years.length / cols);
  return Plot.plot({
    title: `Intraday price volatility — ${zoneByKey.get(zone).name}`,
    subtitle: "Median (line) and P10-P90 range (band) of the hourly DAM price, by local hour of day and year",
    caption: SOURCE,
    width: Math.min(width, 800), height: 60 + rowsN * 170, marginLeft: 50, marginRight: 30,
    x: {label: "hour of day", domain: [0, 23], ticks: [0, 6, 12, 18, 23], line: true},
    y: {nice: true, grid: true, label: "EUR / MWh"},
    fx: {axis: null}, fy: {axis: null},
    marks: [
      Plot.areaY(data, {x: "hour", y1: "p10", y2: "p90", fx: "col", fy: "row", fill: BAND, fillOpacity: 0.5, curve: "catmull-rom"}),
      Plot.lineY(data, {
        x: "hour", y: "p50", fx: "col", fy: "row", stroke: ACCENT, strokeWidth: 2, curve: "catmull-rom",
        channels: {year: "year", P10: "p10", P90: "p90"},
        tip: {format: {fx: false, fy: false, year: true, y: fmt1, P10: fmt1, P90: fmt1}}
      }),
      Plot.text(years.map((year) => ({year, ...pos.get(year)})), {
        fx: "col", fy: "row", text: "year", frameAnchor: "top-left", dx: 4, dy: 2, fontWeight: "bold"
      })
    ]
  });
}

/** 30-day moving average of a TB spread for several zones, one directly-labelled line each. */
export function spreadLines({d3, Plot, rows, tb, window, width}) {
  const data = rows.map((d) => ({...d, date: new Date(d.date + "T00:00:00Z"), name: zoneByKey.get(d.zone).name}));
  const keys = [...new Set(data.map((d) => d.zone))];
  const height = 340, marginTop = 20, marginBottom = 30;
  const yMax = d3.max(data, (d) => d.ma) ?? 1;
  const last = separateLabels(keys.map((k) => data.filter((d) => d.zone === k).at(-1)), {yMax, plotHeight: height - marginTop - marginBottom});
  const render = multiSeriesTip(d3, Plot, {y: "name", value: "ma", header: (d) => d3.utcFormat("%e %b %Y")(d.date)});
  return Plot.plot({
    title: `${tb.toUpperCase()} day-ahead spread: country comparison`,
    subtitle: `Daily mean of the top-${tb.slice(2)} minus the mean of the bottom-${tb.slice(2)} hourly prices, ${window}-day moving average`,
    caption: SOURCE,
    width: Math.min(width, 800), height, marginTop, marginBottom, marginLeft: 50, marginRight: 45,
    x: timeAxis(width, d3),
    y: {grid: true, label: "EUR / MWh", domain: [0, yMax]},
    color: {legend: true, ...seriesColors(keys)},
    marks: [
      Plot.lineY(data, {x: "date", y: "ma", stroke: "name", strokeWidth: 1.5}),
      Plot.text(last, {
        x: "date", y: "labelY", text: (d) => zoneByKey.get(d.zone).short, textAnchor: "start", dx: 4,
        fill: "var(--theme-foreground)", fontSize: 10, clip: false
      }),
      Plot.ruleX(data, Plot.pointerX(Plot.binX({x: "min"}, {x: "date", interval: d3.utcDay, insetTop: 20}))),
      Plot.tip(data, Plot.pointerX(Plot.binX({title: (v) => v, x: "min"}, {x: "date", interval: d3.utcDay, render})))
    ]
  });
}
