# globe-quality.ts - the globe's quality tiers

## Purpose

One table of what `low`, `medium` and `high` set in the sea and the near
clouds, and the pixel ratio each caps the canvas at, so both are built
against the same names. Pages pick a name by link (`?quality=<name>`) or
take the default.

## Public API

- `GLOBE_QUALITIES`: frozen table, name to `{ pixelRatioCap, sea, clouds }`.
  - `sea`: `waveOctaves`, `shortestWaveM`.
  - `clouds`: `law` (steps of `distanceKm`, `march`, `pixelsPerCss`, nearest
    first), `maxPixelsPerCss`, `entrySubSteps`.
- `GlobeQualityName`, `GLOBE_QUALITY_NAMES` (cheapest first),
  `GLOBE_QUALITY_PARAM` (`"quality"`).
- `resolveGlobeQuality(name, coarsePointer, warn = console.warn)`: the tier
  to use. `null` is the default: `high` with a fine pointer, `medium` with a
  coarse one. An unknown name is that default with one warning. Never
  throws.
- `globeQualityPixelRatio(name, devicePixelRatio)`: the device's ratio,
  capped. A zero or non-finite ratio reads as 1. `RangeError` for a name not
  in the table.

`createGlobeView` takes the name as option `quality` (default: `high`, the
fine-pointer tier) and shows it as `view.quality`.

## The values

- **Sea and cloud steps** are the look prototype's tiers,
  `globe-look-10-living-lod-r2`, unchanged. Its waves end at 1,024 m on every
  tier, so a cheaper tier gives up only the short waves.
- **The cloud law's `march`** is the prototype's `q`, `pixelsPerCss` its `c`,
  `maxPixelsPerCss` its `cMax`, `entrySubSteps` its `refDiv`. The march's
  fixed step counts per `q` belong to the cloud modules.
- **The pixel ratio caps are this table's own, not the prototype's**
  (0.75, 1, 1.5 there). The prototype's canvas holds only sea, sky and
  clouds; the globe's also holds the imagery, the city and the interface,
  which go soft sooner, so `high` keeps today's 2 and the others step down
  by 0.5. Not measured on a phone: the first reading is a preview on one.

## Invariants and assumptions

- **A tier is fixed for a view's life.** The wave count is compiled into the
  sea's shader. A page changes tier by making a new view.
- **`low` is never a default.** It exists for a choice made by hand and as a
  last step down.
- **A choice by hand always wins** over the pointer; an automatic step-down
  has to respect that.
- The pointer test is the page's (`matchMedia("(pointer: coarse)")`), so this
  module has no browser dependency.

## The cloud numbers' reader

`tapPixels` is the upsampling tent's reach in cloud pixels, read by the shell's composite.

## Example

```ts
const coarse = matchMedia("(pointer: coarse)").matches;
const quality = resolveGlobeQuality(params.get(GLOBE_QUALITY_PARAM), coarse);
renderer.setPixelRatio(globeQualityPixelRatio(quality, devicePixelRatio));
createGlobeView({ canvas, quality });
```

## Tests

- `globe-quality.test.ts`: the table's values and order, the resolver, the
  cap.
- `globe-view.test.ts`: the view holds the tier it was made with.
