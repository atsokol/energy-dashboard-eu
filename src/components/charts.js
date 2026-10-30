// Chart builders shared by the dashboard pages.
//
// d3 and Plot are passed in rather than imported (same convention as axes.js and tooltips.js):
// they are page globals, and the smoke-test harness supplies its own copies.

import {timeAxis} from "./axes.js";
import {captureTechByKey, seasonLabel} from "./capture.js";
import {GEN_GROUPS, completeGrid, genGroupByKey, SEASONS} from "./gen.js";
import {outlineBrush, plotSvg} from "./linking.js";
import {multiSeriesTip} from "./tooltips.js";
import {ZONE_KEYS, ZONES, zoneByKey} from "./zones.js";

// Sequential blue ramp (validated reference palette, steps 100 → 700) for magnitude on the maps.
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const ACCENT = "#2a78d6";
const SOURCE = "Source: ENTSO-E Transparency Platform via entsoemcp.com";
const FUEL_SOURCE = "Sources: ENTSO-E Transparency Platform via entsoemcp.com; THE gas and EUA auction prices: Energy-Charts (Fraunhofer ISE)";
const GAS_COST = "gas-plant cost (2 × THE gas + 0.4 × EUA)";

// Validated categorical palette, in its CVD-safe order.
const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

// Hue slot per selected zone, kept for the life of the page. Forty-four zones cannot each own one of
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

// Label anchors where a shape's centroid lands somewhere unhelpful (Croatia's sits in Bosnia,
// Slovenia's and Croatia's collide at their shared border, Italy Centre-South's is at sea).
const LABEL_AT = {SI: [14.4, 46.2], HR: [17.0, 45.45], GR: [22.2, 39.6], DE_LU: [10.3, 51.0], IT_CSUD: [13.4, 42.0]};

/** Zone key of a map feature — e.g. of a map's `value`, the feature under the pointer. */
export const zoneOfFeature = (f) => f?.properties?.zone ?? null;

/**
 * A map's features split into the shapes of the zones on show (`keys`, default every zone) and
 * the grey context around them: other countries, and zones of regions not ticked.
 */
function splitFeatures(geo, keys = ZONE_KEYS) {
  const shown = new Set(keys);
  return {
    inScope: geo.features.filter((f) => shown.has(zoneOfFeature(f))),
    context: geo.features.filter((f) => !shown.has(zoneOfFeature(f)))
  };
}

/** [lon, lat] to label (or place a symbol on) zone `z`: its largest shape's centroid. */
function zoneAnchor(d3, inScope, z) {
  if (LABEL_AT[z.key]) return LABEL_AT[z.key];
  const own = inScope.filter((f) => zoneOfFeature(f) === z.key);
  return d3.geoCentroid(d3.greatest(own, (f) => d3.geoArea(f)));
}

/** Map height for a width: tall enough for the zones on show, from Portugal to North Cape. */
function mapHeight(d3, inScope, w) {
  const [[x0, y0], [x1, y1]] = d3.geoPath(d3.geoConicEqualArea().parallels([40, 58]).rotate([-10, 0]))
    .bounds({type: "FeatureCollection", features: inScope});
  return Math.round(Math.min(Math.max(w * ((y1 - y0) / (x1 - x0)), w * 0.6), w * 1.25, 900));
}

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
 * `domain` fixes the colour scale (values outside it clamp to the end colours); without it the
 * scale spans this map's own values. With `pivot` the scale is diverging around that value (red
 * below, blue above) instead of the sequential blue ramp. `height` overrides the default for maps
 * drawn in pairs.
 */
export function zoneMap({d3, Plot, geo, values, zones = ZONE_KEYS, selected, width, title, subtitle, label, domain, format = fmt1, legendFormat, pivot = null, caption = SOURCE, height}) {
  const byZone = new Map(values.map((d) => [d.zone, d.value]));
  const {inScope, context} = splitFeatures(geo, zones);
  const zoneOf = zoneOfFeature;
  const valued = inScope.filter((f) => byZone.has(zoneOf(f)));
  const missing = inScope.filter((f) => !byZone.has(zoneOf(f)));

  const w = Math.min(width, 800);
  // On a phone-width map of many zones, values would overlap: names only (the colour and the
  // tooltip still give the value).
  const namesOnly = w < 500 && zones.length > 20;
  const labels = ZONES.filter((z) => zones.includes(z.key)).map((z) => {
    const [lon, lat] = zoneAnchor(d3, inScope, z);
    const v = byZone.get(z.key);
    return {zone: z.key, lon, lat, text: namesOnly ? z.short : `${z.short}\n${v === undefined ? "n/a" : format(v)}`, dark: v !== undefined};
  });

  const extent = d3.extent(values, (d) => d.value);
  const plot = Plot.plot({
    title, subtitle, caption,
    width: w,
    height: height ?? mapHeight(d3, inScope, w),
    projection: {type: "conic-equal-area", parallels: [40, 58], rotate: [-10, 0], domain: {type: "FeatureCollection", features: inScope}, inset: 6},
    color: {
      legend: true, label, clamp: true, tickFormat: legendFormat,
      domain: domain ?? (extent[0] === extent[1] ? [extent[0] - 1, extent[1] + 1] : extent),
      ...(pivot == null
        ? {type: "linear", interpolate: d3.piecewise(d3.interpolateLab, RAMP)}
        : {type: "diverging", pivot, scheme: "rdbu"})
    },
    marks: [
      Plot.geo(context, {fill: "var(--theme-foreground-faintest)", stroke: "var(--theme-background)", strokeWidth: 0.5, clip: "frame"}),
      Plot.geo(missing, {fill: "var(--theme-foreground-faintest)", stroke: "var(--theme-foreground-muted)", strokeWidth: 0.5}),
      Plot.geo(valued, {
        fill: (f) => byZone.get(zoneOf(f)),
        stroke: "var(--theme-background)", strokeWidth: 1,
        channels: {Country: (f) => zoneByKey.get(zoneOf(f)).name, [label]: (f) => byZone.get(zoneOf(f))},
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

/**
 * Make a click on `map` select the hovered zone in `input`, so the map and the input are one
 * control: an Inputs.select takes the zone; with `toggle`, an Inputs.checkbox adds or removes it.
 * Returns the map for use as a display expression.
 */
export function linkMapToInput(map, input, {toggle = false, zoneOf = zoneOfFeature} = {}) {
  map.addEventListener("click", () => {
    const zone = zoneOf(map.value);
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
export function monthlyPriceChart({d3, Plot, rows, zone, width, cost}) {
  const data = rows.map((d) => ({...d, date: new Date(d.month + "T00:00:00Z")}));
  const own = data.filter((d) => d.zone === zone);
  const others = data.filter((d) => d.zone !== zone);
  const name = zoneByKey.get(zone).name;
  // Optional monthly gas-plant cost, over the same months as the zone's prices.
  const first = own[0]?.month;
  const gas = (cost ?? []).filter((d) => first && d.month >= first).map((d) => ({...d, date: new Date(d.month + "T00:00:00Z")}));
  const gasEnd = gas.length ? [{...gas.at(-1), label: "gas-plant cost"}] : [];
  return Plot.plot({
    title: `Monthly average day-ahead price — ${name}`,
    subtitle: `Hour-weighted monthly average; other zones in grey${gas.length ? `; dashed: ${GAS_COST}` : ""}`,
    caption: gas.length ? FUEL_SOURCE : SOURCE,
    width: Math.min(width, 800), height: 300, marginLeft: 50, marginRight: gas.length ? 90 : 30,
    x: timeAxis(width, d3),
    y: {nice: true, grid: true, label: "EUR / MWh", zero: true},
    marks: [
      Plot.lineY(others, {x: "date", y: "value", z: "zone", stroke: "var(--theme-foreground-faint)", strokeWidth: 1, strokeOpacity: 0.25}),
      Plot.lineY(gas, {x: "date", y: "cost", stroke: "var(--gen-gas)", strokeWidth: 1.5, strokeDasharray: "4,3"}),
      Plot.text(gasEnd, {x: "date", y: "cost", text: "label", fill: "var(--gen-gas)", textAnchor: "start", dx: 6, fontSize: 10, clip: false}),
      Plot.lineY(own, {x: "date", y: "value", stroke: ACCENT, strokeWidth: 2}),
      Plot.dot(own, {
        x: "date", y: "value", fill: ACCENT, r: 2.5,
        tip: {format: {x: (d) => d3.utcFormat("%B %Y")(d), y: fmt1}}
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
    subtitle: `Top-${tb.slice(2)} minus bottom-${tb.slice(2)} hourly prices, ${window}-day moving average`,
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

/**
 * One zone's spread band (rows from spreadBand): rolling top-x and bottom-x price lines with the
 * daily average dashed between them, the gap shaded day by day on a blue-to-red scale of the
 * rolling TBx spread it spans. Lines are labelled at their right end rather than in a legend,
 * which is left to the shading scale.
 */
export function spreadBandChart({d3, Plot, rows, zone, tb, window, width}) {
  const x = tb.slice(2);
  const data = rows.map((d) => ({...d, date: new Date(d.date + "T00:00:00Z")}));
  const name = zoneByKey.get(zone).name;
  const top = x === "1" ? "Daily max" : `Top-${x} mean`;
  const bottom = x === "1" ? "Daily min" : `Bottom-${x} mean`;
  const lines = [
    ["top", x === "1" ? "Max" : `Top-${x}`, MONTH_WARM],
    ["avg", "Avg", "var(--theme-foreground-muted)"],
    ["bottom", x === "1" ? "Min" : `Bottom-${x}`, MONTH_COLD]
  ];
  const last = data.at(-1);
  const ends = last ? lines.map(([key, label, color]) => ({date: last.date, y: last[key], label, color})) : [];
  return Plot.plot({
    title: `${tb.toUpperCase()} spread band — ${name}`,
    subtitle: `${window}-day moving averages of the ${top.toLowerCase()}, ${bottom.toLowerCase()} and daily average price; shading is the ${tb.toUpperCase()} spread`,
    caption: SOURCE,
    width: Math.min(width, 800), height: 380, marginLeft: 50, marginRight: 55,
    x: timeAxis(width, d3),
    y: {grid: true, nice: true, label: "EUR / MWh"},
    color: {type: "linear", scheme: "rdbu", reverse: true, legend: true, label: `${tb.toUpperCase()}, ${window}-day avg (EUR / MWh)`, tickFormat: ".0f"},
    marks: [
      Plot.rectY(data, {
        x1: "date", x2: (d) => d3.utcDay.offset(d.date, 1), y1: "bottom", y2: "top",
        fill: "spread", fillOpacity: 0.55
      }),
      Plot.ruleY([0], {stroke: "var(--theme-foreground-faint)"}),
      Plot.lineY(data, {x: "date", y: "avg", stroke: "var(--theme-foreground-muted)", strokeWidth: 1, strokeDasharray: "3,2"}),
      Plot.lineY(data, {x: "date", y: "top", stroke: MONTH_WARM, strokeWidth: 1.5}),
      Plot.lineY(data, {x: "date", y: "bottom", stroke: MONTH_COLD, strokeWidth: 1.5}),
      Plot.text(ends, {x: "date", y: "y", text: "label", fill: "color", textAnchor: "start", dx: 4, fontSize: 10, clip: false}),
      Plot.ruleX(data, Plot.pointerX({x: "date", insetTop: 20})),
      Plot.tip(data, Plot.pointerX({
        x: "date", y: "top",
        title: (d) => [
          d3.utcFormat("%e %b %Y")(d.date),
          `${top}: ${fmt1(d.top)}`, `Daily average: ${fmt1(d.avg)}`, `${bottom}: ${fmt1(d.bottom)}`,
          `${tb.toUpperCase()}: ${fmt1(d.spread)}`
        ].join("\n")
      }))
    ]
  });
}

/**
 * One running-total line per calendar year on a shared Jan-Dec axis (rows from cumulativeByYear),
 * with the latest year drawn heavier. Days are placed on leap year 2000 so 29 February has a slot.
 */
export function cumulativeYearChart({d3, Plot, rows, width, title, subtitle, label, format = d3.format(",.0f")}) {
  const data = rows.map((d) => ({...d, date: new Date(`2000-${d.day}T00:00:00Z`)}));
  const years = [...new Set(data.map((d) => d.year))].sort();
  const latest = years.at(-1);
  const render = multiSeriesTip(d3, Plot, {y: "year", value: "value", valueFormat: format, header: (d) => d3.utcFormat("%e %b")(d.date), width: 150});
  return Plot.plot({
    title, subtitle, caption: SOURCE,
    width: Math.min(width, 800), height: 320, marginLeft: 55, marginRight: 30,
    x: {line: true, label: null, ticks: d3.utcMonth.every(width < 500 ? 2 : 1), tickFormat: d3.utcFormat("%b")},
    y: {grid: true, nice: true, label, tickFormat: format},
    color: {legend: true, domain: years, range: years.map((_, i) => CATEGORICAL[i % CATEGORICAL.length])},
    marks: [
      Plot.ruleY([0]),
      Plot.lineY(data, {
        x: "date", y: "value", stroke: "year", curve: "step-after",
        strokeWidth: (d) => (d.year === latest ? 2.5 : 1.5)
      }),
      Plot.ruleX(data, Plot.pointerX(Plot.binX({x: "min"}, {x: "date", interval: d3.utcDay, insetTop: 20}))),
      Plot.tip(data, Plot.pointerX(Plot.binX({title: (v) => v, x: "min"}, {x: "date", interval: d3.utcDay, render})))
    ]
  });
}

/**
 * One year's running total of a daily metric for every zone shown: the selected zone in the accent
 * colour and labelled at its end, the others as thin grey steps. `rows`: [{zone, day: "MM-DD",
 * value}]. Hovering shows the nearest zone's value.
 */
export function cumulativeCompareChart({d3, Plot, rows, zone, year, width, title, subtitle, label, format = d3.format(",.0f")}) {
  const data = rows.map((d) => ({...d, date: new Date(`2000-${d.day}T00:00:00Z`), country: zoneByKey.get(d.zone).name}));
  const own = data.filter((d) => d.zone === zone);
  const others = data.filter((d) => d.zone !== zone);
  const end = own.length ? [own.at(-1)] : [];
  return Plot.plot({
    title, subtitle, caption: SOURCE,
    width: Math.min(width, 800), height: 320, marginLeft: 55, marginRight: 45,
    x: {line: true, label: null, ticks: d3.utcMonth.every(width < 500 ? 3 : 2), tickFormat: d3.utcFormat("%b")},
    y: {grid: true, nice: true, label, tickFormat: format},
    marks: [
      Plot.ruleY([0]),
      Plot.lineY(others, {x: "date", y: "value", z: "zone", curve: "step-after", stroke: "var(--theme-foreground-faint)", strokeWidth: 1, strokeOpacity: 0.5}),
      Plot.lineY(own, {x: "date", y: "value", curve: "step-after", stroke: ACCENT, strokeWidth: 2.5}),
      Plot.text(end, {x: "date", y: "value", text: () => zoneByKey.get(zone).short, textAnchor: "start", dx: 5, fill: ACCENT, fontSize: 10, fontWeight: "bold", clip: false}),
      Plot.tip(data, Plot.pointer({
        x: "date", y: "value",
        channels: {Country: "country", [label]: "value"},
        format: {x: (d) => `${d3.utcFormat("%e %b")(d)} ${year}`, y: false, [label]: format, Country: true}
      }))
    ]
  });
}

// ---------------------------------------------------------------------------------------------
// Price vs residual load
// ---------------------------------------------------------------------------------------------

/**
 * Colour scale for the years present in `rows`, hues assigned by position in `years` (every year
 * the page can show) so a year keeps its colour when the month leaves one out, and matches the
 * year-by-year charts that colour the same `years` in order.
 */
function yearColors(rows, years) {
  const present = years.filter((y) => rows.some((d) => d.year === y));
  return {domain: present, range: present.map((y) => CATEGORICAL[years.indexOf(y) % CATEGORICAL.length])};
}

/**
 * Average of `value` by local hour of day, one line per year (hourlyProfiles rows of one month),
 * each labelled at its right end; the latest year drawn heavier. `k` scales the value for display;
 * `domain` (display units) fixes the y scale, e.g. across months.
 */
export function hourlyByYearChart({d3, Plot, rows, years, value, k = 1, domain, title, subtitle, label, format = fmt1, width}) {
  const data = rows.map((d) => ({year: d.year, hour: d.hour, v: d[value] / k}));
  const colors = yearColors(data, years);
  const latest = colors.domain.at(-1);
  const height = 300, marginTop = 20, marginBottom = 35;
  const [lo, hi] = domain ?? d3.extent(data, (d) => d.v);
  const last = separateLabels(
    colors.domain.map((year) => data.filter((d) => d.year === year).at(-1)).map((d) => ({...d, ma: d.v})),
    {yMax: (hi ?? 1) - Math.min(0, lo ?? 0), plotHeight: height - marginTop - marginBottom}
  );
  const render = multiSeriesTip(d3, Plot, {y: "year", value: "v", valueFormat: format, header: (d) => `${String(d.hour).padStart(2, "0")}:00`, width: 130});
  return Plot.plot({
    title, subtitle, caption: SOURCE,
    width, height, marginTop, marginBottom, marginLeft: 45, marginRight: 40,
    x: {label: "hour of day", domain: [0, 23], ticks: [0, 6, 12, 18, 23], line: true},
    y: {grid: true, nice: true, label, domain},
    color: {legend: true, ...colors},
    marks: [
      Plot.ruleY([0]),
      Plot.lineY(data, {x: "hour", y: "v", stroke: "year", strokeWidth: (d) => (d.year === latest ? 2.5 : 1.5)}),
      Plot.text(last, {
        x: "hour", y: "labelY", text: "year", fill: "year", textAnchor: "start", dx: 4, fontSize: 10, fontWeight: "bold", clip: false
      }),
      Plot.ruleX(data, Plot.pointerX(Plot.binX({x: "min"}, {x: "hour", interval: 1, insetTop: 20}))),
      Plot.tip(data, Plot.pointerX(Plot.binX({title: (v) => v, x: "min"}, {x: "hour", interval: 1, render})))
    ]
  });
}

/**
 * Gaussian-kernel smooth of y on x (Nadaraya-Watson) at `n` evenly spaced x values: [{x, y}].
 * Points are pre-binned so a year of hours costs no more than a month. The bandwidth is 1/15 of
 * the x range; the curve stops where fewer than `minN` points lie within one bandwidth, so its ends
 * do not swing on a handful of hours.
 */
function kernelSmooth(points, {n = 80, bins = 300, minN = 20} = {}) {
  if (points.length < minN) return [];
  let lo = Infinity, hi = -Infinity;
  for (const p of points) { if (p.x < lo) lo = p.x; if (p.x > hi) hi = p.x; }
  if (!(hi > lo)) return [];
  const step = (hi - lo) / bins;
  const count = new Float64Array(bins), sum = new Float64Array(bins);
  for (const p of points) {
    const i = Math.min(bins - 1, Math.floor((p.x - lo) / step));
    count[i] += 1; sum[i] += p.y;
  }
  const bw = (hi - lo) / 15;
  const out = [];
  for (let j = 0; j < n; j++) {
    const x = lo + ((hi - lo) * j) / (n - 1);
    let w = 0, wy = 0, near = 0;
    for (let i = 0; i < bins; i++) {
      if (!count[i]) continue;
      const u = (lo + (i + 0.5) * step - x) / bw;
      if (Math.abs(u) <= 1) near += count[i];
      const k = Math.exp(-0.5 * u * u) * count[i];
      w += k; wy += k * (sum[i] / count[i]);
    }
    if (near >= minN) out.push({x, y: wy / w});
  }
  return out;
}

/**
 * Every hour of one calendar month (or of every month) as a dot, day-ahead price against residual
 * load, coloured by year, with a dotted kernel-smoothed average price over all the dots. `rows`:
 * [{year, date, hour, price, rl}] with `rl` in MW. `rlDomain` (MW) and `priceDomain` fix the
 * scales, e.g. across months; hours outside them are clipped. Clicking a year in the legend keeps
 * that year's dots in colour and greys the rest; clicking it again restores all. Pass the same
 * `selection` object ({year}) on every redraw to keep the choice as the chart is rebuilt. With a
 * `brush` (linkedBrush in linking.js), dragging a box picks out its dots and shows the hourly
 * charts on the same brush when in the day they fall, and an hour range brushed there greys the
 * dots of other hours.
 */
export function priceResidualScatter({d3, Plot, rows, years, zone, monthLabel, rlDomain, priceDomain, width, selection = {year: null}, brush = null}) {
  const unit = powerUnit(d3.max(rlDomain ?? d3.extent(rows, (d) => d.rl), Math.abs) ?? 0);
  const data = rows.map((d) => ({...d, x: d.rl / unit.k}));
  // Every year shown keeps its legend entry, so the frame does not shift from month to month.
  const colors = {domain: years, range: years.map((_, i) => CATEGORICAL[i % CATEGORICAL.length])};
  const smooth = kernelSmooth(data.map((d) => ({x: d.x, y: d.price})));
  const w = Math.min(width, 800);
  const r = data.length > 15000 ? 1.4 : 2;
  const dots = []; // [circle, row] in drawing order, filled when the dot mark renders
  const chart = Plot.plot({
    title: `Day-ahead price vs residual load — ${zoneByKey.get(zone).name}, ${monthLabel}, by year`,
    subtitle: `One dot per hour: price against residual load, ${unit.label}`,
    caption: SOURCE,
    width: w, height: Math.round(Math.min(w * 0.7, 480)), marginLeft: 50, marginRight: 20,
    x: {grid: true, nice: true, label: `residual load (${unit.label})`, domain: rlDomain?.map((v) => v / unit.k)},
    y: {grid: true, nice: true, label: "EUR / MWh", domain: priceDomain},
    color: {legend: true, ...colors},
    marks: [
      Plot.ruleY([0]),
      Plot.ruleX([0], {stroke: "var(--theme-foreground-faint)"}),
      Plot.dot(data, {
        x: "x", y: "price", fill: "year", r, fillOpacity: 0.55, clip: true,
        channels: {date: "date", hour: (d) => `${String(d.hour).padStart(2, "0")}:00`},
        tip: {format: {fill: true, date: true, hour: true, x: unit.format, y: fmt1}},
        // The rendered circles follow `index`, so each can be paired with its row.
        render(index, scales, values, dimensions, context, next) {
          const g = next(index, scales, values, dimensions, context);
          dots.length = 0;
          g.querySelectorAll("circle").forEach((c, j) => dots.push([c, data[index[j]]]));
          return g;
        }
      }),
      // A background halo under the dotted curve keeps it readable over the dots.
      Plot.line(smooth, {x: "x", y: "y", stroke: "var(--theme-background)", strokeWidth: 5, curve: "basis", clip: true}),
      Plot.line(smooth, {x: "x", y: "y", stroke: "var(--theme-foreground)", strokeWidth: 2.5, strokeDasharray: "1,4", strokeLinecap: "round", curve: "basis", clip: true})
    ]
  });
  linkScatter(d3, chart, {dots, years, selection, brush, fillOpacity: 0.55});
  return chart;
}

/**
 * The scatter's interactions, applied to the rendered SVG without re-plotting. A dot keeps its
 * colour when it passes both the legend's year (`selection.year`) and the brush (`brush.sel`: an
 * hour range from an hourly chart, or this chart's own box); the rest turn faint grey. The chosen
 * year's dots are moved to the front. Charts passed the same `selection` under different `id`s
 * follow each other's legend: a click in one highlights the year in all.
 */
function linkScatter(d3, chart, {dots, years, selection, brush, fillOpacity, id = "scatter"}) {
  const svg = plotSvg(chart);
  if (!svg || !dots.length) return;
  const group = dots[0][0].parentNode;
  const swatches = [...chart.querySelectorAll("[class$='-swatch']")];
  for (const [c] of dots) c.__fill = c.getAttribute("fill");
  if (selection.year != null && !years.includes(selection.year)) selection.year = null;
  const yearOk = (d) => selection.year == null || d.year === selection.year;
  const brushOk = (d) => {
    const s = brush?.sel;
    if (!s) return true;
    if (s.kind === "hours") return d.hour >= s.h0 && d.hour <= s.h1;
    return d.x >= s.x0 && d.x <= s.x1 && d.price >= s.y0 && d.price <= s.y1;
  };
  const restyle = () => {
    for (const [c, d] of dots) {
      const on = yearOk(d) && brushOk(d);
      if (c.__on === on) continue;
      c.__on = on;
      c.setAttribute("fill", on ? c.__fill : "var(--theme-foreground-faint)");
      c.setAttribute("fill-opacity", on ? fillOpacity : 0.25);
    }
  };
  const reorder = () => {
    // Original order when no year is chosen; otherwise the chosen year's dots drawn last, on top.
    for (const [c, d] of dots) if (selection.year == null || d.year !== selection.year) group.appendChild(c);
    if (selection.year != null) for (const [c, d] of dots) if (d.year === selection.year) group.appendChild(c);
    for (const sw of swatches) sw.style.opacity = selection.year == null || sw.textContent.trim() === selection.year ? 1 : 0.35;
  };
  for (const sw of swatches) {
    const year = sw.textContent.trim();
    if (!years.includes(year)) continue;
    sw.style.cursor = "pointer";
    sw.title = "Click to highlight this year; click again to show all";
    sw.addEventListener("click", () => {
      selection.year = selection.year === year ? null : year;
      for (const redraw of selection.views.values()) redraw();
      if (brush?.sel?.kind === "box") brush.notify(); // the hourly charts weigh the chosen year only
    });
  }
  // Non-enumerable, so a selection object kept on a page holds just its year for the smoke test.
  if (!selection.views) Object.defineProperty(selection, "views", {value: new Map()});
  selection.views.set(id, () => { reorder(); restyle(); });
  reorder();
  if (!brush) return restyle();

  const x = chart.scale("x"), y = chart.scale("y");
  const [l, r] = d3.extent(x.range), [t, b] = d3.extent(y.range);
  const box = d3.brush().extent([[l, t], [r, b]]);
  const g = d3.select(svg).append("g").call(box).call(outlineBrush);
  const token = {};
  let quiet = false;
  box.on("brush end", ({selection: px, sourceEvent}) => {
    if (quiet || !sourceEvent) return;
    if (!px) return brush.set(null, token);
    const [[x0, y1], [x1, y0]] = px.map(([a, c]) => [x.invert(a), y.invert(c)]);
    brush.set({kind: "box", x0, x1, y0, y1}, token);
  });
  // Share of the picked dots at each hour of day, for the hourly charts: 1 for the busiest hour.
  const weigh = () => {
    const n = new Array(24).fill(0);
    for (const [, d] of dots) if (yearOk(d) && brushOk(d)) n[d.hour] += 1;
    const max = Math.max(...n);
    return n.map((v) => (max ? v / max : 0));
  };
  const redraw = () => {
    restyle();
    quiet = true;
    const s = brush.sel;
    if (s?.kind !== "box") g.call(box.move, null);
    else if (brush.source !== token) g.call(box.move, [[x.apply(s.x0), y.apply(s.y1)], [x.apply(s.x1), y.apply(s.y0)]]);
    quiet = false;
  };
  brush.weigh = weigh;
  brush.views.set("scatter", redraw);
  // A box kept from the previous month now holds other dots: let the hourly charts reweigh.
  if (brush.sel?.kind === "box") brush.notify();
  else redraw();
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Cyclic two-colour month palette: cold blue in mid-winter (Jan), warm red in mid-summer (Jul),
// passing through a light neutral grey at the equinox months (Apr, Oct; pure white would vanish
// on the light theme), blended along a cosine of the month so Dec sits next to Jan and spring
// mirrors autumn.
const MONTH_COLD = "#2f5aa8", MONTH_MID = "#c4c4c4", MONTH_WARM = "#d7301f";
function monthCycle(d3) {
  const mix = d3.piecewise(d3.interpolateLab, [MONTH_COLD, MONTH_MID, MONTH_WARM]);
  return (t) => mix((1 - Math.cos((2 * Math.PI * (t * 11)) / 12)) / 2); // t: 0 = Jan, 1 = Dec
}

/**
 * One year's months built up one at a time: the average of `value` by local hour of day for each
 * month up to `upTo` ("01"-"12"), coloured on a cyclic seasonal palette (monthCycle: cold in
 * winter, warm in summer), the newest month drawn heavier and labelled. `rows`: hourlyProfiles rows of one year.
 * `domain` (display units) fixes the y scale so the frames compare.
 */
export function monthBuildChart({d3, Plot, rows, upTo, value, k = 1, domain, title, subtitle, label, format = fmt1, width}) {
  const data = rows.filter((d) => d.month <= upTo).map((d) => ({month: +d.month, hour: d.hour, v: d[value] / k}));
  const newest = d3.max(data, (d) => d.month);
  const render = multiSeriesTip(d3, Plot, {y: "month", label: "name", value: "v", valueFormat: format, header: (d) => `${String(d.hour).padStart(2, "0")}:00`, width: 130});
  const tipData = data.map((d) => ({...d, name: MONTH_ABBR[d.month - 1]}));
  return Plot.plot({
    title, subtitle, caption: SOURCE,
    width, height: 300, marginTop: 20, marginBottom: 35, marginLeft: 45, marginRight: 40,
    x: {label: "hour of day", domain: [0, 23], ticks: [0, 6, 12, 18, 23], line: true},
    y: {grid: true, nice: true, label, domain},
    color: {
      type: "linear", domain: [1, 12], interpolate: monthCycle(d3),
      legend: true, ticks: [1, 4, 7, 10, 12], tickFormat: (m) => MONTH_ABBR[m - 1], label: null
    },
    marks: [
      Plot.ruleY([0]),
      Plot.lineY(data, {
        x: "hour", y: "v", z: "month", stroke: "month",
        strokeWidth: (d) => (d.month === newest ? 3 : 1.25), strokeOpacity: (d) => (d.month === newest ? 1 : 0.8)
      }),
      Plot.text(data.filter((d) => d.month === newest && d.hour === 23), {
        x: "hour", y: "v", text: (d) => MONTH_ABBR[d.month - 1], textAnchor: "start", dx: 4,
        fill: "var(--theme-foreground)", fontSize: 10, fontWeight: "bold", clip: false
      }),
      Plot.ruleX(tipData, Plot.pointerX(Plot.binX({x: "min"}, {x: "hour", interval: 1, insetTop: 20}))),
      Plot.tip(tipData, Plot.pointerX(Plot.binX({title: (v) => v, x: "min"}, {x: "hour", interval: 1, render})))
    ]
  });
}

/**
 * Play/pause control stepping through `values` (an Inputs-style element: `value` is the current
 * step, an "input" event fires on each change). Starts on `value` (default the last step);
 * setting `value` from outside moves the slider without firing "input", so another control can
 * drive it (see linkValue in linking.js). Autoplays once on the page unless `autoplay` is false, pauses on the last step for
 * `endDelay` ms and loops; with `loop: false`, Play runs once through to the last step and stops. Stops ticking when removed from the page (e.g. when its cell re-runs).
 * Scrubbers given the same `group` (from playGroup) share Play/Pause: one plays at a time, every
 * button shows it, and Pause or a drag on any of them stops it.
 */
export function scrubber(values, {format = (v) => v, delay = 900, endDelay = 2500, autoplay = true, loop = true, label = "", value, group = null} = {}) {
  const form = document.createElement("form");
  form.style.cssText = "display: flex; align-items: center; gap: 0.6em; font: 13px var(--sans-serif); margin: 0.5em 0;";
  form.innerHTML = `<span style="min-width: 120px">${label}</span><button type="button" style="width: 5em"></button>
    <input type="range" min="0" max="${values.length - 1}" step="1" style="width: 200px">
    <output style="min-width: 3em; font-weight: bold"></output>`;
  const [button, range, output] = [form.querySelector("button"), form.querySelector("input"), form.querySelector("output")];
  let i = Math.max(0, value === undefined ? values.length - 1 : values.indexOf(value)), timer = null;
  const show = () => {
    range.value = i; output.value = format(values[i]);
  };
  Object.defineProperty(form, "value", {
    get: () => values[i],
    set: (v) => {
      const j = values.indexOf(v);
      if (j >= 0 && j !== i) { i = j; show(); }
    }
  });
  const set = (j) => {
    i = j; show(); form.dispatchEvent(new Event("input", {bubbles: true}));
  };
  if (group) group.buttons.add(button);
  const playing = () => (group ? group.stop !== null : timer !== null);
  const showButtons = (text) => {
    if (!group) return void (button.textContent = text);
    for (const b of group.buttons) {
      if (b !== button && !b.isConnected) group.buttons.delete(b); // its cell re-ran
      else b.textContent = text;
    }
  };
  const stop = () => {
    clearTimeout(timer); timer = null;
    if (group?.stop === stop) group.stop = null;
    showButtons("Play");
  };
  // Stop whichever scrubber of the group is playing (this one without a group).
  const stopAll = () => (group?.stop ?? stop)();
  const tick = () => {
    if (!form.isConnected) return stop();
    set(i < values.length - 1 ? i + 1 : 0);
    if (!loop && i === values.length - 1) return stop();
    timer = setTimeout(tick, i === values.length - 1 ? endDelay : delay);
  };
  const play = () => {
    group?.stop?.();
    if (group) group.stop = stop;
    if (i === values.length - 1) i = -1; // restart from the first step
    showButtons("Pause");
    timer = setTimeout(tick, 0);
  };
  button.onclick = () => (playing() ? stopAll() : play());
  range.oninput = (event) => {
    event.stopPropagation(); stopAll(); set(+range.value);
  };
  form.onsubmit = (event) => event.preventDefault();
  button.textContent = playing() ? "Pause" : "Play";
  show();
  // Start once the form is on the page, so a cell that never displays it never ticks.
  if (autoplay) setTimeout(() => form.isConnected && play(), 500);
  return form;
}

/** Shared Play/Pause state for the scrubbers given it as `group`. */
export function playGroup() {
  return {buttons: new Set(), stop: null};
}

// ---------------------------------------------------------------------------------------------
// Generation mix
// ---------------------------------------------------------------------------------------------

/**
 * Plot colour scale for the generation groups. The values are CSS custom properties (style.css),
 * so dark mode swaps in its own validated steps without re-rendering.
 */
export const GEN_COLORS = {
  domain: GEN_GROUPS.map((g) => g.label),
  range: GEN_GROUPS.map((g) => `var(--gen-${g.key})`)
};

/** Fill opacity for the stacked generation areas and bars (and their legend swatches): full-strength
 * fills read too harsh in large blocks. */
export const GEN_OPACITY = 0.8;

const genLabel = (key) => genGroupByKey.get(key).label;
const pct = (x) => (x == null ? undefined : `${Math.round(x * 100)}%`);

/**
 * Energy unit for a series whose largest value is `max` GWh: TWh for national-scale systems,
 * GWh for the smallest, so the axis never reads 0.1-0.4 TWh or 40,000 GWh. `format` is for
 * tooltips and labels, precise enough that a minor type's slice does not read as 0.0.
 */
function energyUnit(max) {
  return max >= 1000 ? {label: "TWh", k: 1000, format: (x) => x.toFixed(x < 10 ? 2 : 1)} : {label: "GWh", k: 1, format: (x) => x.toFixed(0)};
}

/** Power unit for a series whose largest value is `max` MW (see energyUnit). */
function powerUnit(max) {
  return max >= 1000 ? {label: "GW", k: 1000, format: (x) => x.toFixed(x < 10 ? 2 : 1)} : {label: "MW", k: 1, format: (x) => x.toFixed(0)};
}

// Donut sizes on the mix map: the largest system's outer radius as a share of the map width, and
// a floor so the smallest systems (≈ 2 TWh against Germany's ≈ 440) stay visible and hoverable.
// A hovered donut grows to at least DONUT_HOVER_R (share of map width) so its labels have room.
const DONUT_MAX_R = 0.065;
const DONUT_MIN_R = 7;
const DONUT_HOVER_R = 0.085;
const CALLOUT_MIN_SHARE = 0.01; // slices below 1% get no callout (still in the ring)

/**
 * Callout positions for a donut of outer radius `R`: a leader from each slice's mid-angle to a
 * label in a column on that slice's side, labels pushed apart vertically by at least `gap` px.
 */
function donutCallouts(slices, R, gap) {
  const items = slices.filter((s) => s.data.share >= CALLOUT_MIN_SHARE).map((s) => {
    const a = (s.startAngle + s.endAngle) / 2;
    const [dx, dy] = [Math.sin(a), -Math.cos(a)];
    return {s, side: dx >= 0 ? 1 : -1, x0: dx * (R + 1), y0: dy * (R + 1), x1: dx * (R + 9), y1: dy * (R + 9), ly: dy * (R + 9)};
  });
  for (const side of [-1, 1]) {
    const col = items.filter((d) => d.side === side).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < col.length; i++) col[i].ly = Math.max(col[i].ly, col[i - 1].ly + gap);
    // Re-centre a column that the push moved down, so it does not all hang below the donut.
    const shift = col.length ? col.reduce((t, d) => t + d.ly - d.y1, 0) / col.length : 0;
    for (const d of col) d.ly -= shift;
    for (let i = 1; i < col.length; i++) col[i].ly = Math.max(col[i].ly, col[i - 1].ly + gap);
  }
  return items.map((d) => ({...d, lx: d.side * (R + 18)}));
}

/**
 * One donut per zone at its label anchor: slices are the zone's generation mix over the year, and
 * the donut's area is proportional to its total generation (above a minimum size). Hovering a
 * country (its shape or its donut) brings its donut to the front, grows it, and labels every type
 * with its share. Returns the Plot figure; its `value` is the hovered zone's row ({zone, …}) or
 * null. `mix` is annualMix output: [{zone, total (GWh), mix: Map(group → GWh)}].
 */
export function mixMap({d3, Plot, geo, mix, zones = ZONE_KEYS, selected, width, year}) {
  const byZone = new Map(mix.filter((d) => zones.includes(d.zone)).map((d) => [d.zone, d]));
  const {inScope, context} = splitFeatures(geo, zones);
  const zoneOf = zoneOfFeature;
  const w = Math.min(width, 800);
  const maxR = Math.max(28, w * DONUT_MAX_R);
  const hoverR = Math.max(48, w * DONUT_HOVER_R);

  // Biggest first, so smaller donuts overlapping a neighbour are drawn on top of it.
  const points = ZONES.filter((z) => byZone.has(z.key))
    .map((z) => {
      const [lon, lat] = zoneAnchor(d3, inScope, z);
      const {total, mix: groups} = byZone.get(z.key);
      const share = Object.fromEntries(GEN_GROUPS.map((g) => [g.key, (groups.get(g.key) ?? 0) / total]));
      return {zone: z.key, name: z.name, short: z.short, lon, lat, twh: total / 1000, share};
    })
    .sort((a, b) => b.twh - a.twh);
  const pointByZone = new Map(points.map((p) => [p.zone, p]));
  const missing = ZONES.filter((z) => zones.includes(z.key) && !byZone.has(z.key)).map((z) => {
    const [lon, lat] = zoneAnchor(d3, inScope, z);
    return {zone: z.key, lon, lat, text: `${z.short}\nn/a`};
  });

  const fontSize = w < 500 ? 8 : 10;
  const calloutSize = w < 500 ? 9 : 11;
  const radius = (r) => Math.max(DONUT_MIN_R, r);
  const halo = (sel, width = 3) => sel.attr("stroke", "var(--theme-background)").attr("stroke-width", width).attr("paint-order", "stroke");

  // Per zone, what hover needs to animate: filled in when the donuts render.
  const donutsByZone = new Map();

  function donuts(index, scales, values, dimensions, context) {
    const g = d3.create("svg:g");
    const pie = d3.pie().sort(null).value((d) => d.share);
    for (const i of index) {
      const p = points[i];
      const r = radius(values.r[i]);
      const R = Math.max(hoverR, r * 1.3);
      const slices = pie(GEN_GROUPS.map((group) => ({group, share: p.share[group.key]}))).filter((s) => s.data.share > 0);
      const gi = g.append("g").attr("transform", `translate(${values.x[i]},${values.y[i]})`).attr("data-zone", p.zone);
      // A surface disc separates overlapping neighbours; the selected zone also gets an ink ring.
      const disc = gi.append("circle").attr("fill", "var(--theme-background)");
      const ring = p.zone === selected ? gi.append("circle").attr("fill", "none").attr("stroke", "currentColor").attr("stroke-width", 2) : null;
      const paths = gi.selectAll("path").data(slices).join("path")
        .attr("fill", (d) => `var(--gen-${d.data.group.key})`)
        .attr("stroke", "var(--theme-background)");
      const draw = (rad) => {
        const arc = d3.arc().innerRadius(rad * 0.5).outerRadius(rad);
        disc.attr("r", rad + 2);
        ring?.attr("r", rad + 3);
        paths.attr("d", arc).attr("stroke-width", rad > 14 ? 1 : 0.5);
      };
      draw(r);
      const name = gi.append("text")
        .attr("y", -r - 5).attr("text-anchor", "middle").attr("font-size", fontSize)
        .attr("font-weight", p.zone === selected ? "bold" : "normal")
        .attr("fill", "var(--theme-foreground)")
        .call(halo)
        .text(p.short);

      // Shown on hover: country and total in the hole, a callout per type around the ring.
      const detail = gi.append("g").attr("opacity", 0).attr("pointer-events", "none").attr("font-size", calloutSize);
      const centre = detail.append("text").attr("text-anchor", "middle").attr("fill", "var(--theme-foreground)");
      centre.append("tspan").attr("x", 0).attr("dy", "-0.2em").attr("font-weight", "bold").text(p.short);
      centre.append("tspan").attr("x", 0).attr("dy", "1.2em").text(`${p.twh.toFixed(p.twh < 10 ? 1 : 0)} TWh`);
      const callouts = donutCallouts(slices, R, calloutSize + 3);
      for (const c of callouts) {
        detail.append("polyline")
          .attr("points", [[c.x0, c.y0], [c.x1, c.y1], [c.lx - c.side * 4, c.ly]].join(" "))
          .attr("fill", "none").attr("stroke", "var(--theme-foreground-muted)").attr("stroke-width", 0.75);
        const t = detail.append("text").attr("x", c.lx).attr("y", c.ly).attr("dy", "0.32em")
          .attr("text-anchor", c.side > 0 ? "start" : "end").attr("fill", "var(--theme-foreground)").call(halo, 4);
        t.append("tspan").text(`${c.s.data.group.label} `);
        t.append("tspan").attr("font-weight", "bold").text(pct(c.s.data.share));
      }
      // Grown, a donut near the frame edge would spill out (Estonia over the legend): find the
      // shift that keeps the donut and its callout columns inside the frame.
      const [x, y] = [values.x[i], values.y[i]];
      const top = Math.min(-R - 4, ...callouts.map((c) => c.ly - calloutSize));
      const bottom = Math.max(R + 4, ...callouts.map((c) => c.ly + calloutSize));
      const [y0, y1] = [dimensions.marginTop, dimensions.height - dimensions.marginBottom];
      const [x0, x1] = [dimensions.marginLeft, dimensions.width - dimensions.marginRight];
      const dy = y + top < y0 ? y0 - (y + top) : y + bottom > y1 ? y1 - (y + bottom) : 0;
      const dx = x - R - 4 < x0 ? x0 - (x - R - 4) : x + R + 4 > x1 ? x1 - (x + R + 4) : 0;
      donutsByZone.set(p.zone, {gi, r, R, x, y, dx, dy, draw, name, detail, t: 0});
    }
    // Size key: two reference donuts' outlines in the lower-left corner.
    const refs = [100, 10].filter((v) => scales.r(v) >= DONUT_MIN_R);
    const big = scales.r(refs[0] ?? 10);
    const key = g.append("g").attr("transform", `translate(${dimensions.marginLeft + big + 8},${dimensions.height - dimensions.marginBottom - 8})`)
      .attr("fill", "none").attr("stroke", "var(--theme-foreground-muted)");
    for (const v of refs) {
      const r = scales.r(v);
      key.append("circle").attr("cy", -r).attr("r", r);
      key.append("text").attr("x", big + 6).attr("y", -2 * r + 4).attr("stroke", "none").attr("text-anchor", "start")
        .attr("fill", "var(--theme-foreground-muted)").attr("font-size", fontSize).text(`${v} TWh`);
    }

    // One listener for the whole map: the country under the pointer is the nearest element
    // tagged with data-zone (a country shape, or a donut, which may overlap its neighbours).
    const svg = context.ownerSVGElement;
    svg.style.overflow = "visible"; // callouts of a donut near the edge may spill past the frame
    svg.addEventListener("pointermove", (event) => highlight(event.target.closest?.("[data-zone]")?.dataset.zone ?? null));
    svg.addEventListener("pointerleave", () => highlight(null));
    return g.node();
  }

  // Grow a donut to its hover size (and shift it inside the frame), or shrink it back, by redrawing
  // its arcs (crisp at every size, unlike scaling), then fade its labels in or out.
  function animate(d, show) {
    d.gi.interrupt();
    const [from, to] = [d.t, show ? 1 : 0];
    d.gi.transition().duration(180).ease(d3.easeCubicOut)
      .tween("grow", () => (k) => {
        const t = (d.t = from + (to - from) * k);
        d.draw(d.r + (d.R - d.r) * t);
        d.gi.attr("transform", `translate(${d.x + d.dx * t},${d.y + d.dy * t})`);
      });
    d.detail.interrupt().transition().delay(show ? 120 : 0).duration(show ? 140 : 80).attr("opacity", show ? 1 : 0);
    d.name.attr("opacity", show ? 0 : 1);
  }

  let active = null;
  function highlight(zone) {
    if (zone === active) return;
    if (donutsByZone.has(active)) animate(donutsByZone.get(active), false);
    active = zone;
    const d = donutsByZone.get(zone);
    if (d) {
      d.gi.raise();
      animate(d, true);
    }
    // Grey out the other donuts (desaturate and dim) so the hovered one stands alone and its
    // callouts read cleanly where they cross them.
    for (const [z, o] of donutsByZone) {
      const muted = d && z !== zone;
      o.gi.attr("opacity", muted ? 0.35 : 1).style("filter", muted ? "grayscale(1)" : null);
    }
    plot.value = zone ? pointByZone.get(zone) ?? {zone} : null;
  }

  const plot = Plot.plot({
    title: `Generation mix — ${year}`,
    subtitle: "Share of each type; donut area ∝ total generation. Hover for the breakdown",
    caption: SOURCE,
    width: w,
    height: mapHeight(d3, inScope, w),
    projection: {type: "conic-equal-area", parallels: [40, 58], rotate: [-10, 0], domain: {type: "FeatureCollection", features: inScope}, inset: 6},
    r: {domain: [0, d3.max(points, (d) => d.twh) ?? 1], range: [0, maxR]},
    color: {legend: true, ...GEN_COLORS},
    marks: [
      Plot.geo(context, {fill: "var(--theme-foreground-faintest)", stroke: "var(--theme-background)", strokeWidth: 0.5, clip: "frame"}),
      Plot.geo(inScope, {
        fill: "var(--theme-background-alt)", stroke: "var(--theme-foreground-muted)", strokeWidth: 0.5,
        // Tag each shape with its zone for the hover listener.
        render(index, scales, values, dimensions, context, next) {
          const g = next(index, scales, values, dimensions, context);
          g.querySelectorAll("path").forEach((path, j) => path.setAttribute("data-zone", zoneOf(inScope[index[j]])));
          return g;
        }
      }),
      Plot.geo(inScope.filter((f) => zoneOf(f) === selected), {stroke: "currentColor", strokeWidth: 2}),
      // Under the donuts, so a grown donut covers a neighbouring "n/a" rather than the reverse.
      Plot.text(missing, {
        x: "lon", y: "lat", text: "text", fontSize, lineHeight: 1.1, pointerEvents: "none",
        fill: "var(--theme-foreground-muted)", stroke: "var(--theme-background)", strokeWidth: 3, paintOrder: "stroke"
      }),
      Plot.dot(points, {x: "lon", y: "lat", r: "twh", render: donuts}),
      // Draws nothing (zero radius); its fill binds the colour scale so the legend lists every type.
      Plot.dot(GEN_COLORS.domain, {fill: (d) => d, r: 0})
    ]
  });
  plot.value = null;
  plot.style.cursor = "pointer";
  return plot;
}

/**
 * Monthly generation by type for one zone, stacked. `rows`: [{month, group, gwh}] for the zone.
 */
export function generationAreaChart({d3, Plot, rows, zone, width, height = 320}) {
  const unit = energyUnit(d3.max(d3.rollups(rows, (v) => d3.sum(v, (d) => d.gwh), (d) => d.month), ([, v]) => v) ?? 0);
  const data = completeGrid(rows, (d) => d.month, "gwh")
    .map((d) => ({date: new Date(d.month + "T00:00:00Z"), label: genLabel(d.group), value: d.gwh / unit.k}));
  const render = multiSeriesTip(d3, Plot, {y: "label", value: "value", valueFormat: unit.format, header: (d) => d3.utcFormat("%B %Y")(d.date), width: 190});
  return Plot.plot({
    title: `Monthly generation by type — ${zoneByKey.get(zone).name}`,
    subtitle: `Actual generation per calendar month, ${unit.label}`,
    caption: SOURCE,
    width, height, marginLeft: 45, marginRight: 15,
    x: timeAxis(width, d3),
    y: {grid: true, nice: true, label: unit.label},
    color: GEN_COLORS, // legend shared with capacityChart, drawn by the page above both
    marks: [
      Plot.areaY(data, {x: "date", y: "value", fill: "label", fillOpacity: GEN_OPACITY, order: GEN_COLORS.domain, stroke: "var(--theme-background)", strokeWidth: 0.75}),
      Plot.ruleY([0]),
      Plot.ruleX(data, Plot.pointerX(Plot.binX({x: "min"}, {x: "date", interval: d3.utcMonth, insetTop: 20}))),
      Plot.tip(data, Plot.pointerX(Plot.binX({title: (v) => v, x: "min"}, {x: "date", interval: d3.utcMonth, render})))
    ]
  });
}

/**
 * Installed capacity by type for one zone, one stacked column per annual snapshot given, total on
 * top. `rows`: [{year, group, mw}] for the zone.
 */
export function capacityChart({d3, Plot, rows, zone, width, height = 320}) {
  const totals = d3.rollups(rows, (v) => d3.sum(v, (d) => d.mw), (d) => d.year).map(([year, mw]) => ({year, mw}));
  const unit = powerUnit(d3.max(totals, (d) => d.mw) ?? 0);
  const data = rows.map((d) => ({year: d.year, label: genLabel(d.group), value: d.mw / unit.k}));
  return Plot.plot({
    title: totals.length === 1 ? `Installed capacity, ${totals[0].year}` : "Installed capacity",
    subtitle: `ENTSO-E annual snapshot, ${unit.label}`,
    width, height, marginLeft: 45, marginRight: 10,
    // A lone column at the default padding would be a slab two-thirds of the panel wide.
    x: {label: null, type: "band", padding: totals.length === 1 ? 0.5 : 0.25},
    y: {grid: true, nice: true, label: unit.label},
    color: GEN_COLORS,
    marks: [
      Plot.barY(data, {
        x: "year", y: "value", fill: "label", fillOpacity: GEN_OPACITY, order: GEN_COLORS.domain,
        stroke: "var(--theme-background)", strokeWidth: 1,
        tip: {format: {x: true, y: unit.format, fill: true}}
      }),
      Plot.ruleY([0]),
      Plot.text(totals, {
        x: "year", y: (d) => d.mw / unit.k, text: (d) => unit.format(d.mw / unit.k), dy: -7,
        fill: "var(--theme-foreground)", fontSize: 10
      })
    ]
  });
}

/**
 * Average generation by type and local hour of day, one stacked panel per season (2 × 2), all on
 * one y scale. `rows`: [{season, hour, group, mw}] for the zone and year.
 */
export function seasonalProfileChart({d3, Plot, rows, zone, year, width}) {
  const unit = powerUnit(d3.max(d3.rollups(rows, (v) => d3.sum(v, (d) => d.mw), (d) => d.season, (d) => d.hour).flatMap(([, hs]) => hs), ([, v]) => v) ?? 0);
  const pos = new Map(SEASONS.map((s, i) => [s.key, {col: i % 2, row: Math.floor(i / 2), name: s.label}]));
  const data = completeGrid(rows, (d) => `${d.season}|${d.hour}`, "mw")
    .map((d) => ({...pos.get(d.season), hour: d.hour, label: genLabel(d.group), value: d.mw / unit.k}));
  const render = multiSeriesTip(d3, Plot, {y: "label", value: "value", valueFormat: unit.format, header: (d) => `${d.name}, ${String(d.hour).padStart(2, "0")}:00`, width: 180});
  const w = Math.min(width, 800);
  return Plot.plot({
    title: `Typical day by season — ${zoneByKey.get(zone).name}, ${year}`,
    subtitle: `Average generation by type and local hour, ${unit.label}; winter = January, February and December of the year`,
    caption: SOURCE,
    width: w, height: 60 + 2 * (w < 500 ? 170 : 210), marginLeft: 45, marginRight: 15,
    x: {label: "hour of day", domain: [0, 23], ticks: [0, 6, 12, 18, 23], line: true},
    y: {grid: true, nice: true, label: unit.label},
    fx: {axis: null}, fy: {axis: null},
    color: {legend: true, opacity: GEN_OPACITY, ...GEN_COLORS},
    marks: [
      Plot.areaY(data, {x: "hour", y: "value", fx: "col", fy: "row", fill: "label", fillOpacity: GEN_OPACITY, order: GEN_COLORS.domain, stroke: "var(--theme-background)", strokeWidth: 0.75}),
      Plot.ruleY([0]),
      Plot.text(SEASONS.map((s) => pos.get(s.key)), {fx: "col", fy: "row", text: "name", frameAnchor: "top-left", dx: 4, dy: 2, fontWeight: "bold"}),
      Plot.ruleX(data, Plot.pointerX(Plot.binX({x: "min"}, {x: "hour", fx: "col", fy: "row", interval: 1, insetTop: 20}))),
      Plot.tip(data, Plot.pointerX(Plot.binX({title: (v) => v, x: "min"}, {x: "hour", fx: "col", fy: "row", interval: 1, render})))
    ]
  });
}

// ---------------------------------------------------------------------------------------------
// Generation mix by hour of one month
// ---------------------------------------------------------------------------------------------

const HOUR_FRAME = {marginLeft: 50, marginRight: 45};
const hourAxis = (label) => ({label, domain: [0, 23], ticks: [0, 3, 6, 9, 12, 15, 18, 21, 23], line: true});
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

/**
 * Average generation by group at each local hour of one month, stacked, with average load as a
 * dashed line: where the stack falls short of the load the zone imports, where it overshoots it
 * exports or charges storage. `rows`: monthHourProfiles output for the month (load as "load").
 */
export function hourlyMixChart({d3, Plot, rows, zone, label, width}) {
  const gen = rows.filter((d) => d.group !== "load");
  const loadAt = new Map(rows.filter((d) => d.group === "load").map((d) => [d.hour, d.mw]));
  const totals = d3.rollups(gen, (v) => d3.sum(v, (d) => d.mw), (d) => d.hour).map(([, v]) => v);
  const unit = powerUnit(d3.max([...totals, ...loadAt.values()]) ?? 0);
  const data = completeGrid(gen, (d) => String(d.hour), "mw")
    .map((d) => ({hour: d.hour, label: genLabel(d.group), value: d.mw / unit.k, load: loadAt.get(d.hour)}));
  const load = [...loadAt].map(([hour, mw]) => ({hour, value: mw / unit.k})).sort((a, b) => a.hour - b.hour);
  const header = (d) => `${hh(d.hour)}${d.load == null ? "" : ` · load ${unit.format(d.load / unit.k)} ${unit.label}`}`;
  const render = multiSeriesTip(d3, Plot, {y: "label", value: "value", valueFormat: unit.format, header, width: 200});
  return Plot.plot({
    title: `Generation mix by hour — ${zoneByKey.get(zone).name}, ${label}`,
    subtitle: `Average generation by type and local hour, ${unit.label}; dashed: load. Below load = imports, above = exports or storage`,
    caption: SOURCE,
    width: Math.min(width, 800), height: 320, ...HOUR_FRAME,
    x: hourAxis("hour of day"),
    y: {grid: true, nice: true, label: unit.label},
    color: {legend: true, opacity: GEN_OPACITY, ...GEN_COLORS},
    marks: [
      Plot.areaY(data, {x: "hour", y: "value", fill: "label", fillOpacity: GEN_OPACITY, order: GEN_COLORS.domain, stroke: "var(--theme-background)", strokeWidth: 0.75}),
      Plot.ruleY([0]),
      Plot.lineY(load, {x: "hour", y: "value", stroke: "var(--theme-foreground)", strokeWidth: 2, strokeDasharray: "5,3"}),
      Plot.text(load.slice(-1), {x: "hour", y: "value", text: () => "Load", textAnchor: "start", dx: 5, fontSize: 10, fill: "var(--theme-foreground)", clip: false}),
      Plot.ruleX(data, Plot.pointerX(Plot.binX({x: "min"}, {x: "hour", interval: 1, insetTop: 20}))),
      Plot.tip(data, Plot.pointerX(Plot.binX({title: (v) => v, x: "min"}, {x: "hour", interval: 1, render})))
    ]
  });
}

// ---------------------------------------------------------------------------------------------
// Capture factors
// ---------------------------------------------------------------------------------------------

const pct0 = (x) => `${Math.round(x * 100)}%`;
// Percentage points of baseload, signed: a decomposition term.
const pp = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pt`;
const monthShort = (month) => new Date(month + "T00:00:00Z").toLocaleDateString("en-GB", {timeZone: "UTC", month: "short", year: "numeric"});

/**
 * Capture factor of one technology over time, one line per selected zone: per calendar year
 * (`resolution` "annual", rows from annualFactors) or per season (rows from seasonalFactors).
 * A year still in progress (`months` < 12) joins its line with a dashed segment and a hollow dot.
 * `keys` are the selected zone keys, so colours match the other chart of the pair; `domain` fixes
 * the y scale so the solar and wind charts share it.
 */
export function captureLines({d3, Plot, rows, keys, tech, resolution, width, domain, height = 320}) {
  const annual = resolution === "annual";
  const label = captureTechByKey.get(tech).label;
  const data = rows
    .map((d) => ({
      ...d, name: zoneByKey.get(d.zone).name, open: annual && d.months < 12,
      x: annual ? +d.period : new Date(d.period + "T00:00:00Z")
    }))
    .sort((a, b) => a.x - b.x);
  const closed = data.filter((d) => !d.open);
  // The dashed run: each zone's last complete year to its year in progress.
  const dashed = data.filter((d) => d.open).flatMap((o) => {
    const prev = closed.find((d) => d.zone === o.zone && d.x === o.x - 1);
    return prev ? [prev, o] : [];
  });
  const marginTop = 20, marginBottom = 30;
  const [lo, hi] = domain ?? d3.extent(data, (d) => d.value);
  const present = keys.filter((k) => data.some((d) => d.zone === k));
  // End labels stay inside a capped scale (the page cuts capture factors at 200%).
  const last = separateLabels(present.map((k) => data.filter((d) => d.zone === k).at(-1)).map((d) => ({...d, ma: Math.min(d.value, hi)})), {
    yMax: hi - lo, plotHeight: height - marginTop - marginBottom
  });
  const header = annual
    ? (d) => (d.open ? `${d.period} (Jan–${new Date(Date.UTC(2000, d.months - 1, 1)).toLocaleDateString("en-GB", {timeZone: "UTC", month: "short"})})` : d.period)
    : seasonLabel;
  const render = multiSeriesTip(d3, Plot, {y: "name", value: "value", valueFormat: pct0, header, width: 200});
  const years = annual ? d3.range(d3.min(data, (d) => d.x) ?? 2021, (d3.max(data, (d) => d.x) ?? 2021) + 1) : null;
  return Plot.plot({
    title: `${label} capture factor — ${annual ? "by year" : "by season"}`,
    subtitle: annual
      ? `Output-weighted ÷ baseload day-ahead price per calendar year; dashed: year to date`
      : `Output-weighted ÷ baseload day-ahead price per season; winter is December to February`,
    caption: SOURCE,
    width: Math.min(width, 800), height, marginTop, marginBottom, marginLeft: 45, marginRight: 45,
    x: annual ? {label: null, line: true, ticks: years, tickFormat: "d", inset: 8} : timeAxis(width, d3),
    y: {grid: true, label: "capture factor", tickFormat: ".0%", domain: [lo, hi]},
    color: {legend: true, ...seriesColors(keys)},
    marks: [
      Plot.ruleY([1], {stroke: "var(--theme-foreground-muted)", strokeDasharray: "2,2"}),
      Plot.lineY(closed, {x: "x", y: "value", stroke: "name", z: "zone", strokeWidth: 1.5, clip: true}),
      Plot.lineY(dashed, {x: "x", y: "value", stroke: "name", z: "zone", strokeWidth: 1.5, strokeDasharray: "3,3", clip: true}),
      ...(annual
        ? [
            Plot.dot(closed, {x: "x", y: "value", fill: "name", r: 2.5, clip: true}),
            Plot.dot(data.filter((d) => d.open), {x: "x", y: "value", stroke: "name", fill: "var(--theme-background)", r: 3, clip: true})
          ]
        : []),
      Plot.text(last, {
        x: "x", y: "labelY", text: (d) => zoneByKey.get(d.zone).short, textAnchor: "start", dx: 5,
        fill: "var(--theme-foreground)", fontSize: 10, clip: false
      }),
      Plot.ruleX(data, Plot.pointerX(Plot.binX({x: "min"}, {x: "x", interval: annual ? 1 : d3.utcMonth, insetTop: 20}))),
      Plot.tip(data, Plot.pointerX(Plot.binX({title: (v) => v, x: "min"}, {x: "x", interval: annual ? 1 : d3.utcMonth, render})))
    ]
  });
}

/**
 * Monthly capture factor of one technology against its share of the zone's generation that
 * month (rows from withShares): every zone's months as faint grey dots, the selected zone's
 * coloured by year, and a dotted kernel-smoothed average across all of them. `years` fixes the
 * colour of each year; `xDomain` and `yDomain` fix the scales so the chart keeps its frame as
 * the country changes. Clicking a year in the legend keeps that year's dots in colour and greys
 * the selected country's others; clicking it again restores all. Pass one `selection` object
 * ({year}) to both charts of a pair, and on every redraw, so they share and keep the choice.
 */
export function captureShareScatter({d3, Plot, rows, tech, zone, years, width, xDomain, yDomain, selection = {year: null}}) {
  const label = captureTechByKey.get(tech).label;
  const name = zoneByKey.get(zone).name;
  const data = rows.map((d) => ({...d, year: d.period.slice(0, 4), country: zoneByKey.get(d.zone).name, month: monthShort(d.period)}));
  const others = data.filter((d) => d.zone !== zone);
  const mine = data.filter((d) => d.zone === zone);
  const colors = {domain: years, range: years.map((_, i) => CATEGORICAL[i % CATEGORICAL.length])};
  const smooth = kernelSmooth(data.map((d) => ({x: d.share, y: d.value})), {minN: 15});
  const w = Math.min(width, 800);
  const tip = {format: {x: ".1%", y: ".0%", fill: false, country: true, month: true}};
  const channels = {country: {value: "country", label: "Country"}, month: {value: "month", label: "Month"}};
  const dots = []; // [circle, row] of the selected country's dots, filled when the mark renders
  const chart = Plot.plot({
    title: `${label}: capture factor vs share of generation`,
    subtitle: `One dot per country and month; ${name} by year, other countries grey; dotted: average of all`,
    caption: SOURCE,
    width: w, height: Math.round(Math.min(w * 0.85, 420)), marginLeft: 45, marginRight: 20,
    x: {grid: true, label: `${label.toLowerCase()} share of generation`, tickFormat: ".0%", domain: xDomain},
    y: {grid: true, label: "capture factor", tickFormat: ".0%", domain: yDomain},
    color: {legend: true, ...colors},
    marks: [
      Plot.ruleY([1], {stroke: "var(--theme-foreground-muted)", strokeDasharray: "2,2"}),
      Plot.dot(others, {x: "share", y: "value", r: 2, fill: "var(--theme-foreground-faint)", fillOpacity: 0.45, clip: true, channels, tip}),
      Plot.line(smooth, {x: "x", y: "y", stroke: "var(--theme-background)", strokeWidth: 5, curve: "basis", clip: true}),
      Plot.line(smooth, {x: "x", y: "y", stroke: "var(--theme-foreground)", strokeWidth: 2.5, strokeDasharray: "1,4", strokeLinecap: "round", curve: "basis", clip: true}),
      Plot.dot(mine, {
        x: "share", y: "value", r: 3.5, fill: "year", stroke: "var(--theme-background)", strokeWidth: 0.75, clip: true, channels, tip,
        render(index, scales, values, dimensions, context, next) {
          const g = next(index, scales, values, dimensions, context);
          dots.length = 0;
          g.querySelectorAll("circle").forEach((c, j) => dots.push([c, mine[index[j]]]));
          return g;
        }
      })
    ]
  });
  linkScatter(d3, chart, {dots, years, selection, brush: null, fillOpacity: 1, id: `share-${tech}`});
  return chart;
}

/**
 * The capture factor decomposed, for one zone and technology, one column per year (annualFactors
 * rows that carry the terms; see captureFactor). The three terms — price profile, output in
 * negative hours, negative prices paid — are stacked as deviations from the baseload price
 * (100%): positive ones above the line, negative ones below, so none overlaps another. Their sum
 * is the capture factor (dot, labelled), the same value as the annual lines and the maps.
 * `domain` (capture factors) fixes the y scale so solar and wind compare; it is cut at 200% like
 * the other capture charts.
 */
export function captureDecompositionChart({d3, Plot, rows, tech, zone, openYear, lastMonthShort, width, domain}) {
  const label = captureTechByKey.get(tech).label;
  const PARTS = [["Price profile", "profile"], ["Output in negative hours", "negOutput"], ["Negative prices paid", "negPaid"]];
  const yearText = (d) => (d.period === openYear ? `${d.period} (to ${lastMonthShort})` : d.period);
  const data = rows.map((d) => ({...d, x: yearText(d)}));
  // Plot stacks positive and negative values apart, on either side of zero (= baseload here).
  const terms = data.flatMap((d) => PARTS.map(([part, key]) => ({x: d.x, part, dev: d[key], d})));
  const [lo, hi] = domain ?? [Math.min(0.5, d3.min(data, (d) => d.value) ?? 0.5) - 0.05, Math.max(1.1, d3.max(data, (d) => 1 + Math.max(0, d.profile)) ?? 1) + 0.05];
  const channels = {
    "Capture factor": (t) => pct0(t.d.value),
    "Price profile": (t) => pp(t.d.profile),
    "Output in negative hours": (t) => `${pp(t.d.negOutput)} (${pct0(t.d.lost)} of output)`,
    "Negative prices paid": (t) => pp(t.d.negPaid),
    "If curtailed in negative hours": (t) => pct0(t.d.curtailed)
  };
  return Plot.plot({
    title: `${label} capture factor, decomposed — ${zoneByKey.get(zone).name}`,
    subtitle: "Points above or below the baseload price (100%); the parts add up to the capture factor (dot)",
    caption: SOURCE,
    width: Math.min(width, 800), height: 320, marginLeft: 45, marginRight: 15, marginTop: 20,
    x: {label: null, type: "band", padding: 0.35, domain: data.map((d) => d.x)},
    y: {grid: true, label: "% of baseload", tickFormat: (v) => pct0(1 + v), domain: [Math.max(lo, 0) - 1, Math.min(hi, 2) - 1]},
    // The validated palette's first three hues (blue, orange, green): distinct in every pairing,
    // including the two negative parts stacked next to each other.
    color: {legend: true, domain: PARTS.map(([part]) => part), range: CATEGORICAL.slice(0, 3)},
    marks: [
      Plot.barY(terms, {x: "x", y: "dev", fill: "part", fillOpacity: 0.85, clip: true, channels, tip: {format: {x: true, y: false, fill: true}}}),
      Plot.ruleY([0], {stroke: "var(--theme-foreground-muted)"}),
      Plot.dot(data, {x: "x", y: (d) => d.value - 1, r: 4, fill: "none", stroke: "var(--theme-foreground)", strokeWidth: 1.5, clip: true}),
      // Under each column's lowest point, clear of the bars.
      Plot.text(data, {
        x: "x", y: (d) => Math.max(Math.min(0, d.negOutput + d.negPaid + Math.min(0, d.profile)), lo - 1), text: (d) => pct0(d.value), dy: 11,
        fill: "var(--theme-foreground)", stroke: "var(--theme-background)", strokeWidth: 3, paintOrder: "stroke", fontSize: 10, fontWeight: "bold", clip: true
      })
    ]
  });
}
