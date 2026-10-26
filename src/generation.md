---
title: Generation mix
toc: true
---

# Generation mix

Actual electricity generation by production type for the bidding zones in scope, from January
2021, as reported to the ENTSO-E Transparency Platform and sourced through
[entsoemcp.com](https://entsoemcp.com). The twenty ENTSO-E production types are folded into
eight groups. **Coal & lignite** also includes coal-derived gas, peat and Estonia's oil shale.
**Hydro** includes the output of pumped-storage plants but not the power they pump with.
**Biomass & other RES** covers biomass, waste, geothermal and other renewables. **Other** covers
oil, batteries and unclassified plants. Figures are gross output as the TSOs report it. They
include no imports, and in some countries they leave out small rooftop solar.

```js
import {ZONES} from "./components/zones.js"
import {annualMix, lastFullYear} from "./components/gen.js"
import {GEN_COLORS, capacityChart, generationAreaChart, linkMapToInput, mixMap, seasonalProfileChart} from "./components/charts.js"
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

Each zone's generation over the last full calendar year, split by type. The donut's area is
proportional to the zone's total generation, so Germany's dwarfs Montenegro's. The smallest
donuts are drawn at a minimum size so they stay readable, which overstates them slightly. A zone
is shown only when it reported all twelve months; Albania's generation data starts in 2026. Click
a country to show it in the charts below.

```js
// Shown above the charts below; declared here because the map highlights the selected zone.
const zoneInput = Inputs.select(new Map(ZONES.map((z) => [z.name, z.key])), {value: "HU", label: "Country"})
const zone = Generators.input(zoneInput)
```

```js
linkMapToInput(mixMap({d3, Plot, geo, width, mix, selected: zone, year: mixYear}), zoneInput, {zoneOf: (d) => d?.zone ?? null})
```

## Monthly generation and installed capacity

Monthly generation shows the seasonal swing between types: solar peaks in summer, while wind,
hydro and fossil plants carry the winter. Installed capacity is the TSO's latest snapshot, taken
at the start of the year. Capacity counts every plant whether or not it runs, so a type's share of capacity is usually far above its share
of generation for solar and wind, and below it for nuclear.

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
  ${Plot.legend({color: GEN_COLORS})}
  <div style="display: grid; grid-template-columns: ${sideBySide ? `${areaWidth}px ${capacityWidth}px` : "1fr"}; gap: ${pairGap}px; align-items: start;">
    ${zoneMonthly.length ? generationAreaChart({d3, Plot, rows: zoneMonthly, zone, width: areaWidth}) : html`<p>No generation data for this country in the selected years.</p>`}
    ${zoneCapacity.length ? capacityChart({d3, Plot, rows: zoneCapacity, zone, width: capacityWidth}) : html`<p>No installed-capacity data for this country.</p>`}
  </div>
</div>`
```

## Typical day by season

Average generation at each local hour of the day in ${profileYear}, by season. Each panel is the
mean of every day in the season, so it shows a typical day rather than any real one. The midday
solar bulge and how other types make room for it show where storage and flexible demand have the
most to gain. All four panels share one scale.

```js
const zoneProfiles = profiles.filter((d) => d.zone === zone)
```

```js
zoneProfiles.length
  ? seasonalProfileChart({d3, Plot, width, rows: zoneProfiles, zone, year: profileYear})
  : html`<p>No hourly generation data for ${ZONES.find((z) => z.key === zone).name} in ${profileYear}.</p>`
```
