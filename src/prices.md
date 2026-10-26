---
title: Day-ahead prices
toc: true
---

# Day-ahead prices

Hourly **day-ahead market (DAM)** clearing prices for eighteen bidding zones in Central Europe,
South-East Europe and the Baltics, from January 2021, sourced from the ENTSO-E Transparency
Platform through [entsoemcp.com](https://entsoemcp.com). Prices are in EUR/MWh: Bulgaria's BGN
prices (to January 2022) are converted at the euro peg, Romania's RON prices (to June 2021) at ECB
monthly reference rates. Days are local market days.

```js
import {ZONES} from "./components/zones.js"
import {anchorDay, lastFullPeriods, monthlyMeans, periodMeans} from "./components/dam.js"
import {linkMapToInput, monthlyPriceChart, volatilityChart, zoneMap} from "./components/charts.js"
```

```js
const dailyRaw = await FileAttachment("./data/dam-daily.csv").csv()
const quantilesRaw = await FileAttachment("./data/dam-quantiles.csv").csv()
const geo = await FileAttachment("./data/europe.geo.json").json()
```

```js
// Columns are parsed by hand rather than with {typed: true}: autoType would turn `date` into a
// Date object, and the shared metric code in dam.js works on "YYYY-MM-DD" strings.
const daily = dailyRaw.map((d) => ({zone: d.zone, date: d.date, avg: +d.avg, hours: +d.hours}))
const quantiles = quantilesRaw.map((d) => ({zone: d.zone, year: d.year, hour: +d.hour, p10: +d.p10, p50: +d.p50, p90: +d.p90}))

const anchor = anchorDay(daily)
const periods = lastFullPeriods(anchor)
const monthly = monthlyMeans(daily)
```

## Price map

Each zone's average price over the last complete year, month, week or day before the latest
market day every current zone has published. A zone is shaded only when it reported at least 80%
of the period's days. Click a country on the map, or pick it from the list, to show it in the
two charts below.

```js
const periodKey = view(Inputs.radio(new Map(periods.map((p) => [p.label, p.key])), {value: "month", label: "Period"}))
```

```js
const zoneInput = Inputs.select(new Map(ZONES.map((z) => [z.name, z.key])), {value: "HU", label: "Country"})
const zone = view(zoneInput)
```

```js
const period = periods.find((p) => p.key === periodKey)
const priceValues = periodMeans(daily, "avg", period, "hours")
```

```js
linkMapToInput(zoneMap({
  d3, Plot, geo, width,
  values: priceValues, selected: zone,
  title: `Average day-ahead price — ${period.label}`,
  subtitle: "Hour-weighted average of hourly DAM clearing prices",
  label: "EUR / MWh",
}), zoneInput)
```

## Monthly price evolution

```js
monthlyPriceChart({d3, Plot, width, rows: monthly, zone})
```

## Intraday price volatility

The spread between the P10 and P90 lines at a given hour shows how widely that hour's price
ranged over the year. The gap between the morning and evening peaks and the midday trough is
the shape that storage and flexible demand trade on.

```js
const zoneQuantiles = quantiles.filter((d) => d.zone === zone)
```

```js
volatilityChart({d3, Plot, width, rows: zoneQuantiles, zone})
```
