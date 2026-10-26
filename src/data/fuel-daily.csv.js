import {csvFormat} from "d3-dsv";
import {withCache} from "../../lib/cache.js";
import {fuelDaily} from "../../lib/energycharts.js";
import {START_DATE} from "../components/zones.js";

const round = (x) => Math.round(x * 100) / 100;

process.stdout.write(
  await withCache("fuel-daily.csv", async () => {
    const rows = (await fuelDaily(START_DATE)).map((d) => ({date: d.date, gas: round(d.gas), co2: round(d.co2), cost: round(d.cost)}));
    if (rows.length < 1_500) throw new Error(`only ${rows.length} days — upstream looks truncated`);
    console.warn(`[fuel-daily] ${rows.length} days, through ${rows.at(-1).date}`);
    return csvFormat(rows);
  })
);
