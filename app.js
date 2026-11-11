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
    note: "Share of residents who are not of White ethnic group" },
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
// Places where neighbourhood themes exist. A theme is offered only when the map shows its region
const REGIONS = {
  ni: { name: "Northern Ireland", bounds: L.latLngBounds([54.0, -8.2], [55.35, -5.4]), minZoom: 8, home: [[54.55, -6.02], [54.65, -5.86]] },
  us: { name: "US border", bounds: L.latLngBounds([25.4, -117.8], [33.4, -96.6]), minZoom: 7, home: [[31.6, -106.75], [31.95, -106.15]] },
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
  if (!themeData[src]) themeData[src] = fetch({ sa: "data/ni-deprivation.json", dz: "data/ni-census-dz.json", us: "data/us-border-tracts.json", county: "data/us-border-counties.json", mx: "data/mx-border-municipalities.json", mxageb: "data/mx-border-ageb.json" }[src]).then((r) => r.json());
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
const NISRA_SA_REFS = [
  "NISRA (2017) Northern Ireland Multiple Deprivation Measure 2017: technical report. Belfast: Northern Ireland Statistics and Research Agency. Available at: https://www.nisra.gov.uk/files/nisra/publications/NIMDM%202017_Technical%20Report.pdf (Accessed: 9 November 2026).",
  "NISRA (2017) Northern Ireland Multiple Deprivation Measure 2017: Small Area level results. Belfast: Northern Ireland Statistics and Research Agency. Available at: https://www.nisra.gov.uk/publications/nimdm17-sa-level-results (Accessed: 6 November 2026).",
  "NISRA (2013) Small Area boundaries in GIS format. Available at: https://www.nisra.gov.uk/publications/small-area-boundaries-gis-format (Accessed: 6 November 2026).",
];
function areaCardHtml(p, src) {
  const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
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
    </dl>
    ${refs(NISRA_DZ_REFS, "(NISRA, 2023)")}
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
    Object.entries(THEMES).filter(([, th]) => th.region === r).forEach(([k, th]) => {
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
      ${row("GDP per person", yr(p.gdp, (v) => `US$${n(Math.round(v))}`))}
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
// What a city card and the comparison both show
function cityFields(en, meta) {
  let c = (labelData && labelData.census && labelData.census[en]) || null;
  // Records with coordinates only apply to the city of that name within 60 km (several places share a name)
  if (c && c.lat != null && Math.hypot((c.lon - meta.lon) * Math.cos((meta.lat * Math.PI) / 180), c.lat - meta.lat) * 111 > 60) c = null;
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
    economy: (c && c.economy) || "",
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
    <button type="button" class="compare-btn" data-compare>Compare with another city</button>
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
    ${en === "Belfast" ? belfastHistoryHtml() : ""}
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

// Comparing two cities: from a city card, type a name or click a city on the map
let currentCity = null;
let compareFrom = null; // set while the visitor is choosing the second city
function showCity(city) {
  showInfoCard(cityPopupHtml(city.en, city.meta), "city-card");
  currentCity = city;
}
function showComparePicker(from) {
  showInfoCard(`<div class="fiche">
    <div class="fiche-title">Compare ${from.en} with…</div>
    <p class="fiche-text">Type a city's name, or click a city on the map.</p>
    <input id="compare-input" class="compare-input" type="search" placeholder="City name" aria-label="City to compare with" autocomplete="off">
    <ul id="compare-list" class="compare-list"></ul>
    <button type="button" class="compare-btn" data-compare-back>Back to ${from.en}</button>
  </div>`, "city-card");
  compareFrom = from;
  currentCity = from;
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
    if (name.includes(q) && !(p.en === compareFrom.en && p.lat === compareFrom.meta.lat)) found.push({ p, i, starts: name.startsWith(q) });
  });
  found.sort((a, b) => b.starts - a.starts || (b.p.pop || 0) - (a.p.pop || 0));
  list.innerHTML = found.length
    ? found.slice(0, 8).map(({ p, i }) => `<li><button type="button" data-pick="${i}">${p.en}<small>${p.country || ""}</small></button></li>`).join("")
    : "<li class=\"compare-none\">No city of that name on the map</li>";
}
function comparisonHtml(a, b) {
  const fa = cityFields(a.en, a.meta);
  const fb = cityFields(b.en, b.meta);
  const pair = (x, y) => `<div class="cmp-pair"><div>${x}</div><div>${y}</div></div>`;
  const row = (label, key) => `<dt>${label}</dt><dd>${pair(fa[key], fb[key])}</dd>`;
  const fold = (title, x, y) => `<details>
      <summary>${title}</summary>
      <div class="fiche-text">${pair(x, y)}</div>
    </details>`;
  const na = nationalRows(a.meta.country);
  const nb = nationalRows(b.meta.country);
  const labels = [...new Set([...na, ...nb].map(([l]) => l))];
  const val = (rows, l) => (rows.find(([k]) => k === l) || [, "Not available"])[1];
  const national = labels.length
    ? `<details>
      <summary>National figures (not specific to these cities)</summary>
      <dl>${labels.map((l) => `<dt>${l}</dt><dd>${pair(val(na, l), val(nb, l))}</dd>`).join("")}</dl>
    </details>`
    : "";
  const refs = [...new Set([...fa.refs, ...fb.refs])];
  const cites = [...new Set(["(GeoNames, n.d.; Natural Earth, n.d.)", fa.cite, fb.cite].filter(Boolean))].join("; ");
  return `<div class="fiche">
    <div class="fiche-title">${a.en} and ${b.en}</div>
    <div class="compare-actions">
      <button type="button" class="compare-btn" data-compare-change>Change second city</button>
      <button type="button" class="compare-btn" data-compare-back>Back to ${a.en}</button>
    </div>
    <p class="fiche-text">Figures come from different years and national definitions, so compare them with care.</p>
    <div class="cmp-pair cmp-head"><div>${a.en}</div><div>${b.en}</div></div>
    <dl>
      ${row("Country", "country")}
      ${row("Latest census", "census")}
      ${row("Population density", "density")}
    </dl>
    ${fold("Ethnic / national groups", fa.ethnic, fb.ethnic)}
    ${fold("Languages", fa.language, fb.language)}
    ${fold("Religion", fa.religion, fb.religion)}
    ${fold("Income and employment", fa.economy || NOT_FOUND, fb.economy || NOT_FOUND)}
    ${fold("Criminality", fa.crime, fb.crime)}
    ${national}
    <details>
      <summary>References (Harvard)</summary>
      <p class="cite">In-text: ${cites}</p>
      <ol class="refs">${refs.map((r) => `<li>${r}</li>`).join("")}${NATIONAL_REFS}</ol>
    </details>
  </div>`;
}
function showComparison(a, b) {
  showInfoCard(comparisonHtml(a, b), "city-card compare-card");
  currentCity = a;
}
infoBody.addEventListener("click", (e) => {
  const pick = e.target.closest("[data-pick]");
  // These buttons redraw the card: stop here, or the map sees a click from a removed element and closes it
  if (e.target.closest("[data-pick], [data-compare], [data-compare-change], [data-compare-back]")) e.stopPropagation();
  if (pick) {
    const meta = labelData.places[Number(pick.dataset.pick)];
    showComparison(compareFrom, { en: meta.en, meta });
  } else if (e.target.closest("[data-compare]") || e.target.closest("[data-compare-change]")) {
    showComparePicker(currentCity);
  } else if (e.target.closest("[data-compare-back]")) {
    showCity(currentCity);
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
  function place(en, native, lat, lon, kind, meta = null) {
    const pt = map.latLngToContainerPoint([lat, lon]);
    const sub = showNative && native && native.toLowerCase() !== en.toLowerCase();
    const w = en.length * (kind === "country" ? 7.5 : 6.5) + 8;
    const h = kind === "country" ? (sub ? 30 : 16) : (sub ? 26 : 14);
    const x = pt.x - w / 2;
    const y = pt.y - h / 2;
    if (placed.some((b) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y)) return;
    placed.push({ x, y, w, h });
    if (meta) {
      // Cities and capitals are clickable: the card shows population and census details
      L.marker([lat, lon], { icon: labelIcon(en, native, kind), keyboard: false })
        .on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          const city = { en, meta };
          if (compareFrom && !(compareFrom.en === en && compareFrom.meta.lat === meta.lat)) showComparison(compareFrom, city);
          else if (!compareFrom) showCity(city);
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
  for (const c of countries) place(c.en, c.native, c.lat, c.lon, "country");
  // Rivers and mountains (serif, natural features): after the countries, before the cities
  for (const n of labelData.natural || []) {
    if (!bounds.contains([n.lat, n.lon])) continue;
    const need = n.kind === "river" ? (n.tier === 1 ? 5 : 7) : (n.tier === 1 ? 4 : 6);
    if (zoom >= need) place(n.en, "", n.lat, n.lon, n.kind);
  }
  // Cities: from zoom 4, most important first, never repeating a country name
  const countryNames = new Set(labelData.countries.map((c) => c.en));
  const cities = labelData.places
    .filter((p) => Math.max(p.min_zoom, 4) <= zoom && !countryNames.has(p.en) && bounds.contains([p.lat, p.lon]))
    .sort((a, b) => a.min_zoom - b.min_zoom);
  for (const p of cities) place(p.en, p.native, p.lat, p.lon, p.cap ? "capital" : "place", p);
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
function themePickerHtml(regions) {
  return regions.map((r) => `<label class="dep-toggle">${REGIONS[r].name}: show by area on the map
    <select class="theme-select" data-region="${r}">
      <option value="">None</option>
      ${Object.entries(THEMES).filter(([, th]) => th.region === r).map(([k, th]) => `<option value="${k}"${activeThemes[r] === k ? " selected" : ""}>${th.label}</option>`).join("")}
    </select></label>`).join("");
}
// Which themed region a city belongs to (US themes only cover the US side of the border)
function cityRegion(meta) {
  if (REGIONS.ni.bounds.contains([meta.lat, meta.lon]) && /United Kingdom|Ireland/.test(meta.country || "")) return "ni";
  if (REGIONS.us.bounds.contains([meta.lat, meta.lon]) && /United States/.test(meta.country || "")) return "us";
  if (REGIONS.mx.bounds.contains([meta.lat, meta.lon]) && /Mexico/.test(meta.country || "")) return "mx";
  return null;
}
const wallRegion = (p) => (/Northern Ireland/.test(p.countries || "") ? ["ni"] : /United States/.test(p.countries || "") && /Mexico/.test(p.countries || "") ? ["us", "mx"] : null);

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
    ${/Northern Ireland \(Belfast|within Belfast/.test(p.countries || "") ? belfastHistoryHtml() : ""}
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
