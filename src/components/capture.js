// Solar and wind capture prices and capture factors, from the build-time loader
// src/data/capture-monthly.csv.js and rolled up by the capture page.
//
// The capture price is the generation-weighted average day-ahead price a technology earns; the
// capture factor divides it by the period's baseload (hour-weighted) average price. Below 1 the
// technology produces mostly in cheaper-than-average hours, as when its own output depresses the
// price.
//
// Pure functions over plain arrays — no d3, no Plot — so a loader can import this file directly.

import {toEur} from "./dam.js";
import {SEASONS} from "./gen.js";

export const CAPTURE_TECHS = [
  {key: "solar", label: "Solar", psr: ["B16"]},
  {key: "wind", label: "Wind", psr: ["B18", "B19"]}
];
export const captureTechByKey = new Map(CAPTURE_TECHS.map((t) => [t.key, t]));
export const CAPTURE_PSR = CAPTURE_TECHS.flatMap((t) => t.psr);
const techOfPsr = new Map(CAPTURE_TECHS.flatMap((t) => t.psr.map((p) => [p, t.key])));

// A month needs 80% of its hours priced, the same coverage rule as the price maps.
const MIN_COVERAGE = 0.8;
// Below these a month's factor is noise, or 0/0 once the loader rounds it: a zone with a few kWh
// of solar (far-north Nordic zones in winter), or a baseload price within a euro of zero.
const MIN_MWH = 1;
const MIN_BASE = 1;

const daysIn = (month) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();

// ---------------------------------------------------------------------------------------------
// Loader reduction
// ---------------------------------------------------------------------------------------------

/**
 * Per local month and technology: capture price and baseload price in EUR/MWh, generation (GWh)
 * and priced hours, from entsoemcp.com `capture_price` derivation rows for one zone. Wind sums
 * onshore and offshore, weighting each type's capture price by its output. A month that switched
 * currency (BG and RO left their local currencies in 2021-22) arrives as one row per currency over
 * its own hours; each is converted to EUR before the halves are combined. Months from
 * `notBefore` (the month in progress) are dropped.
 */
export function monthlyCapture(rows, notBefore) {
  const tech = new Map(); // month|tech → {value: Σ capture × MWh, mwh}
  const base = new Map(); // month|currency → {price, hours}: one baseload per currency half
  for (const r of rows) {
    const key = techOfPsr.get(r.psr_type);
    const month = r.month.slice(0, 7);
    if (!key || `${month}-01` >= notBefore) continue;
    const capture = toEur(+r.capture_price_eur_per_mwh, r.currency, month);
    const baseload = toEur(+r.baseload_price_eur_per_mwh, r.currency, month);
    const mwh = +r.total_gen_mwh, hours = +r.n_hours;
    if (![capture, baseload, mwh, hours].every(Number.isFinite)) continue;
    const b = base.get(`${month}|${r.currency}`);
    if (!b || hours > b.hours) base.set(`${month}|${r.currency}`, {price: baseload, hours});
    if (mwh < MIN_MWH) continue;
    let a = tech.get(`${month}|${key}`);
    if (!a) tech.set(`${month}|${key}`, (a = {value: 0, mwh: 0}));
    a.value += capture * mwh; a.mwh += mwh;
  }
  const baseByMonth = new Map();
  for (const [key, {price, hours}] of base) {
    const month = key.slice(0, 7);
    const m = baseByMonth.get(month) ?? {value: 0, hours: 0};
    baseByMonth.set(month, {value: m.value + price * hours, hours: m.hours + hours});
  }
  const out = [];
  for (const [key, a] of tech) {
    const [month, t] = key.split("|");
    const b = baseByMonth.get(month);
    if (!b || b.hours < daysIn(month) * 24 * MIN_COVERAGE || Math.abs(b.value / b.hours) < MIN_BASE) continue;
    out.push({month: `${month}-01`, tech: t, capture: a.value / a.mwh, base: b.value / b.hours, gwh: a.mwh / 1000, hours: b.hours});
  }
  return out.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.tech < b.tech ? -1 : 1));
}

/**
 * Output and revenue in negative-price hours, per local month and technology, from one zone's
 * hourly prices (normaliseHourly output: EUR, local date, UTC `ts`) and hourly
 * `generation_per_type` rows joined on the UTC hour, the same join the server's capture_price
 * makes (checked to the fourth decimal). Returns Map("YYYY-MM|tech" → {gwh, value, negGwh,
 * negValue}): all output and its revenue (EUR), and the part in hours priced below zero. `gwh`
 * and `value` are for cross-checking against the server's figures.
 */
export function negativeHourTotals(prices, genRows) {
  const gen = new Map(); // utc ms|tech → MW (= MWh in the hour)
  for (const r of genRows) {
    const tech = techOfPsr.get(r.psr_type);
    const mw = +r.actual_mw;
    if (!tech || r.actual_mw === "" || r.actual_mw == null || !Number.isFinite(mw)) continue;
    const key = `${Date.parse(r.ts_utc.slice(0, 19).replace(" ", "T") + "Z")}|${tech}`;
    gen.set(key, (gen.get(key) ?? 0) + mw);
  }
  const out = new Map();
  for (const p of prices) {
    for (const {key: tech} of CAPTURE_TECHS) {
      const mwh = gen.get(`${p.ts}|${tech}`);
      if (mwh === undefined) continue;
      const id = `${p.date.slice(0, 7)}|${tech}`;
      let a = out.get(id);
      if (!a) out.set(id, (a = {gwh: 0, value: 0, negGwh: 0, negValue: 0}));
      a.gwh += mwh / 1000; a.value += p.price * mwh;
      if (p.price < 0) { a.negGwh += mwh / 1000; a.negValue += p.price * mwh; }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Page roll-ups
// ---------------------------------------------------------------------------------------------

/**
 * Capture factor over a set of one zone's months for one technology, from summed totals: with B
 * the baseload (hour-weighted mean price), G the output and R its revenue,
 *
 *   value (CF) = (R / G) / B
 *
 * Averaging monthly factors instead would give a low-output winter month as much say as a
 * high-output summer one. When every month carries its negative-hour totals (`neg_gwh` G₋ and
 * `neg_capture`, the average price of that output, so R₋ = neg_capture × G₋), CF also splits
 * exactly into three terms, in fractions of baseload, with L = G₋ / G:
 *
 *   CF − 1 = (1 − L)(CF₊ − 1)   profile: the output sold in positive hours, against baseload
 *          − L                  output in negative hours, as if it earned nothing
 *          + L · CF₋             negative prices paid on that output (≤ 0)
 *
 * where CF₊ = (R − R₋)/(G − G₋)/B and CF₋ = R₋/G₋/B. A plant that stops in negative hours earns
 * the first two: `curtailed` = 1 + profile − L.
 */
export function captureFactor(months) {
  let value = 0, gwh = 0, baseValue = 0, hours = 0, negGwh = 0, negValue = 0, split = true;
  for (const d of months) {
    value += d.capture * d.gwh; gwh += d.gwh;
    baseValue += d.base * d.hours; hours += d.hours;
    if (Number.isFinite(d.neg_gwh) && Number.isFinite(d.neg_capture)) {
      negGwh += d.neg_gwh; negValue += d.neg_capture * d.neg_gwh;
    } else split = false;
  }
  const base = baseValue / hours;
  const out = {capture: value / gwh, base, value: value / gwh / base, gwh};
  // The terms are added only when they exist, so rows without them carry no blank fields.
  if (!split) return out;
  const lost = negGwh / gwh;
  const profile = gwh > negGwh ? (1 - lost) * ((value - negValue) / (gwh - negGwh) / base - 1) : 0;
  const negPaid = negGwh > 0 ? lost * (negValue / negGwh / base) : 0;
  return {...out, lost, profile, negOutput: -lost, negPaid, curtailed: 1 + profile - lost};
}

function rollUp(rows, periodOf, need) {
  const groups = new Map();
  for (const d of rows) {
    const p = periodOf(d.month);
    const key = `${d.zone}|${d.tech}|${p}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  return [...groups]
    .filter(([key, months]) => months.length >= need(key.split("|")[2]))
    .map(([key, months]) => {
      const [zone, tech, period] = key.split("|");
      return {zone, tech, period, months: months.length, ...captureFactor(months)};
    })
    .filter((d) => Number.isFinite(d.value));
}

/** Monthly capture factors as rows {zone, tech, period: "YYYY-MM-01", capture, base, value, gwh}. */
// Non-finite factors (no output, or a zero baseload, in a snapshot cached before the loader
// dropped them) are skipped.
export const monthlyFactors = (rows) => rows
  .map((d) => ({zone: d.zone, tech: d.tech, period: d.month, months: 1, ...captureFactor([d])}))
  .filter((d) => Number.isFinite(d.value));

/**
 * Capture factor per zone, technology and calendar year: {zone, tech, period: "YYYY", months,
 * capture, base, value, gwh}. A year needs all twelve months, except `openYear` (the year in
 * progress), which needs `minOpen` and is returned with `months` < 12 for the page to mark.
 */
export function annualFactors(rows, {openYear = null, minOpen = 3} = {}) {
  return rollUp(rows, (m) => m.slice(0, 4), (y) => (y === openYear ? minOpen : 12));
}

// Meteorological seasons: December opens the next year's winter, so the seasons follow each other
// without a gap. Each season is plotted at its middle month.
const seasonOfMonth = new Map(SEASONS.flatMap((s) => s.months.map((m) => [m, s])));
const MID_MONTH = {winter: "01", spring: "04", summer: "07", autumn: "10"};

/**
 * Capture factor per zone, technology and season with all three months: {zone, tech, period:
 * "YYYY-MM-15" (the season's middle month), season, year, ...}. `year` is the year of the season's
 * middle month, so winter 2025 is December 2024 to February 2025.
 */
export function seasonalFactors(rows) {
  const periodOf = (month) => {
    const m = +month.slice(5, 7);
    const year = +month.slice(0, 4) + (m === 12 ? 1 : 0);
    return `${year}-${MID_MONTH[seasonOfMonth.get(m).key]}-15`;
  };
  return rollUp(rows, periodOf, () => 3).map((d) => {
    const season = SEASONS.find((s) => MID_MONTH[s.key] === d.period.slice(5, 7));
    return {...d, season: season.key, year: d.period.slice(0, 4)};
  });
}

/** "Winter 2025 (Dec–Feb)"-style label for a seasonalFactors row. */
export function seasonLabel(d) {
  const s = SEASONS.find((x) => x.key === d.season);
  const short = (m) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleDateString("en-GB", {timeZone: "UTC", month: "short"});
  return `${s.label} ${d.year} (${short(s.months[0])}–${short(s.months.at(-1))})`;
}

/**
 * Join monthly capture factors to each technology's share of the zone's generation that month:
 * `factors` from monthlyFactors, `generation` gen-monthly rows {zone, month, group, gwh}. The
 * share is the tech's GWh (gen-monthly's wind group is onshore + offshore, as here) over the sum
 * of every group; months the generation file lacks are dropped.
 */
export function withShares(factors, generation) {
  const total = new Map(), byGroup = new Map();
  for (const d of generation) {
    const key = `${d.zone}|${d.month}`;
    total.set(key, (total.get(key) ?? 0) + d.gwh);
    byGroup.set(`${key}|${d.group}`, d.gwh);
  }
  return factors.flatMap((d) => {
    const key = `${d.zone}|${d.period}`;
    const t = total.get(key), g = byGroup.get(`${key}|${d.tech}`);
    return t > 0 && g != null ? [{...d, share: g / t}] : [];
  });
}

function quantileSorted(sorted, p) {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return lo + 1 < sorted.length ? sorted[lo] + (sorted[lo + 1] - sorted[lo]) * (i - lo) : sorted[lo];
}

/**
 * A colour domain centred on a capture factor of 1, wide enough for the P2-P98 range of `values`
 * (beyond it the end colours apply). Shared by both maps and all periods of a kind, so solar and
 * wind, and one period and the next, read on one scale.
 */
export function pivotDomain(values, lo = 0.02, hi = 0.98) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return [0.5, 1.5];
  const reach = Math.max(1 - quantileSorted(sorted, lo), quantileSorted(sorted, hi) - 1, 0.05);
  return [1 - reach, 1 + reach];
}
