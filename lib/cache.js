// Last known-good snapshots of every remote dataset, under cache/.
//
// Data loaders must not turn a bad day at an upstream API into a failed deploy. Each
// loader mirrors its successful downloads here and falls back to the stored copy when
// the network or the API lets it down; the build only fails when there is no snapshot
// at all. The directory is committed, so a clean CI checkout always has a floor to
// stand on, and actions/cache layers anything fresher on top between runs.

import {existsSync, readFileSync} from "node:fs";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CACHE_DIR = join(ROOT, "cache");

// Local development reads .env; CI injects secrets as real environment variables.
// Hand-rolled rather than pulling in dotenv — it is a dozen lines and one fewer
// dependency in the build.
export function loadDotEnv() {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue; // real env wins over .env
    process.env[key] = raw.trim().replace(/^(['"])(.*)\1$/s, "$2");
  }
}

export async function cacheWrite(name, text) {
  const file = join(CACHE_DIR, name);
  await mkdir(dirname(file), {recursive: true});
  await writeFile(file, text);
}

export async function cacheRead(name) {
  const file = join(CACHE_DIR, name);
  return existsSync(file) ? readFile(file, "utf-8") : null;
}

/**
 * Run `produce`, caching its output under cache/<name>. If it throws, serve the
 * cached copy instead; only rethrow when nothing has ever been cached.
 */
export async function withCache(name, produce) {
  try {
    const text = await produce();
    if (!text?.trim()) throw new Error("empty response body");
    await cacheWrite(name, text);
    console.warn(`[cache] ${name}: fetched ${text.length} bytes, cache updated`);
    return text;
  } catch (error) {
    const cached = await cacheRead(name);
    if (cached) {
      console.warn(`[cache] ${name}: ${error.message} — serving cached snapshot`);
      return cached;
    }
    throw new Error(`[cache] ${name}: upstream failed and no cached snapshot exists — ${error.message}`);
  }
}
