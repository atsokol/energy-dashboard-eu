// Typical daily generation profiles for the last full calendar year: zone × season × local hour
// × group → average MW. ~13k rows (~350 KB) from ~1.5M hourly values.
//
// The input is a year of hourly data per zone (up to 6 MB each, ~50 MB in all), and a past year
// hardly changes, so the download runs only when the cached snapshot is for an earlier year: once
// a year, plus whenever the cache is missing.

import {csvFormat, csvParse} from "d3-dsv";
import {cacheRead, withCache} from "../../lib/cache.js";
import {CONCURRENCY, downloadRows, pool} from "../../lib/entsoe.js";
import {seasonalProfiles} from "../components/gen.js";
import {ZONE_KEYS} from "../components/zones.js";

const year = String(new Date().getUTCFullYear() - 1);
const round = (x) => Math.round(x * 10) / 10;

process.stdout.write(
  await withCache("gen-profiles.csv", async () => {
    const cached = await cacheRead("gen-profiles.csv");
    if (cached && csvParse(cached.slice(0, 200))[0]?.year === year) {
      console.warn(`[gen-profiles] cached snapshot already covers ${year}; not re-downloading`);
      return cached;
    }
    // A day either side: local days start up to 3 hours before UTC midnight. seasonalProfiles
    // keeps only the year's local days.
    const raw = await pool(ZONE_KEYS, CONCURRENCY, (zone) =>
      downloadRows(zone, {endpoint: "generation_per_type", start: `${+year - 1}-12-31`, end: `${+year + 1}-01-02`, aggregation: "hourly"})
    );
    const rows = ZONE_KEYS.flatMap((zone, i) =>
      seasonalProfiles(raw[i], zone, year).map((d) => ({zone, year, season: d.season, hour: d.hour, group: d.group, mw: round(d.mw)}))
    );
    if (rows.length < 5_000) throw new Error(`only ${rows.length} rows — upstream looks truncated`);
    console.warn(`[gen-profiles] ${rows.length} rows for ${year}`);
    return csvFormat(rows);
  })
);
