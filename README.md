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
| `type`      | Physical structure: `wall`, `fence` or `berm` |
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
| `typology` | Category in Ballif, F. and Rosière, S. (2009) 'Le défi des « teichopolitiques »', *L'Espace géographique*, 38(3), pp. 193–206: `marche` (march), `clôture` (fence), `mur` (wall), `front` (fortified military line) for borders between states. Urban walls (`urbaine (hors typologie)`) and historic walls (`historique`) fall outside their four types. Shown in the pop-up separately from `type` |
| `status`    | Set only for unfinished walls. `Under construction…` stays in the main list; any other value goes to the "Planned walls" section. Both are drawn dotted or as a hollow dot and left out of the counts |
| `planned_start`, `planned_budget`, `planned_purpose` | Planned walls: expected start, provisional budget and stated purpose, shown in the list and the card |
| `abandoned` | `true` for proposals that were dropped, listed under "Proposed but never built" |
| `note`      | Short description                        |

Costs are converted to 2024 prices with US CPI (World Bank), euro-area HICP (Eurostat) and annual average exchange rates (World Bank). Where a source gives no year, the year is stated in the record.

Colours show construction type (concrete, steel or mesh, barbed or razor wire, earthwork, not documented). Place names come from Natural Earth; native names are added where known.

Lines marked `official border` follow the border between the two countries (Natural Earth 50m data),
only along the stretches where the barrier exists. `approximate` barriers are placed from descriptions and are shown as a dot at their centre until surveyed.
`placeholder` marks a point geocoded from a street name, also shown as a dot. Replace approximate and placeholder lines with
researched geometries (for example drawn at [geojson.io](https://geojson.io) or exported from QGIS).

## Cartographic conventions

The map follows common cartographic conventions, described in Esri's article [Cartographic conventions](https://www.esri.com/arcgis-blog/products/arcgis-pro/mapping/cartographic-conventions) (the article is not reproduced here):

- Borders are dashed, since they are not physical features; walls are solid.
- Water is blue (rivers and the sea), and rivers are labelled in italic.
- Natural features (rivers, mountains) use a serif face; cultural names use a sans-serif face.
- One font family per kind of feature, with a minimum label size of about 8 px.
- North is at the top.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Credits

Base maps: OpenStreetMap, OpenTopoMap, Esri World Imagery. Country borders: Natural Earth via world-atlas.

Traced walls:

- US–Mexico fence: Reveal from The Center for Investigative Reporting and OpenStreetMap contributors, [border_fence_map](https://github.com/cirlabs/border_fence_map) (2017), linked to [revealnews.org/wall](https://www.revealnews.org/wall/). Licensed under the [Open Database License](https://opendatacommons.org/licenses/odbl/1.0/).
- US Smart Wall sections under construction or awarded: U.S. Customs and Border Protection, [Smart Wall map](https://www.cbp.gov/border-security/along-us-borders/smart-wall-map), public project alignments layer, edited 2 November 2026 (US government work, public domain).
- Hadrian's Wall: Murphy, K., Turner, A. and Collins, R. (2024) *WallGIS* [data-set], Archaeology Data Service, [doi:10.5284/1100071](https://doi.org/10.5284/1100071), CC BY 4.0. The curtain-wall line was converted from British National Grid (EPSG:27700) to WGS84.
- West Bank barrier: OCHA oPt, [West Bank Separation Barrier, January 2018](https://data.humdata.org/dataset/west-bank-barrier) (HDX, CC BY). This is still the newest public release.
- Other traced walls: OpenStreetMap contributors (ODbL), including the privately built walls at Sunland Park and Mission (2019–2020).

Context layers and city data:

- Neighbourhood themes around the peace walls, offered when the map shows Northern Ireland (zoom 8 or closer), one at a time:
  - Income ([`data/ni-deprivation.json`](data/ni-deprivation.json)): share of residents on low income, from NISRA's [Northern Ireland Multiple Deprivation Measure 2017, Small Area results](https://www.nisra.gov.uk/publications/nimdm17-sa-level-results), on the [Small Area boundaries](https://www.nisra.gov.uk/publications/small-area-boundaries-gis-format) (1,112 areas within 2.5 km of a peace wall).
  - Employment, occupations, community background, ethnic minorities ([`data/ni-census-dz.json`](data/ni-census-dz.json)): Census 2021 by Data Zone (995 zones within 3 km of a peace wall), from the [NISRA Flexible Table Builder](https://build.nisra.gov.uk/) on the [Data Zone boundaries](https://www.nisra.gov.uk/publications/data-zone-boundaries-gis-format). Community background is religion or religion brought up in.
  - All boundaries converted from Irish Grid to WGS84 and simplified. Open Government Licence.
- Neighbourhood themes along the US–Mexico border, offered when the map shows the border (zoom 7 or closer), one at a time:
  - Median household income, poverty, unemployment, Hispanic or Latino, foreign-born, Spanish at home ([`data/us-border-tracts.json`](data/us-border-tracts.json)): American Community Survey 2020–2024 profiles by census tract, for the 1,265 tracts within 40 km of the traced fence, on the Census Bureau's 2024 cartographic boundaries.
  - Catholic adherents by county ([`data/us-border-counties.json`](data/us-border-counties.json)): 2020 U.S. Religion Census. The US census does not ask about religion.
- Themes on the Mexican side, offered with the US ones (one per side can show at once): unemployment, Catholic, Protestant or evangelical, no religion, born in another state, from the INEGI 2020 census. Urban areas ([`data/mx-border-ageb.json`](data/mx-border-ageb.json), 4,169 AGEBs within 40 km of the traced fence, on INEGI's 2020 Marco Geoestadístico, converted to WGS84 and simplified) are drawn over whole municipalities ([`data/mx-border-municipalities.json`](data/mx-border-municipalities.json), ITER totals on 2012 World Bank boundaries via [geoBoundaries](https://www.geoboundaries.org/), CC BY 4.0), which cover rural areas.
- The Northern Ireland low-income measure is below 60% of the NI median equivalised income, April 2015 to March 2016: the median was £24,253 a year (NIMDM 2017 technical report).
- City census data ([`data/city-census.json`](data/city-census.json)): NISRA Census 2021 (settlements), U.S. Census Bureau QuickFacts, INEGI Censo 2020 (ITER, municipal totals) and HCP RGPH 2024 (legal population by commune). Records with `lat`/`lon` only apply to the city of that name within 60 km.
- US–Mexico border timeline ([`data/us-border-timeline.json`](data/us-border-timeline.json), drawn by `border-timeline.js`): U.S. Customs and Border Protection apprehensions by sector FY1960–2020, encounters FY2021–26, deaths FY1998–2022 and drug seizures FY2021–26. Homicide rates in 11 Mexican border municipalities, 2000–2024: INEGI registered deaths (presumed homicide, by municipality and year of occurrence) over census populations for 2000, 2010 and 2020, interpolated between censuses and continuing the 2010–20 trend after 2020.
