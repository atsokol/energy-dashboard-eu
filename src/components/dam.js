// Day-ahead price metrics, computed by the build-time loaders (src/data/*.csv.js) and by the
// pages for period and moving-average roll-ups.
//
// Pure functions over plain arrays — no d3, no Plot — so a loader can import this file directly.

import {START_DATE, zoneByKey} from "./zones.js";

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

// GB prices are in GBP throughout. Its monthly ECB reference rates are fetched at build time
// (lib/fx.js) and handed in with setGbpRates; a month past the latest published one (the month in
// progress) takes the latest rate.
const GBP_PER_EUR = new Map();
let gbpLatest = null;

/** Load GBP per EUR by month: a Map from "YYYY-MM" to the month's average rate. */
export function setGbpRates(rates) {
  GBP_PER_EUR.clear();
  for (const [month, rate] of rates) GBP_PER_EUR.set(month, rate);
  gbpLatest = [...GBP_PER_EUR.keys()].sort().at(-1) ?? null;
}

/** Price in EUR/MWh, or NaN when the row's currency cannot be converted. */
export function toEur(price, currency, month) {
  // A blank currency is EUR: entsoemcp.com only started labelling rows mid-2026, and every
  // unlabelled 2022+ row in scope sits at euro price levels next to labelled EUR neighbours.
  if (!currency || currency === "EUR") return price;
  if (currency === "BGN") return price / BGN_PER_EUR;
  if (currency === "RON" && RON_PER_EUR[month]) return price / RON_PER_EUR[month];
  if (currency === "GBP" && gbpLatest) return price / GBP_PER_EUR.get(month > gbpLatest ? gbpLatest : month);
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
 * Normalise rows of an entsoemcp.com hourly CSV (`ts_utc,currency,eur_per_mwh`, or GB's IMRP
 * `ts_utc,gbp_per_mwh`) for one zone into `{date, hour, price, ts}` in local market time and EUR;
 * `ts` is the hour's UTC start in ms.
 *
 * Duplicate timestamps occur where the feed holds both a labelled and an unlabelled copy of the
 * same hour (2026-07-15 07:00Z in several zones, with different values); the labelled row is the
 * reprocessed one, so it wins.
 */
export function normaliseHourly(rows, zone) {
  const byTs = new Map();
  for (const r of rows) {
    const raw = r.eur_per_mwh ?? r.gbp_per_mwh;
    const currency = r.currency ?? (r.gbp_per_mwh != null ? "GBP" : "");
    const price = +raw;
    if (raw === "" || raw == null || !Number.isFinite(price)) continue;
    const ts = r.ts_utc.slice(0, 19).replace(" ", "T") + "Z";
    const prev = byTs.get(ts);
    if (prev && prev.currency && !currency) continue;
    byTs.set(ts, {currency, price});
  }
  const out = [];
  for (const [ts, {currency, price}] of byTs) {
    const eur = toEur(price, currency, ts.slice(0, 7));
    if (!Number.isFinite(eur)) continue;
    const ms = Date.parse(ts);
    const {date, hour} = localTime(ms, zone);
    out.push({date, hour, price: eur, ts: ms});
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
 * Per local market day: hour-weighted average price, the TB1/TB2/TB4 spreads, and the top-x
 * means they start from (`top1` is the day's maximum; the bottom-x mean is topx − tbx).
 *
 * TBx is the mean of the day's x most expensive hours minus the mean of its x cheapest, in
 * EUR/MWh — the gross margin per MWh cycled by an x-hour battery with perfect foresight, one
 * cycle a day, before losses. It is computed on hourly prices throughout: since SDAC moved to
 * 15-minute products (Oct 2025) the hourly figure is the mean of four quarter-hours, which keeps
 * 2021-2025 and 2026 on one basis but understates what a quarter-hour-dispatched battery sees.
 *
 * `neg_hours` counts the day's hours with a price below zero and `neg_value` sums those prices
 * over one hour each (EUR/MW, ≤ 0): the cost of taking 1 MW of output through every negative
 * hour. Both are on hourly prices too, so a negative quarter-hour inside a positive hour is not
 * counted.
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
    const negative = prices.filter((p) => p < 0);
    const row = {
      date, avg: mean(prices), hours: prices.length,
      neg_hours: negative.length, neg_value: negative.reduce((s, p) => s + p, 0)
    };
    for (const x of TB_DURATIONS) {
      row[`top${x}`] = mean(sorted.slice(-x));
      row[`tb${x}`] = row[`top${x}`] - mean(sorted.slice(0, x));
    }
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------------------------

function quantileSorted(sorted, p) {
  // Linear interpolation between order statistics — the same R-7 rule as d3.quantileSorted.
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return lo + 1 < sorted.length ? sorted[lo] + (sorted[lo + 1] - sorted[lo]) * (i - lo) : sorted[lo];
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(s) + n * 86_400_000));
const fmtDate = (s, opts) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", {timeZone: "UTC", ...opts});

/**
 * The market day the maps anchor on: the latest day every current zone has published. A zone
 * more than a day behind the leader is left out, so one late or dormant feed cannot hold the
 * whole map back: GB's IMRP lands 2-4 days after delivery, while the coupled zones publish the
 * next day's prices each afternoon. A late zone shows no value until its days arrive (a period in
 * progress still needs 80% of its days).
 */
export function anchorDay(daily) {
  const latest = new Map();
  for (const d of daily) if (!(latest.get(d.zone) >= d.date)) latest.set(d.zone, d.date);
  const lead = [...latest.values()].sort().at(-1);
  const current = [...latest.values()].filter((d) => d >= addDays(lead, -1));
  return current.sort()[0];
}

// Per period kind: the start of the period containing a date, the start `n` periods later, and a
// display label. Weeks are ISO weeks (Mon-Sun).
const PERIOD_KINDS = {
  year: {
    floor: (s) => `${s.slice(0, 4)}-01-01`,
    offset: (s, n) => `${+s.slice(0, 4) + n}-01-01`,
    label: (s) => s.slice(0, 4)
  },
  month: {
    floor: (s) => `${s.slice(0, 7)}-01`,
    offset: (s, n) => iso(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1 + n, 1))),
    label: (s) => fmtDate(s, {month: "long", year: "numeric"})
  },
  week: {
    floor: (s) => addDays(s, -((new Date(s + "T00:00:00Z").getUTCDay() + 6) % 7)),
    offset: (s, n) => addDays(s, 7 * n),
    label: (s) => `Week of ${fmtDate(s, {day: "numeric", month: "short", year: "numeric"})}`
  },
  day: {
    floor: (s) => s,
    offset: addDays,
    label: (s) => fmtDate(s, {weekday: "short", day: "numeric", month: "short", year: "numeric"})
  }
};

/**
 * Every period of `kind` ("year" | "month" | "week" | "day") from `from` to `anchor`, newest
 * first. Each is {key, label, start, end, partial} with `end` exclusive, all as "YYYY-MM-DD";
 * `key` is the start date. The period still in progress on `anchor` comes first, cut off after
 * `anchor` and marked `partial`, so its coverage is judged against the days elapsed.
 */
export function listPeriods(kind, anchor, from = START_DATE) {
  const {floor, offset, label} = PERIOD_KINDS[kind];
  const out = [];
  const next = addDays(anchor, 1);
  let end = floor(next); // start of the first period not yet complete
  if (end < next && end >= from) {
    const to = fmtDate(anchor, {day: "numeric", month: "short"});
    out.push({key: end, label: `${label(end)} (to ${to})`, start: end, end: next, partial: true});
  }
  for (let start = offset(end, -1); start >= from; end = start, start = offset(end, -1)) {
    out.push({key: start, label: label(start), start, end, partial: false});
  }
  return out;
}

/**
 * Per-zone mean of `field` in each of `periods` (all of one `kind`), in one pass over `daily`.
 * Returns a Map from period key to [{zone, value, days}]. `weight` (e.g. "hours") makes the mean
 * hour-weighted. A zone needs at least 80% of a period's days, so a part-covered period never
 * reads as a full one.
 */
export function periodMeans(daily, field, kind, periods, weight) {
  const {floor} = PERIOD_KINDS[kind];
  const byKey = new Map(periods.map((p) => [p.key, p]));
  const acc = new Map();
  for (const d of daily) {
    if (!Number.isFinite(d[field])) continue;
    const key = floor(d.date);
    // A partial period ends at the anchor; days a zone has already published beyond it stay out.
    if (!byKey.has(key) || d.date >= byKey.get(key).end) continue;
    const id = `${key}|${d.zone}`;
    let a = acc.get(id);
    if (!a) acc.set(id, (a = {sum: 0, w: 0, n: 0}));
    const w = weight ? d[weight] : 1;
    a.sum += d[field] * w; a.w += w; a.n += 1;
  }
  const out = new Map(periods.map((p) => [p.key, []]));
  for (const [id, a] of acc) {
    const [key, zone] = id.split("|");
    const {start, end} = byKey.get(key);
    const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
    if (a.n >= Math.ceil(days * 0.8)) out.get(key).push({zone, value: a.sum / a.w, days: a.n});
  }
  return out;
}

/**
 * A colour domain shared by every complete period in `byPeriod` (the output of periodMeans for
 * `periods`), so switching between periods never rescales the map, and the period in progress
 * cannot shift it from one day to the next. The P2-P98 range of all zone-period values keeps a few
 * extreme periods (the 2022 price spike, single-day outliers) from washing out the rest; values
 * beyond it take the end colours.
 */
export function stableDomain(byPeriod, periods, lo = 0.02, hi = 0.98) {
  const sorted = periods.filter((p) => !p.partial).flatMap((p) => byPeriod.get(p.key).map((d) => d.value)).sort((a, b) => a - b);
  if (!sorted.length) return [0, 1];
  const domain = [quantileSorted(sorted, lo), quantileSorted(sorted, hi)];
  return domain[0] === domain[1] ? [domain[0] - 1, domain[1] + 1] : domain;
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

/**
 * One zone's spread band: trailing `window`-day means of the daily top-x and bottom-x prices,
 * the daily average and the TBx spread ({date, top, bottom, avg, spread}). The means are taken
 * over the same days, so top − bottom equals the rolling spread exactly.
 */
export function spreadBand(daily, zone, tb, window = 30) {
  const x = tb.slice(2);
  const rows = daily
    .filter((d) => d.zone === zone && [d.avg, d[tb], d[`top${x}`]].every(Number.isFinite))
    .map((d) => ({zone, date: d.date, avg: d.avg, top: d[`top${x}`], bottom: d[`top${x}`] - d[tb]}));
  const ma = (field) => new Map(rollingMeans(rows, field, window).map((d) => [d.date, d.ma]));
  const [top, bottom, avg] = ["top", "bottom", "avg"].map(ma);
  return [...top].map(([date, t]) => ({date, top: t, bottom: bottom.get(date), avg: avg.get(date), spread: t - bottom.get(date)}));
}

/**
 * Running total of `field` through each calendar year, per day: {year, day: "MM-DD", value}.
 * Years start from zero on 1 January, so they compare as cumulative curves on one Jan-Dec axis.
 */
export function cumulativeByYear(daily, field) {
  const out = [];
  let year = null, sum = 0;
  for (const d of [...daily].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (!Number.isFinite(d[field])) continue;
    if (d.date.slice(0, 4) !== year) [year, sum] = [d.date.slice(0, 4), 0];
    sum += d[field];
    out.push({year, day: d.date.slice(5), value: sum});
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Gas-plant cost
// ---------------------------------------------------------------------------------------------

// Short-run cost of a ~50%-efficient CCGT in EUR/MWh: 2 MWh of gas and 0.4 t of CO2 per MWh of
// power (0.2 t/MWh gas emission factor ÷ 0.5). A yardstick for where gas sets the price, not a
// zone's actual marginal plant; one German hub (THE) price serves every zone in scope.
export const GAS_PLANT = {gas: 2, co2: 0.4};
export const gasPlantCost = (gas, co2) => GAS_PLANT.gas * gas + GAS_PLANT.co2 * co2;

/** Calendar-month means of the daily fuel rows: [{month: "YYYY-MM-01", gas, co2, cost}]. */
export function fuelMonthly(fuel) {
  const acc = new Map();
  for (const d of fuel) {
    const key = `${d.date.slice(0, 7)}-01`;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = {gas: 0, co2: 0, cost: 0, n: 0}));
    a.gas += d.gas; a.co2 += d.co2; a.cost += d.cost; a.n += 1;
  }
  return [...acc].map(([month, a]) => ({month, gas: a.gas / a.n, co2: a.co2 / a.n, cost: a.cost / a.n}));
}
