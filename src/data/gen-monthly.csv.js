// Monthly generation by production-type group for every zone in scope, 2021 to the last complete
// month: zone × month × group → GWh. ~25k rows (~750 KB) from one small monthly-aggregated
// download per zone (the server averages the quarter-hourly data on local time).

import {csvFormat} from "d3-dsv";
import {withCache} from "../../lib/cache.js";
import {dayAfterTomorrow, downloadRows, rowsPerZone} from "../../lib/entsoe.js";
import {monthlyGeneration} from "../components/gen.js";
import {START_DATE, ZONE_KEYS} from "../components/zones.js";

const round = (x) => Math.round(x * 10) / 10;
const thisMonth = `${new Date().toISOString().slice(0, 7)}-01`;
const monthsBack = (month, n) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 - n, 1)).toISOString().slice(0, 10);

process.stdout.write(
  await withCache("gen-monthly.csv", async () => {
    // Generation is revised for a few weeks after delivery: the last two cached months are redone.
    const rows = await rowsPerZone("gen-monthly.csv", ZONE_KEYS, async (zone, since) =>
      monthlyGeneration(
        await downloadRows(zone, {endpoint: "generation_per_type", start: since ?? START_DATE, end: dayAfterTomorrow(), aggregation: "monthly", tz: "local"}),
        thisMonth
      ).map((d) => ({zone, month: d.month, group: d.group, gwh: round(d.gwh)})),
      {key: "month", refreshFrom: (last) => monthsBack(last, 1)}
    );
    // Guard against a truncated upstream response replacing a good cache: 44 zones × ~5.8 years
    // × 5-8 groups.
    if (rows.length < 12_000) throw new Error(`only ${rows.length} rows — upstream looks truncated`);
    console.warn(`[gen-monthly] ${rows.length} rows, through ${rows.map((d) => d.month).sort().at(-1)}`);
    return csvFormat(rows);
  })
);
