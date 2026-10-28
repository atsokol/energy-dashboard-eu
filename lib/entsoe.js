// Build-time client for the entsoemcp.com bulk-export endpoint.
//
// entsoemcp.com is anonymous (no token) and rate-limited per IP. `/download` streams one zone ×
// one endpoint as CSV for any window up to 2,000,000 rows, so 2021-to-date hourly prices for a
// zone is a single ~1.7 MB request (~330 KB gzipped, ~1-2 s). The `/api/series` JSON endpoint
// caps a call at 1,830 days, which is why the bulk route is used here.
//
// The generation loaders (src/data/gen-*.csv.js) call other endpoints through downloadRows.
//
// Downloads are incremental: each loader keeps its last output in cache/ (lib/cache.js) and
// fetches only the recent period still open to revision, or a zone's full history when the
// snapshot has none of it (a newly added zone). rowsPerZone does this for the loaders that write
// one file for every zone; residual/[zone] and gen-hourly/[zone] do the same per file.
//
// Hourly price downloads are kept under cache/raw/ (gitignored) for RAW_TTL_MS, keyed by zone and
// start date, so a loader in the same build asking for the same days reads them from disk.

import {existsSync, statSync} from "node:fs";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {csvParse} from "d3-dsv";
import {cacheRead, ROOT} from "./cache.js";

export const API = process.env.ENTSOE_API ?? "https://entsoemcp.com";
const RAW_DIR = join(ROOT, "cache", "raw");
const RAW_TTL_MS = 3 * 3_600_000;
export const CONCURRENCY = 4; // polite: the export endpoint has a small pool of slots (503 when busy)
// With CONCURRENCY requests in flight the server often answers "Retry-After: 1" several times
// running, so waits back off exponentially whatever it suggests: 2, 4, … 64 s, ~2 min in all.
const MAX_ATTEMPTS = 7;
// The server's Retry-After grows with sustained use (minutes, up to ~25 min seen in CI after two
// full downloads in an hour). Waiting that out stalls the build for little gain, so a longer
// demand gives up at once: the loader then serves its cached snapshot (lib/cache.js).
const MAX_WAIT_MS = 120_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET a URL as text, retrying 429/5xx with the server's Retry-After or exponential backoff. */
export async function getText(url) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(url, {headers: {"user-agent": "energy-dashboard-eu (GitHub Pages build)"}});
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw error;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw new Error(`HTTP ${response.status} for ${url}: ${(await response.text()).slice(0, 200)}`);
    }
    const wait = Math.max(Number(response.headers.get("retry-after")) * 1000 || 0, 1000 * 2 ** attempt);
    if (wait > MAX_WAIT_MS) {
      throw new Error(`HTTP ${response.status} for ${url}: server asks to wait ${Math.round(wait / 1000)} s, giving up`);
    }
    console.warn(`[entsoe] HTTP ${response.status}, retry ${attempt} in ${wait / 1000}s — ${url}`);
    await sleep(wait);
  }
}

export function downloadUrl(zone, {endpoint = "day_ahead_price", start, end, aggregation = "hourly", tz} = {}) {
  const q = new URLSearchParams({endpoint, zone, start, end, format: "csv"});
  if (aggregation) q.set("aggregation", aggregation);
  if (tz) q.set("tz", tz);
  return `${API}/download?${q}`;
}

/**
 * One `/download` call for any endpoint, parsed. No raw cache: used by loaders whose downloads
 * nothing else in the build shares.
 */
export async function downloadRows(zone, options) {
  const t0 = Date.now();
  const text = await getText(downloadUrl(zone, options));
  const rows = csvParse(text);
  console.warn(`[entsoe] ${options.endpoint} ${zone}: ${rows.length} rows, ${(text.length / 1e6).toFixed(1)} MB in ${Date.now() - t0} ms`);
  return rows;
}

/**
 * Rows of a server-side derivation (`/api/derivation`, the HTTP face of the MCP get_derivation
 * tool) for one zone: monthly buckets on the zone's local time. Unlike /download it answers in
 * JSON only, and `psr_types` takes a comma-separated list.
 */
export async function derivationRows(zone, slug, {start, end, psrTypes} = {}) {
  const q = new URLSearchParams({slug, zone, start, end});
  if (psrTypes) q.set("psr_types", psrTypes.join(","));
  const t0 = Date.now();
  const body = JSON.parse(await getText(`${API}/api/derivation?${q}`));
  if (!Array.isArray(body.data)) throw new Error(`${slug} ${zone}: ${body.error ?? "no data array"}`);
  console.warn(`[entsoe] ${slug} ${zone}: ${body.data.length} rows in ${Date.now() - t0} ms`);
  return body.data;
}

/** Tomorrow (UTC) as YYYY-MM-DD: an exclusive end that includes the day-ahead auction just cleared. */
export function dayAfterTomorrow() {
  return new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Hourly day-ahead CSV rows for one zone from local day `start` on, from the shared raw cache
 * when fresh. Loaders ask only for the days they refresh; the file is keyed by start date.
 */
export async function hourlyRows(zone, start) {
  const file = join(RAW_DIR, `${zone}@${start}.csv`);
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < RAW_TTL_MS) {
    return csvParse(await readFile(file, "utf-8"));
  }
  const t0 = Date.now();
  // Local market days start up to 3 hours before UTC midnight, so the first local day of the
  // window needs the evening before it in UTC. Callers filter the extra day back out.
  const from = new Date(Date.parse(start) - 86_400_000).toISOString().slice(0, 10);
  const text = await getText(downloadUrl(zone, {start: from, end: dayAfterTomorrow()}));
  await mkdir(RAW_DIR, {recursive: true});
  await writeFile(file, text);
  const rows = csvParse(text);
  console.warn(`[entsoe] ${zone}: ${rows.length} hourly rows, ${(text.length / 1e6).toFixed(1)} MB in ${Date.now() - t0} ms`);
  return rows;
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

/**
 * Rows for every zone of a loader whose output, cache/<name>, is one CSV with a `zone` column and
 * a period column `key` ("date", "month" or "year": strings that sort in time order), refreshed
 * incrementally from that cached snapshot:
 *
 *   - a zone with no cached rows (a country just added, or a new loader) is downloaded in full:
 *     `fetchZone(zone, null)`;
 *   - a zone with cached rows is downloaded from `refreshFrom(lastKey)` only, the period still
 *     open to revision: `fetchZone(zone, since)`, whose rows replace the cached ones from `since`;
 *     `refreshFrom` returning null means the cached rows are current and nothing is downloaded;
 *   - a zone whose download fails keeps all its cached rows, so one rate-limited zone no longer
 *     sends every other zone back to the old snapshot.
 *
 * CONCURRENCY zones download at a time. ENTSOE_FULL=1 ignores the snapshot (full re-download).
 * Throws when every zone that needed a download failed. Returns the rows in zone order.
 */
export async function rowsPerZone(name, zones, fetchZone, {key, refreshFrom}) {
  const text = process.env.ENTSOE_FULL ? null : await cacheRead(name);
  const cached = new Map();
  for (const r of text ? csvParse(text) : []) {
    if (!cached.has(r.zone)) cached.set(r.zone, []);
    cached.get(r.zone).push(r);
  }
  const plan = zones.map((zone) => {
    const own = cached.get(zone);
    if (!own) return {zone, since: null, fetch: true};
    const since = refreshFrom(own.reduce((m, r) => (r[key] > m ? r[key] : m), own[0][key]));
    return {zone, since, fetch: since !== null};
  });
  const failed = [];
  const fresh = await pool(plan, CONCURRENCY, async ({zone, since, fetch}) => {
    if (!fetch) return null;
    try {
      return (await fetchZone(zone, since)).filter((r) => since === null || r[key] >= since);
    } catch (error) {
      failed.push(zone);
      console.warn(`[entsoe] ${name} ${zone}: ${error.message.slice(0, 200)} — keeping its cached rows`);
      return null;
    }
  });
  const fetched = plan.filter((p) => p.fetch).length;
  if (fetched && failed.length === fetched) throw new Error(`every download failed (last: ${failed.at(-1)})`);
  const rows = plan.flatMap(({zone, since}, i) => {
    const own = cached.get(zone) ?? [];
    if (!fresh[i]) return own;
    return [...own.filter((r) => since !== null && r[key] < since), ...fresh[i]];
  });
  const full = plan.filter((p) => p.fetch && p.since === null && !failed.includes(p.zone)).map((p) => p.zone);
  const none = failed.filter((z) => !cached.has(z));
  console.warn(`[entsoe] ${name}: ${fetched - failed.length} zone(s) downloaded${full.length ? ` (full history: ${full.join(", ")})` : ""}, ` +
    `${plan.length - fetched} current${failed.length ? `, ${failed.length} failed (${none.length ? `no data at all for ${none.join(", ")}` : "cached rows kept"})` : ""}`);
  return rows;
}
