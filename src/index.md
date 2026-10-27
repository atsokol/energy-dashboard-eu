---
title: EU Power Markets
---

# EU power markets dashboard

Day-ahead prices, battery spreads and generation mix for 44 bidding zones across Europe, from
2021: every zone with day-ahead prices on ENTSO-E via [entsoemcp.com](https://entsoemcp.com). Italy,
Norway, Sweden and Denmark appear zone by zone. Bosnia & Herzegovina, Great Britain and Cyprus are
left out: there are no ENTSO-E day-ahead prices for them since 2021.

## Dashboards

- [**Generation mix**](./generation): mix map, monthly generation and capacity, typical day by season.
- [**Day-ahead prices**](./prices): price map, monthly history, hourly price, residual load and
  generation mix by month, negative prices.
- [**Day-ahead spreads**](./spreads): TB1 / TB2 / TB4 spread map, top/bottom band per country,
  cross-country comparison.
- [**Capture factors**](./capture): solar and wind capture factor maps, annual and seasonal
  history, capture factor against market share.

The region filter at the top of each page narrows the maps, country lists and comparisons to the
chosen regions. Region, country, period type, month and year choices carry across pages and visits.

## Data updates

Rebuilt weekly, on Mondays after the day-ahead auction. Hourly load and generation are downloaded in full once,
then only the latest weeks.
