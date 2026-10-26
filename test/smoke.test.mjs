// Smoke test for every dashboard page: runs the page's real cells against the real
// CSVs in cache/ and asserts that each derived cell holds well-formed data and each chart renders
// something. The site rebuilds unattended on a daily cron, so without this a schema change
// upstream would publish a blank dashboard silently.
//
//   npm test                 # 800px viewport
//   HARNESS_WIDTH=400 npm test
//
// Requires `npm run build` first, to populate cache/ and Framework's module cache.

import {existsSync, mkdirSync} from "node:fs";
import {join, resolve} from "node:path";
import {buildHarness, ROOT} from "./harness.mjs";

const PAGES = ["generation", "prices", "spreads", "capture"];
const width = Number(process.env.HARNESS_WIDTH ?? 800);
const tmp = resolve(ROOT, "test/.generated");
mkdirSync(tmp, {recursive: true});

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.log(`  ✗ ${msg}`); failures++; };

if (!existsSync(resolve(ROOT, "cache"))) {
  console.error("cache/ is empty — run `npm run build` first so the data loaders populate it");
  process.exit(1);
}

for (const page of PAGES) {
  console.log(`\n${"=".repeat(60)}\n${page}.md  (width ${width}px)\n${"=".repeat(60)}`);

  const out = join(tmp, `${page}.mjs`);
  const {declarations, outputs, resolved, raw} = buildHarness(page, out);
  console.log(`  ${declarations} declaration cells, ${outputs} output cells`);
  resolved.forEach((r) => console.log(`  ${r}`));

  let mod;
  try {
    mod = await import(out);
  } catch (error) {
    // A cell that throws while evaluating takes the whole page down in the browser too.
    bad(`${page}.md failed to evaluate: ${error.message.split("\n")[0]}`);
    continue;
  }

  console.log("\n  -- cells --");
  for (const [name, value] of Object.entries(mod.cells)) {
    if (typeof value === "function") continue;
    if (value == null) { bad(`${name} is ${value}`); continue; }
    if (Array.isArray(value)) {
      if (!value.length) { bad(`${name} is an EMPTY array — anything drawn from it renders blank`); continue; }
      if (raw.has(name)) { ok(`${name}: ${value.length} rows (raw)`); continue; }
      const holes = value.filter((row) =>
        row && typeof row === "object" &&
        Object.values(row).some((v) => v == null || (typeof v === "number" && !Number.isFinite(v)))
      );
      holes.length ? bad(`${name}: ${holes.length}/${value.length} rows carry a null or non-finite value`)
                   : ok(`${name}: ${value.length} rows`);
    } else if (typeof value === "string") {
      ok(`${name}: "${value.slice(0, 40)}"`);
    }
  }

  // Every zone in scope should have a value on every map period except (possibly) the latest
  // day, and the selected zone's charts must have data.
  if (mod.cells.priceValues) {
    mod.cells.priceValues.length >= 15 ? ok(`price map: ${mod.cells.priceValues.length} zones shaded`)
                                       : bad(`price map: only ${mod.cells.priceValues.length} zones shaded`);
  }
  if (mod.cells.mix) {
    mod.cells.mix.length >= 15 ? ok(`generation map: ${mod.cells.mix.length} zones with a full year`)
                               : bad(`generation map: only ${mod.cells.mix.length} zones with a full year`);
  }
  for (const name of ["solarValues", "windValues"]) {
    if (!mod.cells[name]) continue;
    mod.cells[name].length >= 12 ? ok(`${name} map: ${mod.cells[name].length} zones shaded`)
                                 : bad(`${name} map: only ${mod.cells[name].length} zones shaded`);
  }
  if (mod.cells.spreadValues) {
    mod.cells.spreadValues.length >= 15 ? ok(`spread map: ${mod.cells.spreadValues.length} zones shaded`)
                                        : bad(`spread map: only ${mod.cells.spreadValues.length} zones shaded`);
  }

  console.log("\n  -- outputs --");
  for (const {index, render} of mod.outputs) {
    try {
      const el = render();
      if (!el?.querySelectorAll) { ok(`output ${index + 1}: ${typeof el}`); continue; }
      const svgs = [...(el.tagName === "svg" ? [el] : el.querySelectorAll("svg"))];
      if (!svgs.length) { ok(`output ${index + 1}: <${el.tagName}> "${el.textContent.trim().slice(0, 60)}"`); continue; }
      const marks = Math.max(...svgs.map((s) => s.querySelectorAll("path, rect, line, circle, text").length));
      marks < 20 ? bad(`output ${index + 1}: largest svg has only ${marks} elements — likely blank`)
                 : ok(`output ${index + 1}: ${svgs.length} svg(s), ${marks} elements`);
    } catch (error) {
      bad(`output ${index + 1} THREW: ${error.message}`);
    }
  }
}

console.log(failures ? `\n${failures} failure(s)\n` : "\nAll checks passed\n");
process.exit(failures ? 1 : 0);
