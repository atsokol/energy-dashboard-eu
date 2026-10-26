// Day-ahead price metrics, computed by the build-time loaders (src/data/*.csv.js) and by the
// pages for period and moving-average roll-ups.
//
// Pure functions over plain arrays — no d3, no Plot — so a loader can import this file directly.

import {zoneByKey} from "./zones.js";

// ---------------------------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------------------------

// entsoemcp.com never FX-converts. Inside the 2021+ window two zones published in local currency:
//   BG in BGN until market day 2022-01-21 — pegged, so one rate is exact;
//   RO in RON until market day 2021-06-17 — floating, so ECB monthly reference-rate averages
//   (EXR M.RON.EUR.SP00.A). Only these six months are needed, so they are constants rather than a
//   runtime dependency on the ECB API.
const BGN_PER_EUR = 1.95583;
const RON_PER_EUR = {
  "2021-01": 4.873245, "2021-02": 4.874975, "2021-03": 4.888361,
  "2021-04": 4.92313, "2021-05": 4.925, "2021-06": 4.923795
};

/** Price in EUR/MWh, or NaN when the row's currency cannot be converted. */
export function toEur(price, currency, month) {
  // A blank currency is EUR: entsoemcp.com only started labelling rows mid-2026, and every
  // unlabelled 2022+ row in scope sits at euro price levels next to labelled EUR neighbours.
  if (!currency || currency === "EUR") return price;
  if (currency === "BGN") return price / BGN_PER_EUR;
  if (currency === "RON" && RON_PER_EUR[month]) return price / RON_PER_EUR[month];
  return NaN;
}

// ---------------------------------------------------------------------------------------------
// Local market time
// ---------------------------------------------------------------------------------------------

// EU summer time runs from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday
// of October, in every zone in scope. Computing it is ~50x faster than an Intl.DateTimeFormat call
// per row, which matters for the ~900k hourly rows the spreads page handles.
const dstCache = new Map();
function dstWindow(year) {
  let w = dstCache.get(year);
  if (!w) {
    const lastSunday = (month) => {
      const d = new Date(Date.UTC(year, month + 1, 0)); // last day of month
      return Date.UTC(year, month, d.getUTCDate() - d.getUTCDay(), 1);
    };
    dstCache.set(year, (w = [lastSunday(2), lastSunday(9)]));
  }
  return w;
}

/** Local {date: "YYYY-MM-DD", hour: 0-23} of a UTC timestamp in a zone. */
export function localTime(ms, zone) {
  const [on, off] = dstWindow(new Date(ms).getUTCFullYear());
  const offset = zoneByKey.get(zone).utc + (ms >= on && ms < off ? 1 : 0);
  const local = new Date(ms + offset * 3_600_000);
  return {date: local.toISOString().slice(0, 10), hour: local.getUTCHours()};
}

// ---------------------------------------------------------------------------------------------
// Hourly rows → local hours
// ---------------------------------------------------------------------------------------------

/**
 * Normalise rows of an entsoemcp.com hourly CSV (`ts_utc,currency,eur_per_mwh`) for one zone into
 * `{date, hour, price}` in local market time and EUR.
 *
 * Duplicate timestamps occur where the feed holds both a labelled and an unlabelled copy of the
 * same hour (2026-07-15 07:00Z in several zones, with different values); the labelled row is the
 * reprocessed one, so it wins.
 */
export function normaliseHourly(rows, zone) {
  const byTs = new Map();
  for (const r of rows) {
    const price = +r.eur_per_mwh;
    if (r.eur_per_mwh === "" || r.eur_per_mwh == null || !Number.isFinite(price)) continue;
    const ts = r.ts_utc.slice(0, 19).replace(" ", "T") + "Z";
    const prev = byTs.get(ts);
    if (prev && prev.currency && !r.currency) continue;
    byTs.set(ts, {currency: r.currency, price});
  }
  const out = [];
  for (const [ts, {currency, price}] of byTs) {
    const eur = toEur(price, currency, ts.slice(0, 7));
    if (!Number.isFinite(eur)) continue;
    const {date, hour} = localTime(Date.parse(ts), zone);
    out.push({date, hour, price: eur});
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.hour - b.hour));
}

// ---------------------------------------------------------------------------------------------
// Daily metrics
// ---------------------------------------------------------------------------------------------

export const TB_DURATIONS = [1, 2, 4];

// A market day has 23-25 hours. Fewer than 22 means a publication gap, and a gapped day would
// understate the spread (its missing hours are as likely to be the peak as anything else).
const MIN_HOURS_PER_DAY = 22;

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Per local market day: hour-weighted average price and the TB1/TB2/TB4 spreads.
 *
 * TBx is the mean of the day's x most expensive hours minus the mean of its x cheapest, in
 * EUR/MWh — the gross margin per MWh cycled by an x-hour battery with perfect foresight, one
 * cycle a day, before losses. It is computed on hourly prices throughout: since SDAC moved to
 * 15-minute products (Oct 2025) the hourly figure is the mean of four quarter-hours, which keeps
 * 2021-2025 and 2026 on one basis but understates what a quarter-hour-dispatched battery sees.
 */
export function dailyMetrics(hourly) {
  const days = new Map();
  for (const d of hourly) {
    let xs = days.get(d.date);
    if (!xs) days.set(d.date, (xs = []));
    xs.push(d.price);
  }
  const out = [];
  for (const [date, prices] of days) {
    if (prices.length < MIN_HOURS_PER_DAY) continue;
    const sorted = [...prices].sort((a, b) => a - b);
    const row = {date, avg: mean(prices), hours: prices.length};
    for (const x of TB_DURATIONS) row[`tb${x}`] = mean(sorted.slice(-x)) - mean(sorted.slice(0, x));
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Intraday volatility
// ---------------------------------------------------------------------------------------------

function quantileSorted(sorted, p) {
  // Linear interpolation between order statistics — the same R-7 rule as d3.quantileSorted.
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return lo + 1 < sorted.length ? sorted[lo] + (sorted[lo + 1] - sorted[lo]) * (i - lo) : sorted[lo];
}

/** P10 / P50 / P90 of the hourly price by calendar year and local hour of day. */
export function hourlyQuantiles(hourly) {
  const groups = new Map();
  for (const d of hourly) {
    const key = `${d.date.slice(0, 4)}|${d.hour}`;
    let xs = groups.get(key);
    if (!xs) groups.set(key, (xs = []));
    xs.push(d.price);
  }
  return [...groups]
    .map(([key, xs]) => {
      const [year, hour] = key.split("|");
      const sorted = xs.sort((a, b) => a - b);
      return {
        year, hour: +hour, n: sorted.length,
        p10: quantileSorted(sorted, 0.1), p50: quantileSorted(sorted, 0.5), p90: quantileSorted(sorted, 0.9)
      };
    })
    // A year needs a few weeks of observations per hour before its percentiles mean anything.
    .filter((d) => d.n >= 28)
    .sort((a, b) => (a.year < b.year ? -1 : a.year > b.year ? 1 : a.hour - b.hour));
}

// ---------------------------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------------------------

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(s) + n * 86_400_000));

/**
 * The market day the maps anchor on: the latest day every reasonably current zone has published.
 * A zone more than a week behind the leader is treated as stalled and excluded, so one dormant
 * feed cannot freeze the whole map; it simply shows no value for recent periods.
 */
export function anchorDay(daily) {
  const latest = new Map();
  for (const d of daily) if (!(latest.get(d.zone) >= d.date)) latest.set(d.zone, d.date);
  const lead = [...latest.values()].sort().at(-1);
  const current = [...latest.values()].filter((d) => d >= addDays(lead, -7));
  return current.sort()[0];
}

/**
 * The last *complete* year, month, ISO week (Mon-Sun) and day ending on or before `anchor`.
 * Each is {key, label, start, end} with `end` exclusive, all as "YYYY-MM-DD".
 */
export function lastFullPeriods(anchor) {
  const a = new Date(anchor + "T00:00:00Z");
  const next = addDays(anchor, 1); // first day NOT yet complete
  const y = a.getUTCFullYear(), m = a.getUTCMonth();

  const yearEnd = next.slice(5) === "01-01" ? next : `${y}-01-01`;
  const yearStart = `${+yearEnd.slice(0, 4) - 1}-01-01`;

  const monthEnd = next.slice(8) === "01" ? next : iso(new Date(Date.UTC(y, m, 1)));
  const monthStart = iso(new Date(Date.UTC(+monthEnd.slice(0, 4), +monthEnd.slice(5, 7) - 2, 1)));

  const dow = (new Date(next + "T00:00:00Z").getUTCDay() + 6) % 7; // 0 = Monday
  const weekEnd = addDays(next, -dow);
  const weekStart = addDays(weekEnd, -7);

  const fmt = (s, opts) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", {timeZone: "UTC", ...opts});
  return [
    {key: "year", label: `Year ${yearStart.slice(0, 4)}`, start: yearStart, end: yearEnd},
    {key: "month", label: fmt(monthStart, {month: "long", year: "numeric"}), start: monthStart, end: monthEnd},
    {key: "week", label: `Week of ${fmt(weekStart, {day: "numeric", month: "short", year: "numeric"})}`, start: weekStart, end: weekEnd},
    {key: "day", label: fmt(anchor, {weekday: "short", day: "numeric", month: "short", year: "numeric"}), start: anchor, end: next}
  ];
}

/**
 * Per-zone mean of `field` over [start, end). `weight` (e.g. "hours") makes it hour-weighted.
 * A zone needs at least 80% of the period's days, so a part-covered period never reads as a full one.
 */
export function periodMeans(daily, field, {start, end}, weight) {
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
  const acc = new Map();
  for (const d of daily) {
    if (d.date < start || d.date >= end || !Number.isFinite(d[field])) continue;
    let a = acc.get(d.zone);
    if (!a) acc.set(d.zone, (a = {sum: 0, w: 0, n: 0}));
    const w = weight ? d[weight] : 1;
    a.sum += d[field] * w; a.w += w; a.n += 1;
  }
  return [...acc]
    .filter(([, a]) => a.n >= Math.ceil(days * 0.8))
    .map(([zone, a]) => ({zone, value: a.sum / a.w, days: a.n}));
}

/** Per zone and calendar month: hour-weighted average price, months with ≥ 80% of days only. */
export function monthlyMeans(daily, field = "avg", weight = "hours") {
  const acc = new Map();
  for (const d of daily) {
    const key = `${d.zone}|${d.date.slice(0, 7)}`;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = {sum: 0, w: 0, n: 0}));
    const w = weight ? d[weight] : 1;
    a.sum += d[field] * w; a.w += w; a.n += 1;
  }
  return [...acc]
    .map(([key, a]) => {
      const [zone, month] = key.split("|");
      const daysInMonth = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
      return {zone, month: `${month}-01`, value: a.sum / a.w, days: a.n, full: a.n >= daysInMonth * 0.8};
    })
    .filter((d) => d.full)
    .map(({zone, month, value, days}) => ({zone, month, value, days}));
}

/**
 * Trailing `window`-day moving average of `field` per zone, on the calendar (a missing day shrinks
 * the window rather than pulling in an older one). Needs two-thirds of the window present.
 */
export function rollingMeans(daily, field, window = 30) {
  const byZone = new Map();
  for (const d of daily) {
    if (!Number.isFinite(d[field])) continue;
    let xs = byZone.get(d.zone);
    if (!xs) byZone.set(d.zone, (xs = []));
    xs.push(d);
  }
  const out = [];
  for (const [zone, xs] of byZone) {
    xs.sort((a, b) => (a.date < b.date ? -1 : 1));
    let lo = 0, sum = 0;
    for (let hi = 0; hi < xs.length; hi++) {
      sum += xs[hi][field];
      const cutoff = addDays(xs[hi].date, -window);
      while (xs[lo].date <= cutoff) sum -= xs[lo++][field];
      const n = hi - lo + 1;
      if (n >= Math.ceil(window * 2 / 3)) out.push({zone, date: xs[hi].date, value: xs[hi][field], ma: sum / n});
    }
  }
  return out;
}
