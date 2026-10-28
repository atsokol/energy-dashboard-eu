// Monthly solar and wind capture prices for every zone in scope, 2021 to the last complete month:
// zone × month × tech → capture price, baseload price (EUR/MWh), generation (GWh) and priced hours.
// ~6k rows (~350 KB). entsoemcp.com weights hourly prices by hourly output server-side
// (`capture_price` derivation, local months), so this is one ~1 s JSON call per zone instead of
// ~500 MB of hourly generation. GB is the exception: the derivation runs on ENTSO-E's day-ahead
// price, which ended for GB in 2020, so GB is computed here from its hourly IMRP prices and NESO
// generation (monthlyCaptureHourly).

import {csvFormat} from "d3-dsv";
import {withCache} from "../../lib/cache.js";
import {dayAfterTomorrow, derivationRows, downloadYears, hourlyRows, rowsPerZone} from "../../lib/entsoe.js";
import {useGbpRates} from "../../lib/fx.js";
import {CAPTURE_PSR, monthlyCapture, monthlyCaptureHourly} from "../components/capture.js";
import {normaliseHourly} from "../components/dam.js";
import {START_DATE, ZONE_KEYS} from "../components/zones.js";

const round = (x, k) => Math.round(x * k) / k;
const thisMonth = `${new Date().toISOString().slice(0, 7)}-01`;
const monthsBack = (month, n) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 - n, 1)).toISOString().slice(0, 10);

// A day before: local months start up to 3 hours before UTC midnight.
const addDays = (date, n) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
async function gbCapture(start) {
  const prices = normaliseHourly(await hourlyRows("GB", start), "GB").filter((d) => d.date >= start);
  const gen = await downloadYears("GB", {endpoint: "generation_per_type", start: addDays(start, -1), end: dayAfterTomorrow(), aggregation: "hourly"});
  return monthlyCaptureHourly(prices, gen, thisMonth);
}

process.stdout.write(
  await withCache("capture-monthly.csv", async () => {
    await useGbpRates();
    // Generation is revised for a few weeks after delivery: the last two cached months are redone.
    const rows = await rowsPerZone("capture-monthly.csv", ZONE_KEYS, async (zone, since) =>
      (zone === "GB"
        ? await gbCapture(since ?? START_DATE)
        : monthlyCapture(await derivationRows(zone, "capture_price", {start: since ?? START_DATE, end: dayAfterTomorrow(), psrTypes: CAPTURE_PSR}), thisMonth))
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
