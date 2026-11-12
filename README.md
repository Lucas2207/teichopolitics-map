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
| `cost` | Construction cost in USD and EUR at the latest published prices, with the original figure, year and note, or `Unknown` |
| `cost_usd_current`, `cost_eur_current` | The same cost as numbers (optional) |
| `maintenance_cost` | Annual maintenance cost in USD and EUR at the latest published prices, with the original figure, or `Unknown` |
| `maintenance_usd_current`, `maintenance_eur_current` | The same maintenance cost as numbers (optional) |
| `security_technology` | Cameras, sensors, lighting and other equipment used with the barrier |
| `geometry_quality` | How the line was drawn: `official border`, `approximate` or `placeholder` |
| `typology` | Category in Ballif, F. and Rosière, S. (2009) 'Le défi des « teichopolitiques »', *L'Espace géographique*, 38(3), pp. 193–206: `marche` (march), `clôture` (fence), `mur` (wall), `front` (fortified military line) for borders between states. Urban walls (`urbaine (hors typologie)`) and historic walls (`historique`) fall outside their four types. Shown in the pop-up separately from `type` |
| `status`    | Set only for unfinished walls. `Under construction…` stays in the main list; any other value goes to the "Planned walls" section. Both are drawn dotted or as a hollow dot and left out of the counts |
| `planned_start`, `planned_budget`, `planned_purpose` | Planned walls: expected start, provisional budget and stated purpose, shown in the list and the card |
| `abandoned` | `true` for proposals that were dropped, listed under "Proposed but never built" |
| `construction_class` | Sets the colour class by hand when the text alone would misclassify it: `mixed` for sections built differently, or another class (optional) |
| `note`      | Short description                        |

Costs are shown at the latest month published for both US CPI-U (U.S. Bureau of Labor Statistics) and euro-area HICP (Eurostat). `scripts/update_prices.py` runs daily through GitHub Actions and republishes them when a new month appears; `data/price-index.json` holds the current month and `data/price-base.json` the figures it recalculates from. They were first converted to 2024 prices with US CPI (World Bank; U.S. Bureau of Labor Statistics CPI-U for 2025 and January to September 2026), euro-area HICP (Eurostat) and annual average exchange rates (World Bank; European Central Bank reference rates for 2026). Spending over several years uses the midpoint year, and where a source gives no year, the assumed year is stated in the record. Planned and projected budgets are converted in the text only, with no numeric fields, because they are not money spent.

Colours show construction type (concrete, stone or brick; steel, metal or mesh; barbed or razor wire; earthwork; mixed; not documented; historical). The material named first in `construction` is the main structure, and anything added to it does not change the class. Mixed means sections built differently, such as a concrete wall with fenced sections. Seven hues were chosen for perceptual distance (CIEDE2000) under normal vision and simulated colour blindness; the pale yellow carries a thin outline in a darker shade of its own hue. Place names come from Natural Earth; native names are added where known.

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

- Israeli settlements and outposts ([`data/israeli-settlements.json`](data/israeli-settlements.json)), offered in the layer box when the map shows Israel, Palestine and the Golan Heights (zoom 7 or closer) and filtered by the year slider. West Bank and East Jerusalem: 253 settlements, outposts and settlement industrial zones from OCHA's West Bank Atlas 2019 settlements index (type, founding year, population; data from Peace Now), located with the Peace Now and OCHA settlement outlines on the Humanitarian Data Exchange (2018, CC BY-IGO) or, for outposts without an outline, from their labels on OCHA's atlas maps (georeferenced against the outlines, usually within about 500 m, marked approximate); three settlements founded after 2019 are added from Israel's Central Bureau of Statistics list of localities. Sixteen small outposts and East Jerusalem compounds in OCHA's index could not be placed precisely and are left out. Gaza: 20 of the 21 settlements evacuated in 2005 (Slav, a small neighbourhood, has no recorded location) (coordinates from Wikidata, founding dates and 2000 populations as listed on Wikipedia from the Settlement Division and Israel's Central Bureau of Statistics), shown up to 2004. Golan Heights: 33 settlements from the Central Bureau of Statistics locality file (end of 2024). Settlements are filled dots and outposts hollow dots. Each is described as illegal under international law (UN Security Council Resolutions 2334, 478 and 497; International Court of Justice advisory opinion, 2024), and East Jerusalem settlements as illegal colonies.

- Country cards (click a country's name) and national figures on city cards ([`data/country-profiles.json`](data/country-profiles.json)): official name and, for states with limited recognition, their status (List of states with limited recognition, Wikipedia; Northern Cyprus figures from its statistics office via Wikipedia and the 2011 TRNC census; Puntland, a semi-autonomous member state of Somalia, from the Puntland Ministry of Planning's Facts and Figures 2012–2017 and the Somalia National Bureau of Statistics district poverty estimates from the 2022 household budget survey); life expectancy, GDP, sector shares and relative poverty (World Bank); median income or consumption (World Bank Poverty and Inequality Platform); immigrants and emigrants by origin and destination (UN DESA International Migrant Stock 2024); immigration, emigration, foreign citizens and police-recorded offences for European countries (Eurostat); area, its notes on overseas territories and main industries (CIA World Factbook). Also, shown as national context and never as city data: World Bank World Development Indicators (population, GDP per person, unemployment and employment modelled by the ILO, Gini index, international migrant share, net migration, intentional homicide from UNODC), UNHCR refugee statistics 2025, and the CIA World Factbook (ethnic groups, religions, languages; public domain, via the factbook.json archive).

- Neighbourhood themes around the peace walls, offered when the map shows Northern Ireland (zoom 8 or closer), one at a time:
  - Income ([`data/ni-deprivation.json`](data/ni-deprivation.json)): share of residents on low income, from NISRA's [Northern Ireland Multiple Deprivation Measure 2017, Small Area results](https://www.nisra.gov.uk/publications/nimdm17-sa-level-results), on the [Small Area boundaries](https://www.nisra.gov.uk/publications/small-area-boundaries-gis-format) (1,112 areas within 2.5 km of a peace wall).
  - Employment, occupations, community background, ethnic minorities ([`data/ni-census-dz.json`](data/ni-census-dz.json)): Census 2021 by Data Zone (995 zones within 3 km of a peace wall), from the [NISRA Flexible Table Builder](https://build.nisra.gov.uk/) on the [Data Zone boundaries](https://www.nisra.gov.uk/publications/data-zone-boundaries-gis-format). Community background is religion or religion brought up in.
  - All boundaries converted from Irish Grid to WGS84 and simplified. Open Government Licence.
- Neighbourhood themes along the US–Mexico border, offered when the map shows the border (zoom 7 or closer), one at a time:
  - Median household income, poverty, unemployment, Hispanic or Latino, foreign-born, Spanish at home ([`data/us-border-tracts.json`](data/us-border-tracts.json)): American Community Survey 2020–2024 profiles by census tract, for the 1,282 tracts within 40 km of the US–Mexico border, on the Census Bureau's 2024 cartographic boundaries.
  - Catholic adherents by county ([`data/us-border-counties.json`](data/us-border-counties.json)): 2020 U.S. Religion Census. The US census does not ask about religion.
- Themes on the Mexican side, offered with the US ones (one per side can show at once): unemployment, Catholic, Protestant or evangelical, no religion, born in another state, from the INEGI 2020 census. Urban areas ([`data/mx-border-ageb.json`](data/mx-border-ageb.json), 4,343 AGEBs within 40 km of the US–Mexico border, on INEGI's 2020 Marco Geoestadístico, converted to WGS84 and simplified) are drawn over whole municipalities ([`data/mx-border-municipalities.json`](data/mx-border-municipalities.json), ITER totals on 2012 World Bank boundaries via [geoBoundaries](https://www.geoboundaries.org/), CC BY 4.0), which cover rural areas.
- The Northern Ireland low-income measure is below 60% of the NI median equivalised income, April 2015 to March 2016: the median was £24,253 a year (NIMDM 2017 technical report).
- City census data ([`data/city-census.json`](data/city-census.json)): NISRA Census 2021 (settlements), U.S. Census Bureau QuickFacts, INEGI Censo 2020 (ITER, municipal totals) and HCP RGPH 2024 (legal population by commune). Added for cities near walls: Israel's Central Bureau of Statistics locality file (end of 2024), Palestine's PCBS 2017 final census, Jordan's Department of Statistics locality estimates (end of 2025) and archived tables of Syria's 2004 census, TÜİK's 2025 population register for Hatay districts, Belstat regional indicators, Statistics Finland, GUS (Poland), INSEE (France), NISRA settlement tables, Pakistan's 2023 census tables by tehsil, India's 2011 census tables (town-level Primary Census Abstract by religion, district mother tongue), and City Population (Brinkhoff) where it names the national statistics office as its source (Russia, Spain), American Community Survey 2020–2024 places, and, where no bulk official table was reachable, national census figures as given in Wikipedia city articles (South Africa 2011, India 2011, Bangladesh 2022, Pakistan 2023, labelled on each record). Chile: Instituto Nacional de Estadísticas census 2024 tables by commune and the Biblioteca del Congreso Nacional commune reports (Casen 2024, CEAD crime reports). Peru: INEI census and thematic tables by department and city, and City Population for province figures it credits to INEI. Turkey: population register (TÜİK) via City Population; Syria: the 2004 census via City Population; northern Cyprus: the 2011 census of the State Planning Organisation (archived), with labels added for North Nicosia, Famagusta, Kyrenia and Morphou under the exception for places near the walls. Europe: INSEE (Melodi API and comparateur, 2023 census by commune and Paris arrondissement) with SSMSI police and gendarmerie crime rates; Eurostat city statistics (urb_cpop1, urb_cpopcb, urb_clma, 2018 or later) for the main EU and EFTA cities; ONS Census 2021 by local authority via Nomis and National Records of Scotland's 2022 census by locality (UK Data Service); CSO Ireland (census 2022 by town); Statistics Denmark, Statistics Norway, Statistics Finland, Statistics Sweden and Statistics Iceland registers; Statistik Austria; ELSTAT (2021 census, citizenship and birthplace by region); STATEC (Luxembourg); Statbel (Belgium, register 2026); INE Spain (annual census 2025) with the Barcelona and Madrid city registers by district; ISTAT (2026 municipal estimates and the 2019 permanent census); Destatis (Zensus 2022 population and religion by municipality), the Amt für Statistik Berlin-Brandenburg (register by Ortsteil, 2025) and Statistikamt Nord (Hamburg, migration background by Stadtteil, 2025); Serbia's RZS (2022 census, ethnicity), Bosnia and Herzegovina's BHAS (2013 census), MONSTAT (Montenegro 2023), the Kosovo Agency of Statistics (2024 census), MakStat (North Macedonia 2021), INSTAT (Albania 2023, ethnicity by prefecture), Moldova's BNS (2024 census, Chișinău); the State Statistics Committee of Ukraine (2001 census, nationality and native language by region, marked as pre-war); and, because Rosstat refuses connections from outside Russia, 2021 census city populations as compiled by City Population. The optional `crime` field in a city record appears as its own row on the card. The optional `pre_war` field states when a card's figures date from before a war. Records with `lat`/`lon` only apply to the city of that name within 60 km.
- US–Mexico border timeline ([`data/us-border-timeline.json`](data/us-border-timeline.json), drawn by `border-timeline.js`): U.S. Customs and Border Protection apprehensions by sector FY1960–2020, encounters FY2021–26, deaths FY1998–2022 and drug seizures FY2021–26. Homicide rates in 11 Mexican border municipalities, 2000–2024: INEGI registered deaths (presumed homicide, by municipality and year of occurrence) over census populations for 2000, 2010 and 2020, interpolated between censuses and continuing the 2010–20 trend after 2020.
