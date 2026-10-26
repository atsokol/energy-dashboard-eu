// The bidding zones in scope, shared by the build-time loaders (Node) and every page (browser).
//
// `key` is the entsoemcp.com zone key. `iso` lists the ISO 3166 numeric codes of the map shapes
// the zone covers (DE_LU is two countries). `utc` is the zone's standard-time UTC offset: every
// zone here follows the EU summer-time rule, so standard offset + rule gives local market time
// without an Intl lookup per row (see localTime in dam.js).
//
// Bosnia & Herzegovina is deliberately absent: entsoemcp.com reports that ENTSO-E publishes no
// day-ahead price for BA at all, so it would only ever render as an empty shape.
//
// No colours here: eighteen zones exceed the eight validated categorical hues, so line charts
// assign hues per selection instead (seriesColors in charts.js).

export const REGIONS = ["Central Europe", "South-East Europe", "Baltics"];

export const ZONES = [
  {key: "DE_LU", name: "Germany–Luxembourg", short: "DE-LU", region: "Central Europe", iso: ["276", "442"], utc: 1},
  {key: "AT", name: "Austria", short: "AT", region: "Central Europe", iso: ["040"], utc: 1},
  {key: "CZ", name: "Czechia", short: "CZ", region: "Central Europe", iso: ["203"], utc: 1},
  {key: "SK", name: "Slovakia", short: "SK", region: "Central Europe", iso: ["703"], utc: 1},
  {key: "PL", name: "Poland", short: "PL", region: "Central Europe", iso: ["616"], utc: 1},
  {key: "HU", name: "Hungary", short: "HU", region: "Central Europe", iso: ["348"], utc: 1},
  {key: "SI", name: "Slovenia", short: "SI", region: "Central Europe", iso: ["705"], utc: 1},
  {key: "HR", name: "Croatia", short: "HR", region: "South-East Europe", iso: ["191"], utc: 1},
  {key: "RO", name: "Romania", short: "RO", region: "South-East Europe", iso: ["642"], utc: 2},
  {key: "BG", name: "Bulgaria", short: "BG", region: "South-East Europe", iso: ["100"], utc: 2},
  {key: "GR", name: "Greece", short: "GR", region: "South-East Europe", iso: ["300"], utc: 2},
  {key: "RS", name: "Serbia", short: "RS", region: "South-East Europe", iso: ["688"], utc: 1},
  {key: "ME", name: "Montenegro", short: "ME", region: "South-East Europe", iso: ["499"], utc: 1},
  {key: "MK", name: "North Macedonia", short: "MK", region: "South-East Europe", iso: ["807"], utc: 1},
  {key: "AL", name: "Albania", short: "AL", region: "South-East Europe", iso: ["008"], utc: 1},
  {key: "EE", name: "Estonia", short: "EE", region: "Baltics", iso: ["233"], utc: 2},
  {key: "LV", name: "Latvia", short: "LV", region: "Baltics", iso: ["428"], utc: 2},
  {key: "LT", name: "Lithuania", short: "LT", region: "Baltics", iso: ["440"], utc: 2}
];

export const ZONE_KEYS = ZONES.map((z) => z.key);
export const zoneByKey = new Map(ZONES.map((z) => [z.key, z]));
export const zoneByIso = new Map(ZONES.flatMap((z) => z.iso.map((id) => [id, z])));

/** First market day of the dashboard's history. */
export const START_DATE = "2021-01-01";

