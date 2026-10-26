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
import {START_DATE, ZONES} from "./components/zones.js"
import {anchorDay, cumulativeByYear, listPeriods, monthlyMeans, periodMeans, stableDomain} from "./components/dam.js"
import {cumulativeYearChart, linkMapToInput, monthlyPriceChart, volatilityChart, zoneMap} from "./components/charts.js"
```

```js
const dailyRaw = await FileAttachment("./data/dam-daily.csv").csv()
const quantilesRaw = await FileAttachment("./data/dam-quantiles.csv").csv()
const geo = await FileAttachment("./data/europe.geo.json").json()
```

```js
// Columns are parsed by hand rather than with {typed: true}: autoType would turn `date` into a
// Date object, and the shared metric code in dam.js works on "YYYY-MM-DD" strings.
const daily = dailyRaw.map((d) => ({
  zone: d.zone, date: d.date, avg: +d.avg, hours: +d.hours, neg_hours: +d.neg_hours, neg_value: +d.neg_value
}))
const quantiles = quantilesRaw.map((d) => ({zone: d.zone, year: d.year, hour: +d.hour, p10: +d.p10, p50: +d.p50, p90: +d.p90}))

const anchor = anchorDay(daily)
const monthly = monthlyMeans(daily)
```

## Price map

Each zone's average price over a year, month, week or day: pick the period type, then the period.
The latest period is shown to date while it is still in progress. The colour scale is fixed for
each period type, so colours compare across periods; the most extreme 2% of values at either end
take the end colours. A zone is shaded only when it reported at least 80% of the period's days (so
far). Click a country to show it in the charts below.

```js
const PERIOD_KINDS = [["Year", "year"], ["Month", "month"], ["Week", "week"], ["Day", "day"]]
const periodKind = view(Inputs.radio(new Map(PERIOD_KINDS), {value: "month", label: "Period"}))
```

```js
const periodOptions = listPeriods(periodKind, anchor)
const period = view(Inputs.select(periodOptions, {
  value: periodOptions[0], format: (p) => p.label,
  label: PERIOD_KINDS.find(([, k]) => k === periodKind)[0]
}))
```

```js
const pricesByPeriod = periodMeans(daily, "avg", periodKind, periodOptions, "hours")
const priceDomain = stableDomain(pricesByPeriod, periodOptions)
const priceValues = pricesByPeriod.get(period.key)
```

```js
// Shown above the charts below; declared here because the map highlights the selected zone.
const zoneInput = Inputs.select(new Map(ZONES.map((z) => [z.name, z.key])), {value: "HU", label: "Country"})
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
monthlyPriceChart({d3, Plot, width, rows: monthly.filter((d) => d.month >= `${fromYear}-01-01`), zone})
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

## Negative prices

Hours with a negative day-ahead price, year by year, for the selected country and from the start
year chosen above. The first chart counts the hours. The second sums their prices, which is what
1 MW of output would have paid to run through every one of them, so a few deeply negative days
weigh more there than many hours just below zero. Both are counted on hourly prices: since
October 2025 each hour is the mean of its four quarter-hours, so a negative quarter-hour inside
a positive hour is not counted.

```js
const zoneNegative = daily.filter((d) => d.zone === zone && d.date >= `${fromYear}-01-01`)
const negHours = cumulativeByYear(zoneNegative, "neg_hours")
const negValue = cumulativeByYear(zoneNegative, "neg_value")
```

```js
cumulativeYearChart({
  d3, Plot, width, rows: negHours,
  title: `Cumulative hours with negative day-ahead prices — ${ZONES.find((z) => z.key === zone).name}`,
  subtitle: "Hours with an hourly DAM price below 0 EUR/MWh, running total from 1 January",
  label: "hours"
})
```

```js
cumulativeYearChart({
  d3, Plot, width, rows: negValue,
  title: `Cumulative value of negative day-ahead prices — ${ZONES.find((z) => z.key === zone).name}`,
  subtitle: "Sum of negative hourly DAM prices × 1 hour, running total from 1 January",
  label: "EUR / MW"
})
```
