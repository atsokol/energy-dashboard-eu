# EU power markets dashboard

Observable Framework site for GitHub Pages: day-ahead prices and TB1/TB2/TB4 battery-arbitrage
spreads for all 44 bidding zones with ENTSO-E day-ahead prices (Western Europe, Iberia, the seven
Italian zones, the Nordics zone by zone, the Baltics, Central-East and South-East Europe), from 2021.
Data: ENTSO-E Transparency Platform via [entsoemcp.com](https://entsoemcp.com) (anonymous API,
no key).

Same architecture as `energy-dashboard-UA`: build-time data loaders with a committed `cache/`
fallback, shared client modules in `src/components/`, a jsdom smoke test gating CI deploys.

## Pages

- **Generation mix** (`/generation`): for a chosen year (the current one to date), a donut map of
  each zone's mix (area ∝ total generation), the installed-capacity snapshot of that year (or the
  latest before it) beside monthly generation by type since 2021, and average hourly generation by
  season (winter/spring/summer/autumn) for a selected country.
- **Day-ahead prices** (`/prices`): price map (any year / month / week / day since 2021, the
  current one to date), monthly average price (from a chosen start year), average hourly residual
  load and price either **by year** (one line per year for a chosen month) or **by month** (one
  year built up month by month, coloured by season), with a month slider whose Play runs once,
  the generation mix by hour of that year and month, a price vs residual-load scatter, cumulative
  negative-price hours and value by year for a selected country, and the same through a chosen
  year against every other country.
- **Day-ahead spreads** (`/spreads`): TB1/2/4 map (any year / month / week, the current one to
  date), the top/bottom spread band for the selected country, and a 30-day moving-average
  comparison across countries.
- **Capture factors** (`/capture`): solar and wind capture factor maps (any year or month, a
  diverging scale centred on 100%), annual and seasonal capture factors for chosen countries, and
  monthly capture factor against the technology's share of generation (y scales cut at 200%), and
  **capture and curtailment**: per year, a plant's effective value if it stops in negative-price
  hours, split into the capture factor of the output it still sells and the output it gives up.

Map colour scales are fixed per period type (P2-P98 of all zone-period values, clamped), so
colours compare across periods.

Every page starts with a **Regions** filter: the maps zoom to the ticked regions, and the country
lists, comparison checkboxes and grey context lines offer only their zones (none ticked shows
all). Colour scales stay computed over every zone, so they do not shift with the filter.

Clicking a country on a map selects it. The regions, country, period type, month and year are
shared across pages and remembered (localStorage); a month or year map period follows the month and year
controls.

## Data pipeline

All data is downloaded and aggregated at build time, **incrementally**. Every loader keeps its
last output in `cache/` and, per zone, downloads only the recent period still open to revision;
a zone with nothing in the snapshot (a country just added to `zones.js`), or a new loader, gets
its full history from 2021. Refresh windows: day-ahead metrics the last 7 days; monthly
generation and capture prices the last two cached months (generation is revised for weeks after
delivery); capacity the latest cached year; residual load and the hourly mix from the start of
the month before their latest month; seasonal profiles only zones missing the profile year (all
of them in January). `ENTSOE_FULL=1` ignores the snapshots and downloads everything again.

A zone whose download fails (rate limit, outage) keeps its cached rows while the other zones
update, and a request the server asks to retry after more than 2 minutes is given up at once, so a
bad day upstream leaves stale rows for that zone rather than a stalled or failed build. The
build fails only when a file has no snapshot to fall back on. CI saves `cache/` after the build
step even when a later step fails, so downloads are never repeated (`.github/workflows/deploy.yml`).

`src/data/dam-daily.csv.js` reduces hourly prices to `dam-daily.csv` (zone × day: average, TB1,
TB2, TB4, negative hours). Pages load ~1 MB of gzipped static files and are ready in well under a
second.

Generation uses two more loaders: `gen-monthly.csv` (zone × month × group, GWh, from one
monthly-aggregated `generation_per_type` call per zone) and `gen-capacity.csv` (zone × year ×
group, MW, from `installed_generation_capacity`). The seasonal profiles of any year are averaged
in the page from the hourly-mix files below (`seasonalFromMonthHour`), so no separate download is
needed.

Residual load comes from the parameterized loader `src/data/residual/[zone].csv.js`, which
writes one file per zone (`date,hour,price,rl,solar,wind`: every local hour since 2021 with its
price, load − wind − solar, and solar and wind output in MW, ~1.9 MB, ~0.6 MB gzipped), so the
prices and capture pages load only the selected country. A snapshot from before a column was added
is downloaded again in full once. It joins hourly prices (shared raw cache), `actual_load` and hourly `generation_per_type`
on the UTC hour. Hourly generation is ~5 MB per zone-year (~500 MB for all zones since 2021), so
the loader keeps its cached snapshot (`cache/residual/`) up to the start of the month before its
latest month and downloads only from there (~2 s per zone a day). `RESIDUAL_FULL=1` (or
`ENTSOE_FULL=1`) forces a full re-download (~25 s per zone).

The hourly generation mix comes from `src/data/gen-hourly/[zone].csv.js` (`month,hour,group,mw`:
average MW per generation group, and load as group `load`, at each local hour of every month since
2021, ~0.3 MB per zone). It downloads the same hourly `generation_per_type` and `actual_load` as
the residual loader and is incremental the same way (`cache/gen-hourly/`, `GEN_HOURLY_FULL=1`
forces a full re-download, ~17 s per zone).

Capture prices come from `src/data/capture-monthly.csv.js` (`zone,month,tech,capture,base,gwh,
hours`). It calls entsoemcp.com's server-side `capture_price` derivation (`/api/derivation`, JSON,
local months; one ~1 s call per zone) for solar (B16) and wind onshore and
offshore (B18, B19). The server weights hourly prices by hourly output, so no hourly generation
is downloaded. The page rolls months up into years and seasons as generation-weighted capture
price over hour-weighted baseload (`src/components/capture.js`), never as a mean of monthly
factors.

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

- **Zones** (`src/components/zones.js`): Western Europe = DE-LU, FR, BE, NL, AT, CH, IE (SEM);
  Iberia = ES, PT; Italy = NORD, CNOR, CSUD, SUD, CALA, SICI, SARD; Nordics = DK1-2, NO1-5, SE1-4,
  FI; Baltics = EE, LV, LT; Central-East Europe = PL, CZ, SK, HU, SI, HR, RO, BG; South-East
  Europe = GR, RS, ME, MK, AL. Bosnia & Herzegovina publishes no DA price on ENTSO-E, and
  entsoemcp.com has none for Great Britain (post-Brexit) or Cyprus since 2021, so they are grey
  context. AL, ME and MK start in 2023.
- **Map shapes**: `src/data/europe.geo.json` holds bidding-zone outlines (`properties.zone` = zone
  key; context countries have `zone: null`), derived from Electricity Maps' `geo/world.geojson`
  (github.com/electricitymaps/electricitymaps-contrib), simplified with mapshaper. Check that
  project's licence before relying on the shapes in a public deployment.
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
- **Capture and curtailment**: for a plant that stops whenever the day-ahead price is below zero,
  with B the year's baseload, p the hourly price and g the hourly output: capture factor of the
  output still sold CF₊ = Σ₍p≥0₎ p·g ÷ Σ₍p≥0₎ g ÷ B; output lost L = Σ₍p<0₎ g ÷ Σ g; effective value
  factor EVF = Σ₍p≥0₎ p·g ÷ Σ g ÷ B = CF₊ × (1 − L), so EVF − 1 = (CF₊ − 1) + (−CF₊ × L). Reported
  output is used as the potential, so output that was already curtailed upstream is not counted.
- **Capture factor** = output-weighted day-ahead price ÷ baseload (all-hours) price in the same
  period. Wind is onshore + offshore, each type weighted by its own output. A month that switched
  currency arrives split per currency and is converted to EUR before combining. Seasons are
  meteorological (winter = December to February, counted with the January's year); a year on the
  maps and annual lines needs all twelve months, except the year in progress (dashed). SK and SI
  report only a few MW of wind, and RS/ME report no solar, so those values are thin or absent.
  Market share in the dot plots is of reported generation (gen-monthly), not of load.
- **Capacity**: the page shows each zone's latest annual snapshot. ENTSO-E has snapshots for most
  zones only from 2025 (DE-LU and PL earlier); the loader keeps them all.
- **Generation colours**: CSS tokens `--gen-*` in `src/style.css` (brown coal, orange gas, light-blue
  hydro, blue wind, green biomass/RES, yellow solar, violet nuclear), light and dark shades
  validated for colour-vision separation in the stacking order of `GEN_GROUPS`.
- **Gas and carbon prices**: THE (German hub) day-ahead gas and EEX EUA auction prices, daily,
  from the data file behind Energy-Charts' German spot-market chart (no public API carries
  them). Weekend and holiday gaps carry the last price forward. THE serves as the European gas
  reference for every zone: CEE hubs price off THE/TTF, and THE spot differs from the TTF front
  month by a median ~1 EUR/MWh outside 2022. Energy-Charts restricts some datasets to private and
  internal use; check the licence before relying on these in a public deployment.
- **Gas-plant cost** = 2 × gas + 0.4 × EUA (EUR/MWh): fuel and carbon for a ~50%-efficient CCGT.
