# EU power markets dashboard

Observable Framework site for GitHub Pages: day-ahead prices and TB1/TB2/TB4 battery-arbitrage
spreads for 18 bidding zones in Central Europe, South-East Europe and the Baltics, from 2021.
Data: ENTSO-E Transparency Platform via [entsoemcp.com](https://entsoemcp.com) (anonymous API,
no key).

Same architecture as `energy-dashboard-UA`: build-time data loaders with a committed `cache/`
fallback, shared client modules in `src/components/`, a jsdom smoke test gating CI deploys.

## Pages

- **Day-ahead prices** (`/prices`): price map (any year / month / week / day since 2021, the
  current one to date), monthly average price (from a chosen start year) and intraday P10/P50/P90
  by year for a selected country.
- **Day-ahead spreads** (`/spreads`): TB1/2/4 map (any year / month / week, the current one to
  date) and a 30-day moving-average comparison across countries.
- **Generation mix** (`/generation`): donut map of each zone's mix in the last full year (area ∝
  total generation), monthly generation by type beside the latest installed-capacity snapshot, and average
  hourly generation by season (winter/spring/summer/autumn) for a selected country.

Map colour scales are fixed per period type (P2-P98 of all zone-period values, clamped), so
colours compare across periods.

Clicking a country on a map selects it (prices) or adds/removes it from the comparison (spreads).

## Data pipeline

All data is downloaded and aggregated at build time. `src/data/dam-daily.csv.js` and
`src/data/dam-quantiles.csv.js` fetch hourly prices for every zone (one `/download` call per zone)
and reduce them to `dam-daily.csv` (zone × day: average, TB1, TB2, TB4) and `dam-quantiles.csv`
(zone × year × hour: P10/P50/P90). Pages load ~580 KB of gzipped static files and are ready in
about 0.2 s. If entsoemcp.com is down or rate-limits the build, loaders serve the last snapshot
committed in `cache/`, so the build still succeeds.

Generation uses three more loaders: `gen-monthly.csv` (zone × month × group, GWh, from one
monthly-aggregated `generation_per_type` call per zone), `gen-capacity.csv` (zone × year × group,
MW, from `installed_generation_capacity`) and `gen-profiles.csv` (zone × season × local hour ×
group, mean MW, for the last full year). The profiles need a year of hourly data (~60 MB across
all zones, ~30 s), so that loader reuses its cached snapshot while it is still for the right year
and only downloads again in January.

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
- **Generation groups**: the ENTSO-E production types fold into eight groups (`GEN_GROUPS` in
  `src/components/gen.js`): nuclear; coal & lignite (+ coal gas, oil shale, peat); gas; hydro
  (+ pumped-storage output, not pumping); wind; biomass & other RES (biomass, waste, geothermal,
  other renewable); solar; other (oil, batteries, other). Monthly GWh = monthly mean MW × days ×
  24, local months, the month in progress dropped. AL has generation data only from 2026, so it is
  absent from the 2025 map and profiles.
- **Capacity**: the page shows each zone's latest annual snapshot. ENTSO-E has snapshots for most
  zones only from 2025 (DE-LU and PL earlier); the loader keeps them all.
- **Generation colours**: CSS tokens `--gen-*` in `src/style.css` (brown coal, orange gas, light-blue
  hydro, blue wind, green biomass/RES, yellow solar, violet nuclear), light and dark shades
  validated for colour-vision separation in the stacking order of `GEN_GROUPS`.
