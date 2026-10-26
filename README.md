# EU power markets dashboard

Observable Framework site for GitHub Pages: day-ahead prices and TB1/TB2/TB4 battery-arbitrage
spreads for 18 bidding zones in Central Europe, South-East Europe and the Baltics, from 2021.
Data: ENTSO-E Transparency Platform via [entsoemcp.com](https://entsoemcp.com) (anonymous API,
no key).

Same architecture as `energy-dashboard-UA`: build-time data loaders with a committed `cache/`
fallback, shared client modules in `src/components/`, a jsdom smoke test gating CI deploys.

## Pages

- **Day-ahead prices** (`/prices`): price map (last full year / month / week / day), monthly
  average price and intraday P10/P50/P90 by year for a selected country.
- **Day-ahead spreads** (`/spreads`): TB1/2/4 map (year / month / week) and a 30-day
  moving-average comparison across countries.

Clicking a country on a map selects it (prices) or adds/removes it from the comparison (spreads).

## Data pipeline

All data is downloaded and aggregated at build time. `src/data/dam-daily.csv.js` and
`src/data/dam-quantiles.csv.js` fetch hourly prices for every zone (one `/download` call per zone)
and reduce them to `dam-daily.csv` (zone × day: average, TB1, TB2, TB4) and `dam-quantiles.csv`
(zone × year × hour: P10/P50/P90). Pages load ~580 KB of gzipped static files and are ready in
about 0.2 s. If entsoemcp.com is down or rate-limits the build, loaders serve the last snapshot
committed in `cache/`, so the build still succeeds.

A browser-side live fetch was prototyped and dropped: it took 4–31 s per page, and entsoemcp.com
sends no CORS headers and rate-limits per IP (HTTP 429, ~35 s Retry-After).

## Running locally

```bash
npm install          # see CLAUDE.md for the rollup x64 gotcha on this Mac
npm run build        # runs the loaders (≈15 s for the first, raw downloads reused by the second)
npm test             # smoke test (also HARNESS_WIDTH=400 npm test)
npm run dev          # Framework preview on :3000
node test/serve-dist.mjs   # serve the built dist/ like GitHub Pages (gzip) on :3000
```

## Deploying to GitHub Pages

1. Create the repo, push to `main`.
2. Settings → Pages → Source: **GitHub Actions**.
3. `.github/workflows/deploy.yml` builds, smoke-tests and deploys on push, on manual dispatch, and
   daily at 15:30 UTC (after the day-ahead auction lands). No secrets are needed.

## Data notes

- **Zones**: Central Europe = DE-LU, AT, CZ, SK, PL, HU, SI; SEE = HR, RO, BG, GR, RS, ME, MK, AL;
  Baltics = EE, LV, LT. Bosnia & Herzegovina publishes no DA price on ENTSO-E. AL, ME and MK
  start in 2023.
- **Currency**: BG published in BGN until 2022-01-21 (converted at the 1.95583 peg), RO in RON
  until 2021-06-17 (ECB monthly rates). Unlabelled rows are EUR.
- **Time**: all metrics use the zone's local market day and hour.
- **TBx** = mean of the day's x highest hourly prices − mean of the x lowest, in EUR/MWh (days with
  ≥ 22 hours). This is the UA dashboard's definition. entsoemcp.com's `tb_spread` uses
  *sums* (EUR/MW/day = x × ours) and Berlin-time days. Validated: our monthly means equal
  `tb_spread / x / n_days` exactly for CET zones, and within 2% for EET zones (day boundary).
- **15-minute MTU**: since October 2025, DA prices are quarter-hourly. All metrics use hourly
  means for consistency with earlier years, which understates spreads a quarter-hour battery
  could capture.
- **Coverage rule**: a map shows a zone for a period only if ≥ 80% of the period's days are
  present. Monthly series require ≥ 80% of the month.
