// Teichopolitics map: border barriers shown by the year they were built.

// Colour by construction type (see constructionClass)
const CONSTRUCTION_COLORS = {
  concrete: "#b3261e", // concrete, stone or brick wall
  steel: "#d97706",    // steel or mesh fence
  wire: "#7c3aed",     // barbed or razor wire
  earth: "#7c5c3b",    // earthwork, sand berm, trench
  unknown: "#6b6b6b",  // not documented, or mixed
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
const baseLayers = {
  "Streets": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }),
  "Terrain": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: "&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap (CC-BY-SA)",
  }),
  "Satellite": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri, Maxar, Earthstar Geographics",
  }),
};
baseLayers["Streets"].addTo(map);

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
  const sub = native && native !== en ? `<small>${native}</small>` : "";
  return L.divIcon({ className: `map-label ${kind}`, html: `<span class="label-inner">${en}${sub}</span>`, iconSize: null });
}

function renderLabels() {
  if (!labelData) return;
  labelLayer.clearLayers();
  const zoom = map.getZoom();
  const bounds = map.getBounds();
  // Countries: the largest first; a smaller rank shows at a lower zoom
  const maxRank = zoom <= 2 ? 1 : zoom <= 3 ? 2 : zoom <= 4 ? 3 : zoom <= 5 ? 4 : 6;
  for (const c of labelData.countries) {
    if (c.rank > maxRank || !bounds.contains([c.lat, c.lon])) continue;
    L.marker([c.lat, c.lon], { icon: labelIcon(c.en, c.native, "country"), interactive: false, keyboard: false }).addTo(labelLayer);
  }
  // Places: Natural Earth gives each city the zoom at which it appears
  for (const p of labelData.places) {
    if (p.min_zoom > zoom || !bounds.contains([p.lat, p.lon])) continue;
    L.marker([p.lat, p.lon], { icon: labelIcon(p.en, p.native, "place"), interactive: false, keyboard: false }).addTo(labelLayer);
  }
}
map.on("moveend", renderLabels);

// Country borders from Natural Earth (via world-atlas)
fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json")
  .then((r) => r.json())
  .then((topo) => {
    const countries = topojson.feature(topo, topo.objects.countries);
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
      const color = CONSTRUCTION_COLORS[constructionClass(p)];
      let layer;
      if (areaOnly) {
        layer = L.featureGroup([L.circleMarker(L.geoJSON(feature).getBounds().getCenter(), dotStyle(color, 8))]);
      } else {
        const line = L.geoJSON(feature, { style: { color, weight: 4 } });
        layer = L.featureGroup([line]);
        // Short surveyed barriers are under a pixel at world zoom, so they also get a dot
        if ((p.length_km || 0) < 25) layer.addLayer(L.circleMarker(line.getBounds().getCenter(), dotStyle(color, 6)));
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
