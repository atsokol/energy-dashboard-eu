// Intraday price volatility: P10 / P50 / P90 of the hourly day-ahead price by zone, calendar year
// and local hour of day. 18 zones × 6 years × 24 hours ≈ 2.5k rows (~100 KB) from ~900k prices.
// Shares cache/raw/ with dam-daily.csv.js, so within one build only the first loader downloads.

import {csvFormat} from "d3-dsv";
import {withCache} from "../../lib/cache.js";
import {hourlyRowsAll} from "../../lib/entsoe.js";
import {hourlyQuantiles, normaliseHourly} from "../components/dam.js";
import {START_DATE, ZONE_KEYS} from "../components/zones.js";

const round = (x) => Math.round(x * 100) / 100;

process.stdout.write(
  await withCache("dam-quantiles.csv", async () => {
    const raw = await hourlyRowsAll(ZONE_KEYS, START_DATE);
    const rows = ZONE_KEYS.flatMap((zone) =>
      hourlyQuantiles(normaliseHourly(raw.get(zone), zone).filter((d) => d.date >= START_DATE))
        .map(({year, hour, p10, p50, p90}) => ({zone, year, hour, p10: round(p10), p50: round(p50), p90: round(p90)}))
    );
    if (rows.length < 2_000) throw new Error(`only ${rows.length} rows — upstream looks truncated`);
    console.warn(`[dam-quantiles] ${rows.length} rows`);
    return csvFormat(rows);
  })
);
