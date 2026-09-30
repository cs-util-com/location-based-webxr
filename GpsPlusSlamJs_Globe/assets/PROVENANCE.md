# Globe imagery provenance

Written by `scripts/fetch-globe-assets.mjs` (globe plan 2026-09-26-0539
§7.4). Fetched: 2026-09-29. All sources are NASA, public domain; the
globe's credits line names each. Every file is WebP at quality
75, encoded once from a lossless source (round-4 plan
2026-09-28-2105 DEC-GL4-10).

- `blue-marble-4326/{z}/{x}/{y}.webp`: NASA Earth Observatory, Blue Marble:
  Next Generation, via NASA GIBS (WMS `BlueMarble_NextGeneration` as PNG,
  EPSG:4326, levels 0-4, 682 tiles of 256x256, 2550 KiB).
  GIBS layer time: not reported. Each tile's
  ALPHA is the MODIS Water Mask (MOD44W), via NASA GIBS (WMS
  `MODIS_Water_Mask`, cut to the same tile) where the imagery is also
  darker than 55 in every channel, lossless: 255 on land, 0 on
  water, the colour under the water kept; a tile with no water has no alpha.
- `equirect/night-2016-2048.webp`: NASA Black Marble (VIIRS), 2016, via
  NASA GIBS (WMS `VIIRS_Black_Marble` as PNG, TIME 2016-01-01, 2048x1024,
  60 KiB).
- `equirect/clouds-2048.webp`: NASA Visible Earth, Blue Marble clouds
  (R. Stöckli), `cloud_combined_2048.tif` (2048x1024, 346 KiB).

We acknowledge the use of imagery provided by services from NASA's Global
Imagery Browse Services (GIBS), part of NASA's Earth Science Data and
Information System (ESDIS).
