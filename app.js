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

const map = L.map("map", { worldCopyJump: true }).setView([30, 20], 3);

// Base maps (all free, attribution required)
// Street map: country shapes in the page's own colours. Drawn here, so it carries no names of its own
const LAND = {
  light: { sea: "#dbe4ea", fill: "#f2f2ef", stroke: "#bdbdb6" },
  dark: { sea: "#0f141b", fill: "#2a2a31", stroke: "#4a4a55" },
};
const landLayer = L.geoJSON(null, { style: { fillColor: LAND.light.fill, fillOpacity: 1, color: LAND.light.stroke, weight: 0.6 } });
function applyLandStyle() {
  const t = document.documentElement.dataset.theme === "dark" ? LAND.dark : LAND.light;
  landLayer.setStyle({ fillColor: t.fill, color: t.stroke, fillOpacity: 1, weight: 0.6 });
  map.getContainer().style.background = t.sea;
}

const baseLayers = {
  "Map": landLayer,
  // Shaded relief has no place names, so only the labels on this page appear
  "Terrain": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 13,
    attribution: "Tiles &copy; Esri",
  }),
  "Satellite": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri, Maxar, Earthstar Geographics",
  }),
};
landLayer.addTo(map);

// Scale bar (metric only, as the data is in kilometres)
L.control.scale({ metric: true, imperial: false }).addTo(map);

// Overlays
const barriersLayer = L.layerGroup().addTo(map);
const bordersLayer = L.layerGroup();
const labelLayer = L.layerGroup().addTo(map);
const layerControl = L.control.layers(baseLayers, {
  "Border barriers": barriersLayer,
  "Country borders": bordersLayer,
  "Place names": labelLayer,
}, { collapsed: false }).addTo(map);

// Place names: English, with the native name where known. More appear as you zoom in.
const nativeNames = document.getElementById("native-names");
let labelData = null;
fetch("data/labels-countries.json")
  .then((r) => r.json())
  .then((countries) => {
    fetch("data/labels-places.json")
      .then((r) => r.json())
      .then((places) => {
        labelData = { countries, places };
        renderLabels();
      });
  });

function labelIcon(en, native, kind) {
  // English sits just above the native name, in a smaller, more transparent style.
  // Native names are shown only when the switch is on and they differ from the English name.
  const showSub = nativeNames.checked && native && native.toLowerCase() !== en.toLowerCase();
  const sub = showSub ? `<small>${native}</small>` : "";
  return L.divIcon({ className: `map-label ${kind}`, html: `<span class="label-inner"><span class="label-en">${en}</span>${sub}</span>`, iconSize: null });
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
  function place(en, native, lat, lon, kind) {
    const pt = map.latLngToContainerPoint([lat, lon]);
    const sub = showNative && native && native.toLowerCase() !== en.toLowerCase();
    const w = en.length * (kind === "country" ? 7.5 : 6.5) + 8;
    const h = kind === "country" ? (sub ? 30 : 16) : (sub ? 26 : 14);
    const x = pt.x - w / 2;
    const y = pt.y - h / 2;
    if (placed.some((b) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y)) return;
    placed.push({ x, y, w, h });
    L.marker([lat, lon], { icon: labelIcon(en, native, kind), interactive: false, keyboard: false }).addTo(labelLayer);
  }
  // Countries: largest rank first; more ranks are allowed as you zoom in
  const maxRank = zoom <= 2 ? 2 : zoom <= 3 ? 3 : zoom <= 4 ? 4 : zoom <= 5 ? 5 : 7;
  const countries = labelData.countries
    .filter((c) => c.rank <= maxRank && bounds.contains([c.lat, c.lon]))
    .sort((a, b) => a.rank - b.rank);
  for (const c of countries) place(c.en, c.native, c.lat, c.lon, "country");
  // Cities: from zoom 4, most important first, never repeating a country name
  const countryNames = new Set(labelData.countries.map((c) => c.en));
  const cities = labelData.places
    .filter((p) => Math.max(p.min_zoom, 4) <= zoom && !countryNames.has(p.en) && bounds.contains([p.lat, p.lon]))
    .sort((a, b) => a.min_zoom - b.min_zoom);
  for (const p of cities) place(p.en, p.native, p.lat, p.lon, "place");
}
map.on("moveend", renderLabels);
nativeNames.addEventListener("change", renderLabels);

// Country borders from Natural Earth (via world-atlas)
fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json")
  .then((r) => r.json())
  .then((topo) => {
    const countries = topojson.feature(topo, topo.objects.countries);
    landLayer.addData(countries);
    applyLandStyle();
    L.geoJSON(countries, {
      style: { color: "#555", weight: 0.8, fill: false, dashArray: "3 3" },
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
  const period = p.built == null
    ? "date unknown"
    : `${formatYear(p.built)}–${p.removed ? formatYear(p.removed) : "present"}`;
  const separates = p.separates ? `<br>Separates: ${p.separates}` : "";
  const owner = p.owner ? `<br>Owner: ${p.owner}` : "";
  const initiator = p.initiated_by ? `<br>Initiated by: ${p.initiated_by} (${p.initiator_type || "unknown"})` : "";
  const cost = p.cost ? `<br>Cost: ${p.cost}` : "";
  const maintenance = p.maintenance_cost ? `<br>Maintenance: ${p.maintenance_cost}` : "";
  const technology = p.security_technology ? `<br>Security technology: ${p.security_technology}` : "";
  const construction = p.construction ? `<br>Construction: ${p.construction}` : "";
  const quality = p.geometry_quality ? `<br><small>Line: ${p.geometry_quality}</small>` : "";
  const typology = p.typology ? `<br>Typology (Ballif & Rosière 2009): ${p.typology}` : "";
  const purpose = p.purpose ? `<br>Stated purpose: ${p.purpose}` : "";
  const term = p.term_note ? `<br>Term: ${p.term_note}` : "";
  const contractors = p.contractors ? `<br>Contractors: ${p.contractors}` : "";
  const sources = (p.sources || []).length
    ? `<br><small>Sources: ${p.sources.map((u) => `<a href="${u}" target="_blank" rel="noopener">${new URL(u).hostname}</a>`).join(", ")}</small>`
    : "";
  return `<strong>${p.name}</strong><br>${p.countries}${separates}${owner}${initiator}${typology}${purpose}${term}${cost}${maintenance}${construction}${technology}${contractors}<br>
    ${period} · ${p.type} · ~${p.length_km} km${quality}<br><em>${p.note || ""}</em>${sources}`;
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
  statKm.textContent = km.toLocaleString();
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
        // A surveyed barrier is drawn as its line only; no extra dot
        layer = L.featureGroup([L.geoJSON(feature, { style: { color, weight: 4 } })]);
      }
      layer.bindPopup(popupHtml(p));

      const listItem = document.createElement("li");
      listItem.innerHTML = `${p.name}<small>${p.countries} · ${p.built == null ? "date unknown" : formatYear(p.built)}</small>`;
      listItem.addEventListener("click", () => {
        if (p.built != null && !isStanding(p, Number(yearInput.value))) {
          yearInput.value = p.built;
          update();
        }
        map.fitBounds(layer.getBounds(), { maxZoom: 10, padding: [40, 40] });
        layer.openPopup();
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
  map.closePopup();
  map.setView([30, 20], 3);
  update();
});

// Light and dark mode: starts from the system setting, then remembers the user's choice
const themeToggle = document.getElementById("theme-toggle");
function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
  // Night-time map: CARTO dark tiles built on OpenStreetMap data (see the credits in the page note)
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
