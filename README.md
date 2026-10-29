# Teichopolitics Map

An interactive map showing the construction of physical border barriers (walls, fences, berms) over time.

- **Timeline:** drag the year slider or press Play to watch barriers appear and disappear.
- **Layers:** switch between street, terrain and satellite base maps, and toggle country borders.
- **Search:** filter barriers by name or country, and click one to zoom to it.

## Data

Barriers live in [`data/barriers.geojson`](data/barriers.geojson). Each feature has:

| Property    | Meaning                                  |
|-------------|------------------------------------------|
| `name`      | Name of the barrier                      |
| `countries` | Countries or territories it separates    |
| `separates` | Groups or areas it separates (optional)  |
| `type`      | `wall`, `fence` or `berm`                |
| `built`     | Year construction started, or `null` if unknown (undated barriers are always shown and left out of the counts) |
| `removed`   | Year it was dismantled, or `null`        |
| `length_km` | Approximate length                       |
| `owner`     | Who owns or maintains it (optional)      |
| `initiated_by` | Who initiated it, or `Not documented` (optional) |
| `initiator_type` | `government`, `other` or `unknown` (optional) |
| `construction` | Type of construction, e.g. steel bollard fence, concrete wall (optional) |
| `cost` | Construction cost in 2024 USD and EUR, with the original figure, year and note, or `Unknown` |
| `cost_usd_2024`, `cost_eur_2024` | The same cost as numbers (optional) |
| `maintenance_cost` | Annual maintenance cost in 2024 USD and EUR, with the original figure, or `Unknown` |
| `maintenance_usd_2024`, `maintenance_eur_2024` | The same maintenance cost as numbers (optional) |
| `security_technology` | Cameras, sensors, lighting and other equipment used with the barrier |
| `geometry_quality` | How the line was drawn: `official border`, `approximate` or `placeholder` |
| `typology` | Ballif & Rosière (2009) class: `marche`, `clôture`, `mur`, `front` (optional) |
| `note`      | Short description                        |

Costs are converted to 2024 prices with US CPI (World Bank), euro-area HICP (Eurostat) and annual average exchange rates (World Bank). Where a source gives no year, the year is stated in the record.

Colours show construction type (concrete, steel or mesh, barbed or razor wire, earthwork, not documented). Place names come from Natural Earth; native names are added where known.

Lines marked `official border` follow the border between the two countries (Natural Earth 50m data),
only along the stretches where the barrier exists. `approximate` barriers are placed from descriptions and are shown as a dot at their centre until surveyed.
`placeholder` marks a point geocoded from a street name, also shown as a dot. Replace approximate and placeholder lines with
researched geometries (for example drawn at [geojson.io](https://geojson.io) or exported from QGIS).

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Credits

Base maps: OpenStreetMap, OpenTopoMap, Esri World Imagery. Country borders: Natural Earth via world-atlas.
