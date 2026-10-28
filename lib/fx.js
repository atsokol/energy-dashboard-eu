// GBP per EUR for converting GB prices (dam.js toEur): ECB monthly averages of its daily euro
// reference rates (EXR M.GBP.EUR.SP00.A) from 2021, fetched once per build and kept in
// cache/fx-gbp.csv. If the ECB is unreachable the cached rates serve; with neither, GB prices
// cannot be converted and GB drops out of the price data (with a warning) rather than failing
// the build.

import {csvParse} from "d3-dsv";
import {cacheRead, cacheWrite} from "./cache.js";
import {getText} from "./entsoe.js";
import {setGbpRates} from "../src/components/dam.js";

const URL = `${process.env.ECB_API ?? "https://data-api.ecb.europa.eu"}/service/data/EXR/M.GBP.EUR.SP00.A?format=csvdata&startPeriod=2021-01`;
const NAME = "fx-gbp.csv";

const parse = (text) => new Map(csvParse(text).filter((r) => +r.gbp_per_eur > 0).map((r) => [r.month, +r.gbp_per_eur]));

async function fetchRates() {
  // Two attempts: a small table that the cached copy can stand in for.
  const rows = csvParse(await getText(URL, {attempts: 2}))
    .filter((r) => /^\d{4}-\d{2}$/.test(r.TIME_PERIOD) && +r.OBS_VALUE > 0)
    .map((r) => `${r.TIME_PERIOD},${r.OBS_VALUE}`);
  if (rows.length < 12) throw new Error(`only ${rows.length} monthly rates`);
  const text = ["month,gbp_per_eur", ...rows].join("\n") + "\n";
  await cacheWrite(NAME, text);
  return text;
}

/** Fetch (or read the cached) GBP rates and hand them to dam.js. Returns the number of months. */
export async function useGbpRates() {
  let text;
  try {
    text = await fetchRates();
  } catch (error) {
    text = await cacheRead(NAME);
    console.warn(`[fx] ECB GBP rates: ${error.message.slice(0, 160)} — ${text ? "using cached rates" : "no rates, GB prices left out"}`);
  }
  const rates = text ? parse(text) : new Map();
  setGbpRates(rates);
  if (rates.size) console.warn(`[fx] GBP per EUR for ${rates.size} months, through ${[...rates.keys()].sort().at(-1)}`);
  return rates.size;
}
