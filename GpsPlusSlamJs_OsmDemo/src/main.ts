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
import { MapView } from './map-view.js';
import { BuildingView } from './building-view.js';

/** Cologne — where the fixtures and the field tests are. */
const DEFAULT_START: LatLng = { lat: 50.9413, lng: 6.9583 };

/**
 * Where to start, overridable with `?lat=&lng=`.
 *
 * Useful in its own right — pointing the demo at a place you know is the whole
 * point of it — and it is also what lets the e2e suite put the app exactly on
 * top of the checked-in fixture instead of two kilometres away from it, which
 * is a difference between "0 cells" and a working assertion.
 *
 * Both parameters are required together and both must be finite: half an
 * override would silently mix a URL latitude with a default longitude and land
 * somewhere neither the user nor the test asked for.
 */
function startPosition(): LatLng {
  const params = new URLSearchParams(window.location.search);
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const given = params.has('lat') && params.has('lng');
  if (!given || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return DEFAULT_START;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return DEFAULT_START;
  return { lat, lng };
}

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
  const start = startPosition();
  const mapView = new MapView({ container: el('map'), centre: start });
  const buildingView = new BuildingView({ container: el('scene') });

  let position = start;

  // Clicking the map moves the "user", which is how a walk is simulated without
  // a phone — and crossing a res-11 boundary is what exercises the chunk cache.
  mapView.map.on('click', (event: { latlng: { lat: number; lng: number } }) => {
    position = { lat: event.latlng.lat, lng: event.latlng.lng };
    void refresh();
  });
  categorySelect.addEventListener('change', () => void refresh());

  async function refresh(): Promise<void> {
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

  await refresh();
}

void main();
