import {
  BoxGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type MeshStandardMaterial,
} from "three";
import { buildBird } from "./bird";
import { buildParcoursPark } from "./park";
import { buildForestPortal } from "./portal";
import { buildGeocache } from "./geocache";
import { clayMesh, namedGroup } from "./palette";
import { buildPin } from "./markers";
import {
  buildContactShadows,
  buildGrass,
  CONTACT_SHADOWS_NAME,
  GRASS_NAME,
} from "./world-detail";
import { buildUseCaseVignettes, VIGNETTES_NAME } from "./use-case-vignettes";

/**
 * Procedural low-poly "clay world": the miniature landscape every chapter
 * plays in. All content is generated (no GLTF downloads — the plan's asset
 * budget) and DETERMINISTIC via a seeded LCG, so tests can pin structure
 * and two page loads look identical.
 *
 * The story timeline addresses parts of the world by the names in
 * `WORLD_NODE` and stages the dot-person along `createPathCurve()`;
 * `WORLD_ANCHORS` are the story hot-spots (QR sign, marker pair, statue).
 */

export const WORLD_NODE = {
  root: "clay-world",
  ground: "world-ground",
  path: "world-path",
  hills: "world-hills",
  trees: "world-trees",
  rocks: "world-rocks",
  sign: "world-sign",
  statue: "world-statue",
  snapRing: "world-snap-ring",
  outer: "world-outer",
  skyline: "world-skyline",
  arContent: "world-ar-content",
  grass: GRASS_NAME,
  contactShadows: CONTACT_SHADOWS_NAME,
  vignettes: VIGNETTES_NAME,
} as const;

const WORLD_RADIUS = 30;
const PATH_WIDTH = 1.6;

/** The S-curve the dot-person walks; ground level (y = 0). */
export function createPathCurve(): CatmullRomCurve3 {
  return new CatmullRomCurve3(
    [
      new Vector3(-16, 0, 12),
      new Vector3(-8, 0, 6),
      new Vector3(-2, 0, 8),
      new Vector3(4, 0, 2),
      new Vector3(2, 0, -6),
      new Vector3(10, 0, -12),
    ],
    false,
    "catmullrom",
    0.5,
  );
}

// Anchors derived from the path curve (round-2 R5/R6): the marker anchor
// sits ON the path edge (the red pin stands exactly where the user
// walks); the QR drop point is ON the path near the sign, and the sign
// stands BEHIND the path as seen from the QR chapter's camera (+z side).
const anchorCurve = createPathCurve();
const anchorPoint = anchorCurve.getPointAt(0.42);
const anchorTangent = anchorCurve.getTangentAt(0.42);
const dropT = 0.14;
const dropPoint = anchorCurve.getPointAt(dropT);
const dropTangent = anchorCurve.getTangentAt(dropT);
// Perpendicular pointing to the path's -z side here = away from the QR
// camera (which looks from +z), i.e. "behind" the path.
const signPerp = new Vector3(dropTangent.z, 0, -dropTangent.x).normalize();

/** Story hot-spots, derived from the path so they stay beside it. */
export const WORLD_ANCHORS = {
  /** QR sign standing behind the path (chapter: qr). */
  sign: dropPoint.clone().add(signPerp.clone().multiplyScalar(2.2)),
  /** Where the QR fix drops the user onto the path (chapter: qr). */
  dropPoint: dropPoint.clone(),
  /** GPS rings + fused pin anchor, on the path edge (chapter: fusion). */
  markerPair: anchorPoint
    .clone()
    .add(new Vector3(anchorTangent.z, 0, -anchorTangent.x).multiplyScalar(0.5)),
  /** Statue a short detour off the path (chapter: gallery labels). */
  statue: new Vector3(8, 0, -4),
} as const;

/** Path parameter of the QR drop point — the walk starts here. */
export const DROP_PATH_T = dropT;

// The skyline sits on the horizon in the direction the dive camera faces
// (round-2 R11), far enough out to sit hazily in the fog.
const skyDirection = anchorCurve.getTangentAt(0.56).setY(0).normalize();
const skylineCenter = anchorCurve
  .getPointAt(0.5)
  .clone()
  .add(skyDirection.clone().multiplyScalar(48))
  .setY(0);

/** Center of the skyline row — the round-11 city-sweep look target. */
export const SKYLINE_CENTER = skylineCenter;

/** World position of the skyline's TV tower (the second POI pin's spot).
 * Exported for the round-13 city-sweep framing: the journey camera aims
 * at the tower TOP, not the city average. */
export const SKYLINE_TOWER_POS = skylineCenter
  .clone()
  .add(new Vector3(-skyDirection.z, 0, skyDirection.x).multiplyScalar(4));

// The use-case vignettes (round-11) sit on the same far ring as the
// skyline, spread sideways so the gallery camera journey sweeps the city
// first, flies past the campus, and arrives at the castle.
const vignetteAcross = new Vector3(-skyDirection.z, 0, skyDirection.x);
export const VIGNETTE_ANCHORS = {
  /** Trade-fair/campus stage (tents + static AR arrows). */
  campus: skylineCenter
    .clone()
    .add(vignetteAcross.clone().multiplyScalar(-26))
    .add(skyDirection.clone().multiplyScalar(-9))
    .setY(0),
  /** Historic-buildings stage (ruin + translucent ghost). */
  castle: skylineCenter
    .clone()
    .add(vignetteAcross.clone().multiplyScalar(-48))
    .add(skyDirection.clone().multiplyScalar(-16))
    .setY(0),
} as const;

// Geocache chest anchor (easter-egg №1): near the world-center-facing
// RIM of the castle vignette's disc (radius 9), pulled 7.6 units toward
// the world center so it sits CLEAR of the castle's built footprint
// (keep/towers span ~±3.5) — buried under a tower it was both invisible
// and un-clickable — yet still on the disc and in the CTA arrival frame.
const GEOCACHE_ANCHOR = VIGNETTE_ANCHORS.castle
  .clone()
  .add(VIGNETTE_ANCHORS.castle.clone().setY(0).normalize().multiplyScalar(-7.6))
  .add(
    VIGNETTE_ANCHORS.castle
      .clone()
      .sub(VIGNETTE_ANCHORS.campus)
      .setY(0)
      .normalize()
      .multiplyScalar(1.6),
  )
  .setY(0);

// Hidden bird anchor (easter-egg №10): perched on top of the QR sign
// panel (panel top ≈ 2.55), a touch to one side — small and in frame
// during the QR chapter, easy to miss.
const BIRD_ANCHOR = WORLD_ANCHORS.sign.clone().add(new Vector3(0.25, 2.55, 0));

// Forest portal anchor (round-14 R14-10, grounded in the golden-hour
// rebuild): the monument stands ON the terrain between the world and the
// tents, in the outer-tree band near the campus — pulled ~15 units back
// toward the world center from the campus. Ground level also gives the
// planned portal-traveler egg (N2) a doorway to step out of. It faces
// the world center (the far-out works-anywhere camera looks from there).
const PORTAL_ANCHOR = VIGNETTE_ANCHORS.campus
  .clone()
  .add(VIGNETTE_ANCHORS.campus.clone().setY(0).normalize().multiplyScalar(-15))
  .setY(0);

// Parkour park anchor (round-14 R14-12): a lawn patch IN FRONT of the
// city highrises — pulled ~11 units back toward the world center from
// the skyline row so it sits between the city and the viewer.
const PARK_ANCHOR = skylineCenter
  .clone()
  .add(skyDirection.clone().multiplyScalar(-11))
  .add(new Vector3(-skyDirection.z, 0, skyDirection.x).multiplyScalar(9))
  .setY(0);

/** Deterministic LCG (numerical recipes constants) — NOT crypto, just art. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface DetailCounts {
  trees: number;
  rocks: number;
  hills: number;
  outerTrees: number;
  pathSegments: number;
}

const DETAIL: Record<"high" | "low", DetailCounts> = {
  high: { trees: 22, rocks: 12, hills: 7, outerTrees: 10, pathSegments: 60 },
  low: { trees: 9, rocks: 5, hills: 4, outerTrees: 4, pathSegments: 30 },
};

function buildGround(): Group {
  const group = namedGroup(WORLD_NODE.ground);
  const disc = clayMesh(
    new CylinderGeometry(WORLD_RADIUS, WORLD_RADIUS + 2, 1.6, 28),
    "ground",
  );
  disc.position.y = -0.8;
  disc.castShadow = false;
  group.add(disc);
  return group;
}

function buildPath(segments: number): Group {
  const group = namedGroup(WORLD_NODE.path);
  const curve = createPathCurve();
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const slab = clayMesh(new BoxGeometry(PATH_WIDTH, 0.12, 1.1), "path");
    slab.position.set(point.x, 0.06, point.z);
    slab.rotation.y = Math.atan2(tangent.x, tangent.z);
    slab.castShadow = false;
    group.add(slab);
  }
  return group;
}

function buildTree(rng: () => number): Group {
  const tree = new Group();
  const height = 1.6 + rng() * 1.6;
  const trunk = clayMesh(
    new CylinderGeometry(0.14, 0.2, height * 0.45, 6),
    "trunk",
  );
  trunk.position.y = height * 0.225;
  const crown = clayMesh(
    new ConeGeometry(0.7 + rng() * 0.5, height, 7),
    "foliage",
  );
  crown.position.y = height * 0.45 + height / 2;
  tree.add(trunk, crown);
  return tree;
}

function buildRock(rng: () => number): Group {
  const rock = new Group();
  const mesh = clayMesh(new IcosahedronGeometry(0.3 + rng() * 0.5, 0), "rock");
  mesh.position.y = 0.25;
  mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
  rock.add(mesh);
  return rock;
}

function buildHill(rng: () => number): Group {
  const hill = new Group();
  const radius = 2.5 + rng() * 3.5;
  const mesh = clayMesh(new SphereGeometry(radius, 10, 7), "hill");
  mesh.position.y = -radius * 0.55;
  mesh.castShadow = false;
  hill.add(mesh);
  return hill;
}

/**
 * Scatter `count` pieces inside the world disc while keeping a margin from
 * the path (sampled at 100 points) and from the story anchors.
 */
function scatter(
  name: string,
  count: number,
  rng: () => number,
  build: (rng: () => number) => Group,
  minPathDistance: number,
): Group {
  const group = namedGroup(name);
  const curve = createPathCurve();
  const pathPoints: Vector3[] = [];
  for (let i = 0; i <= 100; i++) {
    pathPoints.push(curve.getPointAt(i / 100));
  }
  const anchors = Object.values(WORLD_ANCHORS);
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 30) {
    attempts++;
    const angle = rng() * Math.PI * 2;
    const radius = 3 + rng() * (WORLD_RADIUS - 5);
    const candidate = new Vector3(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius,
    );
    const nearPath = pathPoints.some(
      (p) => p.distanceTo(candidate) < minPathDistance,
    );
    const nearAnchor = anchors.some((a) => a.distanceTo(candidate) < 3);
    if (nearPath || nearAnchor) {
      continue;
    }
    const piece = build(rng);
    piece.position.copy(candidate);
    piece.rotation.y = rng() * Math.PI * 2;
    group.add(piece);
    placed++;
  }
  return group;
}

/**
 * A QR-like module grid (round-1 feedback: the old 5x5 blob did not read
 * as a QR code): 9x9 cells with the three corner finder squares real QR
 * codes have, plus a ~50% random module fill. Modules use the `qrModule`
 * role so the copy highlight (`.hl-code`) can echo their color.
 */
function buildQrGrid(panelY: number): Group {
  const qr = namedGroup("world-sign-qr");
  const grid = 9;
  const cell = 0.1;
  const half = (grid - 1) / 2;
  const rng = createRng(7);

  const moduleAt = (col: number, row: number, parent: Group): void => {
    const dot = clayMesh(
      new BoxGeometry(cell * 0.85, cell * 0.85, 0.04),
      "qrModule",
    );
    dot.position.set((col - half) * cell, panelY + (row - half) * cell, 0.06);
    dot.castShadow = false;
    parent.add(dot);
  };

  // Finder patterns: 3x3 corner squares (outer ring + center like a real
  // QR finder, simplified to filled 3x3 blocks with a gap row around).
  const finderOrigins: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [grid - 3, 0],
    [0, grid - 3],
  ];
  const inFinderZone = (col: number, row: number): boolean =>
    finderOrigins.some(
      ([c0, r0]) =>
        col >= c0 - 1 && col <= c0 + 3 && row >= r0 - 1 && row <= r0 + 3,
    );
  finderOrigins.forEach(([c0, r0], index) => {
    const finder = namedGroup(`qr-finder-${index}`);
    for (let row = r0; row < r0 + 3; row++) {
      for (let col = c0; col < c0 + 3; col++) {
        if (row === r0 + 1 && col === c0 + 1) {
          continue; // hollow center ring look
        }
        moduleAt(col, row, finder);
      }
    }
    qr.add(finder);
  });

  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      if (inFinderZone(col, row) || rng() >= 0.5) {
        continue;
      }
      moduleAt(col, row, qr);
    }
  }
  return qr;
}

function buildSign(): Group {
  const sign = namedGroup(WORLD_NODE.sign);
  const post = clayMesh(new CylinderGeometry(0.08, 0.1, 1.6, 6), "sign");
  post.position.y = 0.8;
  const panel = clayMesh(new BoxGeometry(1.1, 1.1, 0.08), "signPanel");
  panel.position.y = 2.0;
  sign.add(post, panel, buildQrGrid(2.0));
  sign.position.copy(WORLD_ANCHORS.sign);
  sign.rotation.y = Math.PI / 5;
  return sign;
}

function buildStatue(): Group {
  const statue = namedGroup(WORLD_NODE.statue);
  const pedestal = clayMesh(new BoxGeometry(1.2, 0.8, 1.2), "statue");
  pedestal.position.y = 0.4;
  const figure = clayMesh(new ConeGeometry(0.4, 1.4, 8), "statue");
  figure.position.y = 1.5;
  const head = clayMesh(new SphereGeometry(0.28, 10, 8), "statue");
  head.position.y = 2.4;
  statue.add(pedestal, figure, head);
  statue.position.copy(WORLD_ANCHORS.statue);
  return statue;
}

/**
 * The QR accuracy ring (round-2 R6): fades in LARGE (position uncertainty
 * unknown) and collapses to ~zero at the drop point (QR fix acquired).
 * Material is transparent so the timeline can tween its opacity; hidden
 * until the stage primes it.
 */
function buildSnapRing(): Group {
  const group = namedGroup(WORLD_NODE.snapRing);
  const ring = clayMesh(new TorusGeometry(1.2, 0.06, 8, 32), "snapRing");
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  ring.castShadow = false;
  const material = ring.material as MeshStandardMaterial;
  material.transparent = true;
  material.opacity = 0;
  group.add(ring);
  group.position.copy(WORLD_ANCHORS.dropPoint);
  group.visible = false;
  return group;
}

/**
 * The "works anywhere" reveal: a wider unmapped-park ring around the world
 * disc with sparse trees. Hidden until the anywhere chapter pulls back.
 */
function buildOuter(counts: DetailCounts, rng: () => number): Group {
  const outer = namedGroup(WORLD_NODE.outer);
  const ring = clayMesh(
    new CylinderGeometry(WORLD_RADIUS + 18, WORLD_RADIUS + 20, 1.2, 28),
    "ground",
  );
  ring.position.y = -1.0;
  ring.castShadow = false;
  outer.add(ring);
  for (let i = 0; i < counts.outerTrees; i++) {
    const tree = buildTree(rng);
    const angle = rng() * Math.PI * 2;
    const radius = WORLD_RADIUS + 4 + rng() * 12;
    tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    outer.add(tree);
  }
  outer.visible = false;
  return outer;
}

/**
 * Quiet horizon scenery (round-2 R11): a handful of dark blocky
 * buildings + one TV tower, placed in the dive camera's view direction.
 * Always visible (it is scenery); only the tower's red pin reveals with
 * the AR content group.
 */
function buildSkyline(): Group {
  const skyline = namedGroup(WORLD_NODE.skyline);
  const across = new Vector3(-skyDirection.z, 0, skyDirection.x);
  const rng = createRng(42);
  // The skyline stands beyond the ground disc, over the void — every
  // piece is extended SINK units below y=0 (tops unchanged) so nothing
  // reads as floating from the story's camera angles (round-10 R10-3).
  const SINK = 8;
  // The TV tower sits at across-offset +4 (SKYLINE_TOWER_POS). Round-14
  // R14-11: the block nearest that lateral spot used to sit AT the
  // tower's depth, so the tower poked THROUGH it. Pull that block a good
  // step FORWARD (toward the viewer, −skyDirection) so the tower reads as
  // clearly BEHIND a foreground highrise.
  const TOWER_ACROSS = 4;
  const blocks = [-9, -5.5, -2, 1.5, 5, 8.5];
  for (const offset of blocks) {
    const width = 2 + rng() * 2;
    const height = 3 + rng() * 6;
    const block = clayMesh(
      new BoxGeometry(width, height + SINK, 2.5),
      "skyline",
    );
    const forwardPull = Math.abs(offset - TOWER_ACROSS) < 2 ? 6 : 0;
    block.position
      .copy(skylineCenter)
      .add(across.clone().multiplyScalar(offset))
      .add(skyDirection.clone().multiplyScalar(-forwardPull))
      .setY(height / 2 - SINK / 2);
    block.castShadow = false;
    skyline.add(block);
  }
  const tower = namedGroup("skyline-tower");
  const shaft = clayMesh(
    new CylinderGeometry(0.4, 0.7, 12 + SINK, 8),
    "skyline",
  );
  shaft.position.y = 6 - SINK / 2;
  shaft.castShadow = false;
  const bulb = clayMesh(new SphereGeometry(0.9, 8, 6), "skyline");
  bulb.position.y = 12.4;
  bulb.castShadow = false;
  const spike = clayMesh(new CylinderGeometry(0.06, 0.12, 2.4, 6), "skyline");
  spike.position.y = 14;
  spike.castShadow = false;
  tower.add(shaft, bulb, spike);
  tower.position.copy(SKYLINE_TOWER_POS);
  skyline.add(tower);
  return skyline;
}

/**
 * The AR content seen "through the phone" from the dive on (round-1
 * feedback shaped this): trail arrows hovering over the path pointing
 * FORWARD along the walk direction, a red POI pin over the statue, and a
 * hinted text label (board with bars suggesting text) beside it.
 */
function buildArContent(): Group {
  const arContent = namedGroup(WORLD_NODE.arContent);
  const curve = createPathCurve();
  // 8 arrows, 0.05 apart, reaching t=0.91 (round-8 Z3: with 4 arrows
  // spaced 0.08 only ONE was visible on a phone in landscape — denser
  // and further keeps several in frame from the dive through the later
  // framings). Test-pinned: ≥8, spacing ≤0.06, max t ≥0.9.
  for (let i = 0; i < 8; i++) {
    const t = 0.56 + i * 0.05; // ahead of the dive position (walk t = 0.5)
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const arrow = clayMesh(new ConeGeometry(0.26, 0.75, 6), "arrow");
    arrow.position.set(point.x, 0.45, point.z);
    // Cone +Y axis onto the tangent: pitch flat first (X), then yaw (Y);
    // Euler order YXZ applies X before Y. The extra ~14° of pitch tips
    // the nose slightly down so the cone reads as an arrow (not a flat
    // hexagon) when seen from behind at eye level. Pinned by the
    // alignment test (cos 0.25 ≈ 0.97 keeps the tangent dot above 0.95).
    arrow.rotation.order = "YXZ";
    arrow.rotation.x = Math.PI / 2 + 0.25;
    arrow.rotation.y = Math.atan2(tangent.x, tangent.z);
    arrow.userData.pathT = t;
    arrow.castShadow = false;
    arContent.add(arrow);
  }

  const poi = buildPin("ar-poi-pin", "poi");
  poi.position.set(WORLD_ANCHORS.statue.x, 3.0, WORLD_ANCHORS.statue.z);
  arContent.add(poi);

  // Second POI over the skyline's TV tower (R11): "there can be many
  // pins". Scaled up so it reads at horizon distance.
  const towerPin = buildPin("ar-skyline-pin", "poi");
  towerPin.position.copy(SKYLINE_TOWER_POS).setY(16);
  towerPin.scale.setScalar(2.2);
  arContent.add(towerPin);

  const label = namedGroup("ar-poi-label");
  const board = clayMesh(new BoxGeometry(1.7, 0.62, 0.04), "signPanel");
  board.castShadow = false;
  label.add(board);
  const barWidths = [1.3, 1.0, 1.2];
  barWidths.forEach((width, index) => {
    const bar = clayMesh(new BoxGeometry(width, 0.09, 0.05), "label");
    bar.position.set((width - 1.4) / 2, 0.17 - index * 0.17, 0.02);
    bar.castShadow = false;
    label.add(bar);
  });
  // LEFT of the pin from the dive camera's view (round-2 feedback R12:
  // on the right it was off-screen on phones until it faded out).
  label.position.set(
    WORLD_ANCHORS.statue.x - 1.9,
    2.4,
    WORLD_ANCHORS.statue.z + 0.4,
  );
  // Face the dive/gallery viewing directions (path side of the statue).
  label.lookAt(new Vector3(2, 2.2, 8));
  arContent.add(label);

  arContent.visible = false;
  return arContent;
}

export function buildClayWorld(detail: "high" | "low"): Group {
  const counts = DETAIL[detail];
  const rng = createRng(20260712);
  const world = namedGroup(WORLD_NODE.root);
  world.add(
    buildGround(),
    buildPath(counts.pathSegments),
    scatter(WORLD_NODE.hills, counts.hills, rng, buildHill, 4),
    scatter(WORLD_NODE.trees, counts.trees, rng, buildTree, 2.2),
    scatter(WORLD_NODE.rocks, counts.rocks, rng, buildRock, 1.8),
    buildSign(),
    buildStatue(),
    buildSnapRing(),
    buildOuter(counts, rng),
    buildSkyline(),
    buildArContent(),
    // Use-case vignettes (round-11): the gallery journey's destinations.
    buildUseCaseVignettes(VIGNETTE_ANCHORS),
    // Geocache chest (easter-egg №1): tucked on the castle disc, on the
    // side the CTA arrival camera faces — palm-sized, hidden in plain
    // sight. The chest faces the world center like the castle does.
    buildGeocache(GEOCACHE_ANCHOR),
    // Hidden bird (easter-egg №10): perched atop the QR sign, in frame
    // during the QR chapter — small and easy to miss (fully hidden).
    buildBird(BIRD_ANCHOR),
    // Forest magic portal (round-14 R14-10): opens while the
    // works-anywhere copy is on screen; primed closed here, the story
    // timeline pops it open + shut and the render loop swirls its rings.
    buildForestPortal(PORTAL_ANCHOR, new Vector3(0, PORTAL_ANCHOR.y, 0)),
    // Parkour park (round-14 R14-12): a lawn + green course in front of
    // the highrises; the blocks pop in during the works-anywhere copy.
    buildParcoursPark(PARK_ANCHOR),
    // World-detail layer (v3 F7, curb removed in round-9): instanced
    // grass + contact shadows.
    buildGrass(detail, createPathCurve(), Object.values(WORLD_ANCHORS)),
    buildContactShadows(WORLD_ANCHORS),
  );
  return world;
}
