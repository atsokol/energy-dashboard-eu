// Generation mix and load by calendar month and local hour of day, one file per zone:
// month × hour × group → average MW (load as group "load"). Incremental like residual/[zone]:
// cached months before the last cached month − 1 are kept, later ones re-downloaded.

import {parseArgs} from "node:util";
import {csvFormat, csvParse} from "d3-dsv";
import {cacheRead, withCache} from "../../../lib/cache.js";
import {dayAfterTomorrow, downloadRows} from "../../../lib/entsoe.js";
import {monthHourProfiles} from "../../components/gen.js";
import {gbLoad} from "../../components/residual.js";
import {START_DATE, zoneByKey} from "../../components/zones.js";

const {values: {zone}} = parseArgs({options: {zone: {type: "string"}}});
if (!zoneByKey.has(zone)) throw new Error(`unknown zone ${zone}`);

const name = `gen-hourly/${zone}.csv`;
const monthStart = (month, offset) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + offset, 1)).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

process.stdout.write(
  await withCache(name, async () => {
    const cached = process.env.GEN_HOURLY_FULL || process.env.ENTSOE_FULL ? null : await cacheRead(name);
    const prev = cached ? csvParse(cached) : [];
    const last = prev.at(-1)?.month;
    const from = last ? monthStart(last, -1) : START_DATE;
    const kept = prev.filter((d) => d.month < from.slice(0, 7));

    // A day before: local days start up to 3 hours before UTC midnight.
    const start = addDays(from, -1);
    const end = dayAfterTomorrow();
    let gen = [], load = [];
    for (let s = start; s < end; s = `${+s.slice(0, 4) + 1}-01-01`) {
      const e = `${+s.slice(0, 4) + 1}-01-01` < end ? `${+s.slice(0, 4) + 1}-01-01` : end;
      gen = gen.concat(await downloadRows(zone, {endpoint: "generation_per_type", start: s, end: e, aggregation: "hourly"}));
      load = load.concat(await downloadRows(zone, {endpoint: "actual_load", start: s, end: e, aggregation: "hourly"}));
    }
    // GB: transmission demand plus the embedded output it cannot see (gbLoad).
    const fresh = monthHourProfiles(gen, zone === "GB" ? gbLoad(load, gen) : load, zone)
      .filter((d) => d.month >= from.slice(0, 7))
      .map((d) => ({...d, mw: Math.round(d.mw)}));
    if (!fresh.length && !kept.length) throw new Error("no generation or load hours");
    if (prev.length && kept.length + fresh.length < prev.length * 0.98) {
      throw new Error(`only ${kept.length + fresh.length} rows against ${prev.length} cached — upstream looks truncated`);
    }
    console.warn(`[gen-hourly] ${zone}: kept ${kept.length} cached rows before ${from}, ${fresh.length} new`);
    return csvFormat([...kept, ...fresh], ["month", "hour", "group", "mw"]);
  })
);
