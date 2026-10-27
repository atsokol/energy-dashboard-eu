// Monthly generation by production-type group for every zone in scope, 2021 to the last complete
// month: zone × month × group → GWh. ~25k rows (~750 KB) from one small monthly-aggregated
// download per zone (the server averages the quarter-hourly data on local time).

import {csvFormat} from "d3-dsv";
import {withCache} from "../../lib/cache.js";
import {CONCURRENCY, dayAfterTomorrow, downloadRows, pool} from "../../lib/entsoe.js";
import {monthlyGeneration} from "../components/gen.js";
import {START_DATE, ZONE_KEYS} from "../components/zones.js";

const round = (x) => Math.round(x * 10) / 10;
const thisMonth = `${new Date().toISOString().slice(0, 7)}-01`;

process.stdout.write(
  await withCache("gen-monthly.csv", async () => {
    const raw = await pool(ZONE_KEYS, CONCURRENCY, (zone) =>
      downloadRows(zone, {endpoint: "generation_per_type", start: START_DATE, end: dayAfterTomorrow(), aggregation: "monthly", tz: "local"})
    );
    const rows = ZONE_KEYS.flatMap((zone, i) =>
      monthlyGeneration(raw[i], thisMonth).map((d) => ({zone, month: d.month, group: d.group, gwh: round(d.gwh)}))
    );
    // Guard against a truncated upstream response replacing a good cache: 44 zones × ~5.8 years
    // × 5-8 groups.
    if (rows.length < 12_000) throw new Error(`only ${rows.length} rows — upstream looks truncated`);
    console.warn(`[gen-monthly] ${rows.length} rows, through ${rows.map((d) => d.month).sort().at(-1)}`);
    return csvFormat(rows);
  })
);
