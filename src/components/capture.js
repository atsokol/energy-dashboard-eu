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

// ---------------------------------------------------------------------------------------------
// Page roll-ups
// ---------------------------------------------------------------------------------------------

/**
 * Capture factor over a set of one zone's months for one technology: the generation-weighted
 * capture price over the hour-weighted baseload price. Averaging the monthly factors instead
 * would give a low-output winter month as much say as a high-output summer one.
 */
export function captureFactor(months) {
  let value = 0, gwh = 0, baseValue = 0, hours = 0;
  for (const d of months) {
    value += d.capture * d.gwh; gwh += d.gwh;
    baseValue += d.base * d.hours; hours += d.hours;
  }
  return {capture: value / gwh, base: baseValue / hours, value: value / gwh / (baseValue / hours), gwh};
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

// ---------------------------------------------------------------------------------------------
// Capture and curtailment
// ---------------------------------------------------------------------------------------------

/**
 * The combined effect of the capture price and negative prices on a plant that stops producing
 * whenever the day-ahead price is below zero (a merchant plant with no subsidy for negative
 * hours), per calendar year and technology, from one zone's hourly rows {date, price, solar,
 * wind} (residual/[zone].csv). With B the year's baseload (mean of every hourly price), g the
 * hourly output and p the price:
 *
 *   cfPos  = Σ_{p≥0} p·g / Σ_{p≥0} g / B   capture factor of the output still sold
 *   lost   = Σ_{p<0} g / Σ g               share of output curtailed in negative hours
 *   evf    = Σ_{p≥0} p·g / Σ g / B         effective value factor = cfPos × (1 − lost)
 *
 * so evf − 1 = (cfPos − 1) [price capture] + (−cfPos × lost) [output lost to curtailment]. `cf`
 * is the ordinary capture factor (selling through negative hours, Σ p·g / Σ g / B), for
 * reference. A year needs all twelve months, except `openYear`, which needs three; rows with too
 * little output (under 1 MWh) or a baseload within 1 EUR/MWh of zero are left out, as in
 * monthlyCapture. Returns [{year, tech, months, base, cf, cfPos, lost, evf, priceEffect,
 * curtailEffect, negHours}].
 */
export function curtailmentEffect(rows, {openYear = null} = {}) {
  const acc = new Map(); // year → {months, prices, hours, negHours, tech: {key: {e, eNeg, r, rPos}}}
  for (const d of rows) {
    const year = d.date.slice(0, 4);
    let a = acc.get(year);
    if (!a) acc.set(year, (a = {months: new Set(), sum: 0, hours: 0, negHours: 0, tech: Object.fromEntries(CAPTURE_TECHS.map((t) => [t.key, {e: 0, eNeg: 0, r: 0, rPos: 0}]))}));
    a.months.add(d.date.slice(5, 7));
    a.sum += d.price; a.hours += 1;
    if (d.price < 0) a.negHours += 1;
    for (const {key} of CAPTURE_TECHS) {
      const g = d[key];
      if (!(g > 0)) continue;
      const t = a.tech[key];
      t.e += g; t.r += d.price * g;
      if (d.price < 0) t.eNeg += g;
      else t.rPos += d.price * g;
    }
  }
  const out = [];
  for (const [year, a] of acc) {
    if (a.months.size < (year === openYear ? 3 : 12)) continue;
    const base = a.sum / a.hours;
    if (Math.abs(base) < MIN_BASE) continue;
    for (const {key} of CAPTURE_TECHS) {
      const {e, eNeg, r, rPos} = a.tech[key];
      if (e < MIN_MWH || e - eNeg < MIN_MWH) continue;
      const cfPos = rPos / (e - eNeg) / base;
      const lost = eNeg / e;
      const evf = rPos / e / base;
      out.push({
        year, tech: key, months: a.months.size, base, cf: r / e / base, cfPos, lost, evf,
        priceEffect: cfPos - 1, curtailEffect: evf - cfPos, negHours: a.negHours
      });
    }
  }
  return out.sort((x, y) => (x.year < y.year ? -1 : x.year > y.year ? 1 : x.tech < y.tech ? -1 : 1));
}

