// Installed generation capacity by production-type group: zone × year × group → MW. ENTSO-E
// publishes one snapshot a year; most zones in scope only from 2025 (DE-LU and PL from 2016).

import {csvFormat} from "d3-dsv";
import {withCache} from "../../lib/cache.js";
import {CONCURRENCY, downloadRows, pool} from "../../lib/entsoe.js";
import {capacityByYear} from "../components/gen.js";
import {START_DATE, ZONE_KEYS} from "../components/zones.js";

const nextYear = `${new Date().getUTCFullYear() + 1}-01-01`;

process.stdout.write(
  await withCache("gen-capacity.csv", async () => {
    const raw = await pool(ZONE_KEYS, CONCURRENCY, (zone) =>
      downloadRows(zone, {endpoint: "installed_generation_capacity", start: START_DATE, end: nextYear, aggregation: null})
    );
    const rows = ZONE_KEYS.flatMap((zone, i) =>
      capacityByYear(raw[i]).map((d) => ({zone, year: d.year, group: d.group, mw: Math.round(d.mw)}))
    );
    if (rows.length < 150) throw new Error(`only ${rows.length} rows — upstream looks truncated`);
    console.warn(`[gen-capacity] ${rows.length} rows`);
    return csvFormat(rows);
  })
);
