---
title: Day-ahead prices
toc: true
---

# Day-ahead prices

Hourly **day-ahead market (DAM)** prices for eighteen zones from 2021 (ENTSO-E via
[entsoemcp.com](https://entsoemcp.com)), in EUR/MWh on local market days. Early BGN and RON prices
are converted to EUR.

```js
import {START_DATE, ZONES} from "./components/zones.js"
import {anchorDay, cumulativeByYear, fuelMonthly, listPeriods, monthlyMeans, periodMeans, stableDomain} from "./components/dam.js"
import {hourlyProfiles} from "./components/residual.js"
import {brushHours, linkedBrush, linkPeriod, linkValue, periodLinks, rememberZone, savedZone} from "./components/linking.js"
import {cumulativeYearChart, hourlyByYearChart, linkMapToInput, hourlyMixChart, monthBuildChart, monthlyPriceChart, playGroup, priceResidualScatter, scrubber, zoneMap} from "./components/charts.js"
```

```js
const dailyRaw = await FileAttachment("./data/dam-daily.csv").csv()
const geo = await FileAttachment("./data/europe.geo.json").json()
const fuelRaw = await FileAttachment("./data/fuel-daily.csv").csv()
```

```js
// Columns are parsed by hand rather than with {typed: true}: autoType would turn `date` into a
// Date object, and the shared metric code in dam.js works on "YYYY-MM-DD" strings.
const daily = dailyRaw.map((d) => ({
  zone: d.zone, date: d.date, avg: +d.avg, hours: +d.hours, neg_hours: +d.neg_hours, neg_value: +d.neg_value
}))

const anchor = anchorDay(daily)
const monthly = monthlyMeans(daily)
const fuel = fuelRaw.map((d) => ({date: d.date, gas: +d.gas, co2: +d.co2, cost: +d.cost}))
const fuelByMonth = fuelMonthly(fuel)
```

```js
const MONTHS = Array.from({length: 12}, (_, i) => {
  const mm = String(i + 1).padStart(2, "0");
  return [new Date(`2000-${mm}-01T00:00:00Z`).toLocaleDateString("en-GB", {timeZone: "UTC", month: "long"}), mm];
})
const monthName = (mm) => MONTHS.find(([, m]) => m === mm)[0]
// Period type, month and year: shared by every month/year control here and on the spreads page, and remembered.
const links = periodLinks(anchor)
// The two month sliders below share Play/Pause.
const players = playGroup()
// The hour brush shared by the generation mix chart and the price vs residual load dots.
const hourBrush = linkedBrush()
```

## Price map

Average price by zone for the chosen period; the latest period is shown to date. Colours are fixed
per period type so periods compare. Click a country to select it below.

```js
const PERIOD_KINDS = [["Year", "year"], ["Month", "month"], ["Week", "week"], ["Day", "day"]]
const periodKind = view(linkValue(links.kind, "kind", Inputs.radio(new Map(PERIOD_KINDS), {value: "month", label: "Period"}), {
  accepts: (k) => PERIOD_KINDS.some(([, v]) => v === k)
}))
```

```js
const periodOptions = listPeriods(periodKind, anchor)
// A month or year period follows the month and year controls below.
const period = view(linkPeriod(links, Inputs.select(periodOptions, {
  value: periodOptions[0], format: (p) => p.label,
  label: PERIOD_KINDS.find(([, k]) => k === periodKind)[0]
}), periodKind, periodOptions))
```

```js
const pricesByPeriod = periodMeans(daily, "avg", periodKind, periodOptions, "hours")
const priceDomain = stableDomain(pricesByPeriod, periodOptions)
const priceValues = pricesByPeriod.get(period.key)
```

```js
// Shown below; declared here because the map highlights it. Shared across pages and remembered.
const zoneInput = rememberZone(Inputs.select(new Map(ZONES.map((z) => [z.name, z.key])), {value: savedZone("HU"), label: "Country"}))
const zone = Generators.input(zoneInput)
```

```js
linkMapToInput(zoneMap({
  d3, Plot, geo, width,
  values: priceValues, selected: zone, domain: priceDomain,
  title: `Average day-ahead price — ${period.label}`,
  subtitle: "Hour-weighted average of hourly DAM clearing prices",
  label: "EUR / MWh",
}), zoneInput)
```

## Monthly price evolution

```js
zoneInput
```

```js
const YEARS = Array.from({length: +anchor.slice(0, 4) - +START_DATE.slice(0, 4) + 1}, (_, i) => String(+START_DATE.slice(0, 4) + i))
const fromYear = view(Inputs.select(YEARS, {value: "2023", label: "From"}))
```

```js
monthlyPriceChart({d3, Plot, width, rows: monthly.filter((d) => d.month >= `${fromYear}-01-01`), zone, cost: fuelByMonth})
```

## Hourly prices and residual load

Residual load (load − wind − solar) is what dispatchable plants, storage and imports must cover.
Average by local hour for the selected month, one line per year; where solar cuts midday residual
load, the price follows. Scales are fixed across months. All month and year controls on this page
are linked.

```js
const month = view(linkValue(links.month, "profiles", Inputs.select(new Map(MONTHS), {label: "Month"})))
```

```js
// One file per zone, so the page loads only the selected country; FileAttachment needs literal paths.
const RESIDUAL = {
  DE_LU: FileAttachment("./data/residual/DE_LU.csv"), AT: FileAttachment("./data/residual/AT.csv"),
  CZ: FileAttachment("./data/residual/CZ.csv"), SK: FileAttachment("./data/residual/SK.csv"),
  PL: FileAttachment("./data/residual/PL.csv"), HU: FileAttachment("./data/residual/HU.csv"),
  SI: FileAttachment("./data/residual/SI.csv"), HR: FileAttachment("./data/residual/HR.csv"),
  RO: FileAttachment("./data/residual/RO.csv"), BG: FileAttachment("./data/residual/BG.csv"),
  GR: FileAttachment("./data/residual/GR.csv"), RS: FileAttachment("./data/residual/RS.csv"),
  ME: FileAttachment("./data/residual/ME.csv"), MK: FileAttachment("./data/residual/MK.csv"),
  AL: FileAttachment("./data/residual/AL.csv"), EE: FileAttachment("./data/residual/EE.csv"),
  LV: FileAttachment("./data/residual/LV.csv"), LT: FileAttachment("./data/residual/LT.csv")
}
```

```js
const residualRaw = await RESIDUAL[zone].csv()
```

```js
const residualAll = residualRaw.map((d) => ({year: d.date.slice(0, 4), date: d.date, hour: +d.hour, price: +d.price, rl: +d.rl}))
const profilesAll = hourlyProfiles(residualAll)
const residual = residualAll.filter((d) => d.year >= fromYear)
const shownYears = YEARS.filter((y) => y >= fromYear)
const shownProfiles = profilesAll.filter((d) => d.year >= fromYear)
```

```js
// Its own cell, so a month change re-runs only what reads the month.
const monthLabel = monthName(month)
const profiles = shownProfiles.filter((d) => d.month === month)
```

```js
// Side by side when each chart keeps at least ~310 px; stacked otherwise.
const pairWidth = Math.min(width, 800)
const sideBySide = pairWidth >= 640
const pairGap = 16
const halfWidth = sideBySide ? Math.floor((pairWidth - pairGap) / 2) : pairWidth
const rlUnit = d3.max(profilesAll, (d) => Math.abs(d.rl)) >= 1000 ? {label: "GW", k: 1000} : {label: "MW", k: 1}
const rlFormat = (x) => x.toFixed(rlUnit.k > 1 ? 2 : 0)
// Fixed across months: the profiles' range over every month shown, with zero always included.
const fixedDomain = (rows, key, k = 1) => {
  const [lo, hi] = d3.extent(rows, (d) => d[key] / k);
  return [Math.min(0, lo ?? 0), hi ?? 1];
}
const profileRlDomain = fixedDomain(shownProfiles, "rl", rlUnit.k)
const profilePriceDomain = fixedDomain(shownProfiles, "price")
// The scatter's scales span every hour shown; the price scale stops at the 0.1st and 99.9th
// percentiles so a handful of spikes cannot flatten every month.
const hourPrices = residual.map((d) => d.price).sort(d3.ascending)
const scatterPriceDomain = [Math.min(0, d3.quantileSorted(hourPrices, 0.001) ?? 0), d3.quantileSorted(hourPrices, 0.999) ?? 1]
const scatterRlDomain = d3.extent(residual, (d) => d.rl)
```

```js
profiles.length ? html`<div style="display: grid; grid-template-columns: ${sideBySide ? `${halfWidth}px ${halfWidth}px` : "1fr"}; gap: ${pairGap}px; max-width: 800px; align-items: start;">
  ${hourlyByYearChart({
    d3, Plot, rows: profiles, years: shownYears, value: "rl", k: rlUnit.k, domain: profileRlDomain, width: halfWidth,
    title: `Residual load by hour — ${monthLabel}`,
    subtitle: `${ZONES.find((z) => z.key === zone).name}: average load − wind − solar, ${rlUnit.label}`,
    label: rlUnit.label, format: rlFormat
  })}
  ${hourlyByYearChart({
    d3, Plot, rows: profiles, years: shownYears, value: "price", domain: profilePriceDomain, width: halfWidth,
    title: `Day-ahead price by hour — ${monthLabel}`,
    subtitle: `${ZONES.find((z) => z.key === zone).name}: average hourly DAM price, EUR/MWh`,
    label: "EUR / MWh"
  })}
</div>` : html`<p>No residual-load data for this country in ${monthLabel} from ${fromYear}.</p>`
```

### Month by month through a year

Both profiles for each month of one year, coloured by season (blue winter, red summer). Press Play
or drag the slider; scales are fixed for the year.

```js
const profileYears = [...new Set(profilesAll.map((d) => d.year))]
const buildYear = view(linkValue(links.year, "build", Inputs.select(profileYears, {value: profileYears.at(-1), label: "Year"}), {
  accepts: (y) => profileYears.includes(y)
}))
```

```js
const yearProfiles = profilesAll.filter((d) => d.year === buildYear)
const yearMonths = [...new Set(yearProfiles.map((d) => d.month))]
const buildRlDomain = fixedDomain(yearProfiles, "rl", rlUnit.k)
const buildPriceDomain = fixedDomain(yearProfiles, "price")
const upTo = view(linkValue(links.month, "build", scrubber(yearMonths, {format: (m) => monthName(m).slice(0, 3), label: "Month", autoplay: false, group: players}), {
  accepts: (m) => yearMonths.includes(m)
}))
```

```js
html`<div style="display: grid; grid-template-columns: ${sideBySide ? `${halfWidth}px ${halfWidth}px` : "1fr"}; gap: ${pairGap}px; max-width: 800px; align-items: start;">
  ${monthBuildChart({
    d3, Plot, rows: yearProfiles, upTo, value: "rl", k: rlUnit.k, domain: buildRlDomain, width: halfWidth,
    title: `Residual load by hour — ${buildYear}`,
    subtitle: `${ZONES.find((z) => z.key === zone).name}: monthly average, ${rlUnit.label}`,
    label: rlUnit.label, format: rlFormat
  })}
  ${monthBuildChart({
    d3, Plot, rows: yearProfiles, upTo, value: "price", domain: buildPriceDomain, width: halfWidth,
    title: `Day-ahead price by hour — ${buildYear}`,
    subtitle: `${ZONES.find((z) => z.key === zone).name}: monthly average, EUR/MWh`,
    label: "EUR / MWh"
  })}
</div>`
```

### Generation mix by hour

Generation by type at each local hour of the year and month chosen above. Hours where gas, coal or
imports fill the gap are usually the dear ones. Drag across hours to pick out part of the day in
the dots below; click to clear.

```js
// One file per zone, like the residual-load files.
const GEN_HOURLY = {
  DE_LU: FileAttachment("./data/gen-hourly/DE_LU.csv"), AT: FileAttachment("./data/gen-hourly/AT.csv"),
  CZ: FileAttachment("./data/gen-hourly/CZ.csv"), SK: FileAttachment("./data/gen-hourly/SK.csv"),
  PL: FileAttachment("./data/gen-hourly/PL.csv"), HU: FileAttachment("./data/gen-hourly/HU.csv"),
  SI: FileAttachment("./data/gen-hourly/SI.csv"), HR: FileAttachment("./data/gen-hourly/HR.csv"),
  RO: FileAttachment("./data/gen-hourly/RO.csv"), BG: FileAttachment("./data/gen-hourly/BG.csv"),
  GR: FileAttachment("./data/gen-hourly/GR.csv"), RS: FileAttachment("./data/gen-hourly/RS.csv"),
  ME: FileAttachment("./data/gen-hourly/ME.csv"), MK: FileAttachment("./data/gen-hourly/MK.csv"),
  AL: FileAttachment("./data/gen-hourly/AL.csv"), EE: FileAttachment("./data/gen-hourly/EE.csv"),
  LV: FileAttachment("./data/gen-hourly/LV.csv"), LT: FileAttachment("./data/gen-hourly/LT.csv")
}
```

```js
const genHourlyRaw = await GEN_HOURLY[zone].csv()
```

```js
const genHourly = genHourlyRaw.map((d) => ({month: d.month, hour: +d.hour, group: d.group, mw: +d.mw}))
```

```js
const mixLabel = `${monthName(upTo)} ${buildYear}`
const mixRows = genHourly.filter((d) => d.month === `${buildYear}-${upTo}`)
```

```js
html`<div style="max-width: 800px;">
  ${mixRows.length ? brushHours(d3, hourlyMixChart({d3, Plot, rows: mixRows, zone, label: mixLabel, width}), hourBrush, "mix") : html`<p>No generation data for ${mixLabel}.</p>`}
</div>`
```

### Price against residual load

One dot per hour: price against residual load, for the selected month or "All months" (the last
step, which leaves the other controls alone). Drag a box to see when those hours fall in the mix
chart above; click a legend year to pick it out. The dotted curve is the smoothed average price.
Higher residual load calls on dearer plants, so the cloud rises to the right.

```js
// "All months" (last step) is its own and moves no other control.
const SCATTER_STEPS = [...MONTHS.map(([, mm]) => mm), "all"]
const scatterMonthInput = linkValue(links.month, "scatter", scrubber(SCATTER_STEPS, {
  autoplay: false, group: players, label: "Month", delay: 1200, endDelay: 3000,
  format: (m) => (m === "all" ? "All months" : monthName(m).slice(0, 3))
}), {toLink: (m) => (m === "all" ? null : m)})
// The year highlighted from the legend, kept while the slider or Play redraws the chart.
const scatterSelection = {year: null}
const scatterMonth = view(scatterMonthInput)
```

```js
const scatterHours = scatterMonth === "all" ? residual : residual.filter((d) => d.date.slice(5, 7) === scatterMonth)
const scatterLabel = scatterMonth === "all" ? "all months" : monthName(scatterMonth)
```

```js
scatterHours.length ? priceResidualScatter({d3, Plot, rows: scatterHours, years: shownYears, zone, monthLabel: scatterLabel, rlDomain: scatterRlDomain, priceDomain: scatterPriceDomain, width, selection: scatterSelection, brush: hourBrush}) : html`<p>No hours to show.</p>`
```

## Negative prices

Negative-price hours by year: their count, and their summed price (what 1 MW running through them
paid). Counted on hourly prices, so a negative quarter-hour inside a positive hour is missed.

```js
const zoneNegative = daily.filter((d) => d.zone === zone && d.date >= `${fromYear}-01-01`)
const negHours = cumulativeByYear(zoneNegative, "neg_hours")
const negValue = cumulativeByYear(zoneNegative, "neg_value")
```

```js
cumulativeYearChart({
  d3, Plot, width, rows: negHours,
  title: `Cumulative hours with negative day-ahead prices — ${ZONES.find((z) => z.key === zone).name}`,
  subtitle: "Hours priced below 0 EUR/MWh, running total from 1 January",
  label: "hours"
})
```

```js
cumulativeYearChart({
  d3, Plot, width, rows: negValue,
  title: `Cumulative value of negative day-ahead prices — ${ZONES.find((z) => z.key === zone).name}`,
  subtitle: "Sum of negative hourly prices, running total from 1 January",
  label: "EUR / MW"
})
```
