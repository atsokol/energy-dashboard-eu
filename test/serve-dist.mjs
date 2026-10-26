// Serve the built site like GitHub Pages does — static files, gzip, clean URLs — so load-speed
// measurements of dist/ reflect production rather than the dev server's on-the-fly builds.
//
//   npm run build && node test/serve-dist.mjs        # http://localhost:3000

import {createReadStream, existsSync, statSync} from "node:fs";
import {createServer} from "node:http";
import {extname, join, normalize} from "node:path";
import {createGzip} from "node:zlib";
import {ROOT} from "./harness.mjs";

const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 3000);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".csv": "text/csv", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2"
};
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".csv", ".svg"]);

createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  else if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
  if (!existsSync(file)) { res.writeHead(404); return res.end("not found"); }

  const ext = extname(file);
  const headers = {"content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-cache"};
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
    res.writeHead(200, {...headers, "content-encoding": "gzip"});
    createReadStream(file).pipe(createGzip()).pipe(res);
  } else {
    res.writeHead(200, {...headers, "content-length": statSync(file).size});
    createReadStream(file).pipe(res);
  }
}).listen(PORT, () => console.log(`dist/ on http://localhost:${PORT}`));
