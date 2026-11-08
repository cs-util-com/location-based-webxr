# City colour space: unify plates, ground and POI (follow-up)

Filed by milestone M1 of the city objects plan 2026-11-07-2315 (section 7,
the colour-space rule). Related sidecars:
[chunk-meshes.ts.md](../src/mesh/chunk-meshes.ts.md),
[city.ts.md](../src/mesh/city.ts.md),
[srgb.ts.md](../src/mesh/srgb.ts.md),
[city-objects.ts.md](../src/three/city-objects.ts.md).

## What M1 settled

- Building chunks (buildings and the barriers drawn among them) are converted
  from sRGB to linear light in `buildCity` (`linearChunkColours`).
- Trees are converted through `THREE.Color` into `instanceColor`.
- Road chunks stay raw, as the O3 picture the owner chose drew them.

## What is still raw, and should be decided

- **OsmDemo's area plates** (`demo-worker.ts`, `plates: chunkMeshes(...)`):
  raw byte / 255 into a three.js vertex colour, so drawn lighter and greyer
  than their palette. M3's land-use tint replaces part of this layer; decide
  there whether the remaining plates convert.
- **Roads**: raw by the owner's chosen picture. Converting them means
  re-tuning `roadColour` so the picture stays, and re-writing the contrast
  checks in `feature-colours.test.ts` against linear values.
- **The ground and the POI layers**: check each app's ground material and the
  POI colours for the same raw path before M3 and M5 add to them.
- **The AR shell** mixes the raw vertex colour into its cyan (`colourMix`
  0.35); with linear building colours the mix pulls slightly darker. Measure
  at an AR probe whether the shell needs its mix re-tuned.
- **Three of Heidelberg's ten tagged fence ways are not drawn** (nor indexed;
  unchanged by M1, pinned in `site-barriers.test.ts`). Find out which and
  why before M2 adds more barrier-like objects.

## Why one rule

Two pipelines side by side is what made the V2 Heidelberg two-toned: kept
buildings came raw from the library next to converted invented houses. Each
layer still drawing raw is a place that can recreate it.
