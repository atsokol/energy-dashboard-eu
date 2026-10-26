// Build-time client for the gas and carbon prices on Energy-Charts (Fraunhofer ISE).
//
// Neither ENTSO-E nor the public api.energy-charts.info carries fuel prices, but the data file behind
// Energy-Charts' "Electricity production and spot prices in Germany" chart does: one JSON per year,
// hourly arrays (UTC) of the THE (ex-NCG) day-ahead gas price, held flat across its delivery day,
// and the EEX EUA auction price, which steps at each auction. ~1.4 MB per year.
//
// The raw JSON is kept under cache/raw/ like the ENTSO-E downloads: the current year for
// RAW_TTL_MS, closed years for a month.

import {existsSync, statSync} from "node:fs";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {ROOT} from "./cache.js";
import {getText} from "./entsoe.js";
import {gasPlantCost, localTime} from "../src/components/dam.js";

const BASE = "https://www.energy-charts.info/charts/price_spot_market/data/de";
const RAW_DIR = join(ROOT, "cache", "raw");
const RAW_TTL_MS = 3 * 3_600_000;
const CLOSED_TTL_MS = 30 * 86_400_000;

// Series names (English) in the yearly file.
const GAS = "Gas (NCG, THE)";
const CO2 = "CO2 Emission Allowances, Auction EU";

async function yearSeries(year) {
  const file = join(RAW_DIR, `energy-charts-${year}.json`);
  const ttl = year < new Date().getUTCFullYear() ? CLOSED_TTL_MS : RAW_TTL_MS;
  let text;
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < ttl) {
    text = await readFile(file, "utf-8");
  } else {
    text = await getText(`${BASE}/year_${year}.json`);
    await mkdir(RAW_DIR, {recursive: true});
    await writeFile(file, text);
    console.warn(`[energy-charts] ${year}: ${(text.length / 1e6).toFixed(1)} MB`);
  }
  const series = JSON.parse(text);
  const nameOf = (s) => (Array.isArray(s.name) ? s.name[0] : s.name)?.en;
  const x = series.find((s) => s.xAxisValues)?.xAxisValues;
  const pick = (name) => {
    const s = series.find((d) => nameOf(d) === name);
    if (!s || !x) throw new Error(`energy-charts ${year}: no "${name}" series`);
    return s.data;
  };
  return {x, gas: pick(GAS), co2: pick(CO2)};
}

/**
 * Daily THE gas price (EUR/MWh), EUA price (EUR/t) and gas-plant cost (EUR/MWh) for every calendar
 * day from `start` to the last day with a gas price, as [{date, gas, co2, cost}]. Days are German
 * local days; the EUA price is the day's hour-weighted mean. The gas spot is not published for
 * weekends and holidays in the early years; those days carry the last published price forward, as
 * does a day without an EUA auction.
 */
export async function fuelDaily(start) {
  const byDate = new Map();
  for (let year = +start.slice(0, 4); year <= new Date().getUTCFullYear(); year++) {
    const {x, gas, co2} = await yearSeries(year);
    for (let i = 0; i < x.length; i++) {
      const {date} = localTime(x[i], "DE_LU");
      let d = byDate.get(date);
      if (!d) byDate.set(date, (d = {gas: 0, nGas: 0, co2: 0, nCo2: 0}));
      if (gas[i] != null) { d.gas += gas[i]; d.nGas += 1; }
      if (co2[i] != null) { d.co2 += co2[i]; d.nCo2 += 1; }
    }
  }
  const last = [...byDate].filter(([, d]) => d.nGas).map(([date]) => date).sort().at(-1);
  const out = [];
  let gas = null, co2 = null;
  for (let t = Date.parse(start); ; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (!last || date > last) break;
    const d = byDate.get(date);
    if (d?.nGas) gas = d.gas / d.nGas;
    if (d?.nCo2) co2 = d.co2 / d.nCo2;
    if (gas != null && co2 != null) out.push({date, gas, co2, cost: gasPlantCost(gas, co2)});
  }
  return out;
}
