---
title: Day-ahead spreads
toc: true
---

# Day-ahead spreads

The **TBx (top-x / bottom-x)** spread measures the arbitrage available to a battery on the
day-ahead market: the average of a market day's x most expensive hourly prices minus the average
of its x cheapest. It approximates the gross margin per MWh cycled by an x-hour battery that
charges and discharges once a day with perfect foresight, before round-trip losses. TB1, TB2 and
TB4 stand for one-, two- and four-hour batteries. Spreads are computed on hourly prices
throughout. Since SDAC moved to 15-minute products in October 2025, each hour is the mean of its
four quarter-hours, which keeps every year on one basis but understates what quarter-hour
dispatch can capture.

```js
import {ZONES} from "./components/zones.js"
import {anchorDay, lastFullPeriods, periodMeans, rollingMeans} from "./components/dam.js"
import {linkMapToInput, spreadLines, zoneMap} from "./components/charts.js"
```

```js
const dailyRaw = await FileAttachment("./data/dam-daily.csv").csv()
const geo = await FileAttachment("./data/europe.geo.json").json()
```

```js
const daily = dailyRaw.map((d) => ({zone: d.zone, date: d.date, tb1: +d.tb1, tb2: +d.tb2, tb4: +d.tb4}))

const periods = lastFullPeriods(anchorDay(daily)).filter((p) => p.key !== "day")
```

```js
const tb = view(Inputs.radio(new Map([["TB1", "tb1"], ["TB2", "tb2"], ["TB4", "tb4"]]), {value: "tb4", label: "Spread"}))
```

## Spread map

Each zone's average daily spread over the last complete year, month or week. A zone is shaded
only when it reported at least 80% of the period's days. Click a country to add it to the
comparison below.

```js
const periodKey = view(Inputs.radio(new Map(periods.map((p) => [p.label, p.key])), {value: "month", label: "Period"}))
```

```js
const period = periods.find((p) => p.key === periodKey)
const spreadValues = periodMeans(daily, tb, period)
```

```js
const zonesInput = Inputs.checkbox(new Map(ZONES.map((z) => [z.short, z.key])), {value: ["DE_LU", "PL", "HU", "RO", "GR", "LT"], label: "Countries"})
```

```js
linkMapToInput(zoneMap({
  d3, Plot, geo, width,
  values: spreadValues, selected: null,
  title: `Average ${tb.toUpperCase()} spread — ${period.label}`,
  subtitle: `Mean daily top-${tb.slice(2)} minus bottom-${tb.slice(2)} hourly price`,
  label: "EUR / MWh",
}), zonesInput, {toggle: true})
```

## Spread evolution

Regional markets are coupled by cross-border trading, so spreads in neighbouring zones tend to
move together. A sustained gap points to a local driver, such as solar penetration, flexible
capacity or import constraints, rather than a regional one.

```js
const zones = view(zonesInput)
```

```js
const fromYear = view(Inputs.select(["2021", "2022", "2023", "2024", "2025", "2026"], {value: "2021", label: "From"}))
```

```js
const MA_WINDOW = 30
const spreadMa = rollingMeans(daily.filter((d) => zones.includes(d.zone)), tb, MA_WINDOW)
  .filter((d) => d.date >= `${fromYear}-01-01`)
```

```js
spreadLines({d3, Plot, width, rows: spreadMa, tb, window: MA_WINDOW})
```
