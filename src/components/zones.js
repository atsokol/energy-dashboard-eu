// The bidding zones in scope, shared by the build-time loaders (Node) and every page (browser):
// every zone for which entsoemcp.com holds day-ahead prices from 2021.
//
// `key` is the entsoemcp.com zone key, and the `zone` property of its shapes in
// data/europe.geo.json (bidding-zone outlines: Italy, Norway, Sweden and Denmark are split into
// their zones, and DE-LU and the Irish SEM span two countries). `utc` is the zone's standard-time
// UTC offset: every zone here follows the EU summer-time rule, so standard offset + rule gives
// local market time without an Intl lookup per row (see localTime in dam.js).
//
// Great Britain left ENTSO-E's day-ahead coupling at Brexit (its ENTSO-E prices end 2020-12-31,
// generation and load in 2021), so its series come from the successors entsoemcp.com carries:
// the LCCC IMRP auction price (GBP), NESO's generation mix and Elexon's transmission demand
// (SUCCESSORS in lib/entsoe.js). Left out, as there is no day-ahead price for them since 2021:
// Bosnia & Herzegovina (never published) and Cyprus.
//
// No colours here: 45 zones exceed the eight validated categorical hues, so line charts assign
// hues per selection instead (seriesColors in charts.js).

/** Region filter offered on every page, in display order. */
export const REGIONS = ["Western Europe", "British Isles", "Iberia", "Italy", "Nordics", "Baltics", "Central-East Europe", "South-East Europe"];

export const ZONES = [
  {key: "DE_LU", name: "Germany–Luxembourg", short: "DE-LU", region: "Western Europe", utc: 1},
  {key: "FR", name: "France", short: "FR", region: "Western Europe", utc: 1},
  {key: "BE", name: "Belgium", short: "BE", region: "Western Europe", utc: 1},
  {key: "NL", name: "Netherlands", short: "NL", region: "Western Europe", utc: 1},
  {key: "AT", name: "Austria", short: "AT", region: "Western Europe", utc: 1},
  {key: "CH", name: "Switzerland", short: "CH", region: "Western Europe", utc: 1},
  {key: "GB", name: "Great Britain", short: "GB", region: "British Isles", utc: 0},
  {key: "IE_SEM", name: "Ireland (SEM)", short: "IE", region: "British Isles", utc: 0},
  {key: "ES", name: "Spain", short: "ES", region: "Iberia", utc: 1},
  {key: "PT", name: "Portugal", short: "PT", region: "Iberia", utc: 0},
  {key: "IT_NORD", name: "Italy North", short: "IT-N", region: "Italy", utc: 1},
  {key: "IT_CNOR", name: "Italy Centre-North", short: "IT-CN", region: "Italy", utc: 1},
  {key: "IT_CSUD", name: "Italy Centre-South", short: "IT-CS", region: "Italy", utc: 1},
  {key: "IT_SUD", name: "Italy South", short: "IT-S", region: "Italy", utc: 1},
  {key: "IT_CALA", name: "Italy Calabria", short: "IT-CAL", region: "Italy", utc: 1},
  {key: "IT_SICI", name: "Italy Sicily", short: "IT-SIC", region: "Italy", utc: 1},
  {key: "IT_SARD", name: "Italy Sardinia", short: "IT-SAR", region: "Italy", utc: 1},
  {key: "DK_1", name: "Denmark West (DK1)", short: "DK1", region: "Nordics", utc: 1},
  {key: "DK_2", name: "Denmark East (DK2)", short: "DK2", region: "Nordics", utc: 1},
  {key: "NO_1", name: "Norway NO1 (Oslo)", short: "NO1", region: "Nordics", utc: 1},
  {key: "NO_2", name: "Norway NO2 (Kristiansand)", short: "NO2", region: "Nordics", utc: 1},
  {key: "NO_3", name: "Norway NO3 (Trondheim)", short: "NO3", region: "Nordics", utc: 1},
  {key: "NO_4", name: "Norway NO4 (Tromsø)", short: "NO4", region: "Nordics", utc: 1},
  {key: "NO_5", name: "Norway NO5 (Bergen)", short: "NO5", region: "Nordics", utc: 1},
  {key: "SE_1", name: "Sweden SE1 (Luleå)", short: "SE1", region: "Nordics", utc: 1},
  {key: "SE_2", name: "Sweden SE2 (Sundsvall)", short: "SE2", region: "Nordics", utc: 1},
  {key: "SE_3", name: "Sweden SE3 (Stockholm)", short: "SE3", region: "Nordics", utc: 1},
  {key: "SE_4", name: "Sweden SE4 (Malmö)", short: "SE4", region: "Nordics", utc: 1},
  {key: "FI", name: "Finland", short: "FI", region: "Nordics", utc: 2},
  {key: "EE", name: "Estonia", short: "EE", region: "Baltics", utc: 2},
  {key: "LV", name: "Latvia", short: "LV", region: "Baltics", utc: 2},
  {key: "LT", name: "Lithuania", short: "LT", region: "Baltics", utc: 2},
  {key: "PL", name: "Poland", short: "PL", region: "Central-East Europe", utc: 1},
  {key: "CZ", name: "Czechia", short: "CZ", region: "Central-East Europe", utc: 1},
  {key: "SK", name: "Slovakia", short: "SK", region: "Central-East Europe", utc: 1},
  {key: "HU", name: "Hungary", short: "HU", region: "Central-East Europe", utc: 1},
  {key: "SI", name: "Slovenia", short: "SI", region: "Central-East Europe", utc: 1},
  {key: "HR", name: "Croatia", short: "HR", region: "Central-East Europe", utc: 1},
  {key: "RO", name: "Romania", short: "RO", region: "Central-East Europe", utc: 2},
  {key: "BG", name: "Bulgaria", short: "BG", region: "Central-East Europe", utc: 2},
  {key: "GR", name: "Greece", short: "GR", region: "South-East Europe", utc: 2},
  {key: "RS", name: "Serbia", short: "RS", region: "South-East Europe", utc: 1},
  {key: "ME", name: "Montenegro", short: "ME", region: "South-East Europe", utc: 1},
  {key: "MK", name: "North Macedonia", short: "MK", region: "South-East Europe", utc: 1},
  {key: "AL", name: "Albania", short: "AL", region: "South-East Europe", utc: 1}
];

export const ZONE_KEYS = ZONES.map((z) => z.key);
export const zoneByKey = new Map(ZONES.map((z) => [z.key, z]));

/** The zones of the chosen regions, in ZONES order; every zone when none is chosen. */
export function zonesIn(regions) {
  const shown = ZONES.filter((z) => regions.includes(z.region));
  return shown.length ? shown : ZONES;
}

/** First market day of the dashboard's history. */
export const START_DATE = "2021-01-01";
