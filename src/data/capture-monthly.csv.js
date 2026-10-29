// Monthly solar and wind capture prices for every zone in scope, 2021 to the last complete month:
// zone × month × tech → capture price, baseload price (EUR/MWh), generation (GWh), priced hours,
// and the output in negative-price hours with its average price. ~6k rows (~400 KB).
//
// The capture price, baseload and output come from entsoemcp.com's server-side `capture_price`
// derivation (output-weighted hourly prices, local months; one ~1 s JSON call per zone). The
// derivation has no split by price sign, so the negative-hour totals come from hourly prices and
// hourly generation joined the same way (negativeHourTotals): baseload over every priced hour,
// output weighted on the hours it has data. That join reproduces the server's capture factors to
// the fourth decimal; the loader checks every month and logs any that differ by over 0.5 points.
// Incremental like the other loaders: the last two cached months are redone, a new zone (or a
// snapshot without the negative-hour columns) is downloaded in full.

import {csvFormat} from "d3-dsv";
import {withCache} from "../../lib/cache.js";
import {dayAfterTomorrow, derivationRows, downloadYears, hourlyRows, rowsPerZone} from "../../lib/entsoe.js";
import {CAPTURE_PSR, monthlyCapture, negativeHourTotals} from "../components/capture.js";
import {normaliseHourly} from "../components/dam.js";
import {START_DATE, ZONE_KEYS} from "../components/zones.js";

const round = (x, k) => Math.round(x * k) / k;
const thisMonth = `${new Date().toISOString().slice(0, 7)}-01`;
const monthsBack = (month, n) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 - n, 1)).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
const MAX_CHECK_DIFF = 0.005; // capture factor, hourly join vs server

async function zoneRows(zone, since) {
  const start = since ?? START_DATE;
  const end = dayAfterTomorrow();
  const server = monthlyCapture(await derivationRows(zone, "capture_price", {start, end, psrTypes: CAPTURE_PSR}), thisMonth);
  // A day before: local months start up to 3 hours before UTC midnight.
  const prices = normaliseHourly(await hourlyRows(zone, start), zone).filter((d) => d.date >= start);
  const gen = await downloadYears(zone, {endpoint: "generation_per_type", start: addDays(start, -1), end, aggregation: "hourly"});
  const neg = negativeHourTotals(prices, gen);
  const off = [];
  const rows = server.map((d) => {
    const n = neg.get(`${d.month.slice(0, 7)}|${d.tech}`);
    if (n && n.gwh > 0) {
      const diff = n.value / (n.gwh * 1000) / d.base - d.capture / d.base;
      if (Math.abs(diff) > MAX_CHECK_DIFF) off.push(`${d.month.slice(0, 7)} ${d.tech} ${(diff * 100).toFixed(1)} pt`);
    }
    return {
      zone, month: d.month, tech: d.tech, capture: round(d.capture, 100), base: round(d.base, 100),
      gwh: round(d.gwh, 1000), hours: d.hours,
      // Blank when the hourly join has no output for the month: no decomposition for its periods.
      neg_gwh: n ? round(n.negGwh, 1000) : "",
      neg_capture: n ? (n.negGwh > 0 ? round(n.negValue / (n.negGwh * 1000), 100) : 0) : ""
    };
  });
  if (off.length) console.warn(`[capture-monthly] ${zone}: hourly join differs from the server by over ${MAX_CHECK_DIFF * 100} pt in ${off.length} month(s): ${off.slice(0, 6).join("; ")}`);
  return rows;
}

process.stdout.write(
  await withCache("capture-monthly.csv", async () => {
    // Generation is revised for a few weeks after delivery: the last two cached months are redone.
    const rows = await rowsPerZone("capture-monthly.csv", ZONE_KEYS, zoneRows, {
      key: "month", refreshFrom: (last) => monthsBack(last, 1), columns: ["neg_gwh", "neg_capture"]
    });
    // Guard against a truncated upstream response replacing a good cache: 44 zones × ~5.8 years
    // × 1-2 technologies.
    if (rows.length < 3_500) throw new Error(`only ${rows.length} rows — upstream looks truncated`);
    const split = rows.filter((d) => d.neg_gwh !== "").length;
    console.warn(`[capture-monthly] ${rows.length} rows (${split} with negative-hour totals), through ${rows.map((d) => d.month).sort().at(-1)}`);
    return csvFormat(rows);
  })
);
