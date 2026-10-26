// Monthly solar and wind capture prices for every zone in scope, 2021 to the last complete month:
// zone × month × tech → capture price, baseload price (EUR/MWh), generation (GWh) and priced hours.
// ~2.5k rows (~150 KB). entsoemcp.com weights hourly prices by hourly output server-side
// (`capture_price` derivation, local months), so this is one ~1 s JSON call per zone instead of
// ~500 MB of hourly generation.

import {csvFormat} from "d3-dsv";
import {withCache} from "../../lib/cache.js";
import {CONCURRENCY, dayAfterTomorrow, derivationRows, pool} from "../../lib/entsoe.js";
import {CAPTURE_PSR, monthlyCapture} from "../components/capture.js";
import {START_DATE, ZONE_KEYS} from "../components/zones.js";

const round = (x, k) => Math.round(x * k) / k;
const thisMonth = `${new Date().toISOString().slice(0, 7)}-01`;

process.stdout.write(
  await withCache("capture-monthly.csv", async () => {
    const raw = await pool(ZONE_KEYS, CONCURRENCY, (zone) =>
      derivationRows(zone, "capture_price", {start: START_DATE, end: dayAfterTomorrow(), psrTypes: CAPTURE_PSR})
    );
    const rows = ZONE_KEYS.flatMap((zone, i) =>
      monthlyCapture(raw[i], thisMonth).map((d) => ({
        zone, month: d.month, tech: d.tech, capture: round(d.capture, 100), base: round(d.base, 100),
        gwh: round(d.gwh, 1000), hours: d.hours
      }))
    );
    // Guard against a truncated upstream response replacing a good cache: 18 zones × ~5.8 years
    // × 1-2 technologies.
    if (rows.length < 1_500) throw new Error(`only ${rows.length} rows — upstream looks truncated`);
    console.warn(`[capture-monthly] ${rows.length} rows, through ${rows.map((d) => d.month).sort().at(-1)}`);
    return csvFormat(rows);
  })
);
