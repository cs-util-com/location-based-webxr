# Terrain lab fixtures: provenance

The terrain lab's smoke (`../terrain.smoke.spec.mjs`) serves these tiles in
place of the network, so no request leaves the machine (terrain plan
2026-09-27-0605 §5 T1, §9 finding 6).

## Real tiles: the Appalachians (Blue Ridge)

- Source: AWS Open Data Terrain Tiles, Terrarium encoding,
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
  (the Osm library's `TERRARIUM_URL_TEMPLATE`).
- Fetched: 2026-09-27 with `curl`, byte for byte (the server's
  `Last-Modified` is 2017-11-12 for every tile). Not re-encoded, so the
  smoke decodes exactly what production decodes.
- Cropped to the region: only the 9 tiles the lab's `regionTiles` asks for
  at z8 (the 256 km region around 37.9° N, 79.2° W plus its 8 km padding
  ring), not a pyramid. The smoke fails if the lab asks for a tile that is
  not here, or if one here is never asked for.
- Zoom 8 only (plan §9 finding 6: real fixtures at z8 or coarser). At z7-z8
  the tile set's data over the US is SRTM (NASA/NGA, distributed by the
  USGS), public domain.
- Credits: the lab's credits line carries the tile set's full list
  (`../terrain-credits.js`); for these tiles the relevant ones are Mapzen and
  "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain
  data courtesy of the U.S. Geological Survey".

The files (bytes, first 16 hex digits of the SHA-256):

- `terrarium/8/70/97.png`: 86455 bytes, `970ca2f58c6123f9`
- `terrarium/8/70/98.png`: 93200 bytes, `f72490139b5993e6`
- `terrarium/8/70/99.png`: 90167 bytes, `cde944142c40fd2b`
- `terrarium/8/71/97.png`: 89527 bytes, `8759280f5cc25343`
- `terrarium/8/71/98.png`: 92180 bytes, `4a11696cf647c11f`
- `terrarium/8/71/99.png`: 79186 bytes, `bd4740385240f674`
- `terrarium/8/72/97.png`: 79823 bytes, `c8dec36ec30d4ad4`
- `terrarium/8/72/98.png`: 73190 bytes, `c7f7f022cc5abdab`
- `terrarium/8/72/99.png`: 60366 bytes, `cd46ae2b6b1b5696`
- Total: 744094 bytes (727 KiB).

## Real tiles: the Alps (Valais to Bernina)

- Source and encoding: as above (AWS Open Data Terrain Tiles, Terrarium).
- Fetched: 2026-09-28 with `curl`, byte for byte (`Last-Modified`
  2017-11-15 for every tile). Not re-encoded.
- Cropped to the region: the 9 tiles `regionTiles` asks for at z8 for the
  256 km region around 46.56° N, 9.14° E (the middle of tile 134/90) plus
  its 8 km padding ring. The pipeline test holds the set to the lab's own
  projection.
- Zoom 8 only. At z7-z8 the tile set's data here is SRTM (NASA/NGA,
  distributed by the USGS), public domain; the tile set's sources list
  EU-DEM from z9 only.
- Credits: Mapzen and "United States 3DEP (formerly NED) and global
  GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey",
  from the lab's full list.

The files (bytes, first 16 hex digits of the SHA-256):

- `terrarium/8/133/89.png`: 84251 bytes, `5cef200b17cb58ba`
- `terrarium/8/133/90.png`: 99364 bytes, `f911d5a290e7e8f0`
- `terrarium/8/133/91.png`: 93172 bytes, `249f791365c126bf`
- `terrarium/8/134/89.png`: 82492 bytes, `122ad1a316ea6484`
- `terrarium/8/134/90.png`: 103077 bytes, `77c74b5c0a070695`
- `terrarium/8/134/91.png`: 65960 bytes, `2103fe8d3265b40b`
- `terrarium/8/135/89.png`: 90088 bytes, `a2078ea9387c6374`
- `terrarium/8/135/90.png`: 102887 bytes, `f11c2810ce2bd9ce`
- `terrarium/8/135/91.png`: 75748 bytes, `6cca99b1ac03aaa0`
- Total: 797039 bytes (778 KiB).

## Real tiles: northern Germany (Elbe and coast)

- Source and encoding: as above (AWS Open Data Terrain Tiles, Terrarium).
- Fetched: 2026-09-28 with `curl`, byte for byte (`Last-Modified`
  2017-11-15 for every tile). Not re-encoded.
- Cropped to the region: the 9 tiles `regionTiles` asks for at z8 for the
  256 km region around 53.75° N, 9.14° E (the middle of tile 134/82) plus
  its 8 km padding ring; the pipeline test holds the set to the lab's own
  projection.
- Zoom 8 only. Land: SRTM (NASA/NGA, distributed by the USGS), public
  domain, as for the Alps. The North Sea and the Baltic in these tiles
  carry the tile set's bathymetry (ETOPO1, NOAA), so the region has posts
  at or below 0 m.
- Credits: Mapzen, the USGS line (SRTM) and "Global ETOPO1 terrain data
  U.S. National Oceanic and Atmospheric Administration", from the lab's
  full list.

The files (bytes, first 16 hex digits of the SHA-256):

- `terrarium/8/133/81.png`: 74918 bytes, `0f5032cd699bc79c`
- `terrarium/8/133/82.png`: 64300 bytes, `ffb76831d200e325`
- `terrarium/8/133/83.png`: 40980 bytes, `0eac8fcc9f91d6a3`
- `terrarium/8/134/81.png`: 58224 bytes, `5441d22543efd96c`
- `terrarium/8/134/82.png`: 53955 bytes, `b2e741f7b95f2fe4`
- `terrarium/8/134/83.png`: 43885 bytes, `ec324c804ea0d5ad`
- `terrarium/8/135/81.png`: 83835 bytes, `efb1373745a420b0`
- `terrarium/8/135/82.png`: 53760 bytes, `dca499543e668542`
- `terrarium/8/135/83.png`: 48383 bytes, `41ae7d9a83e46d81`
- Total: 522240 bytes (510 KiB).

All three places together: 2063373 bytes (2.0 MB).

## The GPS place

It has no fixtures: its tiles depend on where the phone is. The smoke
answers its requests with synthetic tiles.

## Budget (DEC-TR-8)

The terrain fixtures of all four places may total 5 MB (the owner,
2026-09-27); each place's share stays at about 1.5 MB or less. Both are
asserted by `../terrain-fixtures.test.mjs`.

## Synthetic tiles

The geometry checks (a ridge, a constant height, a failing tile) are not
files: the smoke writes them at run time with the workspace's Terrarium
encoder, `scripts/e2e/terrarium-png.mjs`, so their heights are declared in
the test that relies on them.
