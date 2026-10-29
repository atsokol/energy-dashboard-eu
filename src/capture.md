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
import {zonesIn} from "./components/zones.js"
import {annualFactors, curtailmentEffect, monthlyFactors, pivotDomain, seasonalFactors, withShares} from "./components/capture.js"
import {linkPeriod, linkValue, periodLinks, regionInput, rememberZone, savedZone} from "./components/linking.js"
import {captureLines, captureShareScatter, curtailmentChart, linkMapToInput, zoneMap} from "./components/charts.js"
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
const zoneInput = rememberZone(Inputs.select(new Map(shownZones.map((z) => [z.name, z.key])), {value: savedZone("HU", shownKeys), label: "Country"}))
const zone = Generators.input(zoneInput)
```

```js
pair(...TECHS.map((tech) => linkMapToInput(zoneMap({
  d3, Plot, geo, width: halfWidth, zones: shownKeys, height: Math.round(halfWidth * (sideBySide ? 1.05 : 0.95)),
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
// Defaults among the zones on show, else the first six of them.
const DEFAULT_COMPARE = ["DE_LU", "FR", "ES", "SE_3", "PL", "GR"].filter((k) => shownKeys.includes(k))
const zones = view(Inputs.checkbox(new Map(shownZones.map((z) => [z.short, z.key])), {value: DEFAULT_COMPARE.length ? DEFAULT_COMPARE : shownKeys.slice(0, 6), label: "Countries"}))
```

```js
// One y scale per pair, so solar and wind compare directly; 100% always in view, and the top cut
// at 200% so one thin month (a few MW of wind) cannot flatten every other line.
const CAPTURE_MAX = 2
const lineDomain = (rows) => {
  const [lo, hi] = d3.extent(rows, (d) => d.value);
  return [Math.min(lo ?? 1, 0.95) - 0.02, Math.min(CAPTURE_MAX, Math.max(hi ?? 1, 1.05) + 0.02)];
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
const shareY = [Math.min(0.95, d3.min(shares, (d) => d.value)) - 0.02, Math.min(CAPTURE_MAX, Math.max(1.05, d3.max(shares, (d) => d.value)) + 0.02)]
```

```js
pair(...TECHS.map((tech) => captureShareScatter({
  d3, Plot, rows: shares.filter((d) => d.tech === tech), tech, zone, years: shareYears,
  width: halfWidth, xDomain: shareX(tech), yDomain: shareY, selection: shareSelection
})))
```

## Capture and curtailment

What a plant earns once negative prices are counted in. A plant without support for negative
hours stops producing when the day-ahead price falls below zero; its effective value, per MWh it
could have produced, is then the capture factor of the output it still sells (blue: above or
below the baseload line) less the output it gives up in negative hours (orange). The hollow dot is
the ordinary capture factor, which sells through those hours at a loss. Hourly prices and output;
a year needs all twelve months, except the year to date.

```js
zoneInput
```

```js
// One file per zone (the residual-load files of the prices page, which carry hourly solar and
// wind output), so the page loads only the selected country; FileAttachment needs literal paths.
const RESIDUAL = {
  DE_LU: FileAttachment("./data/residual/DE_LU.csv"),
  FR: FileAttachment("./data/residual/FR.csv"),
  BE: FileAttachment("./data/residual/BE.csv"),
  NL: FileAttachment("./data/residual/NL.csv"),
  AT: FileAttachment("./data/residual/AT.csv"),
  CH: FileAttachment("./data/residual/CH.csv"),
  IE_SEM: FileAttachment("./data/residual/IE_SEM.csv"),
  ES: FileAttachment("./data/residual/ES.csv"),
  PT: FileAttachment("./data/residual/PT.csv"),
  IT_NORD: FileAttachment("./data/residual/IT_NORD.csv"),
  IT_CNOR: FileAttachment("./data/residual/IT_CNOR.csv"),
  IT_CSUD: FileAttachment("./data/residual/IT_CSUD.csv"),
  IT_SUD: FileAttachment("./data/residual/IT_SUD.csv"),
  IT_CALA: FileAttachment("./data/residual/IT_CALA.csv"),
  IT_SICI: FileAttachment("./data/residual/IT_SICI.csv"),
  IT_SARD: FileAttachment("./data/residual/IT_SARD.csv"),
  DK_1: FileAttachment("./data/residual/DK_1.csv"),
  DK_2: FileAttachment("./data/residual/DK_2.csv"),
  NO_1: FileAttachment("./data/residual/NO_1.csv"),
  NO_2: FileAttachment("./data/residual/NO_2.csv"),
  NO_3: FileAttachment("./data/residual/NO_3.csv"),
  NO_4: FileAttachment("./data/residual/NO_4.csv"),
  NO_5: FileAttachment("./data/residual/NO_5.csv"),
  SE_1: FileAttachment("./data/residual/SE_1.csv"),
  SE_2: FileAttachment("./data/residual/SE_2.csv"),
  SE_3: FileAttachment("./data/residual/SE_3.csv"),
  SE_4: FileAttachment("./data/residual/SE_4.csv"),
  FI: FileAttachment("./data/residual/FI.csv"),
  EE: FileAttachment("./data/residual/EE.csv"),
  LV: FileAttachment("./data/residual/LV.csv"),
  LT: FileAttachment("./data/residual/LT.csv"),
  PL: FileAttachment("./data/residual/PL.csv"),
  CZ: FileAttachment("./data/residual/CZ.csv"),
  SK: FileAttachment("./data/residual/SK.csv"),
  HU: FileAttachment("./data/residual/HU.csv"),
  SI: FileAttachment("./data/residual/SI.csv"),
  HR: FileAttachment("./data/residual/HR.csv"),
  RO: FileAttachment("./data/residual/RO.csv"),
  BG: FileAttachment("./data/residual/BG.csv"),
  GR: FileAttachment("./data/residual/GR.csv"),
  RS: FileAttachment("./data/residual/RS.csv"),
  ME: FileAttachment("./data/residual/ME.csv"),
  MK: FileAttachment("./data/residual/MK.csv"),
  AL: FileAttachment("./data/residual/AL.csv")
}
```

```js
const residualRaw = await RESIDUAL[zone].csv()
```

```js
// Older snapshots have no solar and wind columns: no curtailment rows until the next build.
const curtailment = residualRaw.columns.includes("solar")
  ? curtailmentEffect(residualRaw.map((d) => ({date: d.date, price: +d.price, solar: +d.solar, wind: +d.wind})), {openYear})
  : []
// One scale for both technologies, cut at 200% like the lines above.
const curtailDomain = [
  Math.min(0.5, d3.min(curtailment, (d) => Math.min(d.evf, d.cf)) ?? 0.5) - 0.05,
  Math.min(CAPTURE_MAX, Math.max(1.1, d3.max(curtailment, (d) => d.cfPos) ?? 1) + 0.05)
]
```

```js
curtailment.length
  ? pair(...TECHS.map((tech) => {
      const rows = curtailment.filter((d) => d.tech === tech);
      return rows.length
        ? curtailmentChart({d3, Plot, rows, tech, zone, openYear, lastMonthShort, width: halfWidth, domain: curtailDomain})
        : html`<p>No ${tech} output reported for this country.</p>`;
    }))
  : html`<p>No hourly solar and wind output for this country yet.</p>`
```

