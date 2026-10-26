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
import {ZONES} from "./components/zones.js"
import {rememberZone, savedZone} from "./components/linking.js"
import {annualMix, lastFullYear} from "./components/gen.js"
import {GEN_COLORS, GEN_OPACITY, capacityChart, generationAreaChart, linkMapToInput, mixMap, seasonalProfileChart} from "./components/charts.js"
```

```js
const monthlyRaw = await FileAttachment("./data/gen-monthly.csv").csv()
const capacityRaw = await FileAttachment("./data/gen-capacity.csv").csv()
const profilesRaw = await FileAttachment("./data/gen-profiles.csv").csv()
const geo = await FileAttachment("./data/europe.geo.json").json()
```

```js
// Parsed by hand rather than with {typed: true}, so months stay "YYYY-MM-DD" strings (see dam.js).
const monthly = monthlyRaw.map((d) => ({zone: d.zone, month: d.month, group: d.group, gwh: +d.gwh}))
const capacity = capacityRaw.map((d) => ({zone: d.zone, year: d.year, group: d.group, mw: +d.mw}))
const profiles = profilesRaw.map((d) => ({zone: d.zone, season: d.season, hour: +d.hour, group: d.group, mw: +d.mw}))

const mixYear = lastFullYear(monthly)
const mix = annualMix(monthly, mixYear)
const profileYear = profilesRaw[0].year
```

## Generation mix map

Generation by type over the last full year; donut area is proportional to total generation
(smallest donuts enlarged to stay readable). Zones need all twelve months. Click a country to
select it below.

```js
// Shown below; declared here because the map highlights it. Shared across pages and remembered.
const zoneInput = rememberZone(Inputs.select(new Map(ZONES.map((z) => [z.name, z.key])), {value: savedZone("HU"), label: "Country"}))
const zone = Generators.input(zoneInput)
```

```js
linkMapToInput(mixMap({d3, Plot, geo, width, mix, selected: zone, year: mixYear}), zoneInput, {zoneOf: (d) => d?.zone ?? null})
```

## Monthly generation and installed capacity

Monthly generation shows the seasonal swing; capacity is the latest start-of-year snapshot. Solar
and wind hold far more of capacity than of generation; nuclear the reverse.

```js
zoneInput
```

```js
const YEARS = [...new Set(monthly.map((d) => d.month.slice(0, 4)))].sort()
const fromYear = view(Inputs.select(YEARS, {value: YEARS[0], label: "From"}))
```

```js
const zoneMonthly = monthly.filter((d) => d.zone === zone && d.month >= `${fromYear}-01-01`)
// Latest capacity snapshot only: the mix as it stands, beside the generation history.
const capacityYear = capacity.filter((d) => d.zone === zone).map((d) => d.year).sort().at(-1)
const zoneCapacity = capacity.filter((d) => d.zone === zone && d.year === capacityYear)
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
    ${zoneMonthly.length ? generationAreaChart({d3, Plot, rows: zoneMonthly, zone, width: areaWidth}) : html`<p>No generation data for this country in the selected years.</p>`}
    ${zoneCapacity.length ? capacityChart({d3, Plot, rows: zoneCapacity, zone, width: capacityWidth}) : html`<p>No installed-capacity data for this country.</p>`}
  </div>
</div>`
```

## Typical day by season

Average generation by local hour in ${profileYear}, per season, on one scale. The midday solar
bulge shows where storage and flexible demand gain most.

```js
const zoneProfiles = profiles.filter((d) => d.zone === zone)
```

```js
zoneProfiles.length
  ? seasonalProfileChart({d3, Plot, width, rows: zoneProfiles, zone, year: profileYear})
  : html`<p>No hourly generation data for ${ZONES.find((z) => z.key === zone).name} in ${profileYear}.</p>`
```
