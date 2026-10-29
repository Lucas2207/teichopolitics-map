// Teichopolitics map: border barriers shown by the year they were built.

const COLORS = { wall: "#b3261e", fence: "#d97706", berm: "#7c5c3b" };

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

// Overlays
const barriersLayer = L.layerGroup().addTo(map);
const bordersLayer = L.layerGroup();
const layerControl = L.control.layers(baseLayers, {
  "Border barriers": barriersLayer,
  "Country borders": bordersLayer,
}, { collapsed: false }).addTo(map);

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

function isStanding(props, year) {
  return props.built <= year && (props.removed == null || props.removed > year);
}

function popupHtml(p) {
  const period = p.removed ? `${p.built}–${p.removed}` : `${p.built}–present`;
  return `<strong>${p.name}</strong><br>${p.countries}<br>
    ${period} · ${p.type} · ~${p.length_km} km<br><em>${p.note || ""}</em>`;
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
    if (standing) {
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
    const features = data.features.sort((a, b) => a.properties.built - b.properties.built);
    for (const feature of features) {
      const p = feature.properties;
      const layer = L.geoJSON(feature, {
        style: {
          color: COLORS[p.type] || "#333",
          weight: 4,
          dashArray: p.type === "berm" ? "8 6" : null,
        },
      }).bindPopup(popupHtml(p));

      const listItem = document.createElement("li");
      listItem.innerHTML = `${p.name}<small>${p.countries} · ${p.built}</small>`;
      listItem.addEventListener("click", () => {
        if (!isStanding(p, Number(yearInput.value))) {
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
