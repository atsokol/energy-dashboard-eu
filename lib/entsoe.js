// Build-time client for the entsoemcp.com bulk-export endpoint.
//
// entsoemcp.com is anonymous (no token) and rate-limited per IP. `/download` streams one zone ×
// one endpoint as CSV for any window up to 2,000,000 rows, so 2021-to-date hourly prices for a
// zone is a single ~1.7 MB request (~330 KB gzipped, ~1-2 s). The `/api/series` JSON endpoint
// caps a call at 1,830 days, which is why the bulk route is used here.
//
// Two loaders (daily metrics, hourly quantiles) consume the same hourly downloads. Loaders run as
// separate processes, so the raw CSVs are kept under cache/raw/ (gitignored) and reused for
// RAW_TTL_MS: the second loader in a build reads them from disk instead of re-downloading 30 MB.

import {existsSync, statSync} from "node:fs";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {csvParse} from "d3-dsv";
import {ROOT} from "./cache.js";

export const API = process.env.ENTSOE_API ?? "https://entsoemcp.com";
const RAW_DIR = join(ROOT, "cache", "raw");
const RAW_TTL_MS = 3 * 3_600_000;
const CONCURRENCY = 4; // polite: the export endpoint has a small pool of slots (503 when busy)
const MAX_ATTEMPTS = 5;

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
    const wait = Number(response.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
    console.warn(`[entsoe] HTTP ${response.status}, retry ${attempt} in ${wait / 1000}s — ${url}`);
    await sleep(wait);
  }
}

export function downloadUrl(zone, {start, end, aggregation = "hourly", tz} = {}) {
  const q = new URLSearchParams({endpoint: "day_ahead_price", zone, start, end, format: "csv", aggregation});
  if (tz) q.set("tz", tz);
  return `${API}/download?${q}`;
}

/** Tomorrow (UTC) as YYYY-MM-DD: an exclusive end that includes the day-ahead auction just cleared. */
export function dayAfterTomorrow() {
  return new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
}

/** Hourly day-ahead CSV rows for one zone, from the shared raw cache when fresh. */
export async function hourlyRows(zone, start) {
  const file = join(RAW_DIR, `${zone}.csv`);
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

/** Hourly rows for every zone, downloaded CONCURRENCY at a time. Returns Map(zone → rows). */
export async function hourlyRowsAll(zones, start) {
  const t0 = Date.now();
  const rows = await pool(zones, CONCURRENCY, (zone) => hourlyRows(zone, start));
  console.warn(`[entsoe] ${zones.length} zones ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return new Map(zones.map((z, i) => [z, rows[i]]));
}
