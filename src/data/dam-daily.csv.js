// Daily day-ahead metrics for every zone in scope, 2021 to date: hour-weighted average price and
// the TB1 / TB2 / TB4 spreads per local market day. ~38k rows (~1.3 MB, ~0.4 MB gzipped) distilled
// from ~900k hourly prices.

import {csvFormat} from "d3-dsv";
import {withCache} from "../../lib/cache.js";
import {hourlyRowsAll} from "../../lib/entsoe.js";
import {dailyMetrics, normaliseHourly} from "../components/dam.js";
import {START_DATE, ZONE_KEYS} from "../components/zones.js";

const round = (x) => Math.round(x * 100) / 100;

process.stdout.write(
  await withCache("dam-daily.csv", async () => {
    const raw = await hourlyRowsAll(ZONE_KEYS, START_DATE);
    const rows = [];
    for (const zone of ZONE_KEYS) {
      for (const d of dailyMetrics(normaliseHourly(raw.get(zone), zone))) {
        if (d.date < START_DATE) continue;
        rows.push({
          zone, date: d.date, avg: round(d.avg), tb1: round(d.tb1), tb2: round(d.tb2), tb4: round(d.tb4),
          top1: round(d.top1), top2: round(d.top2), top4: round(d.top4), hours: d.hours,
          neg_hours: d.neg_hours, neg_value: round(d.neg_value)
        });
      }
    }
    // Guard against a truncated upstream response replacing a good cache: 18 zones × ~5.8 years.
    if (rows.length < 30_000) throw new Error(`only ${rows.length} zone-days — upstream looks truncated`);
    console.warn(`[dam-daily] ${rows.length} zone-days, through ${rows.map((d) => d.date).sort().at(-1)}`);
    return csvFormat(rows);
  })
);
