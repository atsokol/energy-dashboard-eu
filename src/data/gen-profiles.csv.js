// Typical daily generation profiles for the last full calendar year: zone × season × local hour
// × group → average MW. ~32k rows (~900 KB) from ~4M hourly values.
//
// The input is a year of hourly data per zone (up to 6 MB each, ~130 MB in all), and a past year
// hardly changes, so a zone is downloaded only when the cached snapshot has no rows for it in
// that year: every zone once a year (in January), otherwise only zones just added (and zones
// with no generation data for the year, a quick empty answer).

import {csvFormat} from "d3-dsv";
import {withCache} from "../../lib/cache.js";
import {downloadRows, rowsPerZone} from "../../lib/entsoe.js";
import {seasonalProfiles} from "../components/gen.js";
import {ZONE_KEYS} from "../components/zones.js";

const year = String(new Date().getUTCFullYear() - 1);
const round = (x) => Math.round(x * 10) / 10;

process.stdout.write(
  await withCache("gen-profiles.csv", async () => {
    // A day either side: local days start up to 3 hours before UTC midnight. seasonalProfiles
    // keeps only the year's local days. A zone cached for an earlier year is downloaded again,
    // and its old year's rows dropped.
    const rows = (await rowsPerZone("gen-profiles.csv", ZONE_KEYS, async (zone) =>
      seasonalProfiles(
        await downloadRows(zone, {endpoint: "generation_per_type", start: `${+year - 1}-12-31`, end: `${+year + 1}-01-02`, aggregation: "hourly"}),
        zone, year
      ).map((d) => ({zone, year, season: d.season, hour: d.hour, group: d.group, mw: round(d.mw)})),
      {key: "year", refreshFrom: (last) => (last >= year ? null : year)}
    )).filter((d) => d.year === year);
    if (rows.length < 12_000) throw new Error(`only ${rows.length} rows — upstream looks truncated`);
    console.warn(`[gen-profiles] ${rows.length} rows for ${year}`);
    return csvFormat(rows);
  })
);
