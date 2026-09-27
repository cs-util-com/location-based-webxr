# Globe imagery provenance

Written by `scripts/fetch-globe-assets.mjs` (globe plan 2026-09-26-0539
§7.4). Fetched: 2026-09-26; files added: 2026-09-27. All sources are NASA, public domain; the
globe's credits line names each.

- `blue-marble-4326/{z}/{x}/{y}.jpg`: NASA Earth Observatory, Blue Marble:
  Next Generation, via NASA GIBS (WMS `BlueMarble_NextGeneration`,
  EPSG:4326, levels 0-4, 682 tiles of 256x256, 3362 KiB).
  GIBS layer time: not reported.
- `equirect/night-2016-2048.jpg`: NASA Black Marble (VIIRS), 2016, via
  NASA GIBS (WMS `VIIRS_Black_Marble`, TIME 2016-01-01, 2048x1024,
  109 KiB).
- `equirect/water-2048.png`: MODIS Water Mask (MOD44W), via NASA GIBS
  (WMS `MODIS_Water_Mask`, 2048x1024, 64 KiB; water is cyan,
  land black: the shader reads the green channel).
- `equirect/clouds-2048.jpg`: NASA Visible Earth, Blue Marble clouds
  (R. Stöckli), `cloud_combined_2048.jpg` (2048x1024, 810 KiB).

We acknowledge the use of imagery provided by services from NASA's Global
Imagery Browse Services (GIBS), part of NASA's Earth Science Data and
Information System (ESDIS).
