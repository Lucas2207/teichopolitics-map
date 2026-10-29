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
| `type`      | `wall`, `fence` or `berm`                |
| `built`     | Year construction started                |
| `removed`   | Year it was dismantled, or `null`        |
| `length_km` | Approximate length                       |
| `note`      | Short description                        |

The current lines are rough sample approximations. Replace them with researched geometries
(for example drawn at [geojson.io](https://geojson.io) or exported from QGIS).

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Credits

Base maps: OpenStreetMap, OpenTopoMap, Esri World Imagery. Country borders: Natural Earth via world-atlas.
