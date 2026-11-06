// Teichopolitics map: border barriers shown by the year they were built.

// Colour by construction type (see constructionClass)
const CONSTRUCTION_COLORS = {
  concrete: "#b3261e", // concrete, stone or brick wall
  steel: "#d97706",    // steel or mesh fence
  wire: "#7c3aed",     // barbed or razor wire
  earth: "#7c5c3b",    // earthwork, sand berm, trench
  unknown: "#6b6b6b",  // not documented, or mixed
  historical: "#2f6f8f", // historical walls, no longer used as borders
};

// Sort a barrier into a construction class from its free-text construction field
function constructionClass(p) {
  const c = (p.construction || "").toLowerCase();
  if (c.includes("mixed")) return "unknown";
  if (/concrete|stone|brick|block|blast/.test(c)) return "concrete";
  if (/earth|sand|berm|dune|rammed|turf|trench/.test(c)) return "earth";
  if (/steel|mesh|bollard|palisade|electronic/.test(c)) return "steel";
  if (/wire|razor|barbed|concertina|blade/.test(c)) return "wire";
  return "unknown";
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
  for (const p of group.pieces) {
    if (!p.line) p.line = L.polyline(p.latlngs, { ...group.style });
    p.line.setStyle({ weight });
    group.addLayer(p.line);
  }
  for (const c of group.connectors || []) {
    if (!c.line) c.line = L.polyline(c.latlngs, { ...group.style, dashArray: "2 6" });
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
const landLayer = L.geoJSON(null, { style: { fillColor: LAND.light.fill, fillOpacity: 1, color: LAND.light.stroke, weight: 0.6 } });
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
// Deprivation by small area (NISRA, NIMDM 2017): classes by national decile of the overall rank (1 = most deprived)
const DEP_CLASSES = [
  { max: 1, color: "#67001f", label: "Most deprived 10% of Northern Ireland" },
  { max: 2, color: "#b2182b", label: "10–20%" },
  { max: 4, color: "#e0785f", label: "20–40%" },
  { max: 7, color: "#f4c9a8", label: "40–70%" },
  { max: 10, color: "#f7f1e8", label: "Least deprived 30%" },
];
const SA_COUNT = 4537;
function depClass(rank) {
  const decile = Math.min(10, Math.ceil((rank / SA_COUNT) * 10));
  return DEP_CLASSES.find((c) => decile <= c.max);
}
const legend = L.control({ position: "bottomleft" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "map-legend" + (SMALL_SCREEN ? " collapsed" : ""));
  div.innerHTML = `
    <button type="button" class="legend-toggle" aria-expanded="${!SMALL_SCREEN}">Legend</button>
    <div class="legend-body">
    <p class="legend-title">Construction</p>
    <div><span class="swatch concrete"></span>Concrete, stone or brick wall</div>
    <div><span class="swatch steel"></span>Steel or mesh fence</div>
    <div><span class="swatch wire"></span>Barbed or razor wire</div>
    <div><span class="swatch earth"></span>Earthwork, sand berm or trench</div>
    <div><span class="swatch unknown"></span>Not documented or mixed</div>
    <div><span class="swatch historical"></span>Historical, no longer a border</div>
    <p class="legend-title">Shape</p>
    <div><span class="swatch line"></span>Line: traced on the ground</div>
    <div><span class="swatch dotted"></span>Dotted: planned, under construction, or a gap between traced pieces</div>
    <div><span class="swatch dot"></span>Dot: location only, route not traced</div>
    <div><span class="swatch border"></span>Dashed: official country border</div>
    <div class="legend-dep" hidden>
      <p class="legend-title">Deprivation, Northern Ireland (2017)</p>
      ${DEP_CLASSES.map((c) => `<div><span class="swatch fill" style="background:${c.color}"></span>${c.label}</div>`).join("")}
    </div>
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
// Deprivation around the peace walls (Belfast, Derry, Lurgan, Portadown): off by default, loaded when switched on
map.createPane("context");
map.getPane("context").style.zIndex = 370;
const depLayer = L.layerGroup();
let depLoaded = false;
function depCardHtml(p) {
  const c = depClass(p.mdm);
  const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
  return `<div class="fiche">
    <div class="fiche-title">${p.area.replace(/_/g, " ")} · small area ${p.sa}</div>
    <dl>
      ${row("Council area", p.lgd)}
      ${row("Overall deprivation", `Rank ${p.mdm.toLocaleString("en")} of ${SA_COUNT.toLocaleString("en")} (1 = most deprived): ${c.label.toLowerCase()}`)}
      ${row("Low income", `${p.low_income_pct}% of residents live in households below 60% of the Northern Ireland median income (income rank ${p.inc_rank.toLocaleString("en")})`)}
      ${row("Employment deprivation", `${p.emp_deprived_pct}% of working-age residents are employment deprived (employment rank ${p.emp_rank.toLocaleString("en")})`)}
    </dl>
    <p class="cite">Most indicators relate to 2015/16. In-text: (NISRA, 2017)</p>
    <p class="cite">References: NISRA (2017) Northern Ireland Multiple Deprivation Measure 2017: Small Area level results. Belfast: Northern Ireland Statistics and Research Agency. Available at: https://www.nisra.gov.uk/publications/nimdm17-sa-level-results (Accessed: 6 November 2026). NISRA (2013) Small Area boundaries in GIS format. Available at: https://www.nisra.gov.uk/publications/small-area-boundaries-gis-format (Accessed: 6 November 2026).</p>
  </div>`;
}
map.on("overlayadd", (e) => {
  if (e.layer !== depLayer) return;
  document.querySelector(".legend-dep").hidden = false;
  if (depLoaded) return;
  depLoaded = true;
  fetch("data/ni-deprivation.json")
    .then((r) => r.json())
    .then((fc) => {
      L.geoJSON(fc, {
        pane: "context",
        style: (f) => ({ fillColor: depClass(f.properties.mdm).color, fillOpacity: 0.6, color: "#ffffff", weight: 0.4, opacity: 0.7 }),
        onEachFeature: (f, lyr) => lyr.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          showInfoCard(depCardHtml(f.properties));
        }),
      }).addTo(depLayer);
    });
});
map.on("overlayremove", (e) => {
  if (e.layer === depLayer) document.querySelector(".legend-dep").hidden = true;
});

const layerControl = L.control.layers(baseLayers, {
  "Border barriers": barriersLayer,
  "Country borders": bordersLayer,
  "Roads, railways and rivers": networkLayer,
  "Place names": labelLayer,
  "Deprivation around Northern Ireland's peace walls (2017)": depLayer,
}, { collapsed: false }).addTo(map);

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
  infoBody.innerHTML = html;
  card.className = "info-card leaflet-control" + (extraClass ? " " + extraClass : "");
  card.hidden = false;
  fitInfoCard();
  infoBody.scrollTop = 0;
}
function closeInfoCard() {
  infoCard.getContainer().hidden = true;
}
window.addEventListener("resize", fitInfoCard);
// Opening or closing a section changes nothing in the card's frame; the content scrolls
map.on("click", closeInfoCard);

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
            labelData = { countries, places, natural, census: {} };
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

// City popup: population and census details, from data/city-census.json where available
function cityPopupHtml(en, meta) {
  let c = (labelData && labelData.census && labelData.census[en]) || null;
  // Records with coordinates only apply to the city of that name within 60 km (several places share a name)
  if (c && c.lat != null && Math.hypot((c.lon - meta.lon) * Math.cos((meta.lat * Math.PI) / 180), c.lat - meta.lat) * 111 > 60) c = null;
  const pop = meta.pop ? `${Number(meta.pop).toLocaleString("en")} (GeoNames or Natural Earth estimate)` : "Not documented";
  const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
  const census = c
    ? `${row("Latest census", `${c.census_year}: ${Number(c.population).toLocaleString("en")}${c.area_note ? ` (${c.area_note})` : ""}`)}
       ${row("Ethnic / national groups", c.ethnic || "Not documented")}
       ${row("Languages", c.language || "Not documented")}
       ${row("Religion", c.religion || "Not documented")}
       ${c.economy ? row("Income and employment", c.economy) : ""}
       ${c.cite ? `<dt>Source</dt><dd>${c.cite}</dd>` : ""}`
    : row("Census", "No census data added yet for this city");
  const censusRefs = c && c.sources ? c.sources.map((s) => `<li>${s}</li>`).join("") : "";
  return `<div class="fiche city-fiche">
    <div class="fiche-title">${en}</div>
    <dl>
      ${row("Country", meta.country || "Not documented")}
      ${row("Population", pop)}
      ${row("Population density", meta.density ? `${Number(meta.density).toLocaleString("en")} per km² (built-up area of ${Number(meta.area_km2).toLocaleString("en")} km²; Natural Earth urban areas)` : "Not available (no built-up area matched to this city)")}
      ${census}
    </dl>
    <details>
      <summary>References (Harvard)</summary>
      <p class="cite">In-text: (GeoNames, n.d.; Natural Earth, n.d.)${c && c.cite ? "; " + c.cite : ""}</p>
      <ol class="refs">
        <li>GeoNames (n.d.) GeoNames gazetteer, cities with population above 15,000. Available at: https://download.geonames.org/export/dump/ (Accessed: 6 November 2026).</li>
        <li>Natural Earth (n.d.) Populated places and urban areas, 10m. Available at: https://www.naturalearthdata.com/ (Accessed: 6 November 2026).</li>
        ${censusRefs}
      </ol>
    </details>
  </div>`;
}

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
          showInfoCard(cityPopupHtml(en, meta), "city-card");
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
  if (props.built == null) return true;
  return props.built <= year && (props.removed == null || props.removed > year);
}

function popupHtml(p) {
  // Summary first; detail sections open with an arrow (native <details>)
  const or = (v, fallback = "Not documented") => (v ? v : fallback);
  const period = p.built == null
    ? "Date unknown"
    : `${formatYear(p.built)} – ${p.removed ? formatYear(p.removed) : "present"}`;
  const length = p.length_km ? `About ${p.length_km} km` : "Length not given";
  const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
  const section = (title, rows, open = false) => `<details${open ? " open" : ""}>
      <summary>${title}</summary>
      <dl>${rows}</dl>
    </details>`;
  const refs = (p.sources || []).length
    ? `<ol class="refs">${(p.sources || []).map((r) => `<li>${r}</li>`).join("")}</ol>`
    : "Not documented";
  const cite = p.cite ? `<p class="cite">In-text: ${p.cite}</p>` : "";
  return `<div class="fiche">
    <div class="fiche-title">${p.name}</div>
    <dl class="summary">
      ${row("Location", `${or(p.countries)}${p.separates ? ` · separates ${p.separates}` : ""}`)}
      ${row("Type", `${or(p.type)}${p.typology ? ` · ${p.typology}` : ""}`)}
      ${row("Length", `${length}`)}
      ${row("Years", period)}
      ${row("Initiator and owner", `${or(p.initiated_by)}${p.owner ? ` · owner: ${p.owner}` : ""}`)}
      ${row("Cost", or(p.cost, "Unknown"))}
    </dl>
    ${section("Funding and budget", `${row("Funded by", or(p.funded_by))}${row("Maintenance and annual budget", or(p.maintenance_cost, "Unknown"))}`)}
    ${section("Security equipment and gates", `${row("Additional equipment", or(p.security_technology))}${row("Gates and crossing points", or(p.gates))}`)}
    ${section("Construction", `${row("Construction", or(p.construction))}${p.phases ? row("Phases", p.phases) : ""}${p.geometry_quality ? row("Line", p.geometry_quality) : ""}`)}
    ${section("Purpose and status", `${row("Stated purpose", or(p.purpose))}${row("Status", `${p.status ? `${p.status}. ` : ""}${or(p.term_note, "No term or removal recorded")}`)}`)}
    ${section("Notes", row("Notes", or(p.note, "None")))}
    <details class="refs-box">
      <summary>References (Harvard)</summary>
      ${cite}
      ${refs}
    </details>
  </div>`;
}

function update() {
  const year = Number(yearInput.value);
  const query = searchInput.value.trim().toLowerCase();
  yearLabel.textContent = year;

  let count = 0;
  let km = 0;
  for (const b of barriers) {
    const p = b.feature.properties;
    const standing = isStanding(p, year);
    const matches = !query || `${p.name} ${p.countries}`.toLowerCase().includes(query);

    if (standing && matches) {
      barriersLayer.addLayer(b.layer);
      // Highlight barriers built in the selected year
      b.layer.setStyle({ weight: p.built === year ? 8 : 4 });
    } else {
      barriersLayer.removeLayer(b.layer);
    }
    if (standing && p.built != null) {
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
      const color = p.historical ? CONSTRUCTION_COLORS.historical : CONSTRUCTION_COLORS[constructionClass(p)];
      let layer;
      if (areaOnly) {
        layer = L.featureGroup([L.circleMarker(L.geoJSON(feature).getBounds().getCenter(), dotStyle(color, 8))]);
      } else {
        const coords = feature.geometry.coordinates;
        if (feature.geometry.type === "MultiLineString" && coords.length > 1) {
          // Many pieces: keep each one, and show them by length as you zoom
          layer = L.featureGroup();
          layer.style = { color, weight: 4, dashArray: p.status ? "2 6" : null };
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
          layer = L.featureGroup([L.geoJSON(feature, { style: { color, weight: 4, dashArray: p.status ? "2 6" : null } })]);
        }
      }
      layer.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        showInfoCard(popupHtml(p));
      });

      const listItem = document.createElement("li");
      listItem.innerHTML = `${p.name}<small>${p.countries} · ${p.built == null ? "date unknown" : formatYear(p.built)}</small>`;
      listItem.addEventListener("click", () => {
        if (p.built != null && !isStanding(p, Number(yearInput.value))) {
          yearInput.value = p.built;
          update();
        }
        map.fitBounds(layer.getBounds(), { maxZoom: 10, padding: [40, 40] });
        showInfoCard(popupHtml(p));
        document.body.classList.remove("panel-open");
      });
      list.appendChild(listItem);

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
