# gps-plus-slam-osm demo

Two views of the same OSM data, side by side:

- **Left, Leaflet** — the res-13 affordance grid and its region outlines over the
  OSM raster basemap. Click the map to move the simulated user.
- **Right, three.js** — the buildings extruded from exactly the same merged
  features, so a discrepancy is geometry rather than data.

```bash
pnpm run dev            # http://127.0.0.1:5186
                        # ?lat=&lng= points it anywhere you like
                        # ?site=<id>  jumps to a named place
pnpm test               # typecheck + unit + e2e
pnpm run test:e2e:headed  # watch the e2e suite drive it
```

It opens on **Manhattan at the Central Park edge**, and the header's `location`
dropdown offers fourteen places worth looking at (`src/picker-places.ts`).

**`?site=<id>` reaches more than the dropdown lists, and that is deliberate.** It
resolves any picker id _and_ any id in the package's fixture corpus
(`CORPUS_SITES`), including the three the dropdown does not offer:

```
?site=sylt-westerland        # natural=coastline, where the ground stops being ground
?site=heidelberg-altstadt    # real terrain relief inside one tile
?site=berlin-alexanderplatz  # stacked U-Bahn/S-Bahn tagging with real layer values
```

Those three are the offline fixture corpus but not places anyone wants in a
dropdown, so the picker dropped them while this route kept them **reachable** —
which is what stops the places under test from drifting away from the places you
can look at. An unrecognised id falls back to the default rather than erroring.
`?lat=&lng=` wins if you pass both.

## What this demo is for

Everything below it is verified against fixtures and the C# oracle, which proves
the port is faithful and says nothing about whether the result is _right for a
real place_. Four questions need eyes:

1. **Is `AFFORDANCE_RES = 13` (4.09 m edge) the right grain?** Too coarse and a
   footpath vanishes into its surroundings; too fine and the grid reads as noise.
2. **Are the unbounded scores practically thresholdable?** The model is
   multiplicative and deliberately unbounded, so a cell overlapped by five mapped
   features outscores the identical surface with one. The colour ramp is
   **logarithmic above the threshold** — equal ratios, equal colour steps — which
   is the honest presentation of a product; the scale is printed in the header so
   the picture can be checked against the arithmetic.
3. **Do regions land in the right places?** The arithmetic is verified; the
   geography is not.
4. **Does the mesh layer produce sane buildings?** Wall normals, `building:part`
   suppression, roof shapes. The 3D material is deliberately **double-sided** so
   a wrongly-wound wall shows up as a shading oddity rather than disappearing.

Hover any cell for its score and the OSM elements that produced it, each linked
to openstreetmap.org — the provenance map is what turns "that looks wrong" into
"that is wrong because of way/12345".

5. **Does an agent route sensibly through a real place?** Click open ground in
   the 3D view and one NPC walks there along a drawn polyline (DEC-R11-3). The
   route is planned in the worker against an obstacle index over the barriers
   and buildings the scene draws, so **seeing the line go _around_ a city wall
   is the proof** — and a line that goes through one is a visible, reportable
   fact rather than a hidden mis-score.
   - A click on an affordance cell or a POI marker still selects it; a click on
     a building selects nothing (it blocks, so the agent is not sent to the
     ground behind it). **A click on a region slab now orders the agent**
     (DEC-R11-21) — the slabs cover much of the ground at a dense site, and
     while they outranked it the agent could not be ordered at all. A region's
     details are still one click away on the 2D map, and in 3D with the ground
     mode set to `none`.
   - Wall tops are unreachable by design this round (DEC-R11-10): there is no
     stair or ramp ingress, so an agent that ended up on a wall would mean a
     sub-threshold step had crept in.

## What it deliberately is not

- **Not an AR INSTRUMENT** — though there is now an AR mode, and the distinction
  is the whole of §8.4. OSM footprints carry low-metre absolute error, plausibly
  larger than the fusion error one would be measuring, so **if buildings look
  offset in AR that is not a fusion finding and no bug should be opened from
  it.** On a 2D map a mis-scored lawn is unambiguously a scoring fact; in AR it
  is a scoring fact, a footprint fact and a pose fact superimposed.
  - What AR mode IS: a product feature — walk around and see the affordance data
    in place. It is judged on whether it feels right, which an instrument is
    not. **The map stays** (DEC-12); AR is an additional mode, not a
    replacement.
  - Entry waits for a first GPS fix, because the scene is anchored to the
    framework's `zero` and there is no re-anchoring later (DEC-R11-6).
- **Not a product.** No offline area management, no route prefetch, no settings.

## Structure

Everything that can be wrong in an interesting way is pure and unit-tested:

- `demo-pipeline.ts` — fetch → `AffordanceIndex` → cells + regions. No DOM.
- `heat-colours.ts` — the log ramp and the scale description.
- `pick.ts` — what a click in the 3D view selected, as a precedence decision
  with no renderer in it.
- `agent-route.ts`, `route-path.ts`, `agent-cycle.ts` — the NPC route: planning
  it, turning it into scene geometry and a walk, and the click that orders it.
- `scene-content.ts` — the map content as one subtree with a swappable parent,
  and the axis change between this demo's scene (X=East, Y=Up, Z=−North) and the
  GPS-world frame (NUE). The AR seam.
- `ar-origin.ts`, `ar-button-state.ts` — the `lon`/`lng` adapter, the geoid
  datum sign, the entry gate, and what the AR button shows. All pure, because
  every one of them fails silently and as something else when wrong.
- `ar-mode.ts` — the WebXR session lifecycle. Tested against a mocked framework
  session; a real one needs a device.
- `map-view.ts`, `building-view.ts`, `main.ts` — drawing and wiring only.

## Attribution

OSM data is ODbL. Both the basemap and the derived grid are shown here, so the
`© OpenStreetMap contributors` attribution on the map is required, not optional.

## Network

Fetches live Overpass on first use and caches to OPFS (falling back to memory).
A res-7 tile is tens of MB; **do not clear the cache casually** — the public
instances are donated infrastructure with a shared budget.

## Tests

- **Unit** (`src/*.test.ts`) — the pure parts: the log colour ramp and its scale.
- **E2E** (`playwright-tests/`) — what is actually **drawn** and what actually
  went **over the wire**, because every failure mode this app has is silent.
  Notably:
  - a **pixel-level** check on the 3D canvas. A present canvas of the right size
    proves nothing — a camera inside a wall, an empty mesh and a render that
    never ran all look identical. The suite reads the drawing buffer and counts
    non-background pixels, which is why the renderer sets
    `preserveDrawingBuffer`.
  - a **request count** across a reload, which is the only way to see the OPFS
    cache working: the map looks the same whether or not it refetched.
  - a **paint-order** assertion on the region outlines. It earned its place
    immediately — the source comment claimed regions were drawn under the cells
    while the code drew them on top, and nothing else could have noticed.

**The e2e suite never touches the network.** Overpass, the rule sheet and the
basemap are all answered from checked-in data. That is about donated
infrastructure before it is about determinism: the public Overpass instances
allow roughly two slots per client, and a CI suite hammering them on every push
would be an abuse rather than a flaky test. The interception is at the HTTP
layer, so `OverpassSource`, the parser, the cache, the OPFS store, the scorer
and the mesh extruder all run for real.
