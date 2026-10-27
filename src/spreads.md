---
title: Day-ahead spreads
toc: true
---

# Day-ahead spreads

The **TBx spread** is the average of a day's x dearest hourly prices minus its x cheapest: the
gross margin per MWh of an x-hour battery cycling once a day with perfect foresight. Computed on
hourly prices, so it understates what 15-minute dispatch (since October 2025) can capture.

```js
import {zonesIn} from "./components/zones.js"
import {linkPeriod, linkValue, periodLinks, regionInput, rememberZone, savedZone} from "./components/linking.js"
import {anchorDay, listPeriods, periodMeans, rollingMeans, spreadBand, stableDomain} from "./components/dam.js"
import {linkMapToInput, spreadBandChart, spreadLines, zoneMap} from "./components/charts.js"
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
const dailyRaw = await FileAttachment("./data/dam-daily.csv").csv()
const geo = await FileAttachment("./data/europe.geo.json").json()
```

```js
const daily = dailyRaw.map((d) => ({
  zone: d.zone, date: d.date, avg: +d.avg, tb1: +d.tb1, tb2: +d.tb2, tb4: +d.tb4,
  top1: +d.top1, top2: +d.top2, top4: +d.top4
}))

const anchor = anchorDay(daily)
// Period type, month and year: shared with the prices page and remembered.
const links = periodLinks(anchor)
```

```js
const tb = view(Inputs.radio(new Map([["TB1", "tb1"], ["TB2", "tb2"], ["TB4", "tb4"]]), {value: "tb4", label: "Spread"}))
```

## Spread map

Average daily spread by zone for the chosen period; the latest period is shown to date. Colours are
fixed per period type so periods compare. Click a country to show it below.

```js
const PERIOD_KINDS = [["Year", "year"], ["Month", "month"], ["Week", "week"]]
const periodKind = view(linkValue(links.kind, "kind", Inputs.radio(new Map(PERIOD_KINDS), {value: "month", label: "Period"}), {
  accepts: (k) => PERIOD_KINDS.some(([, v]) => v === k)
}))
```

```js
const periodOptions = listPeriods(periodKind, anchor)
// A month or year period follows the month and year chosen on the prices page.
const period = view(linkPeriod(links, Inputs.select(periodOptions, {
  value: periodOptions[0], format: (p) => p.label,
  label: PERIOD_KINDS.find(([, k]) => k === periodKind)[0]
}), periodKind, periodOptions))
```

```js
const spreadsByPeriod = periodMeans(daily, tb, periodKind, periodOptions)
const spreadDomain = stableDomain(spreadsByPeriod, periodOptions)
const spreadValues = spreadsByPeriod.get(period.key)
```

```js
// Shown below; declared here because the map highlights it. Shared across pages and remembered.
const bandZoneInput = rememberZone(Inputs.select(new Map(shownZones.map((z) => [z.name, z.key])), {value: savedZone("DE_LU", shownKeys), label: "Country"}))
const bandZone = Generators.input(bandZoneInput)
```

```js
linkMapToInput(zoneMap({
  d3, Plot, geo, width, zones: shownKeys,
  values: spreadValues, selected: bandZone, domain: spreadDomain,
  title: `Average ${tb.toUpperCase()} spread — ${period.label}`,
  subtitle: `Mean daily top-${tb.slice(2)} minus bottom-${tb.slice(2)} hourly price`,
  label: "EUR / MWh",
}), bandZoneInput)
```

## Top, bottom and the gap

A spread widens when peak prices rise, off-peak prices fall, or both. Peaks are usually set by gas
plants, so dearer gas lifts the top leg too.

```js
bandZoneInput
```

```js
const bandFrom = view(Inputs.select(["2021", "2022", "2023", "2024", "2025", "2026"], {value: "2023", label: "From"}))
```

```js
const MA_WINDOW = 30
const band = spreadBand(daily, bandZone, tb, MA_WINDOW).filter((d) => d.date >= `${bandFrom}-01-01`)
```

```js
spreadBandChart({d3, Plot, width, rows: band, zone: bandZone, tb, window: MA_WINDOW})
```

## Spread evolution

Coupled markets move together, so a lasting gap between neighbours points to a local driver: solar,
flexible capacity or import limits.

```js
// Defaults among the zones on show, else the first six of them.
const DEFAULT_COMPARE = ["DE_LU", "FR", "ES", "SE_3", "PL", "GR"].filter((k) => shownKeys.includes(k))
const zones = view(Inputs.checkbox(new Map(shownZones.map((z) => [z.short, z.key])), {value: DEFAULT_COMPARE.length ? DEFAULT_COMPARE : shownKeys.slice(0, 6), label: "Countries"}))
```

```js
const fromYear = view(Inputs.select(["2021", "2022", "2023", "2024", "2025", "2026"], {value: "2023", label: "From"}))
```

```js
const spreadMa = rollingMeans(daily.filter((d) => zones.includes(d.zone)), tb, MA_WINDOW)
  .filter((d) => d.date >= `${fromYear}-01-01`)
```

```js
spreadLines({d3, Plot, width, rows: spreadMa, tb, window: MA_WINDOW})
```
