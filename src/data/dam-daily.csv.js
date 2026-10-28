// Daily day-ahead metrics for every zone in scope, 2021 to date: hour-weighted average price and
// the TB1 / TB2 / TB4 spreads per local market day. ~90k rows (~3 MB, ~1 MB gzipped) distilled
// from ~2.2M hourly prices. Incremental: a zone already in the snapshot downloads only its last
// week, a new zone its full history (rowsPerZone).

import {csvFormat} from "d3-dsv";
import {withCache} from "../../lib/cache.js";
import {hourlyRows, rowsPerZone} from "../../lib/entsoe.js";
import {useGbpRates} from "../../lib/fx.js";
import {dailyMetrics, normaliseHourly} from "../components/dam.js";
import {START_DATE, ZONE_KEYS} from "../components/zones.js";

const round = (x) => Math.round(x * 100) / 100;
const addDays = (date, n) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

process.stdout.write(
  await withCache("dam-daily.csv", async () => {
    await useGbpRates(); // GB prices are in GBP
    // Published prices are final; the last week is refreshed in case of late corrections.
    const rows = await rowsPerZone("dam-daily.csv", ZONE_KEYS, async (zone, since) =>
      dailyMetrics(normaliseHourly(await hourlyRows(zone, since ?? START_DATE), zone))
        .filter((d) => d.date >= (since ?? START_DATE))
        .map((d) => ({
          zone, date: d.date, avg: round(d.avg), tb1: round(d.tb1), tb2: round(d.tb2), tb4: round(d.tb4),
          top1: round(d.top1), top2: round(d.top2), top4: round(d.top4), hours: d.hours,
          neg_hours: d.neg_hours, neg_value: round(d.neg_value)
        })),
      {key: "date", refreshFrom: (last) => addDays(last, -7)}
    );
    // Guard against a truncated upstream response replacing a good cache: 44 zones × ~5.8 years.
    if (rows.length < 75_000) throw new Error(`only ${rows.length} zone-days — upstream looks truncated`);
    console.warn(`[dam-daily] ${rows.length} zone-days, through ${rows.map((d) => d.date).sort().at(-1)}`);
    return csvFormat(rows);
  })
);
