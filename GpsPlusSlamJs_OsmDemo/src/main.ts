/**
 * App shell: wires the pipeline to the two views.
 *
 * DELIBERATELY THIN. Everything that can be wrong in an interesting way lives in
 * `demo-pipeline.ts` (data) and `heat-colours.ts` (presentation of an unbounded
 * quantity), both of which are pure and unit-tested. This file is DOM plumbing,
 * and it is short on purpose: when the demo misbehaves, the question should be
 * answerable without reading it.
 *
 * WHAT THIS DEMO IS FOR — three questions no test suite can answer, and one it
 * can only answer on real data:
 *
 * 1. Is `AFFORDANCE_RES = 13` (4.09 m edge) the right grain? Too coarse and a
 *    footpath vanishes; too fine and the grid is noise.
 * 2. Are the unbounded scores practically thresholdable? See `heat-colours.ts`.
 * 3. Do regions land in the right PLACES? The arithmetic has been verified
 *    against the C# oracle; the geography has not.
 * 4. Does the mesh layer produce sane buildings from real footprints?
 *
 * @see main.ts.md
 */

import {
  CachingSource,
  MemoryBlobStore,
  OverpassSource,
  loadRuleTable,
  type LatLng,
} from 'gps-plus-slam-osm';
import {
  OpfsOsmBlobStore,
  openOsmStoreDirectory,
} from 'gps-plus-slam-app-framework/osm-bridge';

import { DemoPipeline } from './demo-pipeline.js';
import { parseStartPosition } from './start-position.js';
import { latestOnly } from './latest-only.js';
import { MapView } from './map-view.js';
import { BuildingView } from './building-view.js';

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing #${id} in index.html`);
  return found as T;
};

/**
 * OPFS where available, memory otherwise.
 *
 * OPFS is the point — a cached res-7 tile is tens of MB and refetching it on
 * every reload would be an abuse of donated infrastructure. But the demo must
 * still run in a browser without it rather than refusing to start.
 */
async function makeStore() {
  try {
    const root = await navigator.storage.getDirectory();
    return new OpfsOsmBlobStore({
      directory: await openOsmStoreDirectory(root),
    });
  } catch {
    return new MemoryBlobStore();
  }
}

async function main(): Promise<void> {
  const status = el('status');
  const scaleText = el('scale');
  const categorySelect = el<HTMLSelectElement>('category');

  status.textContent = 'Loading the rule table…';
  const loaded = await loadRuleTable({});
  // Which TIER the table came from is worth showing: a demo silently running on
  // the checked-in snapshot looks identical to one running on the live sheet,
  // and they are different claims about what is being judged.
  const tableNote = `rules: ${loaded.tier}${loaded.degradedBecause === undefined ? '' : ` (${loaded.degradedBecause})`}`;

  for (const category of loaded.table.categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categorySelect.append(option);
  }
  categorySelect.value = loaded.table.categories.includes('walkable')
    ? 'walkable'
    : (loaded.table.categories[0] ?? '');

  const source = new CachingSource(
    new OverpassSource({
      userAgent: 'gps-plus-slam-osm-demo (github.com/cs-util-com)',
    }),
    await makeStore(),
  );

  const pipeline = new DemoPipeline({ source, table: loaded.table });
  const start = parseStartPosition(window.location.search);
  const mapView = new MapView({ container: el('map'), centre: start });
  const buildingView = new BuildingView({ container: el('scene') });

  // Clicking the map moves the "user", which is how a walk is simulated without
  // a phone — and crossing a res-11 boundary is what exercises the chunk cache.
  mapView.map.on('click', (event: { latlng: { lat: number; lng: number } }) => {
    void refresh({ lat: event.latlng.lat, lng: event.latlng.lng });
  });
  categorySelect.addEventListener('change', () => void refresh(lastPosition));

  /** The position the view is currently showing, so a category change reuses it. */
  let lastPosition = start;

  /**
   * COALESCED, because `doRefresh` awaits a real Overpass fetch — 18.2 s for a
   * res-7 tile — and the map stays clickable throughout. Two overlapping runs
   * would drive one `AffordanceIndex` concurrently and let the EARLIER one
   * write the final status line, which presents as "the map is showing the
   * wrong place" rather than as a race. Latest-wins rather than a lock: an 18 s
   * dead zone after every click would break the demo's only interaction.
   *
   * The position is an ARGUMENT rather than a mutable outer variable so that
   * "the newest request wins" is a property of the wrapper and not an accident
   * of when each run happens to read the variable.
   */
  const refresh = latestOnly(doRefresh);

  async function doRefresh(position: {
    lat: number;
    lng: number;
  }): Promise<void> {
    lastPosition = position;
    const category = categorySelect.value;
    status.textContent = `Fetching and scoring around ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}…`;
    mapView.setPosition(position);

    try {
      const snapshot = await pipeline.update(position, category);
      const scale = mapView.render(
        snapshot.cells,
        snapshot.regions,
        category,
        snapshot.threshold
      );
      const mesh = buildingView.render(pipeline.features().values(), position);

      scaleText.textContent = mapView.describeScale(scale);
      status.textContent = [
        `${snapshot.cells.length} cells`,
        `${snapshot.regions.length} ${category} regions`,
        `${snapshot.stats.chunksScored} chunks scored / ${snapshot.stats.chunksReused} reused`,
        `${mesh.volumes} volumes (${mesh.parts} parts, ${mesh.guessedHeights} guessed heights)`,
        `${mesh.triangles} triangles`,
        tableNote,
        snapshot.missingTiles.length > 0
          ? `⚠ ${snapshot.missingTiles.length} tile(s) unavailable`
          : '',
      ]
        .filter((part) => part !== '')
        .join(' · ');
    } catch (error) {
      // The demo must say what went wrong rather than going blank — a silent
      // failure here looks exactly like "there is no data at this location".
      status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  await refresh(start);
}

void main();
