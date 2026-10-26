// Generation-mix metrics, computed by the build-time loaders (src/data/gen-*.csv.js) and by the
// generation page.
//
// Pure functions over plain arrays — no d3, no Plot — so a loader can import this file directly.

import {localTime} from "./dam.js";

// ---------------------------------------------------------------------------------------------
// Production-type groups
// ---------------------------------------------------------------------------------------------

// ENTSO-E reports up to twenty production types (B01-B25). Eight groups is the most a chart can
// colour distinctly, so the types fold into these, listed in stacking order (bottom to top):
// nuclear and coal at the base, solar and the "Other" remainder on top. The middle order is set by
// the colours (style.css): it keeps similar hues apart (light-blue hydro from blue wind, brown coal
// from orange gas) so every pair of adjacent stacked layers passes the colour-vision checks.
// B21-B24 are grid assets, not generation, and are dropped.
export const GEN_GROUPS = [
  {key: "nuclear", label: "Nuclear", psr: ["B14"]},
  {key: "coal", label: "Coal & lignite", psr: ["B02", "B03", "B05", "B07", "B08"]},
  {key: "hydro", label: "Hydro", psr: ["B10", "B11", "B12", "B13"]},
  {key: "gas", label: "Gas", psr: ["B04"]},
  {key: "wind", label: "Wind", psr: ["B18", "B19"]},
  {key: "bio", label: "Biomass & other RES", psr: ["B01", "B09", "B15", "B17"]},
  {key: "solar", label: "Solar", psr: ["B16"]},
  {key: "other", label: "Other", psr: ["B06", "B20", "B25", "B99_unknown"]}
];

export const GEN_KEYS = GEN_GROUPS.map((g) => g.key);
export const genGroupByKey = new Map(GEN_GROUPS.map((g) => [g.key, g]));
const groupOfPsr = new Map(GEN_GROUPS.flatMap((g) => g.psr.map((p) => [p, g.key])));

export const SEASONS = [
  {key: "winter", label: "Winter", months: [12, 1, 2]},
  {key: "spring", label: "Spring", months: [3, 4, 5]},
  {key: "summer", label: "Summer", months: [6, 7, 8]},
  {key: "autumn", label: "Autumn", months: [9, 10, 11]}
];
const seasonOfMonth = new Map(SEASONS.flatMap((s) => s.months.map((m) => [m, s.key])));

const value = (s) => (s === "" || s == null ? NaN : +s);

// ---------------------------------------------------------------------------------------------
// Loader reductions
// ---------------------------------------------------------------------------------------------

/**
 * Monthly energy per group from an entsoemcp.com `generation_per_type` CSV aggregated monthly on
 * local time (`ts_utc` = "YYYY-MM-DD" month start, `actual_mw` = the month's mean output). Energy
 * is mean MW × the month's hours; the ±1 h of a DST month is ignored (0.1%). Months from
 * `notBefore` (the month in progress) are dropped: their mean covers only the days so far.
 * Pumped-storage and battery `consumption_mw` is not generation and is left out.
 */
export function monthlyGeneration(rows, notBefore) {
  const acc = new Map();
  for (const r of rows) {
    const group = groupOfPsr.get(r.psr_type);
    const mw = value(r.actual_mw);
    const month = r.ts_utc.slice(0, 7);
    if (!group || !Number.isFinite(mw) || `${month}-01` >= notBefore) continue;
    const key = `${month}|${group}`;
    acc.set(key, (acc.get(key) ?? 0) + mw);
  }
  return [...acc]
    .map(([key, mw]) => {
      const [month, group] = key.split("|");
      const days = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
      return {month: `${month}-01`, group, gwh: (mw * days * 24) / 1000};
    })
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : GEN_KEYS.indexOf(a.group) - GEN_KEYS.indexOf(b.group)));
}

/**
 * Installed capacity per group and year from an `installed_generation_capacity` CSV (one snapshot
 * a year, stamped around 1 January; a blank value means the type was not reported that year).
 */
export function capacityByYear(rows) {
  const acc = new Map();
  for (const r of rows) {
    const group = groupOfPsr.get(r.psr_type);
    const mw = value(r.capacity_mw);
    if (!group || !Number.isFinite(mw)) continue;
    // Snapshots are stamped at local midnight in UTC (23:00 on 31 Dec) or on 1 January itself;
    // shifting by 12 h puts both in the year they describe.
    const year = new Date(Date.parse(r.ts_utc.slice(0, 19).replace(" ", "T") + "Z") + 12 * 3_600_000).getUTCFullYear();
    const key = `${year}|${group}`;
    acc.set(key, (acc.get(key) ?? 0) + mw);
  }
  return [...acc]
    .map(([key, mw]) => {
      const [year, group] = key.split("|");
      return {year, group, mw};
    })
    .sort((a, b) => (a.year < b.year ? -1 : a.year > b.year ? 1 : GEN_KEYS.indexOf(a.group) - GEN_KEYS.indexOf(b.group)));
}

/**
 * Average output per group by season and local hour of day, from an hourly `generation_per_type`
 * CSV for one zone. Each production type is averaged on its own and then summed into its group,
 * so a type with a few missing hours does not drag its group's average down.
 */
export function seasonalProfiles(rows, zone, year) {
  const acc = new Map();
  for (const r of rows) {
    if (!groupOfPsr.has(r.psr_type)) continue;
    const mw = value(r.actual_mw);
    if (!Number.isFinite(mw)) continue;
    const {date, hour} = localTime(Date.parse(r.ts_utc.slice(0, 19).replace(" ", "T") + "Z"), zone);
    if (date.slice(0, 4) !== year) continue;
    const key = `${seasonOfMonth.get(+date.slice(5, 7))}|${hour}|${r.psr_type}`;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = {sum: 0, n: 0}));
    a.sum += mw; a.n += 1;
  }
  const groups = new Map();
  for (const [key, {sum, n}] of acc) {
    const [season, hour, psr] = key.split("|");
    const id = `${season}|${hour}|${groupOfPsr.get(psr)}`;
    groups.set(id, (groups.get(id) ?? 0) + sum / n);
  }
  return [...groups].map(([id, mw]) => {
    const [season, hour, group] = id.split("|");
    return {season, hour: +hour, group, mw};
  });
}

// ---------------------------------------------------------------------------------------------
// Page roll-ups
// ---------------------------------------------------------------------------------------------

/** The latest calendar year whose December is in the monthly data: the last full year. */
export function lastFullYear(monthly) {
  const decembers = monthly.filter((d) => d.month.slice(5, 7) === "12").map((d) => d.month.slice(0, 4));
  return decembers.sort().at(-1);
}

/**
 * Per zone, the year's generation by group (GWh) and in total, for zones that reported all twelve
 * months: [{zone, total, mix: Map(group → gwh)}].
 */
export function annualMix(monthly, year) {
  const byZone = new Map();
  for (const d of monthly) {
    if (d.month.slice(0, 4) !== year) continue;
    let z = byZone.get(d.zone);
    if (!z) byZone.set(d.zone, (z = {months: new Set(), mix: new Map()}));
    z.months.add(d.month);
    z.mix.set(d.group, (z.mix.get(d.group) ?? 0) + d.gwh);
  }
  return [...byZone]
    .filter(([, z]) => z.months.size === 12)
    .map(([zone, {mix}]) => ({zone, total: [...mix.values()].reduce((s, x) => s + x, 0), mix}));
}

/**
 * Rows for one zone completed to every (x, group) pair, zeros filling the gaps, in stacking order:
 * a stacked area needs every series present at every x or its layers cross. `x` names the
 * row's position (e.g. (d) => `${d.season}|${d.hour}`); a filled row copies its other fields from
 * a row at the same position.
 */
export function completeGrid(rows, x, valueKey) {
  const atX = new Map();
  for (const d of rows) {
    const k = x(d);
    if (!atX.has(k)) atX.set(k, new Map());
    atX.get(k).set(d.group, d);
  }
  const present = GEN_KEYS.filter((g) => rows.some((d) => d.group === g));
  return [...atX.values()].flatMap((byGroup) => {
    const template = byGroup.values().next().value;
    return present.map((group) => byGroup.get(group) ?? {...template, group, [valueKey]: 0});
  });
}
