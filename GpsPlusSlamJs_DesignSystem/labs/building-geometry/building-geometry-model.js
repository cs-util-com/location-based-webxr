/**
 * The building geometry lab's pure part: which buildings it shows, from which
 * fixed cameras, and where each camera's "today" picture lives. No DOM and no
 * three.js, so Node's runner tests it.
 *
 * @see building-geometry-model.js.md
 */

/**
 * Every fixture is fetched from the Osm package's own test data through the
 * dev server's `/osm-lib/` route; literal, so the deploy's crawl copies them.
 */
const FIXTURES = {
  heidelberg: new URL(
    "/osm-lib/testdata/sites/heidelberg-altstadt.json",
    import.meta.url,
  ),
  cologne: new URL(
    "/osm-lib/testdata/sites/cologne-cathedral.json",
    import.meta.url,
  ),
  "tower-bridge": new URL(
    "/osm-lib/testdata/sites/london-tower-bridge.json",
    import.meta.url,
  ),
  dresden: new URL(
    "/osm-lib/testdata/landmarks/dresden-frauenkirche.json",
    import.meta.url,
  ),
  berlin: new URL(
    "/osm-lib/testdata/landmarks/berlin-cathedral.json",
    import.meta.url,
  ),
  munich: new URL(
    "/osm-lib/testdata/landmarks/munich-frauenkirche.json",
    import.meta.url,
  ),
  ulm: new URL("/osm-lib/testdata/landmarks/ulm-minster.json", import.meta.url),
  moscow: new URL(
    "/osm-lib/testdata/landmarks/moscow-st-basil.json",
    import.meta.url,
  ),
};

/**
 * The buildings, in the order of the findings doc's "Buildings and cameras".
 * `target`: the outline whose first vertex is the scene's origin. Camera
 * positions are scene metres from that origin: x east, y up, z SOUTH (the
 * library's mesh frame). `bugs`: the findings doc's bug numbers each view
 * shows.
 */
export const BUILDINGS = [
  {
    id: "heidelberg",
    label: "Heidelberg Heiliggeistkirche",
    target: "way/1186298822",
    bugs: "1, 2, 7",
    views: {
      "aerial-se": { pos: [130, 110, 130], at: [35, 22, 10], fov: 40 },
      spire: { pos: [-55, 55, 70], at: [8, 50, 10], fov: 45 },
      "aerial-top": { pos: [35, 260, 11], at: [35, 0, 10], fov: 32 },
    },
  },
  {
    id: "cologne",
    label: "Cologne Cathedral",
    target: "way/4532022",
    bugs: "3, 4, 5, 8",
    views: {
      towers: { pos: [-260, 130, 180], at: [-103, 115, 28], fov: 32 },
      "aerial-se": { pos: [120, 170, 240], at: [-50, 30, 25], fov: 40 },
      plate: { pos: [-10, 160, 330], at: [-10, 0, 190], fov: 45 },
    },
  },
  {
    id: "dresden",
    label: "Dresden Frauenkirche",
    target: "way/23040893",
    bugs: "1, 6",
    views: {
      aerial: { pos: [160, 118, 155], at: [10, 36, 5], fov: 40 },
      street: { pos: [53, 2, 135], at: [10, 45, 5], fov: 60 },
    },
  },
  {
    id: "berlin",
    label: "Berliner Dom",
    target: "way/313670734",
    bugs: "6",
    views: {
      aerial: { pos: [190, 106, 170], at: [20, 32, 0], fov: 40 },
      street: { pos: [73, 2, 160], at: [20, 41, 0], fov: 60 },
    },
  },
  {
    id: "munich",
    label: "Munich Frauenkirche",
    target: "way/225698612",
    bugs: "6, 7",
    views: {
      aerial: { pos: [180, 128, 188], at: [0, 39, 8], fov: 40 },
      street: { pos: [56, 2, 178], at: [0, 49, 8], fov: 60 },
    },
  },
  {
    id: "ulm",
    label: "Ulm Minster",
    target: "way/25697707",
    bugs: "7",
    views: {
      aerial: { pos: [240, 210, 256], at: [10, 64, 26], fov: 40 },
      street: { pos: [86, 2, 256], at: [10, 81, 26], fov: 60 },
    },
  },
  {
    id: "tower-bridge",
    label: "Tower Bridge",
    target: "way/367652787",
    bugs: "5, 11",
    views: {
      aerial: { pos: [170, 85, 30], at: [5, 25, 48], fov: 40 },
      street: { pos: [85, 6, -25], at: [25, 30, 15], fov: 60 },
    },
  },
  {
    id: "moscow",
    label: "Moscow St Basil's",
    target: "relation/3030568",
    bugs: "1, 6",
    views: {
      aerial: { pos: [110, 85, 70], at: [3, 25, -20], fov: 45 },
      street: { pos: [45, 2, 50], at: [3, 30, -20], fov: 60 },
    },
  },
];

/** The fixture URL of building `id`. TypeError for an unknown id. */
export function fixtureUrl(id) {
  const url = FIXTURES[id];
  if (url === undefined) throw new TypeError(`unknown building ${id}`);
  return url;
}

/**
 * The "today" pictures, one per building and view: captured from this page
 * with the library as it was before the geometry fixes (the capture script
 * is in the sidecar). Literal, so the deploy's crawl copies every one.
 */
const TODAY_SHOTS = {
  "heidelberg/aerial-se": new URL(
    "./today/heidelberg-aerial-se.png",
    import.meta.url,
  ),
  "heidelberg/spire": new URL("./today/heidelberg-spire.png", import.meta.url),
  "heidelberg/aerial-top": new URL(
    "./today/heidelberg-aerial-top.png",
    import.meta.url,
  ),
  "cologne/towers": new URL("./today/cologne-towers.png", import.meta.url),
  "cologne/aerial-se": new URL(
    "./today/cologne-aerial-se.png",
    import.meta.url,
  ),
  "cologne/plate": new URL("./today/cologne-plate.png", import.meta.url),
  "dresden/aerial": new URL("./today/dresden-aerial.png", import.meta.url),
  "dresden/street": new URL("./today/dresden-street.png", import.meta.url),
  "berlin/aerial": new URL("./today/berlin-aerial.png", import.meta.url),
  "berlin/street": new URL("./today/berlin-street.png", import.meta.url),
  "munich/aerial": new URL("./today/munich-aerial.png", import.meta.url),
  "munich/street": new URL("./today/munich-street.png", import.meta.url),
  "ulm/aerial": new URL("./today/ulm-aerial.png", import.meta.url),
  "ulm/street": new URL("./today/ulm-street.png", import.meta.url),
  "tower-bridge/aerial": new URL(
    "./today/tower-bridge-aerial.png",
    import.meta.url,
  ),
  "tower-bridge/street": new URL(
    "./today/tower-bridge-street.png",
    import.meta.url,
  ),
  "moscow/aerial": new URL("./today/moscow-aerial.png", import.meta.url),
  "moscow/street": new URL("./today/moscow-street.png", import.meta.url),
};

/** The "today" picture of one building and view; null when there is none. */
export function todayShotUrl(id, view) {
  return TODAY_SHOTS[`${id}/${view}`] ?? null;
}

/** Every (building, view) pair, in page order; the capture script's list. */
export function allShots() {
  return BUILDINGS.flatMap((b) =>
    Object.keys(b.views).map((view) => ({ id: b.id, view })),
  );
}

/**
 * The page's state from its query string: `building` and `view`, each
 * falling back to the first one when missing or unknown, so a stale link
 * still opens a picture.
 */
export function parseParams(search) {
  const params = new URLSearchParams(search);
  const building =
    BUILDINGS.find((b) => b.id === params.get("building")) ?? BUILDINGS[0];
  const views = Object.keys(building.views);
  const asked = params.get("view");
  const view = views.includes(asked) ? asked : views[0];
  return { building, view };
}

/** The query string of a state; the inverse of `parseParams`. */
export function searchFor(buildingId, view) {
  return `?${new URLSearchParams({ building: buildingId, view })}`;
}
