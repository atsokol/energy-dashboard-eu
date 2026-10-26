---
title: Solar and wind capture factors
toc: true
---

# Solar and wind capture factors

The **capture price** of solar or wind is the day-ahead price weighted by its hourly output: what
an unhedged plant earns per MWh. The **capture factor** divides it by the baseload price, the
plain average over every hour. Below 100% the technology produces mostly in cheaper hours, which
grows more likely as its own output starts to set the price. Monthly from 2021 (ENTSO-E via
[entsoemcp.com](https://entsoemcp.com)), on local market months; early BGN and RON prices are
converted to EUR. Wind is onshore and offshore together.

```js
import {ZONES} from "./components/zones.js"
import {annualFactors, monthlyFactors, pivotDomain, seasonalFactors, withShares} from "./components/capture.js"
import {linkPeriod, linkValue, periodLinks, rememberZone, savedZone} from "./components/linking.js"
import {captureLines, captureShareScatter, linkMapToInput, zoneMap} from "./components/charts.js"
```

```js
const captureRaw = await FileAttachment("./data/capture-monthly.csv").csv()
const generationRaw = await FileAttachment("./data/gen-monthly.csv").csv()
const geo = await FileAttachment("./data/europe.geo.json").json()
```

```js
// Parsed by hand rather than with {typed: true}, so months stay "YYYY-MM-DD" strings (see dam.js).
const capture = captureRaw.map((d) => ({
  zone: d.zone, month: d.month, tech: d.tech, capture: +d.capture, base: +d.base, gwh: +d.gwh, hours: +d.hours
}))
const generation = generationRaw.map((d) => ({zone: d.zone, month: d.month, group: d.group, gwh: +d.gwh}))

const lastMonth = capture.map((d) => d.month).sort().at(-1)
// The year in progress: shown to date on the maps and dashed on the annual lines.
const openYear = lastMonth.slice(5, 7) === "12" ? null : lastMonth.slice(0, 4)
const monthly = monthlyFactors(capture)
const annual = annualFactors(capture, {openYear})
const seasonal = seasonalFactors(capture)
// Period type, month and year: shared with the price and spread pages and remembered. They start
// on the last complete month, so the anchor is the first day after it.
const anchor = new Date(Date.UTC(+lastMonth.slice(0, 4), +lastMonth.slice(5, 7), 1)).toISOString().slice(0, 10)
const links = periodLinks(anchor)
```

```js
const TECHS = ["solar", "wind"]
// Side by side when each chart keeps at least ~310 px; stacked otherwise.
const pairWidth = Math.min(width, 800)
const sideBySide = pairWidth >= 640
const pairGap = 16
const halfWidth = sideBySide ? Math.floor((pairWidth - pairGap) / 2) : pairWidth
const pair = (a, b) => html`<div style="display: grid; grid-template-columns: ${sideBySide ? `${halfWidth}px ${halfWidth}px` : "1fr"}; gap: ${pairGap}px; max-width: 800px; align-items: start;">${a}${b}</div>`
const fmtPct = (x) => `${Math.round(x * 100)}%`
const monthLabel = (m) => new Date(m + "T00:00:00Z").toLocaleDateString("en-GB", {timeZone: "UTC", month: "long", year: "numeric"})
```

## Capture factor map

Capture factor by zone for the chosen year or month, on one scale for both technologies; red is
below baseload, blue above. Zones need every month of a year. Click a country to select it below.

```js
const PERIOD_KINDS = [["Year", "year"], ["Month", "month"]]
const periodKind = view(linkValue(links.kind, "kind", Inputs.radio(new Map(PERIOD_KINDS), {value: "year", label: "Period"}), {
  accepts: (k) => PERIOD_KINDS.some(([, v]) => v === k)
}))
```

```js
const kindRows = periodKind === "year" ? annual : monthly
// Keys in listPeriods form ("YYYY-01-01", "YYYY-MM-01"), so linkPeriod can join them to the shared month and year.
const periodKey = (d) => (periodKind === "year" ? `${d.period}-01-01` : d.period)
const lastMonthShort = new Date(lastMonth + "T00:00:00Z").toLocaleDateString("en-GB", {timeZone: "UTC", month: "short"})
const periodOptions = [...new Set(kindRows.map(periodKey))].sort().reverse().map((key) => ({
  key,
  label: periodKind === "month" ? monthLabel(key) : key.slice(0, 4) === openYear ? `${openYear} (to ${lastMonthShort})` : key.slice(0, 4)
}))
const period = view(linkPeriod(links, Inputs.select(periodOptions, {
  value: periodOptions.find((p) => p.key.slice(0, 4) !== openYear) ?? periodOptions[0], format: (p) => p.label,
  label: PERIOD_KINDS.find(([, k]) => k === periodKind)[0]
}), periodKind, periodOptions))
```

```js
// One scale for both maps and every period of this kind, centred on 100%.
const mapDomain = pivotDomain(kindRows.filter((d) => periodKey(d).slice(0, 4) !== openYear || periodKind === "month").map((d) => d.value))
const mapValues = (tech) => kindRows.filter((d) => d.tech === tech && periodKey(d) === period.key).map((d) => ({zone: d.zone, value: d.value}))
const solarValues = mapValues("solar")
const windValues = mapValues("wind")
```

```js
// Shown below; declared here because the maps highlight it. Shared across pages and remembered.
const zoneInput = rememberZone(Inputs.select(new Map(ZONES.map((z) => [z.name, z.key])), {value: savedZone("HU"), label: "Country"}))
const zone = Generators.input(zoneInput)
```

```js
pair(...TECHS.map((tech) => linkMapToInput(zoneMap({
  d3, Plot, geo, width: halfWidth, height: Math.round(halfWidth * (sideBySide ? 1.05 : 0.95)),
  values: tech === "solar" ? solarValues : windValues, selected: zone, domain: mapDomain, pivot: 1,
  format: fmtPct, legendFormat: ".0%",
  title: `${tech === "solar" ? "Solar" : "Wind"} capture factor — ${period.label}`,
  subtitle: "Output-weighted ÷ baseload day-ahead price",
  label: "capture factor"
}), zoneInput)))
```

## Capture factors over time

Coupled markets share prices, so neighbours tend to move together; a zone that falls away from
the pack usually has more of the technology than its interconnectors can export at midday or on
windy days.

```js
const zones = view(Inputs.checkbox(new Map(ZONES.map((z) => [z.short, z.key])), {value: ["DE_LU", "PL", "HU", "RO", "GR", "LT"], label: "Countries"}))
```

```js
// One y scale per pair, so solar and wind compare directly; 100% always in view.
const lineDomain = (rows) => {
  const [lo, hi] = d3.extent(rows, (d) => d.value);
  return [Math.min(lo ?? 1, 0.95) - 0.02, Math.max(hi ?? 1, 1.05) + 0.02];
}
const annualShown = annual.filter((d) => zones.includes(d.zone))
const seasonalShown = seasonal.filter((d) => zones.includes(d.zone))
const annualDomain = lineDomain(annualShown)
const seasonalDomain = lineDomain(seasonalShown)
```

```js
pair(...TECHS.map((tech) => captureLines({
  d3, Plot, rows: annualShown.filter((d) => d.tech === tech), keys: zones, tech, resolution: "annual",
  width: halfWidth, domain: annualDomain
})))
```

### By season

A technology's capture factor drops in the seasons when it produces most, since that is when its
output pushes prices down: spring and summer for solar. Wind output is spread more evenly over
the year, so its seasonal swing is smaller.

```js
html`<div style="max-width: 800px;">
  ${captureLines({d3, Plot, rows: seasonalShown.filter((d) => d.tech === "solar"), keys: zones, tech: "solar", resolution: "seasonal", width: pairWidth, domain: seasonalDomain, height: 300})}
  ${captureLines({d3, Plot, rows: seasonalShown.filter((d) => d.tech === "wind"), keys: zones, tech: "wind", resolution: "seasonal", width: pairWidth, domain: seasonalDomain, height: 300})}
</div>`
```

## Capture factor and market share

Each month's capture factor against the technology's share of generation that month. The more of
the technology a market already has, the lower the price in the hours it produces, so the cloud
falls to the right. Share is of reported generation, excluding imports. Click a year in either
legend to pick it out in both charts; click it again to show all.

```js
zoneInput
```

```js
const shares = withShares(monthly, generation)
const shareYears = [...new Set(shares.map((d) => d.period.slice(0, 4)))].sort()
// The year highlighted from either legend, shared by both charts and kept as the country changes.
const shareSelection = {year: null}
// Fixed across countries: every zone's months set the frame.
const shareX = (tech) => [0, (d3.max(shares, (d) => (d.tech === tech ? d.share : 0)) ?? 0.1) * 1.05]
const shareY = [Math.min(0.95, d3.min(shares, (d) => d.value)) - 0.02, Math.max(1.05, d3.max(shares, (d) => d.value)) + 0.02]
```

```js
pair(...TECHS.map((tech) => captureShareScatter({
  d3, Plot, rows: shares.filter((d) => d.tech === tech), tech, zone, years: shareYears,
  width: halfWidth, xDomain: shareX(tech), yDomain: shareY, selection: shareSelection
})))
```
