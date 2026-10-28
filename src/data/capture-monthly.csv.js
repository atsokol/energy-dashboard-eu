// Monthly solar and wind capture prices for every zone in scope, 2021 to the last complete month:
// zone × month × tech → capture price, baseload price (EUR/MWh), generation (GWh) and priced hours.
// ~6k rows (~350 KB). entsoemcp.com weights hourly prices by hourly output server-side
// (`capture_price` derivation, local months), so this is one ~1 s JSON call per zone instead of
// ~500 MB of hourly generation.

import {csvFormat} from "d3-dsv";
import {withCache} from "../../lib/cache.js";
import {dayAfterTomorrow, derivationRows, rowsPerZone} from "../../lib/entsoe.js";
import {CAPTURE_PSR, monthlyCapture} from "../components/capture.js";
import {START_DATE, ZONE_KEYS} from "../components/zones.js";

const round = (x, k) => Math.round(x * k) / k;
const thisMonth = `${new Date().toISOString().slice(0, 7)}-01`;
const monthsBack = (month, n) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 - n, 1)).toISOString().slice(0, 10);

process.stdout.write(
  await withCache("capture-monthly.csv", async () => {
    // Generation is revised for a few weeks after delivery: the last two cached months are redone.
    const rows = await rowsPerZone("capture-monthly.csv", ZONE_KEYS, async (zone, since) =>
      monthlyCapture(await derivationRows(zone, "capture_price", {start: since ?? START_DATE, end: dayAfterTomorrow(), psrTypes: CAPTURE_PSR}), thisMonth)
        .map((d) => ({
          zone, month: d.month, tech: d.tech, capture: round(d.capture, 100), base: round(d.base, 100),
          gwh: round(d.gwh, 1000), hours: d.hours
        })),
      {key: "month", refreshFrom: (last) => monthsBack(last, 1)}
    );
    // Guard against a truncated upstream response replacing a good cache: 44 zones × ~5.8 years
    // × 1-2 technologies.
    if (rows.length < 3_500) throw new Error(`only ${rows.length} rows — upstream looks truncated`);
    console.warn(`[capture-monthly] ${rows.length} rows, through ${rows.map((d) => d.month).sort().at(-1)}`);
    return csvFormat(rows);
  })
);
