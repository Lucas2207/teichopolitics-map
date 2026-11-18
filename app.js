// Teichopolitics map: border barriers shown by the year they were built.

// Colour by construction type (see constructionClass)
const CONSTRUCTION_COLORS = {
  concrete: "#d62728", // concrete, stone or brick wall
  steel: "#f58518",    // steel, metal or mesh fence
  wire: "#9d6bff",     // barbed or razor wire
  earth: "#00a676",    // earthwork, sand berm, trench
  mixed: "#fff08a",    // sections built differently, e.g. concrete wall with fenced sections
  unknown: "#0b63ce",  // not documented
  historical: "#00838f", // historical walls, no longer used as borders
};
// The pale yellow gets a thin outline in a darker shade of its own hue, so it stays visible on light maps
const CASING_COLORS = { mixed: "#a67c00" };
const MATERIALS = [
  ["concrete", /concrete|stone|brick|block|blast/],
  ["earth", /\bsand\b|berm|dune|rammed|turf|earth|trench|ditch/],
  ["steel", /steel|mesh|bollard|palisade|electronic|metal/],
  ["wire", /wire|razor|barbed|concertina|blade/],
];
const CASING_EXTRA = 2;
// Wider gaps on pale dotted lines, so the dark outlines of neighbouring dots do not merge into a solid line
const dottedDash = (cased) => (cased ? "2 9" : "2 6");

// Sort a barrier into a construction class from its free-text construction field
function constructionClass(p) {
  if (p.construction_class) return p.construction_class; // set by hand for mixed construction and a few exceptions
  const c = (p.construction || "").toLowerCase();
  // The material named first is the main structure; anything added to it does not change the class
  let cls = "unknown", at = Infinity;
  for (const [name, pattern] of MATERIALS) {
    const i = c.search(pattern);
    if (i >= 0 && i < at) { at = i; cls = name; }
  }
  return cls;
}

// A darker copy drawn under a pale line or dot; it stays slightly wider through every restyle
function asCasing(path) {
  const set = path.setStyle;
  path.setStyle = function (s) {
    return set.call(this, s.weight ? { ...s, weight: s.weight + CASING_EXTRA } : s);
  };
  return path;
}
function casingFor(item, style, weight) {
  // style.color is already the outline colour
  if (!item.casing) item.casing = asCasing(L.polyline(item.latlngs, { ...style }));
  item.casing.setStyle({ weight });
  return item.casing;
}

function dotStyle(color, radius) {
  return { radius, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 };
}

// Phones (upright or on their side): the legend and the layer box start folded into small buttons
const SMALL_SCREEN = window.matchMedia("(max-width: 700px), (max-height: 500px)").matches;
const map = L.map("map", { worldCopyJump: true }).setView([30, 20], SMALL_SCREEN ? 2 : 3);

// Base maps (all free, attribution required)
// Roads, railways and rivers (Natural Earth, simplified). Major lines load at start; secondary lines load once you zoom past 6
const NET = {
  roads: { light: "#a3a39a", dark: "#6a6a72" },
  railways: { light: "#8f8f88", dark: "#7a7a84" },
  rivers: { light: "#6fa8cc", dark: "#4f88aa" },
};
const networkLayers = []; // { kind, tier, layer }
function networkStyle(kind, tier) {
  const mode = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  return {
    color: NET[kind][mode],
    weight: kind === "rivers" ? (tier === 1 ? 1.2 : 0.8) : tier === 1 ? 1 : 0.6,
    dashArray: kind === "railways" ? "4 3" : null,
    opacity: 0.9,
  };
}
function loadNetwork(kind, label, tier) {
  fetch(`data/networks/${kind}-${label}.json`)
    .then((r) => r.json())
    .then((fc) => {
      const layer = L.geoJSON(fc, { style: () => networkStyle(kind, tier), interactive: false, pane: "networks" });
      networkLayer.addLayer(layer);
      networkLayers.push({ kind, tier, layer });
      layer.setStyle({ opacity: map.getZoom() >= (tier === 1 ? 5 : 7) ? 0.9 : 0 });
    });
}
// Dotted connectors join each piece to its nearest piece within 5 km, so gaps between pieces read as gaps.
// Skipped for walls with many pieces, to keep the page responsive.
function connectorsFor(pieces) {
  if (pieces.length < 2 || pieces.length > 300) return [];
  const out = [];
  const seen = new Set();
  pieces.forEach((a, i) => {
    const endsA = [a.latlngs[0], a.latlngs[a.latlngs.length - 1]];
    let best = null;
    pieces.forEach((b, j) => {
      if (i === j) return;
      const endsB = [b.latlngs[0], b.latlngs[b.latlngs.length - 1]];
      for (const ea of endsA) {
        for (const eb of endsB) {
          const d = map.distance(ea, eb) / 1000;
          if (d > 0.05 && d <= 5 && (!best || d < best.d)) best = { d, from: ea, to: eb, j };
        }
      }
    });
    if (best) {
      const key = [i, best.j].sort().join("-");
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ latlngs: [best.from, best.to], minKm: Math.min(a.km, pieces[best.j].km), line: null });
      }
    }
  });
  return out;
}

// Walls traced in many pieces (e.g. the Great Wall) show only the pieces long enough for the current zoom
function refreshPieces(group) {
  if (!group.pieces) return;
  // Every piece stays visible; only the thickness changes with zoom
  const zoom = map.getZoom();
  const weight = zoom >= 8 ? 5 : zoom >= 6 ? 4 : 3;
  group.clearLayers();
  if (group.cased) {
    for (const p of group.pieces) group.addLayer(casingFor(p, { ...group.style, color: group.casingColor }, weight));
    for (const c of group.connectors || []) group.addLayer(casingFor(c, { ...group.style, color: group.casingColor, dashArray: dottedDash(true) }, Math.max(2, weight - 1)));
  }
  for (const p of group.pieces) {
    if (!p.line) p.line = L.polyline(p.latlngs, { ...group.style });
    p.line.setStyle({ weight });
    group.addLayer(p.line);
  }
  for (const c of group.connectors || []) {
    if (!c.line) c.line = L.polyline(c.latlngs, { ...group.style, dashArray: dottedDash(group.cased) });
    c.line.setStyle({ weight: Math.max(2, weight - 1) });
    group.addLayer(c.line);
  }
}
map.on("zoomend", () => barriers.forEach((b) => refreshPieces(b.layer)));

let secondaryLoaded = false;
function loadSecondaryNetworks() {
  if (secondaryLoaded) return;
  secondaryLoaded = true;
  loadNetwork("roads", "secondary", 2);
  loadNetwork("railways", "secondary", 2);
  loadNetwork("rivers", "secondary", 2);
}

// Street map: country shapes in the page's own colours. Drawn here, so it carries no names of its own
// Shapes that cross the 180° meridian (Russia's far east, Antarctica, Fiji) would be drawn
// as bands across the whole map. Unwrapping each ring keeps it continuous instead.
function unwrapRing(ring) {
  const out = [];
  let shift = 0;
  let prev = null;
  for (const [lon, lat] of ring) {
    if (prev !== null) {
      if (lon + shift - prev > 180) shift -= 360;
      else if (lon + shift - prev < -180) shift += 360;
    }
    out.push([lon + shift, lat]);
    prev = lon + shift;
  }
  return out;
}
function unwrapFeatures(fc) {
  for (const f of fc.features) {
    const g = f.geometry;
    if (g.type === "Polygon") g.coordinates = g.coordinates.map(unwrapRing);
    if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map((poly) => poly.map(unwrapRing));
  }
  return fc;
}

const LAND = {
  light: { sea: "#dbe4ea", fill: "#f2f2ef", stroke: "#bdbdb6" },
  dark: { sea: "#0f141b", fill: "#2a2a31", stroke: "#4a4a55" },
};
// The "Map" land shapes sit in their own low pane, so overlays such as the deprivation layer draw above them
map.createPane("land");
map.getPane("land").style.zIndex = 250;
const landLayer = L.geoJSON(null, { pane: "land", style: { fillColor: LAND.light.fill, fillOpacity: 1, color: LAND.light.stroke, weight: 0.6 } });
function applyLandStyle() {
  const t = document.documentElement.dataset.theme === "dark" ? LAND.dark : LAND.light;
  landLayer.setStyle({ fillColor: t.fill, color: t.stroke, fillOpacity: 1, weight: 0.6 });
  map.getContainer().style.background = t.sea;
  networkLayers.forEach(({ kind, tier, layer }) => layer.setStyle(networkStyle(kind, tier)));
}

const baseLayers = {
  "Map": landLayer,
  // Shaded relief has no place names, so only the labels on this page appear
  "Terrain": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 13,
    className: "terrain-tiles",
    attribution: "Tiles &copy; Esri",
  }),
  "Satellite": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    className: "satellite-tiles",
    attribution: "Tiles &copy; Esri, Maxar, Earthstar Geographics",
  }),
};
baseLayers["Terrain"].addTo(map);

// Legend on the map: what the colours and line styles mean
// Neighbourhood themes around Northern Ireland's peace walls: one shown at a time, each with its own colour scale.
// "sa" = Small Areas (NIMDM 2017, income); "dz" = Data Zones (Census 2021)
const THEMES = {
  income: { region: "ni", label: "Income: residents on low income (2015/16)", src: "sa", field: "low_income_pct", breaks: [10, 15, 20, 30],
    colors: ["#fef0d9", "#fdcc8a", "#fc8d59", "#e34a33", "#b30000"],
    note: "Share of residents in households below 60% of the Northern Ireland median equivalised income, April 2015 to March 2016. The median was £24,253 a year, so the low-income line is about £280 a week" },
  unemp: { region: "ni", label: "Employment: unemployment rate (2021)", src: "dz", field: "unemp", breaks: [3, 5, 8, 12],
    colors: ["#feedde", "#fdbe85", "#fd8d3c", "#e6550d", "#a63603"],
    note: "Unemployed residents as a share of the economically active aged 16+" },
  prof: { region: "ni", label: "Occupations: managerial and professional (2021)", src: "dz", field: "prof", breaks: [15, 25, 35, 45],
    colors: ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"],
    note: "Share of residents aged 16+ (excluding students) in managerial, administrative and professional occupations" },
  community: { region: "ni", label: "Community background: Catholic / Protestant (2021)", src: "dz", field: "cath_share", breaks: [20, 40, 60, 80],
    colors: ["#5e3c99", "#b2abd2", "#ececec", "#80cdc1", "#018571"],
    labels: ["Over 80% Protestant background", "60–80% Protestant", "Mixed (40–60%)", "60–80% Catholic", "Over 80% Catholic background"],
    note: "Religion or religion brought up in, among residents of Catholic or Protestant background" },
  minority: { region: "ni", label: "Ethnic minorities: residents not White (2021)", src: "dz", field: "minority", breaks: [1, 3, 6, 10],
    colors: ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"],
    note: "Share of residents who are not of White ethnic group; the White share is the rest (100% minus this figure)" },
  british: { region: "ni", label: "National identity: British only (2021)", src: "dz", field: "british", breaks: [10, 25, 40, 55],
    colors: ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"],
    note: "Share of residents whose only national identity is British" },
  irish: { region: "ni", label: "National identity: Irish only (2021)", src: "dz", field: "irish", breaks: [10, 25, 40, 55],
    colors: ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"],
    note: "Share of residents whose only national identity is Irish" },
  ni_only: { region: "ni", label: "National identity: Northern Irish only (2021)", src: "dz", field: "ni", breaks: [10, 15, 20, 25],
    colors: ["#fff5eb", "#fdd0a2", "#fd8d3c", "#d94801", "#8c2d04"],
    note: "Share of residents whose only national identity is Northern Irish" },
  no_background: { region: "ni", label: "Community background: none (2021)", src: "dz", field: "none", breaks: [5, 10, 20, 30],
    colors: ["#f7f7f7", "#cccccc", "#969696", "#636363", "#252525"],
    note: "Share of residents with no religion who were not brought up in one" },
  crime: { region: "ni", label: "Crime: recorded crime per 1,000 residents (2025–26)", src: "dz", field: "crime_rate", unit: "per 1,000", breaks: [25, 50, 100, 200],
    colors: ["#fee5d9", "#fcae91", "#fb6a4a", "#de2d26", "#a50f15"], labels: ["Under 25", "25–50", "50–100", "100–200", "200 and over (per 1,000 residents)"],
    note: "Crimes recorded by the PSNI from October 2025 to September 2026, excluding anti-social behaviour, per 1,000 residents (Census 2021). Locations are snapped to anonymous points near where the crime happened, and areas with shops, pubs or few residents (such as the city centre) have high rates because crimes there involve visitors", source: "PSNI via police.uk" },
  violent: { region: "ni", label: "Crime: violence and sexual offences per 1,000 residents (2025–26)", src: "dz", field: "violent_rate", unit: "per 1,000", breaks: [10, 25, 50, 100],
    colors: ["#fee5d9", "#fcae91", "#fb6a4a", "#de2d26", "#a50f15"], labels: ["Under 10", "10–25", "25–50", "50–100", "100 and over (per 1,000 residents)"],
    note: "Violence and sexual offences recorded by the PSNI, October 2025 to September 2026, per 1,000 residents. Same caveats on locations and on areas with few residents", source: "PSNI via police.uk" },
  asb: { region: "ni", label: "Anti-social behaviour incidents per 1,000 residents (2025–26)", src: "dz", field: "asb_rate", unit: "per 1,000", breaks: [10, 25, 50, 100],
    colors: ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"], labels: ["Under 10", "10–25", "25–50", "50–100", "100 and over (per 1,000 residents)"],
    note: "Anti-social behaviour incidents reported to the PSNI, October 2025 to September 2026, per 1,000 residents. Same caveats on locations and on areas with few residents", source: "PSNI via police.uk" },
  routine: { region: "ni", label: "Occupations: semi-routine and routine (2021)", src: "dz", field: "routine", breaks: [20, 30, 40, 50],
    colors: ["#fef0d9", "#fdcc8a", "#fc8d59", "#e34a33", "#b30000"],
    note: "Share of residents aged 16+ (excluding students) in semi-routine and routine occupations" },
  us_income: { region: "us", label: "Income: median household income (2020–24)", src: "us", field: "income", breaks: [40000, 60000, 80000, 110000],
    colors: ["#b30000", "#e34a33", "#fc8d59", "#fdcc8a", "#fef0d9"],
    labels: ["Under $40,000", "$40,000–60,000", "$60,000–80,000", "$80,000–110,000", "$110,000 and over"],
    note: "Median household income in 2024 dollars, by census tract", source: "U.S. Census Bureau, ACS 2020–2024" },
  us_poverty: { region: "us", label: "Income: people below the poverty line (2020–24)", src: "us", field: "poverty", breaks: [10, 20, 30, 40],
    colors: ["#fef0d9", "#fdcc8a", "#fc8d59", "#e34a33", "#b30000"],
    note: "Share of people below the federal poverty line", source: "U.S. Census Bureau, ACS 2020–2024" },
  us_unemp: { region: "us", label: "Employment: unemployment rate (2020–24)", src: "us", field: "unemp", breaks: [3, 5, 8, 12],
    colors: ["#feedde", "#fdbe85", "#fd8d3c", "#e6550d", "#a63603"],
    note: "Unemployed as a share of the civilian labour force", source: "U.S. Census Bureau, ACS 2020–2024" },
  us_employed: { region: "us", label: "Employment rate: residents in work (2020–24)", src: "us", field: "employed", breaks: [50, 55, 60, 65],
    colors: ["#fee5d9", "#fcae91", "#c7e9c0", "#74c476", "#238b45"],
    note: "Employed civilians as a share of residents aged 16 and over. Same colour scale as the Mexican side, which counts residents aged 12 and over, in March 2020", source: "U.S. Census Bureau, ACS 2020–2024" },
  us_hisp: { region: "us", label: "Ethnicity: Hispanic or Latino residents (2020–24)", src: "us", field: "hisp", breaks: [20, 40, 60, 80],
    colors: ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"],
    note: "Share of residents who are Hispanic or Latino, of any race", source: "U.S. Census Bureau, ACS 2020–2024" },
  us_foreign: { region: "us", label: "Migration: foreign-born residents (2020–24)", src: "us", field: "foreign", breaks: [10, 20, 30, 40],
    colors: ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"],
    note: "Share of residents born outside the United States", source: "U.S. Census Bureau, ACS 2020–2024" },
  us_spanish: { region: "us", label: "Language: Spanish spoken at home (2020–24)", src: "us", field: "spanish", breaks: [20, 40, 60, 80],
    colors: ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"],
    note: "Share of people aged 5 and over who speak Spanish at home", source: "U.S. Census Bureau, ACS 2020–2024" },
  us_religion: { region: "us", label: "Religion: Catholic adherents, by county (2020)", src: "county", field: "catholic", breaks: [15, 25, 35, 45],
    colors: ["#f7f4f9", "#d4b9da", "#c994c7", "#dd1c77", "#980043"],
    note: "Adherents counted by congregations, as a share of county population. The US census does not ask about religion, so this is by county", source: "U.S. Religion Census 2020" },
  mx_unemp: { region: "mx", label: "Employment: unemployment rate (2020)", src: "mxageb", field: "unemp", breaks: [1, 2, 3, 5],
    colors: ["#feedde", "#fdbe85", "#fd8d3c", "#e6550d", "#a63603"],
        note: "Unemployed as a share of the economically active. The census measure runs lower than INEGI's labour survey. Urban areas (AGEB) drawn over whole municipalities", source: "INEGI, Census 2020" },
  mx_employed: { region: "mx", label: "Employment rate: residents in work (2020)", src: "mxageb", field: "employed", breaks: [50, 55, 60, 65],
    colors: ["#fee5d9", "#fcae91", "#c7e9c0", "#74c476", "#238b45"],
    note: "Employed residents as a share of those aged 12 and over, March 2020. Same colour scale as the US side, which counts residents aged 16 and over. Urban areas (AGEB) drawn over whole municipalities", source: "INEGI, Census 2020" },
  mx_cath: { region: "mx", label: "Religion: Catholic (2020)", src: "mxageb", field: "cath", breaks: [50, 60, 70, 80],
    colors: ["#f7f4f9", "#d4b9da", "#c994c7", "#dd1c77", "#980043"],
    note: "Share of residents who are Catholic. Urban areas (AGEB) drawn over whole municipalities", source: "INEGI, Census 2020" },
  mx_prot: { region: "mx", label: "Religion: Protestant or evangelical (2020)", src: "mxageb", field: "prot", breaks: [10, 15, 20, 25],
    colors: ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"],
    note: "Share of residents who are Protestant or evangelical. Urban areas (AGEB) drawn over whole municipalities", source: "INEGI, Census 2020" },
  mx_none: { region: "mx", label: "Religion: no religion (2020)", src: "mxageb", field: "none", breaks: [10, 15, 20, 30],
    colors: ["#f7f7f7", "#cccccc", "#969696", "#636363", "#252525"],
    note: "Share of residents with no religion. Urban areas (AGEB) drawn over whole municipalities", source: "INEGI, Census 2020" },
  mx_born: { region: "mx", label: "Migration: born in another state (2020)", src: "mxageb", field: "born", breaks: [15, 25, 35, 45],
    colors: ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"],
    note: "Share of residents born in another Mexican state. Urban areas (AGEB) drawn over whole municipalities", source: "INEGI, Census 2020" },
};
// Belfast by 2001 ward, 1971–2001, for the side-by-side maps only: one theme per indicator and census year,
// with the same colour scale in every year so that years can be compared
const WARD_YEARS = ["1971", "1981", "1991", "2001"];
const WARD_INDICATORS = {
  cath_share: { label: "Religion: Catholic share", breaks: [20, 40, 60, 80], colors: THEMES.community.colors,
    labels: ["Over 80% Protestant", "60–80% Protestant", "Mixed (40–60%)", "60–80% Catholic", "Over 80% Catholic"],
    note: "Catholics as a share of people stating Catholic or Protestant. 1981 is understated in West Belfast (census boycott)" },
  not_stated: { label: "Religion: not stated or none", breaks: [5, 10, 15, 20], colors: THEMES.no_background.colors, note: "Share of residents not stating a religion (or, in 1991 and 2001, stating none)" },
  male_unemp: { label: "Jobs: male unemployment", breaks: [10, 20, 30, 40], colors: THEMES.unemp.colors, note: "Unemployed men as a share of economically active men" },
  public_rent: { label: "Housing: renting from a public body", breaks: [10, 25, 50, 75], colors: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"], note: "Share of households renting from a public body (2001: Housing Executive only)" },
  owner: { label: "Housing: owner-occupied", breaks: [25, 40, 55, 70], colors: THEMES.prof.colors, note: "Share of households owning their home" },
  no_car: { label: "Housing: households without a car", breaks: [30, 45, 60, 75], colors: THEMES.income.colors, note: "Share of households with no car" },
  per_room: { label: "Housing: people per room", breaks: [0.5, 0.6, 0.7, 0.8], colors: THEMES.routine.colors, unit: "people per room",
    labels: ["Under 0.5", "0.5–0.6", "0.6–0.7", "0.7–0.8", "0.8 and over people per room"], note: "Residents in households divided by rooms (2001 counts kitchens, so slightly lower by definition)" },
  moved_1yr: { label: "Migration: moved home in the past year", breaks: [5, 8, 11, 15], colors: THEMES.minority.colors, note: "Share of residents who changed address in the past year (2001 also counts moves from outside the UK)" },
};
Object.entries(WARD_INDICATORS).forEach(([k, ind]) => WARD_YEARS.forEach((y) => {
  THEMES[`bw_${k}_${y}`] = { region: "ni", compareOnly: true, group: `Belfast by ward · ${ind.label}`, label: `Belfast wards, ${y} · ${ind.label}`,
    src: "bw", field: `${k}_${y}`, breaks: ind.breaks, colors: ind.colors, labels: ind.labels, unit: ind.unit, note: `${ind.note}. ${y}, 2001 ward boundaries` };
}));
// Hadrian's Wall: small areas (LSOAs, 2021 boundaries) in England within 50 km north or south of the wall line, at each census since 2001,
// with income from 2014 and crime for the latest year. Latest figures are in the layer box; earlier years only in the side-by-side maps
const HW_INDICATORS = {
  not_white: { label: "Ethnicity: residents not White", breaks: [2, 5, 10, 20], colors: THEMES.minority.colors, note: "Share of residents not of White ethnic group" },
  white_british: { label: "Ethnicity: White British", breaks: [70, 80, 90, 95], colors: ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"], note: "Share of residents who are White British (English, Welsh, Scottish, Northern Irish or British)" },
  born_abroad: { label: "Migration: born outside the UK", breaks: [3, 6, 10, 20], colors: ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"], note: "Share of residents born outside the United Kingdom" },
  christian: { label: "Religion: Christian", breaks: [40, 50, 60, 70], colors: ["#f7f4f9", "#d4b9da", "#c994c7", "#dd1c77", "#980043"], note: "Share of residents stating Christian" },
  no_religion: { label: "Religion: no religion", breaks: [15, 25, 35, 45], colors: THEMES.no_background.colors, note: "Share of residents stating no religion" },
  muslim: { label: "Religion: Muslim", breaks: [1, 3, 6, 10], colors: ["#fff5eb", "#fdd0a2", "#fd8d3c", "#d94801", "#8c2d04"], note: "Share of residents stating Muslim" },
  unemp: { label: "Jobs: unemployment rate", breaks: [3, 5, 8, 12], colors: THEMES.unemp.colors, note: "Unemployed as a share of the economically active (2001 and 2011: aged 16–74)" },
  prof: { label: "Occupations: managerial and professional", breaks: [15, 25, 35, 45], colors: THEMES.prof.colors, note: "Share of residents aged 16+ (excluding full-time students) in managerial, administrative and professional occupations (NS-SeC 1–2)" },
  owned: { label: "Housing: owner-occupied", breaks: [40, 55, 70, 85], colors: THEMES.prof.colors, note: "Share of households owning their home" },
  social_rent: { label: "Housing: social renting", breaks: [10, 20, 35, 50], colors: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"], note: "Share of households renting from a council or housing association" },
  no_car: { label: "Housing: households without a car", breaks: [15, 30, 45, 60], colors: THEMES.income.colors, note: "Share of households with no car or van" },
};
const HW_YEARS = ["2001", "2011", "2021"];
const HW_INCOME_YEARS = ["2014", "2016", "2018", "2020", "2023"];
THEMES.hw_side = { region: "hw", label: "Side of the wall", src: "hw", field: "side_n", breaks: [0.5], colors: ["#d8b365", "#5ab4ac"],
  labels: ["South of the wall", "North of the wall"], note: "Small areas in England within 50 km of the wall line, directly north or south of it (Scottish areas are in the 1 km squares, 1971–2011; areas beyond the wall's two ends are left out)" };
Object.entries(HW_INDICATORS).forEach(([k, ind]) => HW_YEARS.forEach((y) => {
  THEMES[`hw_${k}_${y}`] = { region: "hw", compareOnly: y !== "2021", group: y === "2021" ? null : `Hadrian's Wall · ${ind.label}`, label: `${ind.label} (${y})`,
    src: "hw", field: `${k}_${y}`, breaks: ind.breaks, colors: ind.colors, note: `${ind.note}. Census ${y}${y === "2021" ? "" : ", carried onto 2021 small areas"}` };
}));
HW_INCOME_YEARS.forEach((y) => {
  THEMES[`hw_income_${y}`] = { region: "hw", compareOnly: y !== "2023", group: y === "2023" ? null : "Hadrian's Wall · Income", label: `Income: household income after tax (${y === "2023" ? "2022/23" : `${Number(y) - 1}/${y.slice(2)}`})`,
    src: "hw", field: `income_${y}`, unit: "£", breaks: [25000, 30000, 35000, 40000], colors: ["#b30000", "#e34a33", "#fc8d59", "#fdcc8a", "#fef0d9"],
    labels: ["Under £25,000", "£25,000–30,000", "£30,000–35,000", "£35,000–40,000", "£40,000 and over"],
    note: "Mean net household income before housing costs, equivalised (adjusted for household size), a year, in pounds of that year (not adjusted for inflation). ONS model-based estimate for the wider area (MSOA) each small area lies in" };
});
// Hadrian's Wall, 1971–2011: 1 km grid squares within 50 km north or south of the wall (England and Scotland), from PopChange
const HWG_YEARS = ["1971", "1981", "1991", "2001", "2011"];
const HWG_INDICATORS = {
  pop: { label: "Population: residents per km²", breaks: [100, 500, 1500, 3500], colors: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"], unit: "people",
    labels: ["Under 100", "100–500", "500–1,500", "1,500–3,500", "3,500 and over per km²"], note: "Residents of the square (1971: people present on census night)" },
  born_abroad: { label: "Migration: born outside the UK", breaks: [1, 2, 4, 8], colors: HW_INDICATORS.born_abroad.colors, note: "Share of residents born outside the United Kingdom" },
  not_white: { label: "Ethnicity: residents not White", breaks: [1, 2, 5, 10], colors: THEMES.minority.colors, note: "Share of residents not of White ethnic group (first asked in 1991)", from: "1991" },
  unemp: { label: "Jobs: unemployment rate", breaks: [4, 7, 10, 15], colors: THEMES.unemp.colors, note: "Unemployed as a share of the employed and unemployed" },
  owned: { label: "Housing: owner-occupied", breaks: [30, 45, 60, 75], colors: THEMES.prof.colors, note: "Share of households owning their home" },
  overcrowded: { label: "Housing: overcrowded households", breaks: [1, 3, 6, 10], colors: THEMES.routine.colors, note: "Share of households with more than one person per room" },
  no_car: { label: "Housing: households without a car", breaks: [20, 35, 50, 65], colors: THEMES.income.colors, note: "Share of households with no car or van" },
};
Object.entries(HWG_INDICATORS).forEach(([k, ind]) => HWG_YEARS.filter((y) => !ind.from || y >= ind.from).forEach((y) => {
  THEMES[`hwg_${k}_${y}`] = { region: "hw", compareOnly: true, group: `Hadrian's Wall within 50 km, 1 km squares · ${ind.label}`, label: `1 km squares, ${y} · ${ind.label}`,
    src: "hwg", field: `${k}_${y}`, breaks: ind.breaks, colors: ind.colors, labels: ind.labels, unit: ind.unit, note: `${ind.note}. Census ${y}, England and Scotland, squares with at least 10 residents` };
}));
THEMES.hwg_side = { region: "hw", compareOnly: true, group: "Hadrian's Wall within 50 km, 1 km squares · Side of the wall", label: "1 km squares · Side of the wall (50 km)", src: "hwg", field: "side_n",
  breaks: [0.5], colors: THEMES.hw_side.colors, labels: THEMES.hw_side.labels, note: "1 km squares within 50 km of the wall line, directly north or south of it; the north side reaches into southern Scotland. Only squares with at least 10 residents at one of the censuses are drawn (5,448 squares, holding over 99% of residents); the empty areas are moors, hills and forest. Residents within 50 km, counting every square: in 2011, 537,425 north of the wall and 979,169 south of it; in 1971, 496,950 north and 973,427 south" };
THEMES.hw_crime = { region: "hw", label: "Crime: recorded crime per 1,000 residents (2025–26)", src: "hw", field: "crime_rate", unit: "per 1,000", breaks: [25, 50, 100, 200],
  colors: THEMES.crime.colors, labels: THEMES.crime.labels, note: "Crimes recorded by Northumbria, Durham and Cumbria police from October 2025 to September 2026, excluding anti-social behaviour, per 1,000 residents (Census 2021). Locations are snapped to anonymous points, and areas with shops, pubs or few residents have high rates", source: "police.uk" };
THEMES.hw_violent = { region: "hw", label: "Crime: violence and sexual offences per 1,000 residents (2025–26)", src: "hw", field: "violent_rate", unit: "per 1,000", breaks: [10, 25, 50, 100],
  colors: THEMES.violent.colors, labels: THEMES.violent.labels, note: "Violence and sexual offences recorded by the police, October 2025 to September 2026, per 1,000 residents. Same caveats", source: "police.uk" };
THEMES.hw_asb = { region: "hw", label: "Anti-social behaviour incidents per 1,000 residents (2025–26)", src: "hw", field: "asb_rate", unit: "per 1,000", breaks: [10, 25, 50, 100],
  colors: THEMES.asb.colors, labels: THEMES.asb.labels, note: "Anti-social behaviour incidents reported to the police, October 2025 to September 2026, per 1,000 residents. Same caveats", source: "police.uk" };
// Places where neighbourhood themes exist. A theme is offered only when the map shows its region
const REGIONS = {
  ni: { name: "Northern Ireland", bounds: L.latLngBounds([54.0, -8.2], [55.35, -5.4]), minZoom: 8, home: [[54.55, -6.02], [54.65, -5.86]] },
  us: { name: "US border", bounds: L.latLngBounds([25.4, -117.8], [33.4, -96.6]), minZoom: 7, home: [[31.6, -106.75], [31.95, -106.15]] },
  hw: { name: "Hadrian's Wall", bounds: L.latLngBounds([54.4, -3.8], [55.8, -1.3]), minZoom: 8, home: [[54.94, -1.78], [55.02, -1.55]] },
  mx: { name: "Mexican border", bounds: L.latLngBounds([25.4, -117.8], [33.4, -96.6]), minZoom: 7, home: [[31.6, -106.75], [31.95, -106.15]] },
};
function themeColor(th, v) {
  if (v == null) return "#cccccc";
  let i = th.breaks.findIndex((b) => v < b);
  if (i < 0) i = th.breaks.length;
  return th.colors[i];
}
function themeLabels(th) {
  if (th.labels) return th.labels;
  const b = th.breaks;
  return [`Under ${b[0]}%`, ...b.slice(0, -1).map((x, i) => `${x}–${b[i + 1]}%`), `${b[b.length - 1]}% and over`];
}
const legend = L.control({ position: "bottomleft" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "map-legend" + (SMALL_SCREEN ? " collapsed" : ""));
  div.innerHTML = `
    <button type="button" class="legend-toggle" aria-expanded="${!SMALL_SCREEN}">Legend</button>
    <div class="legend-body">
    <p class="legend-title">Construction</p>
    <div><span class="swatch concrete"></span>Concrete, stone or brick wall</div>
    <div><span class="swatch steel"></span>Steel, metal or mesh fence</div>
    <div><span class="swatch wire"></span>Barbed or razor wire</div>
    <div><span class="swatch earth"></span>Earthwork, sand berm or trench</div>
    <div><span class="swatch mixed"></span>Mixed: sections built differently</div>
    <div><span class="swatch unknown"></span>Not documented</div>
    <div><span class="swatch historical"></span>Historical, no longer a border</div>
    <p class="legend-title">Shape</p>
    <div><span class="swatch line"></span>Line: traced on the ground</div>
    <div><span class="swatch dotted"></span>Dotted: planned, under construction, or a gap between traced pieces</div>
    <div><span class="swatch dot"></span>Dot: location only, route not traced</div>
    <div><span class="swatch dot planned"></span>Hollow dot: planned, proposed or under construction</div>
    <div><span class="swatch border"></span>Dashed: official country border</div>
    <div class="legend-dep" hidden></div>
    </div>`;
  const toggle = div.querySelector(".legend-toggle");
  toggle.addEventListener("click", () => {
    const collapsed = div.classList.toggle("collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
  });
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);
  return div;
};
legend.addTo(map);

// Phones: a ☰ button on the map opens the side panel as a drawer; × or a tap on the map closes it
const panelButton = L.control({ position: "topleft" });
panelButton.onAdd = () => {
  const wrap = L.DomUtil.create("div", "leaflet-bar panel-btn-wrap");
  wrap.innerHTML = `<button type="button" class="panel-open-btn" aria-label="Open the panel: timeline, search and notes" aria-controls="panel">☰</button>`;
  L.DomEvent.disableClickPropagation(wrap);
  wrap.querySelector("button").addEventListener("click", () => document.body.classList.add("panel-open"));
  return wrap;
};
panelButton.addTo(map);
document.getElementById("panel-close").addEventListener("click", () => document.body.classList.remove("panel-open"));
map.on("click", () => document.body.classList.remove("panel-open"));

// Scale bar (metric only, as the data is in kilometres)
L.control.scale({ metric: true, imperial: false }).addTo(map);

// Overlays
const barriersLayer = L.layerGroup().addTo(map);
const bordersLayer = L.layerGroup().addTo(map);
const labelLayer = L.layerGroup().addTo(map);
// Roads, railways and rivers sit in their own pane, under the walls and borders at every zoom
map.createPane("networks");
map.getPane("networks").style.zIndex = 390;
const networkLayer = L.layerGroup().addTo(map);
loadNetwork("roads", "major", 1);
loadNetwork("railways", "major", 1);
loadNetwork("rivers", "major", 1);
map.on("zoomend", () => {
  if (map.getZoom() >= 6) loadSecondaryNetworks();
  // Roads, railways and rivers come after the borders and walls: major from zoom 5, secondary from zoom 7
  networkLayers.forEach(({ tier, layer }) => {
    const show = map.getZoom() >= (tier === 1 ? 5 : 7);
    layer.setStyle({ opacity: show ? 0.9 : 0 });
  });
});
// Neighbourhood themes around the peace walls (Belfast, Derry, Lurgan, Portadown): loaded when switched on
map.createPane("context");
map.getPane("context").style.zIndex = 370;
const themeLayers = Object.fromEntries(Object.keys(THEMES).map((k) => [k, L.layerGroup()]));
const activeThemes = {}; // one theme per region, so both sides of a border can be compared
const themeData = {};
function loadThemeData(src) {
  // Belfast wards: 2001 ward boundaries joined to the 1971–2001 ward figures, as fields such as cath_share_1971
  if (src === "hwg" && !themeData.hwg) {
    themeData.hwg = fetch("data/hadrian-grid.json").then((r) => r.json()).then((d) => ({ type: "FeatureCollection", features: d.cells.map((c) => {
      const props = { name: "1 km square" };
      d.fields.forEach((f, i) => { props[f] = c[8 + i]; });
      return { type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [[[c[0], c[1]], [c[2], c[3]], [c[4], c[5]], [c[6], c[7]], [c[0], c[1]]]] } };
    }) }));
  }
  if (src === "bw" && !themeData.bw) {
    themeData.bw = Promise.all([fetch("data/belfast-wards-1993.json").then((r) => r.json()), fetch("data/belfast-history.json").then((r) => r.json())]).then(([fc, h]) => {
      fc.features.forEach((f) => {
        const w = h.wards_2001[f.properties.ward] || {};
        f.properties.name = `${f.properties.ward} (ward)`;
        WARD_YEARS.forEach((y) => Object.keys(WARD_INDICATORS).forEach((k) => { f.properties[`${k}_${y}`] = w[y] ? w[y][k] : null; }));
      });
      return fc;
    });
  }
  if (!themeData[src]) themeData[src] = fetch({ sa: "data/ni-deprivation.json", dz: "data/ni-census-dz.json", hw: "data/hadrian-lsoa.json", us: "data/us-border-tracts.json", county: "data/us-border-counties.json", mx: "data/mx-border-municipalities.json", mxageb: "data/mx-border-ageb.json" }[src]).then((r) => r.json());
  return themeData[src];
}
const NISRA_DZ_REFS = [
  "NISRA (2023) Census 2021 Flexible Table Builder: Data Zone tables for religion or religion brought up in, economic activity, National Statistics Socio-economic Classification, ethnic group and national identity. Belfast: Northern Ireland Statistics and Research Agency. Available at: https://build.nisra.gov.uk/ (Accessed: 9 November 2026).",
  "NISRA (2023) Data Zone boundaries in GIS format. Available at: https://www.nisra.gov.uk/publications/data-zone-boundaries-gis-format (Accessed: 9 November 2026).",
];
const US_ACS_REFS = [
  "U.S. Census Bureau (2025) American Community Survey 5-year estimates 2020–2024, Data Profiles DP02, DP03 and DP05, by census tract. Census Data API. Available at: https://api.census.gov/data/2024/acs/acs5/profile (Accessed: 9 November 2026).",
  "U.S. Census Bureau (2025) 2024 cartographic boundary files: census tracts, 1:500,000. Available at: https://www2.census.gov/geo/tiger/GENZ2024/shp/ (Accessed: 9 November 2026).",
];
const MX_AGEB_REFS = [
  "INEGI (2021a) Censo de Población y Vivienda 2020: Principales resultados por AGEB y manzana urbana. Aguascalientes: Instituto Nacional de Estadística y Geografía. Available at: https://www.inegi.org.mx/programas/ccpv/2020/#datos_abiertos (Accessed: 9 November 2026).",
  "INEGI (2021b) Marco Geoestadístico. Censo de Población y Vivienda 2020. Available at: https://www.inegi.org.mx/app/biblioteca/ficha.html?upc=889463807469 (Accessed: 9 November 2026).",
];
const MX_REFS = [
  "INEGI (2021) Censo de Población y Vivienda 2020: Principales resultados por localidad (ITER). Aguascalientes: Instituto Nacional de Estadística y Geografía. Available at: https://www.inegi.org.mx/programas/ccpv/2020/#datos_abiertos (Accessed: 9 November 2026).",
  "World Bank (2012) Mexico municipalities 2012, distributed by geoBoundaries (CC BY 4.0). Available at: https://www.geoboundaries.org/ (Accessed: 9 November 2026).",
];
const US_RELIGION_REFS = [
  "Grammich, C., Dollhopf, E., Gautier, M., Houseal, R., Jones, D.E., Krindatch, A., Stanley, R. and Thumma, S. (2022) 2020 U.S. Religion Census: Religious Congregations & Adherents Study. Association of Statisticians of American Religious Bodies. Available at: https://www.usreligioncensus.org/index.php/node/1639 (Accessed: 9 November 2026).",
];
const BELFAST_WARD_REFS = [
  "Shuttleworth, I. and Lloyd, C.D. (2007) Linking Northern Ireland Census of Population Data, 1971-2001 [data collection]. UK Data Service. SN: 5672. doi:10.5255/UKDA-SN-5672-1. Used under the End User Licence; only ward totals and shares derived from it are shown.",
  "Northern Ireland Statistics and Research Agency (2004) Census 2001 Key Statistics and Migration tables, ward level. Available at: https://www.nisra.gov.uk/publications/2001-census-bulk-download-files (Accessed: 17 November 2026).",
  "Ordnance Survey of Northern Ireland (2025) OSNI Open Data – Largescale Boundaries – Wards (1993). Open Government Licence. Available at: https://www.data.gov.uk/dataset/aa140654-cbd8-45b9-82ed-4aeb05725929/osni-open-data-largescale-boundaries-wards-1993 (Accessed: 18 November 2026). Simplified to about 6 m.",
];
const POPCHANGE_REFS = [
  "Lloyd, C.D., Catney, G., Singleton, A., Williamson, P. and Bearman, N. (2018) PopChange population grids for Britain, 1971-2011 [data collection]. UK Data Service ReShare. doi:10.5255/UKDA-SN-852498. Open access.",
  "Lloyd, C.D., Catney, G., Williamson, P. and Bearman, N. (2017) 'Exploring the utility of grids for analysing long term population change', Computers, Environment and Urban Systems, 66, pp. 1–12. doi:10.1016/j.compenvurbsys.2017.07.003.",
  "Census data from the Office for National Statistics, National Records of Scotland and their predecessors (1971–2011 Small Area Statistics and key statistics), Crown copyright, Open Government Licence.",
];
const HADRIAN_REFS = [
  "Office for National Statistics (2023) Census 2021: TS001, TS004, TS021, TS030, TS045, TS054, TS062 and TS066 by lower layer super output area. Nomis. Available at: https://www.nomisweb.co.uk/ (Accessed: 18 November 2026).",
  "Office for National Statistics (2013) 2011 Census: KS101EW, KS201EW, KS204EW, KS209EW, KS402EW, KS404EW, KS601EW and KS611EW by lower layer super output area. Nomis. Available at: https://www.nomisweb.co.uk/ (Accessed: 18 November 2026).",
  "Office for National Statistics (2003) 2001 Census: KS001, KS005, KS006, KS007, KS009a, KS014a, KS017 and KS018 by lower layer super output area. Nomis. Available at: https://www.nomisweb.co.uk/ (Accessed: 18 November 2026).",
  "Office for National Statistics (2025) LSOA (2001) to LSOA (2011) and LSOA (2011) to LSOA (2021) lookups; LSOA (December 2021) boundaries EW BFE. Open Geography Portal, Open Government Licence. Available at: https://geoportal.statistics.gov.uk/ (Accessed: 18 November 2026).",
  "Office for National Statistics (2016–2025) Income estimates for small areas, England and Wales: net equivalised household income before housing costs by MSOA, financial years ending 2014, 2016, 2018, 2020 and 2023. Available at: https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/smallareaincomeestimatesformiddlelayersuperoutputareasenglandandwales (Accessed: 18 November 2026).",
  "Northumbria Police, Durham Constabulary and Cumbria Constabulary (2026) Street-level crime and anti-social behaviour, October 2025 to September 2026. data.police.uk, Open Government Licence. Available at: https://data.police.uk/ (Accessed: 18 November 2026).",
];
const POLICE_REFS = [
  "Police Service of Northern Ireland (2026) Street-level crime and anti-social behaviour, October 2025 to September 2026. data.police.uk, Open Government Licence. Available at: https://data.police.uk/docs/method/crime-street/ (Accessed: 18 November 2026). Counted by Data Zone; rates per 1,000 residents of the 2021 census.",
];
const NISRA_SA_REFS = [
  "NISRA (2017) Northern Ireland Multiple Deprivation Measure 2017: technical report. Belfast: Northern Ireland Statistics and Research Agency. Available at: https://www.nisra.gov.uk/files/nisra/publications/NIMDM%202017_Technical%20Report.pdf (Accessed: 9 November 2026).",
  "NISRA (2017) Northern Ireland Multiple Deprivation Measure 2017: Small Area level results. Belfast: Northern Ireland Statistics and Research Agency. Available at: https://www.nisra.gov.uk/publications/nimdm17-sa-level-results (Accessed: 6 November 2026).",
  "NISRA (2013) Small Area boundaries in GIS format. Available at: https://www.nisra.gov.uk/publications/small-area-boundaries-gis-format (Accessed: 6 November 2026).",
];
function areaCardHtml(p, src) {
  const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
  if (src === "hw") {
    const v = (x) => (x == null ? "–" : x);
    const rows = Object.entries(HW_INDICATORS).map(([k, ind]) => `<tr><th>${ind.label}</th>${HW_YEARS.map((y) => `<td>${v(p[`${k}_${y}`])}</td>`).join("")}</tr>`).join("");
    return `<div class="fiche">
      <div class="fiche-title">${p.name}</div>
      <dl>
        ${row("Position", `${p.side === "north" ? "North" : "South"} of Hadrian's Wall, about ${p.dist_km} km from the wall line`)}
        ${row("Residents", HW_YEARS.map((y) => `${y}: ${p[`pop_${y}`] != null ? p[`pop_${y}`].toLocaleString("en") : "–"}`).join("; "))}
        ${row("Household income after tax (equivalised, a year)", HW_INCOME_YEARS.map((y) => (p[`income_${y}`] ? `${y}: £${p[`income_${y}`].toLocaleString("en")}` : "")).filter(Boolean).join("; "))}
        ${p.crime_rate != null ? row("Crime, October 2025 to September 2026", `${p.crimes} crimes recorded (excluding anti-social behaviour): ${p.crime_rate} per 1,000 residents; violence and sexual offences ${p.violent_rate}; anti-social behaviour ${p.asb_rate} per 1,000`) : ""}
      </dl>
      <div class="hist-wrap"><table class="hist-table"><thead><tr><th>% of residents or households</th>${HW_YEARS.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="cite">2001 and 2011 figures are carried onto this 2021 area through the official lookups (areas that were later split share their parent's counts). Income is the estimate for the wider area (MSOA), in pounds of each year.</p>
      <details><summary>References (Harvard)</summary><ol class="refs">${HADRIAN_REFS.map((r) => `<li>${r}</li>`).join("")}</ol></details>
    </div>`;
  }
  const pc = (v) => (v == null ? "not available" : `${v}%`);
  const refs = (list, cite) => `<details><summary>References (Harvard)</summary><p class="cite">In-text: ${cite}</p><ol class="refs">${list.map((r) => `<li>${r}</li>`).join("")}</ol></details>`;
  if (src === "county") {
    return `<div class="fiche">
      <div class="fiche-title">${p.name}, ${p.state}</div>
      <dl>
        ${row("Population (2020)", p.pop.toLocaleString("en"))}
        ${row("Religious adherents", `${pc(p.adherents)} of residents are counted as adherents by congregations; the rest are not necessarily non-religious`)}
        ${row("Largest groups", p.top.map((t) => `${t[0]} ${t[1]}%`).join("; "))}
      </dl>
      <p class="cite">The US census does not ask about religion; this is a separate count by county.</p>
      ${refs(US_RELIGION_REFS, "(Grammich et al., 2022)")}
    </div>`;
  }
  if (src === "mxageb") {
    return `<div class="fiche">
      <div class="fiche-title">Urban area ${p.id.slice(-4)}, ${p.mun}, ${p.state}</div>
      <dl>
        ${row("Residents (2020)", p.pop.toLocaleString("en"))}
        ${row("Employment", `${pc(p.employed)} of residents aged 12+ in work; unemployment rate ${pc(p.unemp)} of the economically active`)}
        ${row("Religion", `Catholic ${pc(p.cath)}; Protestant or evangelical ${pc(p.prot)}; no religion ${pc(p.none)}`)}
        ${row("Migration and language", `Born in another Mexican state ${pc(p.born)}; speakers of an indigenous language ${pc(p.indig)}`)}
      </dl>
      <p class="cite">INEGI's urban area (AGEB) ${p.id}. Very small counts are withheld by INEGI and appear as not available. The census does not ask about income, and its unemployment measure runs lower than INEGI's labour survey (ENOE).</p>
      ${refs(MX_AGEB_REFS, "(INEGI, 2021a); (INEGI, 2021b)")}
    </div>`;
  }
  if (src === "mx") {
    return `<div class="fiche">
      <div class="fiche-title">${p.name}, ${p.state}</div>
      <dl>
        ${row("Residents (2020)", p.pop.toLocaleString("en"))}
        ${row("Employment", `${pc(p.employed)} of residents aged 12+ in work; unemployment rate ${pc(p.unemp)} of the economically active`)}
        ${row("Religion", `Catholic ${pc(p.cath)}; Protestant or evangelical ${pc(p.prot)}; no religion ${pc(p.none)}`)}
        ${row("Migration and language", `Born in another Mexican state ${pc(p.born)}; speakers of an indigenous language ${pc(p.indig)}`)}
      </dl>
      <p class="cite">Whole municipality. The census does not ask about income, and its unemployment measure runs lower than INEGI's labour survey (ENOE).</p>
      ${refs(MX_REFS, "(INEGI, 2021); (World Bank, 2012)")}
    </div>`;
  }
  if (src === "us") {
    return `<div class="fiche">
      <div class="fiche-title">${p.name}, ${p.county}, ${p.state}</div>
      <dl>
        ${row("Residents", p.pop == null ? "not available" : p.pop.toLocaleString("en"))}
        ${row("Median household income", p.income == null ? "not available" : `$${p.income.toLocaleString("en")} (2024 dollars)`)}
        ${row("Poverty", `${pc(p.poverty)} of people below the federal poverty line`)}
        ${row("Employment", `${pc(p.employed)} of residents aged 16+ in work; unemployment rate ${pc(p.unemp)} of the civilian labour force`)}
        ${row("Ethnicity", `Hispanic or Latino ${pc(p.hisp)}; White, not Hispanic ${pc(p.white)}`)}
        ${row("Migration and language", `Foreign-born ${pc(p.foreign)}; Spanish spoken at home ${pc(p.spanish)}`)}
      </dl>
      <p class="cite">American Community Survey estimates, 2020–2024 average. Religion is not asked by the US census: see the county religion theme.</p>
      ${refs(US_ACS_REFS, "(U.S. Census Bureau, 2025)")}
    </div>`;
  }
  if (src === "sa") {
    return `<div class="fiche">
      <div class="fiche-title">${p.area.replace(/_/g, " ")} · small area ${p.sa}</div>
      <dl>
        ${row("Council area", p.lgd)}
        ${row("Low income (April 2015 to March 2016)", `${p.low_income_pct}% of residents live in households below 60% of the Northern Ireland median equivalised income. The median was £24,253 a year; the low-income line is about £280 a week`)}
        ${row("Employment deprivation", `${p.emp_deprived_pct}% of working-age residents are employment deprived (out of work and claiming related benefits)`)}
        ${row("Overall rank", `${p.mdm.toLocaleString("en")} of 4,537 small areas on NISRA's multiple deprivation measure (1 = most deprived)`)}
      </dl>
      <p class="cite">Most indicators relate to 2015/16. The 2021 census figures for this area appear under the other themes.</p>
      ${refs(NISRA_SA_REFS, "(NISRA, 2017)")}
    </div>`;
  }
  return `<div class="fiche">
    <div class="fiche-title">${p.name} · Data Zone ${p.dz}</div>
    <dl>
      ${row("Council area", p.lgd)}
      ${row("Residents (2021)", p.pop.toLocaleString("en"))}
      ${row("Employment", `Unemployment rate ${pc(p.unemp)} of the economically active aged 16+; ${pc(p.employed)} of residents aged 16+ in work`)}
      ${row("Occupations", `Managerial and professional ${pc(p.prof)}; semi-routine and routine ${pc(p.routine)}; never worked or long-term unemployed ${pc(p.never)} (residents aged 16+, excluding students)`)}
      ${row("Community background", `Catholic ${pc(p.cath)}; Protestant and other Christian ${pc(p.prot)}; other religions ${pc(p.other_rel)}; none ${pc(p.none)} (religion or religion brought up in)`)}
      ${row("National identity", `British only ${pc(p.british)}; Irish only ${pc(p.irish)}; Northern Irish only ${pc(p.ni)}`)}
      ${row("Ethnic group", `Not White: ${pc(p.minority)}`)}
      ${p.crime_rate != null ? row("Crime, October 2025 to September 2026", `${p.crimes.toLocaleString("en")} crimes recorded (excluding anti-social behaviour): ${p.crime_rate} per 1,000 residents, of which violence and sexual offences ${p.violent_rate} per 1,000; anti-social behaviour ${p.asb_rate} per 1,000. Locations are approximate, and areas with shops, pubs or few residents have high rates`) : ""}
    </dl>
    ${refs([...NISRA_DZ_REFS, ...(p.crime_rate != null ? POLICE_REFS : [])], p.crime_rate != null ? "(NISRA, 2023; Police Service of Northern Ireland, 2026)" : "(NISRA, 2023)")}
  </div>`;
}
function renderThemeLegend() {
  const box = document.querySelector(".legend-dep");
  const keys = Object.values(activeThemes);
  box.hidden = !keys.length;
  box.innerHTML = keys.map((key) => {
    const th = THEMES[key];
    return `<p class="legend-title legend-theme-title">${REGIONS[th.region].name}: ${th.label}</p>
      <div class="legend-theme-rows">${themeLabels(th).map((l, i) => `<div><span class="swatch fill" style="background:${th.colors[i]}"></span>${l}</div>`).join("")}</div>
      <p class="legend-theme-note">${th.note}. Source: ${th.source || "NISRA"}.</p>`;
  }).join("");
  if (keys.length) {
    const legendBox = legend.getContainer();
    if (legendBox.classList.contains("collapsed")) legendBox.querySelector(".legend-toggle").click();
  }
}
map.on("overlayadd", (e) => {
  const key = Object.keys(themeLayers).find((k) => themeLayers[k] === e.layer);
  if (!key) return;
  // One theme at a time for each region
  Object.entries(themeLayers).forEach(([k, l]) => { if (k !== key && THEMES[k].region === THEMES[key].region && map.hasLayer(l)) map.removeLayer(l); });
  // Leaflet does not redraw its checkboxes while it is handling a click, so refresh them just after
  setTimeout(() => layerControl._update && layerControl._update(), 0);
  activeThemes[THEMES[key].region] = key;
  renderThemeLegend();
  const th = THEMES[key];
  if (e.layer.getLayers().length) return;
  const draw = (src, opacity) => loadThemeData(src).then((fc) => {
    L.geoJSON(fc, {
      pane: "context",
      style: (f) => ({ fillColor: themeColor(th, f.properties[th.field]), fillOpacity: opacity, color: "#ffffff", weight: 0.4, opacity: 0.7 }),
      onEachFeature: (f, lyr) => lyr.on("click", (ev) => {
        L.DomEvent.stopPropagation(ev);
        showInfoCard(areaCardHtml(f.properties, src));
      }),
    }).addTo(e.layer);
  });
  // Mexico: whole municipalities first, so rural areas are covered, then the finer urban areas on top
  if (th.src === "mxageb") draw("mx", 0.4).then(() => draw("mxageb", 0.75));
  else draw(th.src, 0.65);
});
map.on("overlayremove", (e) => {
  const key = Object.keys(themeLayers).find((k) => themeLayers[k] === e.layer);
  if (key && activeThemes[THEMES[key].region] === key) { delete activeThemes[THEMES[key].region]; renderThemeLegend(); }
});

const layerControl = L.control.layers(baseLayers, {
  "Border barriers": barriersLayer,
  "Country borders": bordersLayer,
  "Roads, railways and rivers": networkLayer,
  "Place names": labelLayer,
}, { collapsed: false }).addTo(map);

// Israeli settlements and outposts in the occupied West Bank and East Jerusalem (OCHA, from Peace Now data),
// the former settlements of the Gaza Strip (evacuated in 2005) and the settlements of the occupied Syrian Golan Heights.
// Offered in the layer box when the map shows the area, like the neighbourhood themes; filtered by the year slider.
const SETTLEMENT_COLOR = "#7a4b1e";
const settlementLayer = L.layerGroup();
let settlements = [];
const SETTLEMENT_AREA = L.latLngBounds([29.4, 34.1], [33.5, 36.1]);
let settlementsOffered = false;
const SETTLEMENT_LABEL = `<span class="swatch dot settlement"></span>Israeli settlements <span class="swatch dot settlement outpost"></span>and outposts, illegal under international law`;
const SETTLEMENT_LAW = "illegal under international law (UN Security Council Resolution 2334, 2016; International Court of Justice advisory opinion, 2024)";
const SETTLEMENT_STATUS = {
  westbank: `In the occupied West Bank. Israeli settlements in the occupied Palestinian territory are ${SETTLEMENT_LAW}.`,
  eastjerusalem: `In occupied East Jerusalem. These settlements are illegal colonies under international law: the UN Security Council declared Israel's annexation of the city null and void (Resolution 478, 1980), and Resolution 2334 (2016) and the International Court of Justice (2024) confirmed that settlements there are illegal.`,
  gaza: `In the occupied Gaza Strip, ${SETTLEMENT_LAW}. Israel evacuated and demolished all its Gaza settlements in August and September 2005.`,
  golan: "In the occupied Syrian Golan Heights. The UN Security Council declared Israel's 1981 annexation null and void (Resolution 497, 1981), and settlements in occupied territory breach the Fourth Geneva Convention.",
};
const SETTLEMENT_TYPE = {
  settlement: "Settlement",
  outpost: "Outpost: built without the Israeli government's authorisation (OCHA, 2019). Like the settlements, outposts are illegal under international law.",
  "industrial park": "Settlement industrial zone",
};
const SETTLEMENT_REF = {
  ocha: `<li>OCHA occupied Palestinian territory (2019) West Bank Atlas 2019: Israeli settlements index. Data source: Peace Now. Available at: https://www.ochaopt.org/atlas2019/images/db/israeli-settlements-checkpoints/israeli-settlments.pdf (Accessed: 11 November 2026).</li>
  <li>OCHA occupied Palestinian territory (2019) West Bank Atlas 2019: West Bank access and closure maps. Available at: https://www.ochaopt.org/atlas2019/wbclosure.html (Accessed: 11 November 2026).</li>
  <li>Peace Now and OCHA occupied Palestinian territory (2018) State of Palestine settlements [shapefile]. Humanitarian Data Exchange, CC BY-IGO. Available at: https://data.humdata.org/dataset/state-of-palestine-settlements (Accessed: 11 November 2026).</li>`,
  cbs: `<li>Central Bureau of Statistics (Israel) (2025) List of localities, bycode2024. Available at: https://www.cbs.gov.il/he/publications/doclib/2019/ishuvim/bycode2024.xlsx (Accessed: 11 November 2026). Coordinates converted from the Israeli Transverse Mercator grid.</li>`,
  gaza: `<li>Wikipedia (2026) Gush Katif: Demographics. Available at: https://en.wikipedia.org/wiki/Gush_Katif (Accessed: 11 November 2026). Founding dates from the Settlement Division of the World Zionist Organization; populations from the Central Bureau of Statistics (Israel), List of localities, 31 December 2000.</li>
  <li>Wikidata (2026) Coordinates of the former Gaza settlements. Available at: https://www.wikidata.org (Accessed: 11 November 2026).</li>`,
  law: `<li>United Nations Security Council (2016) Resolution 2334 (S/RES/2334). Available at: https://undocs.org/S/RES/2334(2016) (Accessed: 11 November 2026).</li>
  <li>International Court of Justice (2024) Legal Consequences arising from the Policies and Practices of Israel in the Occupied Palestinian Territory, including East Jerusalem: Advisory Opinion of 19 July 2024. Available at: https://www.icj-cij.org/case/186 (Accessed: 11 November 2026).</li>`,
  jlm: `<li>United Nations Security Council (1980) Resolution 478 (S/RES/478). Available at: https://undocs.org/S/RES/478(1980) (Accessed: 11 November 2026).</li>`,
  golan: `<li>United Nations Security Council (1981) Resolution 497 (S/RES/497). Available at: https://undocs.org/S/RES/497(1981) (Accessed: 11 November 2026).</li>`,
};
const settlementSource = (s) => (s.area === "gaza" ? "gaza" : s.area === "golan" || s.src === "cbs" ? "cbs" : "ocha");
function settlementCardHtml(s) {
  const row = (label, value) => (value ? `<dt>${label}</dt><dd>${value}</dd>` : "");
  const src = settlementSource(s);
  const popNote = { ocha: "OCHA atlas, 2019", cbs: "end of 2024", gaza: "end of 2000" }[src];
  const refs = [SETTLEMENT_REF[src], s.area === "golan" ? SETTLEMENT_REF.golan : SETTLEMENT_REF.law, s.area === "eastjerusalem" ? SETTLEMENT_REF.jlm : ""].join("");
  return `<div class="fiche">
    <div class="fiche-title">${s.name}${s.removed ? " (former)" : ""}</div>
    <dl>
      ${row("Type", SETTLEMENT_TYPE[s.type] || "Settlement")}
      ${row("Status", SETTLEMENT_STATUS[s.area])}
      ${row("Name in Hebrew", s.he)}
      ${row("Governorate", s.gov)}
      ${row("Founded", s.founded || "Not given in the source")}
      ${row("Evacuated", s.removed)}
      ${row("Population", s.pop ? `${Number(s.pop).toLocaleString("en")} (${popNote})` : s.type === "outpost" ? "Not given for outposts" : "Not given in the source")}
      ${row("Location", s.approx ? "Approximate: placed from its label on OCHA's atlas maps, usually within about 500 m" : "")}
    </dl>
    ${src === "ocha" ? `<p class="fiche-text">From OCHA's 2019 atlas, which uses Peace Now's data. Outposts and settlements founded after 2019 are not in it; three later settlements recognised by Israel's statistics bureau are added from its list. Sixteen small outposts and East Jerusalem compounds in OCHA's index could not be placed precisely and are left out.</p>` : ""}
    <details>
      <summary>References (Harvard)</summary>
      <ol class="refs">${refs}</ol>
    </details>
  </div>`;
}
fetch("data/israeli-settlements.json")
  .then((r) => r.json())
  .then((d) => {
    settlements = d.settlements.map((s) => {
      const outpost = s.type === "outpost";
      const radius = outpost ? 3 : s.pop ? Math.max(3, Math.min(9, Math.sqrt(s.pop) / 30)) : 3.5;
      const m = outpost
        ? L.circleMarker([s.lat, s.lon], { radius, color: SETTLEMENT_COLOR, weight: 2, fillColor: "#fff", fillOpacity: 0.9 })
        : L.circleMarker([s.lat, s.lon], { radius, color: "#fff", weight: 1, fillColor: SETTLEMENT_COLOR, fillOpacity: 0.9 });
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (!compareFrom) showInfoCard(settlementCardHtml(s), "settlement-card");
      });
      return { s, m };
    });
    refreshSettlements();
    updateSettlementOption();
  })
  .catch(() => {});
function refreshSettlements() {
  const year = Number(yearInput.value);
  settlements.forEach(({ s, m }) => {
    const show = (s.founded ? s.founded <= year : year === Number(yearInput.max)) && !(s.removed && year >= s.removed);
    if (show && !settlementLayer.hasLayer(m)) settlementLayer.addLayer(m);
    else if (!show && settlementLayer.hasLayer(m)) settlementLayer.removeLayer(m);
  });
}
function updateSettlementOption() {
  const show = map.getZoom() >= 7 && SETTLEMENT_AREA.contains(map.getCenter());
  if (show === settlementsOffered) return;
  settlementsOffered = show;
  if (show) layerControl.addOverlay(settlementLayer, SETTLEMENT_LABEL);
  else {
    if (map.hasLayer(settlementLayer)) map.removeLayer(settlementLayer);
    layerControl.removeLayer(settlementLayer);
  }
}
map.on("moveend", updateSettlementOption);

// Neighbourhood themes are offered only when the map shows their region;
// moving away removes the options and switches any theme off
const offered = {};
const regionShown = (r) => map.getZoom() >= REGIONS[r].minZoom && REGIONS[r].bounds.contains(map.getCenter());
function updateThemeOptions() {
  Object.keys(REGIONS).forEach((r) => {
    const show = regionShown(r);
    if (show === !!offered[r]) return;
    offered[r] = show;
    Object.entries(THEMES).filter(([, th]) => th.region === r && !th.compareOnly).forEach(([k, th]) => {
      if (show) layerControl.addOverlay(themeLayers[k], `${REGIONS[r].name} · ${th.label}`);
      else {
        if (map.hasLayer(themeLayers[k])) map.removeLayer(themeLayers[k]);
        layerControl.removeLayer(themeLayers[k]);
      }
    });
  });
  fitInfoCard();
}
map.on("moveend", updateThemeOptions);
// Ticking a theme unticks the other themes of its region before Leaflet reads the boxes, whatever their order in the list
layerControl.getContainer().addEventListener("click", (e) => {
  const input = e.target;
  if (input.type !== "checkbox" || input.layerId == null || !input.checked) return;
  const keyOf = (el) => Object.keys(themeLayers).find((k) => themeLayers[k] === layerControl._getLayer(el.layerId).layer);
  const key = keyOf(input);
  if (!key) return;
  layerControl.getContainer().querySelectorAll("input[type=checkbox]").forEach((other) => {
    if (other === input || other.layerId == null) return;
    const k = keyOf(other);
    if (k && THEMES[k].region === THEMES[key].region) other.checked = false;
  });
}, true);

// The layer box folds into a small "Layers" button, like the legend (folded by default on phones)
{
  const box = layerControl.getContainer();
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "legend-toggle layers-toggle";
  btn.textContent = "Layers";
  box.insertBefore(btn, box.firstChild);
  const setFolded = (folded) => {
    box.classList.toggle("folded", folded);
    btn.setAttribute("aria-expanded", String(!folded));
    fitInfoCard();
  };
  btn.addEventListener("click", () => setFolded(!box.classList.contains("folded")));
  setTimeout(() => setFolded(SMALL_SCREEN), 0);
}

// Information card: the fact sheet of a barrier or city, docked under the layer box (top right).
// It stays in place when the map is dragged or zoomed; long content scrolls inside the card.
const infoCard = L.control({ position: "topright" });
let infoBody = null;
infoCard.onAdd = () => {
  const div = L.DomUtil.create("div", "info-card");
  div.hidden = true;
  div.setAttribute("role", "dialog");
  div.setAttribute("aria-label", "Details");
  div.innerHTML = `<button type="button" class="info-close" aria-label="Close the details">×</button><div class="info-body"></div>`;
  infoBody = div.querySelector(".info-body");
  div.querySelector(".info-close").addEventListener("click", closeInfoCard);
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);
  return div;
};
infoCard.addTo(map);
// Theme picker inside a wall or city card: show a neighbourhood theme, going to Belfast first if needed
infoBody.addEventListener("change", (e) => {
  if (e.target.classList.contains("b7101-select")) {
    const box = e.target.closest("details");
    box.querySelector(".b7101-table").innerHTML = belfast7101Table(e.target.value);
    return;
  }
  if (!e.target.classList.contains("theme-select")) return;
  const key = e.target.value;
  if (!key) {
    const current = activeThemes[e.target.dataset.region];
    if (current) map.removeLayer(themeLayers[current]);
    return;
  }
  const r = THEMES[key].region;
  if (offered[r]) {
    map.addLayer(themeLayers[key]);
  } else {
    map.once("moveend", () => map.addLayer(themeLayers[key]));
    // Already over the region: just zoom in; otherwise go to its main urban area
    if (REGIONS[r].bounds.contains(map.getCenter())) map.setZoom(REGIONS[r].minZoom);
    else map.fitBounds(REGIONS[r].home);
  }
});

function fitInfoCard() {
  const card = infoCard.getContainer();
  if (!card || card.hidden) return;
  const mapBox = map.getContainer().getBoundingClientRect();
  const cardTop = card.getBoundingClientRect().top;
  // From the card's top to the bottom of the map frame, less a margin
  card.style.maxHeight = Math.max(160, mapBox.bottom - cardTop - 12) + "px";
  // Never wider than the map frame (a comparison of four cities is wide)
  card.style.maxWidth = Math.max(240, mapBox.width - 24) + "px";
}
function showInfoCard(html, extraClass) {
  const card = infoCard.getContainer();
  compareFrom = null;
  infoBody.innerHTML = html;
  card.className = "info-card leaflet-control" + (extraClass ? " " + extraClass : "");
  card.hidden = false;
  fitInfoCard();
  infoBody.scrollTop = 0;
}
function closeInfoCard() {
  infoCard.getContainer().hidden = true;
  compareFrom = null;
}
window.addEventListener("resize", fitInfoCard);
// Opening or closing a section changes nothing in the card's frame; the content scrolls
// While a second city is being chosen, a click on empty map keeps the card open
map.on("click", () => {
  if (!compareFrom) closeInfoCard();
});

// Place names: English, with the native name where known. More appear as you zoom in.
const nativeNames = document.getElementById("native-names");
let labelData = null;
fetch("data/labels-countries.json")
  .then((r) => r.json())
  .then((countries) => {
    fetch("data/labels-places.json")
      .then((r) => r.json())
      .then((places) => {
        fetch("data/labels-natural.json")
          .then((r) => r.json())
          .then((natural) => {
            labelData = { countries, places, natural, census: {}, profiles: {} };
            fetch("data/country-profiles.json").then((r) => r.json()).then((p) => { labelData.profiles = p; }).catch(() => {});
            fetch("data/city-census.json")
              .then((r) => r.json())
              .then((census) => {
                labelData.census = census;
                renderLabels();
              })
              .catch(() => renderLabels());
          });
      });
  });

function labelIcon(en, native, kind) {
  // English sits just above the native name, in a smaller, more transparent style.
  // Native names are shown only when the switch is on and they differ from the English name.
  const showSub = nativeNames.checked && native && native.toLowerCase() !== en.toLowerCase();
  const sub = showSub ? `<small>${native}</small>` : "";
  return L.divIcon({ className: `map-label ${kind}`, html: `<span class="label-inner"><span class="label-en">${en}</span>${sub}</span>`, iconSize: null });
}

const NATIONAL_REFS = `<li>International Labour Organization, UNODC and UN DESA, via World Bank (2026) World Development Indicators. Available at: https://data.worldbank.org/ (Accessed: 10 November 2026).</li>
        <li>UNHCR (2026) Refugee Data Finder. Available at: https://www.unhcr.org/refugee-statistics/ (Accessed: 10 November 2026).</li>
        <li>Central Intelligence Agency (2026) The World Factbook, via factbook.json. Available at: https://github.com/factbook/factbook.json (Accessed: 10 November 2026).</li>`;

// National context on a city card: always labelled, never presented as figures for the city
function nationalRows(country) {
  const p = labelData.profiles[country];
  if (!p) return [];
  const n = (v) => Number(v).toLocaleString("en");
  const item = (label, key, show) => (p[key] ? [[label, `${show(p[key][0])} (${p[key][1]})`]] : []);
  const text = (label, key) => (p[key] ? [[label, p[key]]] : []);
  return [
    ...item("Population", "pop", n),
    ...item("GDP per person", "gdp", (v) => `US$${n(Math.round(v))}`),
    ...item("GDP per person, purchasing power", "ppp", (v) => `$${n(Math.round(v))}`),
    ...item("Unemployment", "unemp", (v) => `${v}% of the labour force`),
    ...item("Employed", "emp", (v) => `${v}% of people aged 15+`),
    ...item("Income inequality (Gini)", "gini", (v) => v),
    ...item("Homicide", "hom", (v) => `${v} per 100,000 people`),
    ...item("Born abroad", "migr", (v) => `${v}% of residents`),
    ...item("Net migration", "net", (v) => `${v > 0 ? "+" : ""}${n(v)} people`),
    ...item("Refugees hosted", "refugees", n),
    ...item("Asylum seekers", "asylum", n),
    ...text("Ethnic groups", "ethnic"),
    ...text("Religions", "religion"),
    ...text("Languages", "language"),
  ];
}
function nationalHtml(country) {
  const rows = nationalRows(country);
  if (!rows.length) return "";
  return `<details>
      <summary>National figures: ${country} (not specific to this city)</summary>
      <dl>${rows.map(([l, v]) => `<dt>${l}</dt><dd>${v}</dd>`).join("")}</dl>
    </details>`;
}

// Country card: click a country's name on the map
const COUNTRY_REFS = {
  wb: "World Bank (2026) World Development Indicators, including ILO employment estimates and UNODC homicide data. Available at: https://data.worldbank.org/ (Accessed: 11 November 2026).",
  pip: "World Bank (2026) Poverty and Inequality Platform: median daily income or consumption per person, latest national survey. Available at: https://pip.worldbank.org/ (Accessed: 11 November 2026).",
  un: "United Nations, Department of Economic and Social Affairs, Population Division (2025) International Migrant Stock 2024: destination and origin. Available at: https://www.un.org/development/desa/pd/content/international-migrant-stock (Accessed: 11 November 2026).",
  unhcr: "UNHCR (2026) Refugee Data Finder. Available at: https://www.unhcr.org/refugee-statistics/ (Accessed: 11 November 2026).",
  fb: "Central Intelligence Agency (2026) The World Factbook, via factbook.json. Available at: https://github.com/factbook/factbook.json (Accessed: 11 November 2026).",
  es: "Eurostat (2026) Immigration and emigration by citizenship (migr_imm1ctz, migr_emi1ctz), population by citizenship (migr_pop1ctz) and police-recorded offences (crim_off_cat). Available at: https://ec.europa.eu/eurostat/web/migration-asylum (Accessed: 11 November 2026).",
  rec: "Wikipedia (n.d.) List of states with limited recognition. Available at: https://en.wikipedia.org/wiki/List_of_states_with_limited_recognition (Accessed: 11 November 2026).",
  trnc: "Wikipedia (n.d.) Northern Cyprus, citing the TRNC Statistical Institute for population (2021) and GDP (2018). Available at: https://en.wikipedia.org/wiki/Northern_Cyprus (Accessed: 11 November 2026); Devlet Planlama Örgütü (2013) KKTC Nüfus Sayımı 2011: kesin sonuçlar, ikinci aşama (archived).",
};
function countryCardHtml(en) {
  const p = labelData.profiles[en] || {};
  const n = (v) => Number(v).toLocaleString("en");
  const money = (v) => (v >= 1e12 ? `US$${(v / 1e12).toFixed(2)} trillion` : v >= 1e9 ? `US$${(v / 1e9).toFixed(1)} billion` : `US$${n(Math.round(v))}`);
  const row = (label, value) => (value ? `<dt>${label}</dt><dd>${value}</dd>` : "");
  const yr = (pair, show) => (pair ? `${show(pair[0])} (${pair[1]})` : "");
  const fold = (title, rows) => (rows.trim() ? `<details><summary>${title}</summary><dl>${rows}</dl></details>` : "");
  const list = (pairs) => pairs.map(([k, v]) => `${k} ${n(v)}`).join(", ");
  const life = p.lifeM || p.lifeF ? `Men ${p.lifeM ? p.lifeM[0].toFixed(1) : "?"} years, women ${p.lifeF ? p.lifeF[0].toFixed(1) : "?"} years (${(p.lifeM || p.lifeF)[1]})` : "";
  const crime = p.euCrime
    ? `Police-recorded offences per 100,000 people, ${p.euCrime[1]}: intentional homicide ${p.euCrime[0].ICCS0101 ?? "n/a"}, robbery ${p.euCrime[0].ICCS0401 ?? "n/a"}, burglary ${p.euCrime[0].ICCS0501 ?? "n/a"}, burglary of homes ${p.euCrime[0].ICCS0502 ?? "n/a"}.`
    : "";
  const sectors = p.agr || p.ind || p.srv ? `Agriculture ${p.agr ? p.agr[0].toFixed(1) : "?"}%, industry ${p.ind ? p.ind[0].toFixed(1) : "?"}%, services ${p.srv ? p.srv[0].toFixed(1) : "?"}% of GDP (${(p.agr || p.ind || p.srv)[1]})` : "";
  // Profiles with their own sources (regions not covered by the international datasets) list only those
  const refs = p.refs || [COUNTRY_REFS.wb, p.median ? COUNTRY_REFS.pip : "", COUNTRY_REFS.un, COUNTRY_REFS.unhcr, COUNTRY_REFS.fb, p.euImm || p.euForeign || p.euCrime ? COUNTRY_REFS.es : "", p.status ? COUNTRY_REFS.rec : "", p.source === "trnc" ? COUNTRY_REFS.trnc : ""].filter(Boolean);
  return `<div class="fiche country-fiche">
    <div class="fiche-title">${en}</div>
    <dl>
      ${row("Country", p.official || en)}
      ${row("Status", p.status)}
    </dl>
    ${fold("Population", `
      ${row("Inhabitants", yr(p.pop, n))}
      ${row("Where people live", p.popNote)}
      ${row("Life expectancy at birth", life)}
      ${row("Ethnic groups", p.ethnic)}
      ${row("Religion", p.religion)}
      ${row("Languages", p.languages)}
      ${row("Born abroad", yr(p.migr, (v) => `${v}% of residents`))}
      ${row("Foreign citizens", yr(p.euForeign, (v) => `${v}% of residents`))}
      ${row("Immigrants living here", p.immTot ? `${n(p.immTot)} in 2024; mainly from ${list(p.immTop)}` : "")}
      ${row("Emigrants living abroad", p.emiTot ? `${n(p.emiTot)} in 2024; mainly in ${list(p.emiTop)}` : "")}
      ${row("Immigration in the year", yr(p.euImm, n))}
      ${row("Emigration in the year", yr(p.euEmi, n))}
      ${row("Net migration", yr(p.net, (v) => `${v > 0 ? "+" : ""}${n(v)} people`))}
      ${row("Refugees hosted", yr(p.refugees, n))}
      ${row("Asylum seekers", yr(p.asylum, n))}`)}
    ${fold("Surface", `
      ${row("Area", p.area || (p.areaKm ? `${n(p.areaKm[0])} sq km` : ""))}
      ${row("Note", p.areaNote)}`)}
    ${fold("Economy", `
      ${row("GDP", yr(p.gdpTot, money) + (p.gdpNote ? `. ${p.gdpNote}` : ""))}
      ${row("GDP per person", yr(p.gdp, (v) => `US$${n(Math.round(v))}`) + (p.gdp && euroNow(p.gdp[0], "USD", p.gdp[1]) ? `; ${euroNow(p.gdp[0], "USD", p.gdp[1])}` : ""))}
      ${row("GDP per person, purchasing power", yr(p.ppp, (v) => `$${n(Math.round(v))}`))}
      ${row("Median income or consumption", p.median ? `$${p.median[0]} a day per person, ${p.median[2]} survey, in 2021 purchasing-power dollars (${p.median[1]})` : "")}
      ${row("Living below half the median income", yr(p.relpov, (v) => `${v}% of people`))}
      ${row("Poverty", p.poverty)}
      ${row("Employed", yr(p.emp, (v) => `${v}% of people aged 15+`))}
      ${row("Unemployment", yr(p.unemp, (v) => `${v}% of the labour force`))}
      ${row("Income inequality (Gini)", yr(p.gini, (v) => v))}
      ${row("Sectors", sectors)}
      ${row("Main industries", p.industries)}`)}
    ${fold("Criminality", `
      ${row("Homicide", yr(p.hom, (v) => `${v} per 100,000 people`))}
      ${row("Recorded offences", crime)}
      ${row("Note", p.crimeNote)}`)}
    <details>
      <summary>References (Harvard)</summary>
      <ol class="refs">${refs.map((r) => `<li>${r}</li>`).join("")}</ol>
    </details>
  </div>`;
}

// City popup: population and census details, from data/city-census.json where available
const NOT_FOUND = "Not found yet in the sources checked so far; see the national figures below.";
const GAZETTEER_REFS = [
  "GeoNames (n.d.) GeoNames gazetteer, cities with population above 15,000. Available at: https://download.geonames.org/export/dump/ (Accessed: 6 November 2026).",
  "Natural Earth (n.d.) Populated places and urban areas, 10m. Available at: https://www.naturalearthdata.com/ (Accessed: 6 November 2026).",
];
// Euro equivalents of non-euro incomes: converted at the average exchange rate of the figure's own year,
// then brought to the latest month of euro-area HICP (the same month as the wall costs)
let fxData = null;
let priceNow = null;
fetch("data/fx-eur.json").then((r) => r.json()).then((d) => { fxData = d; }).catch(() => {});
fetch("data/price-index.json").then((r) => r.json()).then((d) => { priceNow = { month: d.month, eur: d.history[d.month].eur }; }).catch(() => {});
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function euroNow(amount, cur, year) {
  if (!fxData || !priceNow) return "";
  const rates = fxData.per_eur[cur];
  const y = String(year);
  if (!rates || !rates[y] || !fxData.hicp[y]) return "";
  const v = (amount / rates[y]) * (priceNow.eur / fxData.hicp[y]);
  const step = v < 1000 ? 1 : v < 10000 ? 10 : v < 100000 ? 100 : 1000;
  const [py, pm] = priceNow.month.split("-");
  return `≈ €${(Math.round(v / step) * step).toLocaleString("en")} in ${MONTH_NAMES[Number(pm) - 1]} ${py} prices`;
}
// Insert the euro equivalent after each listed amount: inside its bracket when one follows (unless the bracket holds a national comparison)
function withEuro(text, fx) {
  if (!text || !fx) return text;
  let out = text;
  let from = 0;
  for (const [s, cur, year] of fx) {
    const i = out.indexOf(s, from);
    if (i < 0) continue;
    const amount = Number(s.replace(/[^\d.]/g, ""));
    const note = euroNow(amount, cur, year);
    let end = i + s.length;
    if (!note) { from = end; continue; }
    const br = out.slice(end).match(/^ \(([^()]*)\)/);
    if (br && !/national/i.test(br[1])) {
      const close = end + br[0].length - 1;
      out = `${out.slice(0, close)}; ${note}${out.slice(close)}`;
      from = close + note.length + 2;
    } else {
      out = `${out.slice(0, end)} (${note})${out.slice(end)}`;
      from = end + note.length + 3;
    }
  }
  return out;
}

// What a city card and the comparison both show
function cityFields(en, meta) {
  const census = (labelData && labelData.census) || {};
  // Records with coordinates only apply to the city of that name within 60 km (several places share a name);
  // a namesake in another country keeps its own record under "Name, Country"
  const near = (r) => r && (r.lat == null || Math.hypot((r.lon - meta.lon) * Math.cos((meta.lat * Math.PI) / 180), r.lat - meta.lat) * 111 <= 60);
  let c = [census[en], census[`${en}, ${meta.country}`]].find(near) || null;
  const pop = meta.pop ? `${Number(meta.pop).toLocaleString("en")} (GeoNames or Natural Earth estimate)` : "Not documented";
  // The census row falls back on the gazetteer estimate; a pre-war warning stays with the figure it qualifies
  const censusValue = c && c.population
    ? `${c.census_year}: ${Number(c.population).toLocaleString("en")}${c.area_note ? ` (${c.area_note})` : ""}`
    : `No census figure found yet. Estimate: ${pop}`;
  return {
    c,
    country: (c && c.country_note) || meta.country || "Not documented",
    census: `${censusValue}${c && c.pre_war ? `<br>${c.pre_war}` : ""}`,
    density: meta.density ? `${Number(meta.density).toLocaleString("en")} per km² (built-up area of ${Number(meta.area_km2).toLocaleString("en")} km²; Natural Earth urban areas)` : "Not available (no built-up area matched to this city)",
    ethnic: (c && c.ethnic) || NOT_FOUND,
    language: (c && c.language) || NOT_FOUND,
    religion: (c && c.religion) || NOT_FOUND,
    economy: (c && withEuro(c.economy, c.fx)) || "",
    crime: (c && c.crime) || NOT_FOUND,
    cite: (c && c.cite) || "",
    refs: [...GAZETTEER_REFS, ...((c && c.sources) || [])],
  };
}

function cityPopupHtml(en, meta) {
  const f = cityFields(en, meta);
  const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
  const fold = (title, content) => `<details>
      <summary>${title}</summary>
      <div class="fiche-text">${content}</div>
    </details>`;
  const region = cityRegion(meta);
  const income = `${f.economy || (region ? "" : NOT_FOUND)}${region ? themePickerHtml([region]) : ""}${["us", "mx"].includes(region) && window.borderTimelineHtml ? window.borderTimelineHtml() : ""}`;
  return `<div class="fiche city-fiche">
    <div class="fiche-title">${en}</div>
    <div class="compare-actions">
      <button type="button" class="compare-btn" data-compare>Compare with another city</button>
      ${region ? `<button type="button" class="compare-btn compare-maps-btn" data-layer-compare="${region}">Compare neighbourhood maps side by side</button>` : ""}
    </div>
    <dl>
      ${row("Country", f.country)}
      ${row("Latest census", f.census)}
      ${row("Population density", f.density)}
    </dl>
    ${fold("Ethnic / national groups", f.ethnic)}
    ${fold("Languages", f.language)}
    ${fold("Religion", f.religion)}
    ${fold("Income and employment", income)}
    ${fold("Criminality", f.crime)}
    ${en === "Belfast" ? belfastHistoryHtml() + belfast7101Html() : ""}
    ${region === "ni" ? niJobsHtml(en === "Belfast") : ""}
    ${nationalHtml(meta.country)}
    <details>
      <summary>References (Harvard)</summary>
      <p class="cite">In-text: (GeoNames, n.d.; Natural Earth, n.d.)${f.cite ? "; " + f.cite : ""}</p>
      <ol class="refs">
        ${f.refs.map((r) => `<li>${r}</li>`).join("")}
        ${labelData.profiles[meta.country] ? NATIONAL_REFS : ""}
      </ol>
    </details>
  </div>`;
}

// Comparing cities (2 to 4): from a city card, type a name or click a city on the map
const MAX_COMPARE = 4;
let currentCity = null;
let currentComparison = null; // the cities shown side by side
let compareFrom = null; // the cities already chosen, while the visitor is choosing the next one
const sameCity = (a, b) => a.en === b.en && a.meta.lat === b.meta.lat;
function showCity(city) {
  showInfoCard(cityPopupHtml(city.en, city.meta), "city-card");
  currentCity = city;
  currentComparison = null;
}
function showComparePicker(chosen) {
  const names = chosen.map((c) => c.en);
  const title = names.length === 1 ? `Compare ${names[0]} with…` : `Add a city to ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  showInfoCard(`<div class="fiche">
    <div class="fiche-title">${title}</div>
    <p class="fiche-text">Type a city's name, or click a city on the map. Up to ${MAX_COMPARE} cities can be compared.</p>
    <input id="compare-input" class="compare-input" type="search" placeholder="City name" aria-label="City to compare with" autocomplete="off">
    <ul id="compare-list" class="compare-list"></ul>
    <button type="button" class="compare-btn" data-compare-back>${chosen.length > 1 ? "Back to the comparison" : `Back to ${names[0]}`}</button>
  </div>`, "city-card");
  compareFrom = chosen;
  currentCity = chosen[0];
  currentComparison = chosen.length > 1 ? chosen : null;
  infoBody.querySelector("#compare-input").focus();
}
const plainName = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function listCompareMatches(text) {
  const q = plainName(text.trim());
  const list = infoBody.querySelector("#compare-list");
  if (!list) return;
  if (!q) { list.innerHTML = ""; return; }
  const found = [];
  labelData.places.forEach((p, i) => {
    const name = plainName(p.en);
    if (name.includes(q) && !compareFrom.some((c) => sameCity(c, { en: p.en, meta: p }))) found.push({ p, i, starts: name.startsWith(q) });
  });
  found.sort((a, b) => b.starts - a.starts || (b.p.pop || 0) - (a.p.pop || 0));
  list.innerHTML = found.length
    ? found.slice(0, 8).map(({ p, i }) => `<li><button type="button" data-pick="${i}">${p.en}<small>${p.country || ""}</small></button></li>`).join("")
    : "<li class=\"compare-none\">No city of that name on the map</li>";
}
function comparisonHtml(cities) {
  const fs = cities.map((c) => cityFields(c.en, c.meta));
  const cols = (xs) => `<div class="cmp-pair" style="grid-template-columns: repeat(${xs.length}, minmax(0, 1fr))">${xs.map((x) => `<div>${x}</div>`).join("")}</div>`;
  const row = (label, key) => `<dt>${label}</dt><dd>${cols(fs.map((f) => f[key]))}</dd>`;
  const fold = (title, xs) => `<details>
      <summary>${title}</summary>
      <div class="fiche-text">${cols(xs)}</div>
    </details>`;
  const nat = cities.map((c) => nationalRows(c.meta.country));
  const labels = [...new Set(nat.flat().map(([l]) => l))];
  const val = (rows, l) => (rows.find(([k]) => k === l) || [, "Not available"])[1];
  const national = labels.length
    ? `<details>
      <summary>National figures (not specific to these cities)</summary>
      <dl>${labels.map((l) => `<dt>${l}</dt><dd>${cols(nat.map((rows) => val(rows, l)))}</dd>`).join("")}</dl>
    </details>`
    : "";
  const refs = [...new Set(fs.flatMap((f) => f.refs))];
  const cites = [...new Set(["(GeoNames, n.d.; Natural Earth, n.d.)", ...fs.map((f) => f.cite)].filter(Boolean))].join("; ");
  const names = cities.map((c) => c.en);
  const head = cities.map((c, i) => `${c.en} <button type="button" class="cmp-remove" data-compare-remove="${i}" aria-label="Remove ${c.en} from the comparison" title="Remove">×</button>`);
  return `<div class="fiche">
    <div class="fiche-title">${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}</div>
    <div class="compare-actions">
      ${cities.length < MAX_COMPARE ? `<button type="button" class="compare-btn" data-compare-add>Add a city (up to ${MAX_COMPARE})</button>` : ""}
      <button type="button" class="compare-btn" data-compare-back>Back to ${cities[0].en}</button>
    </div>
    <p class="fiche-text">Figures come from different years and national definitions, so compare them with care.</p>
    ${cols(head).replace('class="cmp-pair"', 'class="cmp-pair cmp-head"')}
    <dl>
      ${row("Country", "country")}
      ${row("Latest census", "census")}
      ${row("Population density", "density")}
    </dl>
    ${fold("Ethnic / national groups", fs.map((f) => f.ethnic))}
    ${fold("Languages", fs.map((f) => f.language))}
    ${fold("Religion", fs.map((f) => f.religion))}
    ${fold("Income and employment", fs.map((f) => f.economy || NOT_FOUND))}
    ${fold("Criminality", fs.map((f) => f.crime))}
    ${national}
    <details>
      <summary>References (Harvard)</summary>
      <p class="cite">In-text: ${cites}</p>
      <ol class="refs">${refs.map((r) => `<li>${r}</li>`).join("")}${NATIONAL_REFS}</ol>
    </details>
  </div>`;
}
function showComparison(cities) {
  showInfoCard(comparisonHtml(cities), `city-card compare-card compare-${cities.length}`);
  currentCity = cities[0];
  currentComparison = cities;
}
// Adds a city to the comparison being built, or shows it on its own
function chooseCity(city) {
  if (compareFrom) {
    if (!compareFrom.some((c) => sameCity(c, city))) showComparison([...compareFrom, city]);
  } else showCity(city);
}
infoBody.addEventListener("click", (e) => {
  const lcBtn = e.target.closest("[data-layer-compare]");
  if (lcBtn) {
    e.stopPropagation();
    openLayerCompare(lcBtn.dataset.layerCompare);
    return;
  }
  const pick = e.target.closest("[data-pick]");
  const remove = e.target.closest("[data-compare-remove]");
  // These buttons redraw the card: stop here, or the map sees a click from a removed element and closes it
  if (e.target.closest("[data-pick], [data-compare], [data-compare-add], [data-compare-remove], [data-compare-back]")) e.stopPropagation();
  if (pick) {
    const meta = labelData.places[Number(pick.dataset.pick)];
    chooseCity({ en: meta.en, meta });
  } else if (remove) {
    const rest = currentComparison.filter((_, i) => i !== Number(remove.dataset.compareRemove));
    if (rest.length > 1) showComparison(rest);
    else showCity(rest[0]);
  } else if (e.target.closest("[data-compare]")) {
    showComparePicker([currentCity]);
  } else if (e.target.closest("[data-compare-add]")) {
    showComparePicker(currentComparison);
  } else if (e.target.closest("[data-compare-back]")) {
    if (compareFrom && compareFrom.length > 1) showComparison(compareFrom);
    else showCity(currentCity);
  }
});
infoBody.addEventListener("input", (e) => {
  if (e.target.id === "compare-input") listCompareMatches(e.target.value);
});
infoBody.addEventListener("keydown", (e) => {
  if (e.target.id !== "compare-input" || e.key !== "Enter") return;
  const first = infoBody.querySelector("[data-pick]");
  if (first) first.click();
});

function renderLabels() {
  if (!labelData) return;
  labelLayer.clearLayers();
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  // Greedy placement: a label is skipped if its box would overlap one already placed,
  // so the biggest names win and more appear as you zoom in
  const placed = [];
  const showNative = nativeNames.checked;
  const hits = (list, x, y, w, h) => list.some((b) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y);
  const boxOf = (en, native, lat, lon, kind) => {
    const pt = map.latLngToContainerPoint([lat, lon]);
    const sub = showNative && native && native.toLowerCase() !== en.toLowerCase();
    const w = en.length * (kind === "country" ? 7.5 : 6.5) + 8;
    const h = kind === "country" ? (sub ? 30 : 16) : (sub ? 26 : 14);
    return { pt, w, h };
  };
  // Space kept free for capitals: a country name moves off its capital instead of hiding it
  let reserved = [];
  function place(en, native, lat, lon, kind, meta = null, offsets = [[0, 0]]) {
    const { pt, w, h } = boxOf(en, native, lat, lon, kind);
    let x, y, dx, dy, ok = false;
    for ([dx, dy] of offsets) {
      x = pt.x + dx - w / 2;
      y = pt.y + dy - h / 2;
      if (!hits(placed, x, y, w, h) && !(kind === "country" && hits(reserved, x, y, w, h))) { ok = true; break; }
    }
    if (!ok) return;
    placed.push({ x, y, w, h });
    if (dx || dy) ({ lat, lng: lon } = map.containerPointToLatLng([pt.x + dx, pt.y + dy]));
    if (meta) {
      // Cities and capitals are clickable: the card shows population and census details
      L.marker([lat, lon], { icon: labelIcon(en, native, kind), keyboard: false })
        .on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          chooseCity({ en, meta });
        })
        .addTo(labelLayer);
    } else if (kind === "country" && labelData.profiles[en]) {
      // Country names open a card with national figures
      L.marker([lat, lon], { icon: labelIcon(en, native, kind), keyboard: false })
        .on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          if (!compareFrom) showInfoCard(countryCardHtml(en), "country-card");
        })
        .addTo(labelLayer);
    } else {
      L.marker([lat, lon], { icon: labelIcon(en, native, kind), interactive: false, keyboard: false }).addTo(labelLayer);
    }
  }
  // Countries: largest rank first; more ranks are allowed as you zoom in
  const maxRank = zoom <= 2 ? 2 : zoom <= 3 ? 3 : zoom <= 4 ? 4 : zoom <= 5 ? 5 : 7;
  const countries = labelData.countries
    .filter((c) => c.rank <= maxRank && bounds.contains([c.lat, c.lon]))
    .sort((a, b) => a.rank - b.rank);
  // Cities: from zoom 4, most important first, never repeating a country name.
  // Capitals come straight after the countries and show from zoom 4 whatever their size,
  // so a river, a mountain or a smaller town never takes their place.
  const countryNames = new Set(labelData.countries.map((c) => c.en));
  const visible = (p) => (p.cap ? 4 : Math.max(p.min_zoom, 4)) <= zoom && !countryNames.has(p.en) && bounds.contains([p.lat, p.lon]);
  const byImportance = (a, b) => a.min_zoom - b.min_zoom;
  const capitals = labelData.places.filter((p) => p.cap && visible(p)).sort(byImportance);
  reserved = capitals.map((p) => {
    const { pt, w, h } = boxOf(p.en, p.native, p.lat, p.lon, "capital");
    return { x: pt.x - w / 2, y: pt.y - h / 2, w, h };
  });
  // A country name tries its own spot first, then nudges up or down until it clears its capital
  const nudges = [[0, 0], [0, 22], [0, -22], [0, 40], [0, -40], [0, 58], [0, -58]];
  for (const c of countries) place(c.en, c.native, c.lat, c.lon, "country", null, nudges);
  // Two capitals close together (Kinshasa and Brazzaville, Rome and Vatican City) stack instead of hiding one another
  for (const p of capitals) place(p.en, p.native, p.lat, p.lon, "capital", p, [[0, 0], [0, 15], [0, -15]]);
  // Rivers and mountains (serif, natural features): after the capitals, before the other cities
  for (const n of labelData.natural || []) {
    if (!bounds.contains([n.lat, n.lon])) continue;
    const need = n.kind === "river" ? (n.tier === 1 ? 5 : 7) : (n.tier === 1 ? 4 : 6);
    if (zoom >= need) place(n.en, "", n.lat, n.lon, n.kind);
  }
  for (const p of labelData.places.filter((p) => !p.cap && visible(p)).sort(byImportance)) place(p.en, p.native, p.lat, p.lon, "place", p);
}
map.on("moveend", renderLabels);
nativeNames.addEventListener("change", renderLabels);

// Country borders from Natural Earth (via world-atlas)
fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json")
  .then((r) => r.json())
  .then((topo) => {
    const countries = unwrapFeatures(topojson.feature(topo, topo.objects.countries));
    landLayer.addData(countries);
    applyLandStyle();
    L.geoJSON(countries, {
      style: { color: "#3a3a3a", weight: 1.2, fill: false, dashArray: "6 4" },
    }).addTo(bordersLayer);
  });

// UI elements
const yearInput = document.getElementById("year");
const yearLabel = document.getElementById("year-label");
const playButton = document.getElementById("play");
const searchInput = document.getElementById("search");
const list = document.getElementById("list");
const plannedList = document.getElementById("list-planned");
const droppedList = document.getElementById("list-dropped");
const statCount = document.getElementById("stat-count");
const statKm = document.getElementById("stat-km");

let barriers = []; // { feature, layer, listItem }

// Ancient dates: "AD 122", "1200 BC"; modern years stay as they are
function formatYear(y) {
  if (y < 0) return `${-y} BC`;
  if (y < 1000) return `AD ${y}`;
  return `${y}`;
}

// Barriers without a build year are always shown and left out of the counts
function isStanding(props, year) {
  // Walls with no start year yet (planned, projected) belong to the present, not to past years
  if (props.status && props.built == null) return year === Number(yearInput.max);
  if (props.built == null) return true;
  return props.built <= year && (props.removed == null || props.removed > year);
}

// Physical type of the structure (what it is made as), in English
const TYPE_LABELS = { wall: "Wall", fence: "Fence", berm: "Berm (sand or earth embankment)", ditch: "Ditch or trench" };
// Ballif & Rosière (2009) classify closed borders between states in four types; urban and historic walls fall outside them
const CATEGORY_LABELS = {
  "marche": "March (marche): a border with no crossing points, which becomes a buffer zone",
  "clôture": "Fence (clôture): wire mesh or barbed wire, relatively cheap",
  "mur": "Wall (mur): a heavier structure with high-tech surveillance",
  "clôture et mur": "Fence and wall (clôture et mur): both types along the same border",
  "front": "Fortified military line (front): a frozen, unrecognised line of contact held by armed forces",
  "urbaine (hors typologie)": "Urban barrier: a wall or fence within a city or around a neighbourhood",
  "historique": "Historic frontier: a wall that no longer serves as a modern border",
  "non classé (type not stated)": "Not classified: the sources do not describe the structure",
};
const BALLIF_ROSIERE = "Ballif, F. and Rosière, S. (2009) 'Le défi des « teichopolitiques ». Analyser la fermeture contemporaine des territoires', L'Espace géographique, 38(3), pp. 193–206. doi:10.3917/eg.383.0193. (Inspiration for the categories: this map keeps their four border types and adds urban, historic and combined categories.)";

// Picker shown in Northern Ireland wall and city cards: map a neighbourhood theme (income, employment, occupations, community, ethnicity)
// Belfast by ward, 1937–1971: the census before and just after the first peace walls (1969)
let belfastHistory = null;
fetch("data/belfast-history.json").then((r) => r.json()).then((d) => { belfastHistory = d; }).catch(() => {});
const HIST_YEARS = ["1937", "1951", "1961", "1971"];
// Northern Ireland: jobs by community background over time (Labour Force Survey Religion Report 2017),
// and unemployment by community background, ethnic group and country of birth at the 2011 and 2021 censuses
const NI_JOBS = {
  years: [1992,1993,1994,1995,1996,1997,1998,1999,2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017],
  unempP: [9,10,9,8,8,5,5,5,5,5,4,5,4,3,4,3,3,5,6,6,6,6,6,6,5,4],
  unempC: [18,18,16,16,13,12,10,9,9,8,8,7,7,6,6,5,5,8,9,8,8,9,8,6,7,4],
  empP: [69,66,67,69,70,72,71,71,71,71,72,73,73,74,72,73,73,71,69,69,70,68,67,68,71,70],
  empC: [54,55,54,55,57,60,62,62,60,61,62,63,63,62,64,67,66,63,62,64,65,65,65,67,68,67],
  belEmpP: { 1995: 63, 1996: 62, 1997: 66, 1998: 65, 1999: 64, 2000: 65, 2001: 66, 2002: 67, 2003: 66, 2004: 62, 2005: 69, 2006: 67, 2007: 66, 2008: 70, 2009: 63, 2010: 65, 2011: 61, 2012: 60, 2013: 66, 2014: 61, 2015: 60, 2016: 72, 2017: 67 },
  belEmpC: { 1995: 44, 1996: 53, 1997: 56, 1998: 58, 1999: 58, 2000: 57, 2001: 62, 2002: 55, 2003: 55, 2004: 58, 2005: 56, 2006: 62, 2007: 66, 2008: 68, 2009: 59, 2010: 63, 2011: 62, 2012: 59, 2013: 67, 2014: 61, 2015: 65, 2016: 69, 2017: 62 },
  census: [
    ["Community background: Protestant and other Christian", 5.9, 3.9, 8.1, 5.4],
    ["Community background: Catholic", 8.9, 4.8, 9.4, 6.1],
    ["Community background: none", 10.0, 7.6, 9.9, 8.5],
    ["Ethnic group: White", 7.5, 4.6, null, 6.0],
    ["Ethnic group: Asian", 5.3, 7.3, null, 10.4],
    ["Ethnic group: Black", 16.9, 9.6, null, 15.2],
    ["Ethnic group: Mixed", 9.8, 9.0, null, 9.8],
    ["Ethnic group: Other", 10.2, 8.9, null, 11.2],
    ["Born in Northern Ireland", 7.5, 4.5, null, 5.9],
    ["Born in England, Scotland or Wales", 8.4, 5.3, null, 6.8],
    ["Born in the Republic of Ireland", 6.6, 4.3, null, 5.0],
    ["Born outside the UK and Ireland", 7.5, 6.3, null, 9.3],
  ],
};
function niJobsChartSvg() {
  const d = NI_JOBS, W = 320, H = 170, L = 30, R = 64, T = 10, B = 22;
  const x = (i) => L + (i * (W - L - R)) / (d.years.length - 1);
  const y = (v) => T + ((20 - v) * (H - T - B)) / 20;
  const path = (vals) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const gap = `${path(d.unempC)}${d.unempP.map((v, i) => `L${x(d.years.length - 1 - i).toFixed(1)},${y(d.unempP[d.years.length - 1 - i]).toFixed(1)}`).join("")}Z`;
  const grid = [0, 5, 10, 15, 20].map((v) => `<line class="nij-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="nij-axis" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v}%</text>`).join("");
  const ticks = [1992, 2000, 2008, 2017].map((yr) => `<text class="nij-axis" x="${x(d.years.indexOf(yr))}" y="${H - 6}" text-anchor="middle">${yr}</text>`).join("");
  const n = d.years.length - 1;
  return `<svg class="nij-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Unemployment rate of Protestants and Catholics in Northern Ireland, 1992 to 2017: Catholics 18% and Protestants 9% in 1992, both 4% in 2017">
    ${grid}${ticks}
    <path class="nij-gap" d="${gap}"/>
    <path class="nij-line nij-c" d="${path(d.unempC)}"/><path class="nij-line nij-p" d="${path(d.unempP)}"/>
    <text class="nij-label" x="${x(n) + 6}" y="${y(d.unempC[n]) - 4}">Catholic</text>
    <text class="nij-label" x="${x(n) + 6}" y="${y(d.unempP[n]) + 9}">Protestant</text>
    <line class="nij-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
    <circle class="nij-dot nij-c-dot" r="4" visibility="hidden"/><circle class="nij-dot nij-p-dot" r="4" visibility="hidden"/>
    <rect class="nij-hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" data-l="${L}" data-w="${W - L - R}"/>
  </svg>`;
}
function niJobsHtml(isBelfast) {
  const d = NI_JOBS;
  const v = (x) => (x == null ? "–" : `${x}%`);
  const rows = d.years.map((yr, i) => `<tr><th>${yr}</th><td>${d.unempP[i]}%</td><td>${d.unempC[i]}%</td><td>${d.unempC[i] - d.unempP[i]}</td><td>${d.empP[i]}%</td><td>${d.empC[i]}%</td>${isBelfast ? `<td>${v(d.belEmpP[yr])}</td><td>${v(d.belEmpC[yr])}</td>` : ""}</tr>`).join("");
  const census = d.census.map(([g, a, b, c, e]) => `<tr><th>${g}</th><td>${v(a)}</td><td>${v(b)}</td>${isBelfast ? `<td>${v(c)}</td><td>${v(e)}</td>` : ""}</tr>`).join("");
  return `<details>
    <summary>Jobs by community, ethnicity and birthplace over time</summary>
    <p class="fiche-text"><strong>Unemployment, Protestants and Catholics, Northern Ireland, 1992–2017.</strong> The gap fell from 9 points (Catholics 18%, Protestants 9%) in 1992 to none in 2017 (4% each); most of the narrowing came in the 1990s, the decade of the 1994 ceasefires and the 1998 Good Friday Agreement, and the gap widened a little again in the recession after 2008 (3 points in 2009–2013). Hover over the chart for each year.</p>
    <div class="nij-wrap">${niJobsChartSvg()}<div class="nij-tip" hidden></div></div>
    <p class="fiche-text"><span class="nij-key nij-p"></span>Protestant <span class="nij-key nij-c"></span>Catholic <span class="nij-key nij-gapkey"></span>gap</p>
    <details><summary>Table: unemployment and employment by year${isBelfast ? " (with Belfast)" : ""}</summary>
      <div class="hist-wrap"><table class="hist-table"><thead><tr><th>Year</th><th>Unemployed P</th><th>Unemployed C</th><th>Gap (points)</th><th>In work P</th><th>In work C</th>${isBelfast ? "<th>In work, Belfast P</th><th>In work, Belfast C</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="cite">Unemployment: share of the economically active (16+) who are unemployed. In work: share of the working-age population in employment (working age redefined in 2010; the later definition is shown). Belfast figures start in 1995 and rest on smaller samples, so they move more from year to year. The survey report was last published for 2017.</p>
    </details>
    <p class="fiche-text"><strong>Unemployment at the 2011 and 2021 censuses</strong>, by community background, ethnic group and country of birth${isBelfast ? ", Northern Ireland and Belfast" : ", Northern Ireland"}. The Labour Force Survey report does not cover ethnicity or birthplace; the census does.</p>
    <div class="hist-wrap"><table class="hist-table"><thead><tr><th>Group</th><th>NI 2011</th><th>NI 2021</th>${isBelfast ? "<th>Belfast 2011</th><th>Belfast 2021</th>" : ""}</tr></thead><tbody>${census}</tbody></table></div>
    <p class="cite">Census unemployment: unemployed as a share of the economically active. 2011 counts people aged 16–74 and leaves unemployed full-time students out of the unemployed; 2021 counts everyone aged 16+ and includes them; 2021 was taken in March 2021, during the pandemic and furlough. 2011 ethnic group and birthplace are published for Northern Ireland only; Belfast 2011 community background is the Belfast Education and Library Board area (the city).</p>
    <p class="cite">In-text: (NISRA, 2019; 2013; 2023)</p>
    <ol class="refs">
      <li>Northern Ireland Statistics and Research Agency (2019) Labour Force Survey Religion Report 2017, Tables A5.1, A6.1 and A8.10. Belfast: The Executive Office. Available at: https://www.executiveoffice-ni.gov.uk/publications/labour-force-survey-religion-report-2017 (Accessed: 18 November 2026).</li>
      <li>Northern Ireland Statistics and Research Agency (2013) Census 2011 Detailed Characteristics: DC2601NI Economic activity by ethnic group, DC2606NI Economic activity by country of birth, DC2626NI Economic activity by religion or religion brought up in. Available at: https://www.nisra.gov.uk/statistics/2011-census-results/detailed-characteristics (Accessed: 18 November 2026).</li>
      <li>Northern Ireland Statistics and Research Agency (2023) Census 2021 Flexible Table Builder: economic activity by ethnic group, country of birth and community background, by Local Government District. Available at: https://build.nisra.gov.uk/ (Accessed: 18 November 2026).</li>
    </ol>
  </details>`;
}
// Hover on the jobs chart: a crosshair and a readout for the nearest year
document.addEventListener("pointermove", (e) => {
  const hit = e.target.closest && e.target.closest(".nij-hit");
  document.querySelectorAll(".nij-wrap").forEach((wrap) => {
    if (hit && wrap.contains(hit)) return;
    wrap.querySelectorAll(".nij-cross,.nij-dot").forEach((el) => el.setAttribute("visibility", "hidden"));
    wrap.querySelector(".nij-tip").hidden = true;
  });
  if (!hit) return;
  const svg = hit.ownerSVGElement, wrap = svg.parentNode, d = NI_JOBS;
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const l = Number(hit.dataset.l), w = Number(hit.dataset.w), n = d.years.length - 1;
  const i = Math.max(0, Math.min(n, Math.round(((p.x - l) / w) * n)));
  const x = l + (i * w) / n, y = (v) => 10 + ((20 - v) * 138) / 20;
  const cross = svg.querySelector(".nij-cross");
  cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
  [[".nij-c-dot", d.unempC[i]], [".nij-p-dot", d.unempP[i]]].forEach(([s, v]) => { const c = svg.querySelector(s); c.setAttribute("cx", x); c.setAttribute("cy", y(v)); c.setAttribute("visibility", "visible"); });
  const tip = wrap.querySelector(".nij-tip");
  tip.innerHTML = `<strong>${d.years[i]}</strong><br><span class="nij-key nij-c"></span>Catholic ${d.unempC[i]}%<br><span class="nij-key nij-p"></span>Protestant ${d.unempP[i]}%<br>Gap ${d.unempC[i] - d.unempP[i]} points`;
  tip.hidden = false;
  tip.style.left = `${Math.min(wrap.clientWidth - 130, Math.max(0, (x / 320) * wrap.clientWidth + 10))}px`;
});
function belfastHistoryHtml() {
  if (!belfastHistory) return "";
  const c = belfastHistory.city;
  const key = (w) => (["Falls", "Shankill"].includes(w) ? ' class="hist-key"' : "");
  const rows = Object.entries(belfastHistory.wards).map(([w, d]) => `<tr${key(w)}><th>${w}</th>${HIST_YEARS.map((y) => `<td>${d[y].rc_pct}</td>`).join("")}<td>${d["1971"].pop.toLocaleString("en")}</td><td>${d.male_unemp_1971}</td></tr>`).join("");
  return `<details>
    <summary>Belfast by ward, 1937–1971 (before the walls)</summary>
    <p class="fiche-text">The first peace walls went up in 1969, so 1937, 1951 and 1961 are before them; April 1971 is two years after. These are the 15 old wards, whose boundaries were replaced after 1973.</p>
    <div class="hist-wrap"><table class="hist-table">
      <thead><tr><th>Ward: % Catholic</th>${HIST_YEARS.map((y) => `<th>${y}</th>`).join("")}<th>People 1971</th><th>Male unemp. % 1971</th></tr></thead>
      <tbody>${rows}<tr class="hist-total"><th>Whole city</th>${HIST_YEARS.map((y) => `<td>${c[y].rc_pct}</td>`).join("")}<td>${c["1971"].pop.toLocaleString("en")}</td><td>${c.male_unemp_1971}</td></tr></tbody>
    </table></div>
    <p class="fiche-text">Segregation index across wards (Catholics against everyone else; 0 = evenly mixed, 1 = fully separate): ${HIST_YEARS.map((y) => `${y}: ${c[y].dissimilarity_rc_nonrc}`).join("; ")}.</p>
    <p class="cite">In 1971 many people did not state a religion (${c["1971"].not_stated_other_pct}% "other or not stated" citywide, ${belfastHistory.wards.Falls["1971"].not_stated_other_pct}% in Falls), so that year's Catholic shares are minimums. The censuses did not ask about income. Female unemployment is not shown because the scanned table is unreadable for several wards.</p>
    <p class="cite">In-text: (General Register Office, 1938; 1953; 1965; 1975)</p>
    <ol class="refs"><li>General Register Office (Northern Ireland) (1938; 1953; 1965; 1975) Census of Population of Northern Ireland: County Borough of Belfast reports, 1937, 1951, 1961 and 1971. Belfast: HMSO. Available at: https://www.nisra.gov.uk/statistics/census/2011-and-earlier-censuses (Accessed: 9 November 2026).</li></ol>
  </details>`;
}
// Belfast by 2001 ward, 1971–2001: 1971–1991 summed from the 100 m census grid squares (Shuttleworth and Lloyd, UK Data Service SN 5672)
// into 2001 wards; 2001 from NISRA's ward key statistics. Only ward shares and totals are published, never grid-square counts (End User Licence).
const B7101_YEARS = ["1971", "1981", "1991", "2001"];
const B7101_THEMES = {
  cath_share: { label: "Religion: % Catholic (of people stating Catholic or Protestant)", unit: "%" },
  not_stated: { label: "Religion: % not stating a religion (or no religion)", unit: "%" },
  pop: { label: "Population: people counted", unit: "" },
  owner: { label: "Housing: % of households owner-occupied", unit: "%" },
  public_rent: { label: "Housing: % of households renting from a public body", unit: "%" },
  per_room: { label: "Housing: people per room (crowding)", unit: "" },
  no_car: { label: "Housing: % of households without a car", unit: "%" },
  male_unemp: { label: "Jobs: % of economically active men unemployed", unit: "%" },
  moved_1yr: { label: "Migration: % who moved home in the past year", unit: "%" },
};
function belfast7101Table(theme) {
  const fmt = (v) => (v == null ? "–" : theme === "pop" ? v.toLocaleString("en") : v);
  const key = (w) => (["Falls", "Clonard", "Shankill", "Woodvale", "Ardoyne", "Crumlin", "New Lodge"].includes(w) ? ' class="hist-key"' : "");
  const rows = Object.entries(belfastHistory.wards_2001).map(([w, d]) => `<tr${key(w)}><th>${w}</th>${B7101_YEARS.map((y) => `<td>${fmt(d[y] && d[y][theme])}</td>`).join("")}</tr>`).join("");
  const c = belfastHistory.city_2001;
  return `<thead><tr><th>Ward (2001)</th>${B7101_YEARS.map((y) => `<th>${y}</th>`).join("")}</tr></thead>
    <tbody>${rows}<tr class="hist-total"><th>Belfast</th>${B7101_YEARS.map((y) => `<td>${fmt(c[y][theme])}</td>`).join("")}</tr></tbody>`;
}
// Hadrian's Wall: residents within 50 km north and south (England) of the wall, census by census
let hadrianSummary = null;
fetch("data/hadrian-summary.json").then((r) => r.json()).then((d) => { hadrianSummary = d; }).catch(() => {});
let hadrianGridSummary = null;
fetch("data/hadrian-grid.json").then((r) => r.json()).then((d) => { hadrianGridSummary = d.summary; }).catch(() => {});
function hadrianGridHtml() {
  const s = hadrianGridSummary;
  if (!s) return "";
  const cell = (side, y, k) => { const v = s[side][y] && s[side][y][k]; return v == null ? "–" : k === "pop" ? v.toLocaleString("en") : `${v}%`; };
  const head = HWG_YEARS.map((y) => `<th>${y} N</th><th>${y} S</th>`).join("");
  const line = (label, k) => `<tr><th>${label}</th>${HWG_YEARS.map((y) => `<td>${cell("north", y, k)}</td><td>${cell("south", y, k)}</td>`).join("")}</tr>`;
  const rows = [line("Residents", "pop"), ...Object.entries(HWG_INDICATORS).filter(([k]) => k !== "pop").map(([k, ind]) => line(ind.label, k))].join("");
  return `<details>
    <summary>Either side of the wall, 1971–2011 (within 50 km)</summary>
    <p class="fiche-text">Residents of the 1 km squares within 50 km of the wall line, north (N) or south (S) of it. North of the wall this reaches into southern Scotland (Dumfries and Galloway, the Scottish Borders) as well as Northumberland; south of it, Cumbria, County Durham and west Tyne and Wear. The censuses did not ask about religion before 2001 or about ethnicity before 1991, and have never asked about income.</p>
    <div class="hist-wrap"><table class="hist-table"><thead><tr><th>Census</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="cite">The 1971 population counts people present on census night, later censuses usual residents. Each census's small areas were reallocated to 1 km squares by the PopChange project, so all years share the same squares. In-text: (Lloyd et al., 2017; 2018)</p>
    <ol class="refs">${POPCHANGE_REFS.map((r) => `<li>${r}</li>`).join("")}</ol>
  </details>`;
}
function hadrianSidesHtml() {
  if (!hadrianSummary) return "";
  const s = hadrianSummary;
  const cell = (side, y, k) => { const v = s[side][y] && s[side][y][k]; return v == null ? "–" : k === "pop" ? v.toLocaleString("en") : k === "income" ? `£${v.toLocaleString("en")}` : `${v}%`; };
  const head = HW_YEARS.map((y) => `<th>${y} N</th><th>${y} S</th>`).join("");
  const line = (label, k) => `<tr><th>${label}</th>${HW_YEARS.map((y) => `<td>${cell("north", y, k)}</td><td>${cell("south", y, k)}</td>`).join("")}</tr>`;
  const rows = [line("Residents", "pop"), ...Object.entries(HW_INDICATORS).map(([k, ind]) => line(ind.label, k))].join("");
  const inc = HW_INCOME_YEARS.map((y) => `<tr><th>${y === "2023" ? "2022/23" : `${Number(y) - 1}/${y.slice(2)}`}</th><td>${cell("north", y, "income")}</td><td>${cell("south", y, "income")}</td></tr>`).join("");
  const c = s.crime;
  const cr = c ? `<p class="fiche-text">Crime, October 2025 to September 2026, per 1,000 residents (excluding anti-social behaviour): north ${c.north.crime_rate}, south ${c.south.crime_rate}. Violence and sexual offences: north ${c.north.violent_rate}, south ${c.south.violent_rate}. Anti-social behaviour: north ${c.north.asb_rate}, south ${c.south.asb_rate}.</p>` : "";
  return `<details>
    <summary>Either side of the wall today, 2001–2026 (England, within 50 km)</summary>
    <p class="fiche-text">Residents of the small areas in England within 50 km of the wall line, north (N) or south (S) of it, not counting areas beyond the wall's two ends. The Scottish side is not included here: Scotland publishes its census on different small areas, and police.uk and the ONS income estimates do not cover it (see the 1 km squares below for 1971–2011). ${s.note || ""}</p>
    <div class="hist-wrap"><table class="hist-table"><thead><tr><th>Census</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="hist-wrap"><table class="hist-table"><thead><tr><th>Household income after tax (equivalised, a year)</th><th>North</th><th>South</th></tr></thead><tbody>${inc}</tbody></table></div>
    ${cr}
    <button type="button" class="compare-btn compare-maps-btn" data-layer-compare="hw">Compare neighbourhood maps side by side</button>
    <p class="cite">Shares are of all residents (households for housing). 2001 and 2011 are carried onto the 2021 small areas. Income is averaged over areas weighted by their 2021 residents, in pounds of each year. The wall has not been a border since Roman times: these figures describe the places on either side of it today. Censuses before 2001 are not added yet.</p>
    <ol class="refs">${HADRIAN_REFS.map((r) => `<li>${r}</li>`).join("")}</ol>
  </details>`;
}
function belfast7101Html() {
  if (!belfastHistory || !belfastHistory.wards_2001) return "";
  const c = belfastHistory.city_2001;
  return `<details>
    <summary>Belfast by ward, 1971–2001 (after the walls)</summary>
    <p class="fiche-text">The same 51 wards (2001 boundaries) at each census, so areas can be compared through time. 1971, 1981 and 1991 are added up from 100 m census grid squares; 2001 comes from the census ward tables. The peace walls multiplied from 1969 onwards. In bold: wards along the Falls–Shankill and North Belfast walls.</p>
    <label class="dep-toggle">Theme
      <select class="theme-select b7101-select">${Object.entries(B7101_THEMES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("")}</select>
    </label>
    <div class="hist-wrap"><table class="hist-table b7101-table">${belfast7101Table("cath_share")}</table></div>
    <p class="fiche-text">Segregation index, Catholics against Protestants (0 = evenly mixed, 1 = fully separate). Across wards: ${B7101_YEARS.map((y) => `${y}: ${c[y].dissimilarity_wards}`).join("; ")}. Across 100 m squares: ${["1971", "1981", "1991"].map((y) => `${y}: ${c[y].dissimilarity_100m}`).join("; ")} (no 2001 squares in the dataset).</p>
    <p class="cite">How to read it: squares withheld for confidentiality are left out, so 1971–1991 figures cover about 94% of residents and population counts are slightly low. 1981 is the least reliable year: many people refused the census or the religion question (a boycott linked to the hunger strikes), especially in Catholic West Belfast, so 1981 population counts are understated there and more people left religion blank. Catholic shares leave out people who stated no religion, another religion or none, so they compare the two main communities. Moving home in 1971–1991 counts moves within and into the district (from age 1); 2001 also counts moves from outside the UK, so 2001 is higher partly by definition. 2001 public renting is the Housing Executive only; 2001 rooms include kitchens, so crowding is slightly lower by definition. The censuses did not ask about income.</p>
    <p class="cite">In-text: (Shuttleworth and Lloyd, 2007; NISRA, 2004)</p>
    <ol class="refs">
      <li>Shuttleworth, I. and Lloyd, C.D. (2007) Linking Northern Ireland Census of Population Data, 1971-2001 [data collection]. UK Data Service. SN: 5672. doi:10.5255/UKDA-SN-5672-1. Used under the UK Data Service End User Licence; only ward totals and shares derived from it are shown here.</li>
      <li>Northern Ireland Statistics and Research Agency (2004) Census 2001 Key Statistics (KS01, KS07a, KS09b, KS17, KS18, KS19) and Migration table KS25, ward level. Available at: https://www.nisra.gov.uk/publications/2001-census-bulk-download-files (Accessed: 17 November 2026).</li>
    </ol>
  </details>`;
}
function themePickerHtml(regions) {
  return regions.map((r) => `<label class="dep-toggle">${REGIONS[r].name}: show by area on the map
    <select class="theme-select" data-region="${r}">
      <option value="">None</option>
      ${Object.entries(THEMES).filter(([, th]) => th.region === r && !th.compareOnly).map(([k, th]) => `<option value="${k}"${activeThemes[r] === k ? " selected" : ""}>${th.label}</option>`).join("")}
    </select></label>`).join("") + `<button type="button" class="compare-btn" data-layer-compare="${regions[0]}">Compare neighbourhood maps side by side (2 to 4 maps)</button>`;
}

// Side-by-side maps: the same area shown two to four times, each with its own neighbourhood theme.
// The maps move together; hovering an area shows its value. Opened from the theme picker in a card.
const COMPARE_GROUPS = { ni: ["ni"], hw: ["hw"], us: ["us", "mx"], mx: ["us", "mx"] };
const COMPARE_DEFAULTS = { hw: ["hwg_unemp_1971", "hwg_unemp_1981", "hwg_born_abroad_1971", "hwg_born_abroad_2011"], ni: ["community", "unemp", "income", "prof"], us: ["us_income", "mx_employed", "us_hisp", "mx_cath"] };
const THEME_REFS = { hwg: () => POPCHANGE_REFS, hw: () => HADRIAN_REFS, bw: () => BELFAST_WARD_REFS, sa: () => NISRA_SA_REFS, dz: () => NISRA_DZ_REFS, us: () => US_ACS_REFS, county: () => US_RELIGION_REFS, mxageb: () => [...MX_AGEB_REFS, ...MX_REFS] };
let layerCompare = null;
function themeValueText(th, v) {
  if (v == null) return "not available";
  if (th.field === "side_n") return v ? "north of the wall" : "south of the wall";
  if (th.unit === "£") return `£${Math.round(v).toLocaleString("en")}`;
  if (th.unit === "people") return `${Math.round(v).toLocaleString("en")} residents`;
  return th.field === "income" ? `$${Math.round(v).toLocaleString("en")}` : th.unit ? `${v} ${th.unit}` : `${v}%`;
}
function compareOptionsHtml(lc, key) {
  const opt = (k) => `<option value="${k}"${k === key ? " selected" : ""}>${COMPARE_GROUPS[lc.region].length > 1 ? `${REGIONS[THEMES[k].region].name} · ` : ""}${THEMES[k].label}</option>`;
  const plain = lc.keys.filter((k) => !THEMES[k].group);
  const groups = [...new Set(lc.keys.map((k) => THEMES[k].group).filter(Boolean))];
  return `<optgroup label="Latest figures (by small area)">${plain.map(opt).join("")}</optgroup>` +
    groups.map((g) => `<optgroup label="${g}, 1971–2001">${lc.keys.filter((k) => THEMES[k].group === g).map(opt).join("")}</optgroup>`).join("");
}
function compareLegendHtml(th) {
  return `<div class="lc-legend">${themeLabels(th).map((l, i) => `<span><i style="background:${th.colors[i]}"></i>${l}</span>`).join("")}</div>`;
}
function openLayerCompare(region) {
  closeLayerCompare();
  const group = COMPARE_GROUPS[region];
  const keys = Object.keys(THEMES).filter((k) => group.includes(THEMES[k].region));
  const defaults = COMPARE_DEFAULTS[group[0]].filter((k) => keys.includes(k));
  const box = document.createElement("div");
  box.className = "layer-compare";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Compare themes side by side");
  box.innerHTML = `<div class="lc-bar">
      <strong>Compare themes side by side</strong>
      <label>Maps <select class="lc-count">${[2, 3, 4].map((n) => `<option${n === 2 ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <span class="lc-hint">The maps move together. Hover or tap an area to read its value; the black lines are the walls.</span>
      <button type="button" class="lc-close" aria-label="Close the side-by-side maps">×</button>
    </div>
    <div class="lc-grid"></div>
    <details class="lc-refs"><summary>References (Harvard)</summary><ol class="refs"></ol></details>`;
  document.body.appendChild(box);
  const centre = regionShown(group[0]) || (group[1] && regionShown(group[1])) ? { c: map.getCenter(), z: map.getZoom() } : null;
  // Walls in the area, drawn on every map for reference
  const area = REGIONS[group[0]].bounds;
  const walls = barriers.map((b) => b.feature).filter((f) => { try { return area.intersects(L.geoJSON(f).getBounds()); } catch { return false; } });
  layerCompare = { box, panels: [], region: group[0], keys, defaults, centre, walls, syncing: false };
  box.querySelector(".lc-close").addEventListener("click", closeLayerCompare);
  box.querySelector(".lc-count").addEventListener("change", (e) => setComparePanels(Number(e.target.value)));
  document.addEventListener("keydown", layerCompareKey);
  setComparePanels(2);
}
function layerCompareKey(e) {
  if (e.key === "Escape") closeLayerCompare();
}
function closeLayerCompare() {
  if (!layerCompare) return;
  layerCompare.panels.forEach((p) => p.map.remove());
  layerCompare.box.remove();
  document.removeEventListener("keydown", layerCompareKey);
  layerCompare = null;
}
function setComparePanels(n) {
  const lc = layerCompare;
  const grid = lc.box.querySelector(".lc-grid");
  const view = lc.panels.length ? { c: lc.panels[0].map.getCenter(), z: lc.panels[0].map.getZoom() } : lc.centre;
  const kept = lc.panels.map((p) => p.key);
  lc.panels.forEach((p) => p.map.remove());
  lc.panels = [];
  grid.innerHTML = "";
  grid.className = `lc-grid lc-${n}`;
  const used = [...kept];
  for (let i = 0; i < n; i++) {
    const key = kept[i] || lc.defaults.find((k) => !used.includes(k)) || lc.keys.find((k) => !used.includes(k)) || lc.keys[0];
    used.push(key);
    const cell = document.createElement("div");
    cell.className = "lc-panel";
    cell.innerHTML = `<div class="lc-head">
        <select class="lc-theme" aria-label="Theme for map ${i + 1}">${compareOptionsHtml(lc, key)}</select>
        <div class="lc-key"></div>
      </div>
      <div class="lc-map"></div>`;
    grid.appendChild(cell);
    const m = L.map(cell.querySelector(".lc-map"), { zoomControl: i === 0, attributionControl: i === n - 1, minZoom: 6 });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "Tiles &copy; Esri" }).addTo(m);
    m.createPane("lcLabels");
    m.getPane("lcLabels").style.zIndex = 450;
    m.getPane("lcLabels").style.pointerEvents = "none";
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, pane: "lcLabels" }).addTo(m);
    const panel = { map: m, key, cell, theme: L.layerGroup().addTo(m) };
    m.createPane("lcWalls");
    m.getPane("lcWalls").style.zIndex = 440;
    m.getPane("lcWalls").style.pointerEvents = "none";
    L.geoJSON(lc.walls, { pane: "lcWalls", style: { color: "#111", weight: 3, opacity: 0.95 }, pointToLayer: (f, ll) => L.circleMarker(ll, { pane: "lcWalls", radius: 3, color: "#111", fillOpacity: 1 }), interactive: false }).addTo(m);
    if (view) m.setView(view.c, view.z);
    else m.fitBounds(REGIONS[lc.region].home);
    // Moving one map moves the others
    m.on("move", () => {
      if (lc.syncing) return;
      lc.syncing = true;
      lc.panels.forEach((p) => { if (p.map !== m) p.map.setView(m.getCenter(), m.getZoom(), { animate: false }); });
      lc.syncing = false;
    });
    cell.querySelector(".lc-theme").addEventListener("change", (e) => drawComparePanel(panel, e.target.value));
    lc.panels.push(panel);
    drawComparePanel(panel, key);
  }
  setTimeout(() => lc.panels.forEach((p) => p.map.invalidateSize()), 0);
}
function drawComparePanel(panel, key) {
  const th = THEMES[key];
  panel.key = key;
  panel.theme.clearLayers();
  panel.cell.querySelector(".lc-key").innerHTML = `${compareLegendHtml(th)}<p class="lc-note">${th.note}${th.source ? ` (${th.source})` : ""}</p>`;
  const draw = (src, opacity) => loadThemeData(src).then((fc) => {
    if (panel.key !== key) return;
    L.geoJSON(fc, {
      style: (f) => ({ fillColor: themeColor(th, f.properties[th.field]), fillOpacity: opacity, color: "#ffffff", weight: 0.4, opacity: 0.7 }),
      onEachFeature: (f, lyr) => {
        const p = f.properties;
        const name = p.name || (p.area ? String(p.area).replace(/_/g, " ") : "") || p.mun || "";
        lyr.bindTooltip(`${name ? `<strong>${name}</strong><br>` : ""}${th.label}: ${themeValueText(th, p[th.field])}`, { sticky: true });
      },
    }).addTo(panel.theme);
  });
  if (th.src === "mxageb") draw("mx", 0.4).then(() => draw("mxageb", 0.75));
  else draw(th.src, 0.65);
  // References for the themes on screen
  const lc = layerCompare;
  const refs = [...new Set(lc.panels.concat(lc.panels.includes(panel) ? [] : [panel]).flatMap((p) => [...THEME_REFS[THEMES[p.key].src](), ...(THEMES[p.key].unit === "per 1,000" && THEMES[p.key].src === "dz" ? POLICE_REFS : [])]))];
  lc.box.querySelector(".lc-refs ol").innerHTML = refs.map((r) => `<li>${r}</li>`).join("");
}
// Which themed region a city belongs to (US themes only cover the US side of the border)
function cityRegion(meta) {
  if (REGIONS.hw.bounds.contains([meta.lat, meta.lon]) && /United Kingdom/.test(meta.country || "")) return "hw";
  if (REGIONS.ni.bounds.contains([meta.lat, meta.lon]) && /United Kingdom|Ireland/.test(meta.country || "")) return "ni";
  if (REGIONS.us.bounds.contains([meta.lat, meta.lon]) && /United States/.test(meta.country || "")) return "us";
  if (REGIONS.mx.bounds.contains([meta.lat, meta.lon]) && /Mexico/.test(meta.country || "")) return "mx";
  return null;
}
const wallRegion = (p) => (/^Hadrian's Wall$/.test(p.name || "") ? ["hw"] : /Northern Ireland/.test(p.countries || "") ? ["ni"] : /United States/.test(p.countries || "") && /Mexico/.test(p.countries || "") ? ["us", "mx"] : null);

function popupHtml(p) {
  // Summary first; detail sections open with an arrow (native <details>)
  const or = (v, fallback = "Not documented") => (v ? v : fallback);
  const period = p.status
    ? (p.built == null ? p.status : `Started ${formatYear(p.built)} · ${p.status}`)
    : p.built == null
      ? "Date unknown"
      : `${formatYear(p.built)} – ${p.removed ? formatYear(p.removed) : "present"}`;
  const length = p.length_km ? `About ${p.length_km} km` : "Length not given";
  const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
  const section = (title, rows, open = false) => `<details${open ? " open" : ""}>
      <summary>${title}</summary>
      <dl>${rows}</dl>
    </details>`;
  // A section with one item shows the text alone, without repeating the section title as a label
  const single = (title, text) => `<details>
      <summary>${title}</summary>
      <p class="fiche-text">${text}</p>
    </details>`;
  // Repeated values are shown once: same countries in "separates", same body as initiator and owner
  const same = (a, b) => {
    const n = (s) => String(s || "").toLowerCase().replace(/[–—-]/g, "/").replace(/[^a-z/]/g, "");
    return n(a) && (n(a) === n(b) || n(b).includes(n(a)));
  };
  const showSeparates = p.separates && p.separates !== "Not documented" && !same(p.separates, p.countries);
  const showOwner = p.owner && !same(p.owner, p.initiated_by);
  // Ballif & Rosière's category is shown apart from the physical type, and their article is then cited
  const cat = CATEGORY_LABELS[p.typology] || (p.typology ? p.typology : "");
  const sources = [...new Set([...(p.sources || []), ...(cat ? [BALLIF_ROSIERE] : [])])];
  const citeExtra = cat ? "(Ballif and Rosière, 2009)" : "";
  const refs = sources.length
    ? `<ol class="refs">${sources.map((r) => `<li>${r}</li>`).join("")}</ol>`
    : "Not documented";
  const citeParts = [...new Set([...(p.cite ? p.cite.split(/;\s*/) : []), citeExtra].map((s) => s.trim()).filter(Boolean))];
  const cite = citeParts.length ? `<p class="cite">In-text: ${citeParts.join("; ")}</p>` : "";
  const construction = [p.construction ? or(p.construction) : "", p.phases ? `Phases: ${p.phases}` : "", p.geometry_quality ? `Line on the map: ${p.geometry_quality}.` : ""]
    .filter(Boolean);
  return `<div class="fiche">
    <div class="fiche-title">${p.name}</div>
    ${wallRegion(p) ? `<button type="button" class="compare-btn compare-maps-btn" data-layer-compare="${wallRegion(p)[0]}">Compare neighbourhood maps side by side</button>` : ""}
    <dl class="summary">
      ${row("Location", `${or(p.countries)}${showSeparates ? ` · separates ${p.separates}` : ""}`)}
      ${row("Type", or(TYPE_LABELS[p.type] || p.type))}
      ${cat ? row("Category", cat) : ""}
      ${row("Length", `${length}`)}
      ${row(p.status ? "Status" : "Years", period)}
      ${p.planned_start ? row("Planned start", p.planned_start) : ""}
      ${p.planned_purpose ? row("Stated purpose", or(p.purpose)) : ""}
      ${row(showOwner ? "Initiator and owner" : "Initiator", `${or(p.initiated_by)}${showOwner ? ` · owner: ${p.owner}` : ""}`)}
      ${row(p.planned_budget ? "Provisional budget" : "Cost", or(p.cost, "Unknown"))}
    </dl>
    ${section("Funding and budget", `${row("Funded by", or(p.funded_by))}${row("Maintenance and annual budget", or(p.maintenance_cost, "Unknown"))}`)}
    ${section("Security equipment and gates", `${row("Additional equipment", or(p.security_technology))}${row("Gates and crossing points", or(p.gates))}`)}
    ${single("Construction", construction.length ? construction.join("<br>") : "Not documented")}
    ${section("Purpose and status", `${row("Stated purpose", or(p.purpose))}${row("Status", `${p.status ? `${p.status}. ` : ""}${or(p.term_note, "No term or removal recorded")}`)}`)}
    ${wallRegion(p) ? single("Income, employment and population by neighbourhood", themePickerHtml(wallRegion(p))) : ""}
    ${wallRegion(p) && wallRegion(p).includes("us") && window.borderTimelineHtml ? single("Border over time", window.borderTimelineHtml()) : ""}
    ${/Northern Ireland \(Belfast|within Belfast/.test(p.countries || "") ? belfastHistoryHtml() + belfast7101Html() : ""}
    ${wallRegion(p) && wallRegion(p)[0] === "ni" ? niJobsHtml(/Belfast/.test(p.countries || "")) : ""}
    ${p.name === "Hadrian's Wall" ? hadrianSidesHtml() + hadrianGridHtml() : ""}
    ${p.note ? single("Notes", p.note) : ""}
    <details class="refs-box">
      <summary>References (Harvard)</summary>
      ${cite}
      ${refs}
    </details>
  </div>`;
}

function update() {
  const year = Number(yearInput.value);
  if (typeof refreshSettlements === "function") refreshSettlements();
  const query = searchInput.value.trim().toLowerCase();
  yearLabel.textContent = year;

  let count = 0;
  let km = 0;
  for (const b of barriers) {
    const p = b.feature.properties;
    // The border timeline draws the US–Mexico fence itself, year by year
    const hidden = window.timelineHidesUSMexico && /United States/.test(p.countries || "") && /Mexico/.test(p.countries || "");
    const standing = isStanding(p, year);
    const matches = !query || `${p.name} ${p.countries}`.toLowerCase().includes(query);

    if (standing && matches && !hidden) {
      barriersLayer.addLayer(b.layer);
      // Highlight barriers built in the selected year
      b.layer.setStyle({ weight: p.built === year ? 8 : 4 });
    } else {
      barriersLayer.removeLayer(b.layer);
    }
    // Unfinished walls are on the map and in the list, but not in the totals
    if (standing && p.built != null && !p.status) {
      count += 1;
      km += p.length_km || 0;
    }
    b.listItem.style.display = matches ? "" : "none";
    b.listItem.classList.toggle("hidden-by-year", !standing);
  }
  statCount.textContent = count;
  statKm.textContent = Math.round(km).toLocaleString("en");
}

fetch("data/barriers.geojson")
  .then((r) => r.json())
  .then((data) => {
    // Undated barriers go to the end of the list
    const yearKey = (f) => (f.properties.built == null ? Infinity : f.properties.built);
    const features = data.features.sort((a, b) => (yearKey(a) < yearKey(b) ? -1 : yearKey(a) > yearKey(b) ? 1 : 0));
    for (const feature of features) {
      const p = feature.properties;
      // Area-only barriers (no surveyed line) are a dot at their centre; surveyed ones are a line
      const areaOnly = /^(approximate|placeholder)/.test(p.geometry_quality || "");
      const cls = p.historical ? "historical" : constructionClass(p);
      const color = CONSTRUCTION_COLORS[cls];
      const casingColor = CASING_COLORS[cls];
      const cased = Boolean(casingColor);
      let layer;
      if (areaOnly) {
        const dot = p.status ? { radius: 8, color, weight: 2.5, fillColor: "#fff", fillOpacity: 1 } : dotStyle(color, 8);
        if (cased && !p.status) dot.color = color;
        const centre = L.geoJSON(feature).getBounds().getCenter();
        const parts = [L.circleMarker(centre, dot)];
        if (cased) parts.unshift(asCasing(L.circleMarker(centre, { radius: dot.radius, color: casingColor, weight: dot.weight + CASING_EXTRA, fill: false })));
        layer = L.featureGroup(parts);
      } else {
        const coords = feature.geometry.coordinates;
        if (feature.geometry.type === "MultiLineString" && coords.length > 1) {
          // Many pieces: keep each one, and show them by length as you zoom
          layer = L.featureGroup();
          layer.style = { color, weight: 4, dashArray: p.status ? dottedDash(cased) : null };
          layer.cased = cased;
          layer.casingColor = casingColor;
          layer.pieces = coords.map((c) => {
            const latlngs = c.map(([lon, lat]) => [lat, lon]);
            let km = 0;
            for (let i = 1; i < latlngs.length; i++) km += map.distance(latlngs[i - 1], latlngs[i]) / 1000;
            return { km, latlngs };
          });
          layer.connectors = connectorsFor(layer.pieces);
          refreshPieces(layer);
        } else {
          // A surveyed barrier is drawn as its line only; no extra dot
          // Planned or under-construction sections are dotted
          const style = { color, weight: 4, dashArray: p.status ? dottedDash(cased) : null };
          // Created first so it draws underneath: Leaflet orders a group's layers by creation
          const parts = cased ? [asCasing(L.geoJSON(feature, { style: { ...style, color: casingColor, weight: style.weight + CASING_EXTRA } }))] : [];
          parts.push(L.geoJSON(feature, { style }));
          layer = L.featureGroup(parts);
        }
      }
      layer.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        showInfoCard(popupHtml(p));
      });

      const listItem = document.createElement("li");
      const when = p.status ? (p.built != null ? `${formatYear(p.built)} · ${p.status}` : p.status) : p.built == null ? "date unknown" : formatYear(p.built);
      const plannedLines = p.planned_start ? `<small>Start: ${p.planned_start}</small><small>Budget: ${p.planned_budget}</small><small>Purpose: ${p.planned_purpose}</small>` : "";
      listItem.innerHTML = `${p.name}<small>${p.countries}${p.planned_start ? "" : ` · ${when}`}</small>${plannedLines}`;
      listItem.addEventListener("click", () => {
        if (!isStanding(p, Number(yearInput.value))) {
          yearInput.value = p.built != null ? p.built : yearInput.max;
          update();
        }
        map.fitBounds(layer.getBounds(), { maxZoom: 10, padding: [40, 40] });
        showInfoCard(popupHtml(p));
        document.body.classList.remove("panel-open");
      });
      const ongoing = /^Under construction/.test(p.status || "");
      (p.abandoned ? droppedList : p.status && !ongoing ? plannedList : list).appendChild(listItem);

      barriers.push({ feature, layer, listItem });
    }
    update();
  });

// Timeline animation
let timer = null;
playButton.addEventListener("click", () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
    playButton.textContent = "▶ Play";
    return;
  }
  if (Number(yearInput.value) >= Number(yearInput.max)) yearInput.value = yearInput.min;
  playButton.textContent = "❚❚ Pause";
  timer = setInterval(() => {
    const next = Number(yearInput.value) + 1;
    if (next > Number(yearInput.max)) {
      playButton.click();
      return;
    }
    yearInput.value = next;
    update();
  }, 250);
});

yearInput.addEventListener("input", update);
searchInput.addEventListener("input", update);

// Undo: back to the present year, no search, the whole world in view
document.getElementById("reset").addEventListener("click", () => {
  if (timer) playButton.click();
  yearInput.value = yearInput.max;
  searchInput.value = "";
  closeInfoCard();
  map.setView([30, 20], 3);
  update();
});

// Light and dark mode: starts from the system setting, then remembers the user's choice
const themeToggle = document.getElementById("theme-toggle");
function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
  // Night-time map: the land layer is recoloured here; terrain and satellite tiles are darkened in style.css
  applyLandStyle();
  themeToggle.setAttribute("aria-checked", String(mode === "dark"));
  themeToggle.querySelector(".thumb").textContent = mode === "dark" ? "☾" : "☀︎";
}
let savedTheme = null;
try {
  savedTheme = localStorage.getItem("theme");
} catch (e) {
  // Storage can be blocked; the system setting still applies
}
applyTheme(savedTheme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("theme", next);
  } catch (e) {
    // Choice applies for this visit only
  }
});
