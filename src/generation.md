---
title: Generation mix
toc: true
---

# Generation mix

Actual generation by type from 2021 (ENTSO-E via [entsoemcp.com](https://entsoemcp.com)), in eight
groups. **Coal & lignite** includes oil shale; **hydro** includes pumped-storage output; **other**
is oil, batteries and unclassified. Gross output as reported: no imports, and some countries omit
rooftop solar.

```js
import {ZONES, zonesIn} from "./components/zones.js"
import {linkValue, periodLinks, regionInput, rememberZone, savedZone} from "./components/linking.js"
import {annualMix, dataYears, seasonalFromMonthHour} from "./components/gen.js"
import {GEN_COLORS, GEN_OPACITY, capacityChart, generationAreaChart, linkMapToInput, mixMap, seasonalProfileChart} from "./components/charts.js"
```

```js
// Shared by every page and remembered: the regions whose zones the maps, country lists and
// comparison charts offer. Untick them all to show every zone.
const regions = view(regionInput(Inputs))
```

```js
const shownZones = zonesIn(regions)
const shownKeys = shownZones.map((z) => z.key)
```

```js
const monthlyRaw = await FileAttachment("./data/gen-monthly.csv").csv()
const capacityRaw = await FileAttachment("./data/gen-capacity.csv").csv()
const geo = await FileAttachment("./data/europe.geo.json").json()
```

```js
// Parsed by hand rather than with {typed: true}, so months stay "YYYY-MM-DD" strings (see dam.js).
const monthly = monthlyRaw.map((d) => ({zone: d.zone, month: d.month, group: d.group, gwh: +d.gwh}))
const capacity = capacityRaw.map((d) => ({zone: d.zone, year: d.year, group: d.group, mw: +d.mw}))

const lastMonth = monthly.map((d) => d.month).sort().at(-1)
// Years with generation data, newest first; the year in progress is shown to date.
const years = dataYears(monthly)
const shortMonth = (m) => new Date(`2000-${m}-01T00:00:00Z`).toLocaleDateString("en-GB", {timeZone: "UTC", month: "short"})
const yearLabel = (y) => (y.open ? `${y.year} (to ${shortMonth(lastMonth.slice(5, 7))})` : y.year)
// Year shared with the other pages and remembered; it starts on the last complete month's year.
const links = periodLinks(new Date(Date.UTC(+lastMonth.slice(0, 4), +lastMonth.slice(5, 7), 1)).toISOString().slice(0, 10))
```

```js
// The map, capacity and seasonal charts below show this year.
const year = view(linkValue(links.year, "generation", Inputs.select(new Map(years.map((y) => [yearLabel(y), y.year])), {
  value: years.find((y) => !y.open)?.year ?? years[0].year, label: "Year"
}), {accepts: (y) => years.some((d) => d.year === y)}))
```

```js
const yearInfo = years.find((y) => y.year === year)
const yearText = yearLabel(yearInfo)
// A zone needs every month of the year (to date, for the year in progress).
const mix = annualMix(monthly, year, yearInfo.months)
```

## Generation mix map

Generation by type in the chosen year; donut area is proportional to total generation (smallest
donuts enlarged to stay readable). Zones need every month of the year. Click a country to select
it below.

```js
// Shown below; declared here because the map highlights it. Shared across pages and remembered.
const zoneInput = rememberZone(Inputs.select(new Map(shownZones.map((z) => [z.name, z.key])), {value: savedZone("HU", shownKeys), label: "Country"}))
const zone = Generators.input(zoneInput)
```

```js
linkMapToInput(mixMap({d3, Plot, geo, width, mix, zones: shownKeys, selected: zone, year: yearText}), zoneInput, {zoneOf: (d) => d?.zone ?? null})
```

## Monthly generation and installed capacity

Monthly generation since 2021 shows the seasonal swing; capacity is the start-of-year snapshot for
the chosen year (or the latest one before it). Solar and wind hold far more of capacity than of
generation; nuclear the reverse.

```js
zoneInput
```

```js
const zoneMonthly = monthly.filter((d) => d.zone === zone)
// The chosen year's capacity snapshot, or the latest before it: the mix as it stood.
const zoneSnapshots = [...new Set(capacity.filter((d) => d.zone === zone).map((d) => d.year))].sort()
const capacityYear = zoneSnapshots.filter((y) => y <= year).at(-1)
const zoneCapacity = capacity.filter((d) => d.zone === zone && d.year === capacityYear)
const noCapacity = zoneSnapshots.length
  ? `ENTSO-E has no capacity snapshot for this country in or before ${year}; the first is ${zoneSnapshots[0]}.`
  : "No installed-capacity data for this country."
```

```js
// Side by side when there is room for the capacity columns to stay readable; stacked otherwise.
const pairWidth = Math.min(width, 800)
const sideBySide = pairWidth >= 640
const pairGap = 16
const areaWidth = sideBySide ? Math.floor(((pairWidth - pairGap) * 2) / 3) : pairWidth
const capacityWidth = sideBySide ? pairWidth - pairGap - areaWidth : pairWidth
```

```js
html`<div style="max-width: 800px">
  ${Plot.legend({color: GEN_COLORS, opacity: GEN_OPACITY})}
  <div style="display: grid; grid-template-columns: ${sideBySide ? `${areaWidth}px ${capacityWidth}px` : "1fr"}; gap: ${pairGap}px; align-items: start;">
    ${zoneMonthly.length ? generationAreaChart({d3, Plot, rows: zoneMonthly, zone, width: areaWidth}) : html`<p>No generation data for this country.</p>`}
    ${zoneCapacity.length ? capacityChart({d3, Plot, rows: zoneCapacity, zone, width: capacityWidth}) : html`<p>${noCapacity}</p>`}
  </div>
</div>`
```

## Typical day by season

Average generation by local hour in the chosen year, per season, on one scale. The midday solar
bulge shows where storage and flexible demand gain most.

```js
// One file per zone (the hourly-mix files the prices page uses), so the page loads only the
// selected country; FileAttachment needs literal paths.
const GEN_HOURLY = {
  DE_LU: FileAttachment("./data/gen-hourly/DE_LU.csv"),
  FR: FileAttachment("./data/gen-hourly/FR.csv"),
  BE: FileAttachment("./data/gen-hourly/BE.csv"),
  NL: FileAttachment("./data/gen-hourly/NL.csv"),
  AT: FileAttachment("./data/gen-hourly/AT.csv"),
  CH: FileAttachment("./data/gen-hourly/CH.csv"),
  IE_SEM: FileAttachment("./data/gen-hourly/IE_SEM.csv"),
  ES: FileAttachment("./data/gen-hourly/ES.csv"),
  PT: FileAttachment("./data/gen-hourly/PT.csv"),
  IT_NORD: FileAttachment("./data/gen-hourly/IT_NORD.csv"),
  IT_CNOR: FileAttachment("./data/gen-hourly/IT_CNOR.csv"),
  IT_CSUD: FileAttachment("./data/gen-hourly/IT_CSUD.csv"),
  IT_SUD: FileAttachment("./data/gen-hourly/IT_SUD.csv"),
  IT_CALA: FileAttachment("./data/gen-hourly/IT_CALA.csv"),
  IT_SICI: FileAttachment("./data/gen-hourly/IT_SICI.csv"),
  IT_SARD: FileAttachment("./data/gen-hourly/IT_SARD.csv"),
  DK_1: FileAttachment("./data/gen-hourly/DK_1.csv"),
  DK_2: FileAttachment("./data/gen-hourly/DK_2.csv"),
  NO_1: FileAttachment("./data/gen-hourly/NO_1.csv"),
  NO_2: FileAttachment("./data/gen-hourly/NO_2.csv"),
  NO_3: FileAttachment("./data/gen-hourly/NO_3.csv"),
  NO_4: FileAttachment("./data/gen-hourly/NO_4.csv"),
  NO_5: FileAttachment("./data/gen-hourly/NO_5.csv"),
  SE_1: FileAttachment("./data/gen-hourly/SE_1.csv"),
  SE_2: FileAttachment("./data/gen-hourly/SE_2.csv"),
  SE_3: FileAttachment("./data/gen-hourly/SE_3.csv"),
  SE_4: FileAttachment("./data/gen-hourly/SE_4.csv"),
  FI: FileAttachment("./data/gen-hourly/FI.csv"),
  EE: FileAttachment("./data/gen-hourly/EE.csv"),
  LV: FileAttachment("./data/gen-hourly/LV.csv"),
  LT: FileAttachment("./data/gen-hourly/LT.csv"),
  PL: FileAttachment("./data/gen-hourly/PL.csv"),
  CZ: FileAttachment("./data/gen-hourly/CZ.csv"),
  SK: FileAttachment("./data/gen-hourly/SK.csv"),
  HU: FileAttachment("./data/gen-hourly/HU.csv"),
  SI: FileAttachment("./data/gen-hourly/SI.csv"),
  HR: FileAttachment("./data/gen-hourly/HR.csv"),
  RO: FileAttachment("./data/gen-hourly/RO.csv"),
  BG: FileAttachment("./data/gen-hourly/BG.csv"),
  GR: FileAttachment("./data/gen-hourly/GR.csv"),
  RS: FileAttachment("./data/gen-hourly/RS.csv"),
  ME: FileAttachment("./data/gen-hourly/ME.csv"),
  MK: FileAttachment("./data/gen-hourly/MK.csv"),
  AL: FileAttachment("./data/gen-hourly/AL.csv")
}
```

```js
const genHourlyRaw = await GEN_HOURLY[zone].csv()
```

```js
const zoneProfiles = seasonalFromMonthHour(genHourlyRaw.map((d) => ({month: d.month, hour: +d.hour, group: d.group, mw: +d.mw})), year)
```

```js
zoneProfiles.length
  ? seasonalProfileChart({d3, Plot, width, rows: zoneProfiles, zone, year: yearText})
  : html`<p>No hourly generation data for ${ZONES.find((z) => z.key === zone).name} in ${year}.</p>`
```
