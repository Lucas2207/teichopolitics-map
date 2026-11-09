// US–Mexico border timeline: a tickable layer with its own year slider, offered when the map shows the border.
// Bubbles per Border Patrol sector (crossings, deaths, drugs) or per city (crime), and the fence as it was built.
(function () {
  const BOUNDS = L.latLngBounds([24.5, -119], [34, -95.5]);
  const FULL_VIEW = [[25, -118], [33.5, -96.5]];
  const LABEL = "US–Mexico border · Timeline: crossings, deaths, drugs, crime";
  const layer = L.layerGroup();
  map.createPane("timeline");
  map.getPane("timeline").style.zIndex = 430;

  const METRICS = {
    app: { label: "People apprehended or encountered by Border Patrol", kind: "sector", key: "app", color: "#7c3aed", unit: "people", ref: ["cbpApp", "cbpEnc"],
      caveat: "Counts arrests, not crossings: figures rise when enforcement rises, and one person can be counted several times. From March 2020 they include Title 42 expulsions, so later years are not directly comparable." },
    deaths: { label: "Deaths recorded by Border Patrol", kind: "sector", key: "deaths", color: "#111827", unit: "deaths", ref: ["cbpDeaths"],
      caveat: "Official counts, known to be low: in 2021 Pima County recorded 225 deaths where Border Patrol recorded 78." },
    drugs: { label: "Drugs seized by Border Patrol, between crossings (pounds)", kind: "sector", key: "drugs", color: "#059669", unit: "lb", ref: ["cbpDrugs"],
      caveat: "Seizures only, not the amount smuggled. Most hard drugs are seized at official crossings, shown below. CBP publishes this by sector only since FY2021." },
    hom: { label: "Homicide rate per 100,000, border cities", kind: "city", key: "hom", unit: "per 100,000", ref: ["fbi", "inegiDeaths", "inegiPop"],
      caveat: "Mexican figures are death records by municipality of occurrence, from 2000, with populations interpolated between censuses and continuing the 2010–20 trend after 2020. US figures, where shown, are police-reported for the city. Rates in small places swing widely from year to year." },
    violent: { label: "Violent crime rate per 100,000, US cities", kind: "city", key: "violent", side: "us", unit: "per 100,000", ref: ["fbi"],
      caveat: "Reported to the FBI by city police. Years with incomplete reporting are left blank. Mexico has no equivalent series going this far back." },
  };
  const EVENTS = [
    [1993, "1993: Operation Hold the Line concentrates agents in El Paso."],
    [1994, "1994: Operation Gatekeeper in San Diego; the Border Patrol's strategic plan includes barriers."],
    [1996, "1996: law authorises a triple fence along 14 miles near San Diego."],
    [2006, "2006: Secure Fence Act orders hundreds of miles of new fencing."],
    [2008, "2007–09: most of the Secure Fence Act fencing is built."],
    [2017, "From 2017: new wall and replacements are built, but no open map traces them yet."],
    [2020, "March 2020: Title 42 expulsions begin; counts change definition."],
  ];
  const REFS = {
    cbpApp: "U.S. Customs and Border Protection (2020) U.S. Border Patrol fiscal year Southwest border sector apprehensions (FY 1960 – FY 2020). Available at: https://www.cbp.gov/sites/default/files/assets/documents/2020-Jan/U.S.%20Border%20Patrol%20Fiscal%20Year%20Southwest%20Border%20Sector%20Apprehensions%20(FY%201960%20-%20FY%202019)_0.pdf (FY2020 from the same table as published by The Texas Tribune) (Accessed: 9 November 2026).",
    cbpEnc: "U.S. Customs and Border Protection (2026) Nationwide encounters by area of responsibility, FY20–FY26. Available at: https://www.cbp.gov/document/stats/nationwide-encounters (Accessed: 9 November 2026).",
    cbpDeaths: "U.S. Customs and Border Protection (2021; 2023) U.S. Border Patrol Southwest border deaths by fiscal year, FY1998–FY2022. Available at: https://www.cbp.gov/sites/default/files/assets/documents/2023-Oct/SWB%20Deaths%20FY21_FY22.pdf (Accessed: 9 November 2026).",
    cbpDrugs: "U.S. Customs and Border Protection (2026) Nationwide drug seizures, FY21–FY26. Available at: https://www.cbp.gov/document/stats/nationwide-drug-seizures (Accessed: 9 November 2026).",
    fbi: "Federal Bureau of Investigation (2026) Crime Data Explorer: summarized agency data, 1985–2024. Available at: https://cde.ucr.cjis.gov/ (Accessed: 9 November 2026).",
    inegiDeaths: "INEGI (2025) Estadísticas de Defunciones Registradas: microdatos 1990–2024. Available at: https://www.inegi.org.mx/programas/edr/ (Accessed: 9 November 2026).",
    inegiPop: "INEGI (2001; 2011; 2021) Censos de Población y Vivienda 2000, 2010 y 2020: Principales resultados por localidad (ITER). Available at: https://www.inegi.org.mx/programas/ccpv/ (Accessed: 9 November 2026).",
    reveal: "Reveal from The Center for Investigative Reporting and OpenStreetMap contributors (2017) border_fence_map. Available at: https://github.com/cirlabs/border_fence_map (ODbL) (Accessed: 6 November 2026).",
    crs: "Congressional Research Service (2006; 2023) Border security: barriers along the U.S. international border (RS22026); Homeland Security Act at 20: border enforcement (IN12216). Available at: https://www.everycrsreport.com/ (Accessed: 9 November 2026).",
  };

  let data = null, panel = null, offered = false, active = false;
  let metric = "app", year = 1994, timer = null;
  let circles = [], fence = {};
  const fmt = (v) => (v >= 100 ? Math.round(v).toLocaleString("en") : String(Math.round(v * 10) / 10));
  const seriesOf = (item, m) => (m.kind === "sector" ? data.series[m.key][item.name] : item[m.key]) || {};
  const itemsOf = (m) => (m.kind === "sector" ? data.sectors : data.cities.filter((c) => (!m.side || c.side === m.side) && c[m.key]));
  const yearRange = (m) => {
    const ys = itemsOf(m).flatMap((i) => Object.keys(seriesOf(i, m)).map(Number));
    return [Math.min(...ys), Math.max(...ys)];
  };

  function refsHtml(keys) {
    return `<details><summary>References (Harvard)</summary><ol class="refs">${keys.map((k) => `<li>${REFS[k]}</li>`).join("")}</ol></details>`;
  }
  // Small bar chart of one place over time, with the fence phases marked
  function chart(series, m, color) {
    const ys = Object.keys(series).map(Number).sort((a, b) => a - b);
    if (!ys.length) return "";
    const [a, b] = [ys[0], ys[ys.length - 1]];
    const max = Math.max(...ys.map((y) => series[y]), 1e-9);
    const W = 300, H = 90, bw = W / (b - a + 1);
    const x = (y) => ((y - a) / (b - a + 1)) * W;
    const bars = ys.map((y) => {
      const h = (series[y] / max) * (H - 4);
      return `<rect x="${x(y).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(bw - 0.6, 0.6).toFixed(1)}" height="${h.toFixed(1)}" fill="${y === year ? "#dc2626" : color}"><title>${y}: ${fmt(series[y])}</title></rect>`;
    }).join("");
    const mark = [[1994, "1994"], [2006, "2006"]].filter(([y]) => y >= a && y <= b)
      .map(([y, t]) => `<line x1="${x(y)}" x2="${x(y)}" y1="0" y2="${H}" stroke="currentColor" stroke-dasharray="2 2" opacity="0.5"/><text x="${x(y) + 2}" y="9" font-size="8" fill="currentColor">${t}</text>`).join("");
    return `<svg class="tl-chart" viewBox="0 0 ${W} ${H + 12}" role="img" aria-label="${m.label}, ${a} to ${b}">${bars}${mark}<text x="0" y="${H + 10}" font-size="8" fill="currentColor">${a}</text><text x="${W}" y="${H + 10}" font-size="8" text-anchor="end" fill="currentColor">${b}</text><text x="${W}" y="9" font-size="8" text-anchor="end" fill="currentColor">max ${fmt(max)}</text></svg>`;
  }
  function placeCard(item, m) {
    const s = seriesOf(item, m);
    const v = s[year];
    const title = m.kind === "sector" ? `${item.name} sector` : `${item.name}, ${item.side === "us" ? "United States" : "Mexico"}`;
    return `<div class="fiche">
      <div class="fiche-title">${title}</div>
      <dl><dt>${m.label}, ${year}</dt><dd>${v == null ? "No figure for this year" : `${fmt(v)} ${m.unit}`}</dd>${item.note ? `<dt>Area</dt><dd>${item.note}</dd>` : ""}</dl>
      ${chart(s, m, m.color || (item.side === "us" ? "#2563eb" : "#ea580c"))}
      <p class="cite">${m.caveat}</p>
      <p class="cite">Dashed lines: Operation Gatekeeper (1994) and the Secure Fence Act (2006).</p>
      ${refsHtml([...m.ref.filter((k) => !(k === "fbi" && item.side === "mx") && !(k.startsWith("inegi") && item.side === "us")), "reveal", "crs"])}
    </div>`;
  }

  function drawCircles() {
    circles.forEach((c) => layer.removeLayer(c));
    const m = METRICS[metric];
    const items = itemsOf(m);
    const peak = Math.max(...items.flatMap((i) => Object.values(seriesOf(i, m))), 1e-9);
    let total = 0, n = 0;
    circles = items.map((item) => {
      const v = seriesOf(item, m)[year];
      if (v != null) { total += v; n += 1; }
      const color = m.color || (item.side === "us" ? "#2563eb" : "#ea580c");
      const c = L.circleMarker([item.lat, item.lon], {
        pane: "timeline", radius: v == null ? 3 : Math.max(3, Math.sqrt(v / peak) * 34),
        color, weight: 1.5, fillColor: color, fillOpacity: v == null ? 0 : 0.45, opacity: v == null ? 0.4 : 0.9,
      }).bindTooltip(`${item.name}: ${v == null ? "no figure" : `${fmt(v)} ${m.unit}`}`, { direction: "top" });
      c.on("click", (ev) => { L.DomEvent.stopPropagation(ev); showInfoCard(placeCard(item, m)); });
      layer.addLayer(c);
      return c;
    });
    return { total, n, m };
  }
  function drawFence() {
    const on = { legacy: year >= 1993, sfa: year >= 2008, priv: year >= 2019 };
    Object.entries(fence).forEach(([k, l]) => l.setStyle({ opacity: on[k] ? 0.95 : 0 }));
  }
  function refresh() {
    const { total, n, m } = drawCircles();
    drawFence();
    panel.querySelector(".tl-year").textContent = m.kind === "sector" ? `FY ${year}` : String(year);
    const sides = m.kind === "city" ? [...new Set(itemsOf(m).map((i) => i.side))] : [];
    panel.querySelector(".tl-sides").innerHTML = sides.sort((a, b) => (a === "us" ? -1 : 1)).map((s) => `<span style="background:${s === "us" ? "#2563eb" : "#ea580c"}"></span>${s === "us" ? "United States" : "Mexico"}`).join(" ");
    const sum = m.kind === "sector" ? (n ? `Whole border: ${fmt(total)} ${m.unit}` : "No figures for this year") : `${n} cities with a figure`;
    const event = [...EVENTS].reverse().find(([y]) => y <= year);
    panel.querySelector(".tl-read").textContent = sum;
    panel.querySelector(".tl-event").textContent = event ? event[1] : "Before the first barriers of the 1990s.";
    panel.querySelector(".tl-caveat").textContent = m.caveat;
    const split = data.drug_split[year];
    panel.querySelector(".tl-split").innerHTML = metric === "drugs" && split
      ? `Share seized at official crossings, ${year}: ${Object.entries(split).map(([d, v]) => `${d} ${v}%`).join(" · ")}`
      : "";
  }
  function setMetric(k) {
    metric = k;
    const [a, b] = yearRange(METRICS[k]);
    const s = panel.querySelector(".tl-slider");
    s.min = a; s.max = b;
    year = Math.min(b, Math.max(a, year));
    s.value = year;
    panel.querySelector(".tl-min").textContent = a;
    panel.querySelector(".tl-max").textContent = b;
    refresh();
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (panel) panel.querySelector(".tl-play").textContent = "▶ Play";
  }
  function play() {
    if (timer) return stop();
    const s = panel.querySelector(".tl-slider");
    if (year >= Number(s.max)) year = Number(s.min);
    panel.querySelector(".tl-play").textContent = "❚❚ Pause";
    timer = setInterval(() => {
      if (year >= Number(s.max)) return stop();
      year += 1; s.value = year; refresh();
    }, 450);
  }
  function buildPanel() {
    panel = L.DomUtil.create("div", "border-tl", map.getContainer());
    panel.innerHTML = `
      <div class="tl-head"><strong>US–Mexico border over time</strong><button type="button" class="tl-close" aria-label="Close the timeline">×</button></div>
      <select class="tl-metric" aria-label="What to show">${Object.entries(METRICS).filter(([, m]) => itemsOf(m).length).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join("")}</select>
      <div class="tl-row"><span class="tl-year"></span><button type="button" class="tl-play">▶ Play</button><span class="tl-read"></span></div>
      <input class="tl-slider" type="range" step="1" aria-label="Year">
      <div class="range-ends"><span class="tl-min"></span><span class="tl-max"></span></div>
      <p class="tl-event"></p><p class="tl-split"></p><p class="tl-key tl-sides"></p><p class="tl-caveat"></p>
      <p class="tl-key"><span style="background:#b45309"></span>Fence before 2006 (shown from 1993; exact years unknown) <span style="background:#b3261e"></span>Secure Fence Act (2007–09) <span style="background:#7c3aed"></span>Private walls (2019)</p>`;
    L.DomEvent.disableClickPropagation(panel);
    L.DomEvent.disableScrollPropagation(panel);
    panel.querySelector(".tl-metric").addEventListener("change", (e) => setMetric(e.target.value));
    panel.querySelector(".tl-slider").addEventListener("input", (e) => { year = Number(e.target.value); refresh(); });
    panel.querySelector(".tl-play").addEventListener("click", play);
    panel.querySelector(".tl-close").addEventListener("click", () => map.removeLayer(layer));
  }
  function buildFence() {
    const style = { legacy: "#b45309", sfa: "#b3261e", priv: "#7c3aed" };
    Object.entries(style).forEach(([k, color]) => {
      fence[k] = L.polyline(data.fence[k], { pane: "timeline", color, weight: 3, opacity: 0, interactive: false });
      layer.addLayer(fence[k]);
    });
  }
  // The ordinary US–Mexico lines would show the whole fence in every year, so they are hidden while the timeline is on
  function hideBaseLines(on) {
    window.timelineHidesUSMexico = on;
    if (typeof update === "function") update();
  }
  async function activate() {
    active = true;
    if (!data) data = await fetch("data/us-border-timeline.json").then((r) => r.json());
    if (!active) return;
    if (!fence.legacy) buildFence();
    if (!panel) buildPanel();
    panel.hidden = false;
    hideBaseLines(true);
    if (map.getZoom() > 6) map.fitBounds(FULL_VIEW);
    setMetric(metric);
  }
  function deactivate() {
    active = false;
    stop();
    if (panel) panel.hidden = true;
    circles.forEach((c) => layer.removeLayer(c));
    circles = [];
    hideBaseLines(false);
  }
  map.on("overlayadd", (e) => { if (e.layer === layer) activate(); });
  map.on("overlayremove", (e) => { if (e.layer === layer) deactivate(); });

  function updateOffer() {
    const show = map.getZoom() >= 5 && BOUNDS.contains(map.getCenter());
    if (show === offered) return;
    offered = show;
    if (show) layerControl.addOverlay(layer, LABEL);
    else {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      layerControl.removeLayer(layer);
    }
    fitInfoCard();
  }
  map.on("moveend", updateOffer);
  updateOffer();

  // Tick box in the US–Mexico wall and city cards
  window.borderTimelineHtml = () => `<label class="dep-toggle tl-toggle"><span><input type="checkbox" class="tl-check"${map.hasLayer(layer) ? " checked" : ""}> Show the border timeline: crossings, deaths, drugs and crime since 1960</span></label>`;
  document.querySelector(".info-body").addEventListener("change", (e) => {
    if (!e.target.classList.contains("tl-check")) return;
    if (!e.target.checked) { map.removeLayer(layer); return; }
    if (!offered) { map.once("moveend", () => map.addLayer(layer)); map.fitBounds(FULL_VIEW); }
    else map.addLayer(layer);
  });
  document.getElementById("reset").addEventListener("click", () => { if (map.hasLayer(layer)) map.removeLayer(layer); });
})();
