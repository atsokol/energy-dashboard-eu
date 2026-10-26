---
title: EU Power Markets
---

# EU power markets dashboard

Day-ahead electricity prices, battery-arbitrage spreads and the generation mix for eighteen
bidding zones in
**Central Europe** (Germany–Luxembourg, Austria, Czechia, Slovakia, Poland, Hungary, Slovenia),
**South-East Europe** (Croatia, Romania, Bulgaria, Greece, Serbia, Montenegro, North Macedonia,
Albania) and the **Baltics** (Estonia, Latvia, Lithuania), from January 2021. Data comes from the
ENTSO-E Transparency Platform via [entsoemcp.com](https://entsoemcp.com). Bosnia & Herzegovina
is not shown because ENTSO-E publishes no day-ahead price for it.

## Dashboards

- [**Day-ahead prices**](./prices): a map of average prices over the last full year, month,
  week or day, plus the monthly price history and intraday volatility of a selected country.
- [**Day-ahead spreads**](./spreads): a map of average TB1 / TB2 / TB4 spreads by year, month or
  week, and a 30-day moving-average comparison across countries.
- [**Generation mix**](./generation): a map of each country's generation mix over the last full
  year, monthly generation by type next to current installed capacity, and a typical day per season.

## Data updates

The site rebuilds every day after the day-ahead auction. Each build downloads hourly prices and
monthly generation for all zones and reduces them to small tables, which are published with the
site. Hourly generation for the seasonal profiles is downloaded once a year, when a new full year
becomes available.
