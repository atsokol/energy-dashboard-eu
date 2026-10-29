// Residual load (load minus wind and solar) against the day-ahead price, hour by hour: built by the
// loader src/data/residual/[zone].csv.js and rolled up by the prices page.
//
// Pure functions over plain arrays — no d3, no Plot — so a loader can import this file directly.

// Wind onshore, wind offshore, solar: the variable output the rest of the system has to follow.
export const VRE_PSR = new Set(["B16", "B18", "B19"]);

const value = (s) => (s === "" || s == null ? NaN : +s);
const utcKey = (ts) => ts.slice(0, 13).replace(" ", "T"); // "YYYY-MM-DDTHH"

/**
 * Join one zone's hourly prices, load and generation on the UTC hour: [{date, hour, price, rl}] in
 * local market time, `rl` = load − wind − solar in MW. `prices` is normaliseHourly output (with
 * `ts`); `loadRows` and `genRows` are entsoemcp.com `actual_load` and `generation_per_type` CSV
 * rows aggregated hourly. An hour needs all three: a price, a load, and at least one generation row
 * (an hour with generation rows but none for wind or solar has zero variable output — some
 * zones report no wind or solar at all — while an hour with no generation rows is a gap).
 */
export function residualHourly(prices, loadRows, genRows) {
  const load = new Map();
  for (const r of loadRows) {
    const mw = value(r.load_mw);
    if (Number.isFinite(mw)) load.set(utcKey(r.ts_utc), mw);
  }
  const vre = new Map();
  for (const r of genRows) {
    const key = utcKey(r.ts_utc);
    const mw = value(r.actual_mw);
    vre.set(key, (vre.get(key) ?? 0) + (VRE_PSR.has(r.psr_type) && Number.isFinite(mw) ? mw : 0));
  }
  const out = [];
  for (const d of prices) {
    const key = new Date(d.ts).toISOString().slice(0, 13);
    if (!load.has(key) || !vre.has(key)) continue;
    out.push({date: d.date, hour: d.hour, price: d.price, rl: load.get(key) - vre.get(key)});
  }
  return out;
}

// A year's profile for a month needs a week of days before its hourly means say anything.
const MIN_DAYS = 7;

/**
 * Average price and residual load by local hour of day for every calendar month of every year
 * with at least a week of that month: [{year, month ("01"-"12"), hour, price, rl}].
 */
export function hourlyProfiles(rows) {
  const acc = new Map();
  const days = new Map();
  for (const d of rows) {
    const ym = d.date.slice(0, 7);
    const key = `${ym}|${d.hour}`;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = {price: 0, rl: 0, n: 0}));
    a.price += d.price; a.rl += d.rl; a.n += 1;
    if (!days.has(ym)) days.set(ym, new Set());
    days.get(ym).add(d.date);
  }
  return [...acc]
    .filter(([key]) => days.get(key.slice(0, 7)).size >= MIN_DAYS)
    .map(([key, a]) => ({year: key.slice(0, 4), month: key.slice(5, 7), hour: +key.slice(8), price: a.price / a.n, rl: a.rl / a.n}))
    .sort((a, b) => (a.year !== b.year ? (a.year < b.year ? -1 : 1) : a.month !== b.month ? (a.month < b.month ? -1 : 1) : a.hour - b.hour));
}
