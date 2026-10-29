// Hourly day-ahead price and residual load (load − wind − solar) for one zone, 2021 to date:
// `date,hour,price,rl` in local market time, EUR/MWh and MW. ~50k rows (~1.3 MB, ~0.4 MB gzipped)
// per zone. A parameterized loader (Framework runs it once per zone the prices page attaches) so
// the page loads only the selected country's hours.
//
// The residual load needs hourly generation by type, ~5 MB per zone-year (~500 MB for every zone
// since 2021), far too much to download on every daily build. Rows already in the cached snapshot
// are kept up to the start of the month before its latest month (generation and load are revised
// for a few weeks after delivery); only the rest is downloaded again. Without a snapshot, or with
// RESIDUAL_FULL=1, or with a snapshot missing one of the columns, everything is downloaded. Prices for the same days come from the shared raw
// cache (cache/raw/).

import {parseArgs} from "node:util";
import {csvFormat, csvParse} from "d3-dsv";
import {cacheRead, withCache} from "../../../lib/cache.js";
import {dayAfterTomorrow, downloadYears, hourlyRows} from "../../../lib/entsoe.js";
import {normaliseHourly} from "../../components/dam.js";
import {residualHourly} from "../../components/residual.js";
import {START_DATE, zoneByKey} from "../../components/zones.js";

const {values: {zone}} = parseArgs({options: {zone: {type: "string"}}});
if (!zoneByKey.has(zone)) throw new Error(`unknown zone ${zone}`);

const name = `residual/${zone}.csv`;
const COLUMNS = ["date", "hour", "price", "rl"];
const monthStart = (date, offset) => {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1 + offset, 1));
  return d.toISOString().slice(0, 10);
};
const addDays = (date, n) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

process.stdout.write(
  await withCache(name, async () => {
    const cached = process.env.RESIDUAL_FULL || process.env.ENTSOE_FULL ? null : await cacheRead(name);
    // A snapshot missing a column is downloaded again in full; columns no longer written (solar
    // and wind, from an earlier version) are dropped.
    const prev = cached && COLUMNS.every((c) => csvParse(cached.slice(0, cached.indexOf("\n") + 1)).columns.includes(c)) ? csvParse(cached) : [];
    const last = prev.at(-1)?.date;
    const from = last ? monthStart(last, -1) : START_DATE;
    const kept = prev.filter((d) => d.date < from);

    // A day either side of the window: local days start up to 3 hours before UTC midnight.
    // Calendar-year chunks, shared with the gen-hourly and capture loaders (downloadYears).
    const start = addDays(from, -1);
    const end = dayAfterTomorrow();
    const gen = await downloadYears(zone, {endpoint: "generation_per_type", start, end, aggregation: "hourly"});
    const load = await downloadYears(zone, {endpoint: "actual_load", start, end, aggregation: "hourly"});
    const prices = normaliseHourly(await hourlyRows(zone, from), zone).filter((d) => d.date >= from);

    const fresh = residualHourly(prices, load, gen).map((d) => ({
      date: d.date, hour: d.hour, price: Math.round(d.price * 100) / 100, rl: Math.round(d.rl)
    }));
    // Guard against a truncated upstream response replacing a good snapshot: a full refresh must
    // reach back to the first years, and an incremental one must not shrink the snapshot.
    if (!fresh.length && !kept.length) throw new Error("no hours with price, load and generation");
    if (prev.length && kept.length + fresh.length < prev.length * 0.98) {
      throw new Error(`only ${kept.length + fresh.length} hours against ${prev.length} cached — upstream looks truncated`);
    }
    console.warn(`[residual] ${zone}: kept ${kept.length} cached hours before ${from}, ${fresh.length} new`);
    return csvFormat([...kept, ...fresh], COLUMNS);
  })
);
