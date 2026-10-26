// Chart builders shared by the dashboard pages.
//
// d3 and Plot are passed in rather than imported (same convention as axes.js and tooltips.js):
// they are page globals, and the smoke-test harness supplies its own copies.

import {timeAxis} from "./axes.js";
import {GEN_GROUPS, completeGrid, genGroupByKey, SEASONS} from "./gen.js";
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

/** [lon, lat] to label (or place a symbol on) zone `z`, given the map's in-scope features. */
function zoneAnchor(d3, inScope, z) {
  return LABEL_AT[z.key] ?? d3.geoCentroid(inScope.find((f) => f.properties.id === z.iso[0]));
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
 * scale spans this map's own values.
 */
export function zoneMap({d3, Plot, geo, values, selected, width, title, subtitle, label, domain, format = fmt1}) {
  const byZone = new Map(values.map((d) => [d.zone, d.value]));
  const inScope = geo.features.filter((f) => zoneByIso.has(f.properties.id));
  const context = geo.features.filter((f) => !zoneByIso.has(f.properties.id));
  const zoneOf = (f) => zoneByIso.get(f.properties.id).key;
  const valued = inScope.filter((f) => byZone.has(zoneOf(f)));
  const missing = inScope.filter((f) => !byZone.has(zoneOf(f)));

  const labels = ZONES.map((z) => {
    const [lon, lat] = zoneAnchor(d3, inScope, z);
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
      type: "linear", legend: true, label, clamp: true,
      domain: domain ?? (extent[0] === extent[1] ? [extent[0] - 1, extent[1] + 1] : extent),
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
const DONUT_MAX_R = 0.065;
const DONUT_MIN_R = 7;

/**
 * One donut per zone at its label anchor: slices are the zone's generation mix over the year, and
 * the donut's area is proportional to its total generation (above a minimum size). Returns the
 * Plot figure; its `value` is the hovered zone's row ({zone, …}) or null.
 * `mix` is annualMix output: [{zone, total (GWh), mix: Map(group → GWh)}].
 */
export function mixMap({d3, Plot, geo, mix, selected, width, year}) {
  const byZone = new Map(mix.map((d) => [d.zone, d]));
  const inScope = geo.features.filter((f) => zoneByIso.has(f.properties.id));
  const context = geo.features.filter((f) => !zoneByIso.has(f.properties.id));
  const zoneOf = (f) => zoneByIso.get(f.properties.id).key;
  const w = Math.min(width, 800);
  const maxR = Math.max(28, w * DONUT_MAX_R);

  // Biggest first, so smaller donuts overlapping a neighbour are drawn on top of it.
  const points = ZONES.filter((z) => byZone.has(z.key))
    .map((z) => {
      const [lon, lat] = zoneAnchor(d3, inScope, z);
      const {total, mix: groups} = byZone.get(z.key);
      const share = Object.fromEntries(GEN_GROUPS.map((g) => [g.key, (groups.get(g.key) ?? 0) / total]));
      return {zone: z.key, name: z.name, short: z.short, lon, lat, twh: total / 1000, share};
    })
    .sort((a, b) => b.twh - a.twh);
  const missing = ZONES.filter((z) => !byZone.has(z.key)).map((z) => {
    const [lon, lat] = zoneAnchor(d3, inScope, z);
    return {zone: z.key, lon, lat, text: `${z.short}\nn/a`};
  });

  const fontSize = w < 500 ? 8 : 10;
  const radius = (r) => Math.max(DONUT_MIN_R, r);

  function donuts(index, scales, values, dimensions) {
    const g = d3.create("svg:g");
    const pie = d3.pie().sort(null).value((d) => d.share);
    for (const i of index) {
      const p = points[i];
      const r = radius(values.r[i]);
      const slices = pie(GEN_GROUPS.map((group) => ({group, share: p.share[group.key]}))).filter((s) => s.data.share > 0);
      const arc = d3.arc().innerRadius(r * 0.5).outerRadius(r);
      const gi = g.append("g").attr("transform", `translate(${values.x[i]},${values.y[i]})`);
      // A surface disc separates overlapping neighbours; the selected zone also gets an ink ring.
      gi.append("circle").attr("r", r + 2).attr("fill", "var(--theme-background)");
      if (p.zone === selected) gi.append("circle").attr("r", r + 3).attr("fill", "none").attr("stroke", "currentColor").attr("stroke-width", 2);
      gi.selectAll("path").data(slices).join("path")
        .attr("d", arc)
        .attr("fill", (d) => `var(--gen-${d.data.group.key})`)
        .attr("stroke", "var(--theme-background)")
        .attr("stroke-width", r > 14 ? 1 : 0.5);
      gi.append("text")
        .attr("y", -r - 5).attr("text-anchor", "middle").attr("font-size", fontSize)
        .attr("font-weight", p.zone === selected ? "bold" : "normal")
        .attr("fill", "var(--theme-foreground)").attr("stroke", "var(--theme-background)")
        .attr("stroke-width", 3).attr("paint-order", "stroke")
        .text(p.short);
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
    return g.node();
  }

  const plot = Plot.plot({
    title: `Generation mix — ${year}`,
    subtitle: "Share of each type in the year's generation; donut area proportional to the zone's total generation",
    caption: SOURCE,
    width: w,
    height: Math.round(Math.min(w * 0.95, 680)),
    projection: {type: "conic-equal-area", parallels: [40, 58], rotate: [-18, 0], domain: {type: "FeatureCollection", features: inScope}, inset: 6},
    r: {domain: [0, d3.max(points, (d) => d.twh) ?? 1], range: [0, maxR]},
    color: {legend: true, ...GEN_COLORS},
    marks: [
      Plot.geo(context, {fill: "var(--theme-foreground-faintest)", stroke: "var(--theme-background)", strokeWidth: 0.5, clip: "frame"}),
      Plot.geo(inScope, {fill: "var(--theme-background-alt)", stroke: "var(--theme-foreground-muted)", strokeWidth: 0.5}),
      Plot.geo(inScope.filter((f) => zoneOf(f) === selected), {stroke: "currentColor", strokeWidth: 2}),
      Plot.dot(points, {x: "lon", y: "lat", r: "twh", render: donuts}),
      Plot.text(missing, {
        x: "lon", y: "lat", text: "text", fontSize, lineHeight: 1.1,
        fill: "var(--theme-foreground-muted)", stroke: "var(--theme-background)", strokeWidth: 3, paintOrder: "stroke"
      }),
      // Invisible hover layer: the pointer target and tooltip for each donut, at least the
      // minimum donut size. Its constant fill binds the colour scale, so the legend lists every type.
      Plot.dot(points, {
        x: "lon", y: "lat", r: "twh", fill: () => GEN_GROUPS[0].label, fillOpacity: 0,
        channels: {
          Country: "name",
          "Generation, TWh": "twh",
          ...Object.fromEntries(GEN_GROUPS.map((g) => [g.label, (d) => (d.share[g.key] > 0 ? d.share[g.key] : null)]))
        },
        // Key order here is the tooltip's row order.
        tip: {format: {Country: true, x: false, y: false, r: false, fill: false, "Generation, TWh": (x) => x.toFixed(1), ...Object.fromEntries(GEN_GROUPS.map((g) => [g.label, pct]))}}
      })
    ]
  });
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
      Plot.areaY(data, {x: "date", y: "value", fill: "label", order: GEN_COLORS.domain, stroke: "var(--theme-background)", strokeWidth: 0.75}),
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
        x: "year", y: "value", fill: "label", order: GEN_COLORS.domain,
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
    subtitle: `Average generation by type and local hour of day, ${unit.label}. Winter is January, February and December of ${year}`,
    caption: SOURCE,
    width: w, height: 60 + 2 * (w < 500 ? 170 : 210), marginLeft: 45, marginRight: 15,
    x: {label: "hour of day", domain: [0, 23], ticks: [0, 6, 12, 18, 23], line: true},
    y: {grid: true, nice: true, label: unit.label},
    fx: {axis: null}, fy: {axis: null},
    color: {legend: true, ...GEN_COLORS},
    marks: [
      Plot.areaY(data, {x: "hour", y: "value", fx: "col", fy: "row", fill: "label", order: GEN_COLORS.domain, stroke: "var(--theme-background)", strokeWidth: 0.75}),
      Plot.ruleY([0]),
      Plot.text(SEASONS.map((s) => pos.get(s.key)), {fx: "col", fy: "row", text: "name", frameAnchor: "top-left", dx: 4, dy: 2, fontWeight: "bold"}),
      Plot.ruleX(data, Plot.pointerX(Plot.binX({x: "min"}, {x: "hour", fx: "col", fy: "row", interval: 1, insetTop: 20}))),
      Plot.tip(data, Plot.pointerX(Plot.binX({title: (v) => v, x: "min"}, {x: "hour", fx: "col", fy: "row", interval: 1, render})))
    ]
  });
}
