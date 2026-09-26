/**
 * The look-dev page's stand-in world (plan 2026-09-23-0048, DEC-SKY-7): the
 * four things a sky has to be judged against.
 *
 * - A CITY BLOCK of extruded buildings, like the demos' OSM output: this is
 *   what the sky lights in practice, so its grading is the real test.
 * - DISTANT RIDGES at ~2.5, 5 and 9 km: aerial perspective can only be judged
 *   where there is depth to fade into.
 * - MATERIAL SWATCHES: spheres from matte to mirror, dielectric and metal,
 *   which show the environment light without any content in the way.
 * - A LAKE and MARKER PROPS: the lightweight water's home, and the AR diamond
 *   the demos actually place.
 *
 * Deterministic: every "random" choice comes from a fixed hash, so two
 * screenshots of the same preset show the same city.
 *
 * @see stand-in-scene.js.md
 */
import * as THREE from "three";

/** A fixed pseudo-random value in [0, 1) for an integer seed. */
function hash(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Smooth 1-D ridge profile around a circle: a few octaves of hashed sines. */
function ridgeProfile(angle, layer) {
  let height = 0;
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < 4; octave++) {
    const frequency = 3 * 2 ** octave + layer;
    const phase = hash(layer * 31 + octave) * Math.PI * 2;
    height += amplitude * (0.5 + 0.5 * Math.sin(angle * frequency + phase));
    total += amplitude;
    amplitude *= 0.5;
  }
  return height / total;
}

function ground() {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(12000, 96),
    new THREE.MeshStandardMaterial({ color: 0x55654a, roughness: 1 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = "ground";
  return mesh;
}

function streets() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 320),
    new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.9 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.05;
  mesh.name = "streets";
  return mesh;
}

function cityBlock() {
  const group = new THREE.Group();
  group.name = "city";
  const concrete = [0xb9b3a8, 0xa9aeb3, 0xc4b59e, 0x9c9a95].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.78 }),
  );
  const glass = new THREE.MeshStandardMaterial({
    color: 0x8fa4b8,
    metalness: 0.9,
    roughness: 0.12,
  });
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const pitch = 42;
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) {
      const seed = (i + 10) * 37 + (j + 10);
      const height = 8 + 52 * hash(seed) ** 2;
      const tower = hash(seed + 1) > 0.88;
      const material = tower
        ? glass
        : concrete[Math.floor(hash(seed + 2) * concrete.length)];
      const building = new THREE.Mesh(box, material);
      building.scale.set(
        18 + 12 * hash(seed + 3),
        tower ? height * 1.6 : height,
        18 + 12 * hash(seed + 4),
      );
      building.position.set(i * pitch, 0, j * pitch);
      group.add(building);
    }
  }
  return group;
}

/**
 * The dense city's lot pitches (programme plan 2026-09-26-0539, W1 M3): the
 * block's own 42 m, and two denser grids for the performance sweep. The fill
 * is allocated per pitch, so the count a hash names always fits.
 */
export const DENSE_PITCHES = [42, 31, 20];
/** The fill keeps clear of the original scene (block, lake, swatches, markers). */
const DENSE_INNER_M = 420;
/** And stops short of the first mountain ring at 2500 m (DEC: mountains stay). */
const DENSE_OUTER_M = 2350;

/**
 * THE DENSE CITY: every lot of a `pitch` grid between DENSE_INNER_M and
 * DENSE_OUTER_M, ordered by radius, as two InstancedMeshes (concrete with a
 * per-building colour, and glass towers). `setCount(n)` shows the nearest n
 * lots, so a count fills a growing disc. Two draws per pass whatever the
 * count.
 *
 * THE BOUNDS ARE MEASURED ONCE, AT THE FULL ALLOCATION, and never again: an
 * InstancedMesh computes its bounding sphere over `count` instances the first
 * time it is culled and then keeps it, so a sphere measured at a small count
 * would cull the whole fill in any view that misses the centre (W1 plan §4).
 */
export function denseCity(pitch = DENSE_PITCHES[0]) {
  const lots = [];
  const cells = Math.ceil(DENSE_OUTER_M / pitch);
  for (let i = -cells; i <= cells; i++) {
    for (let j = -cells; j <= cells; j++) {
      const x = i * pitch;
      const z = j * pitch;
      const r = Math.hypot(x, z);
      if (r < DENSE_INNER_M || r > DENSE_OUTER_M) continue;
      lots.push({ x, z, r, seed: (i + 1000) * 7919 + (j + 1000) });
    }
  }
  lots.sort((a, b) => a.r - b.r || a.x - b.x || a.z - b.z);
  const concrete = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x8fa4b8,
    metalness: 0.9,
    roughness: 0.12,
  });
  const palette = [0xb9b3a8, 0xa9aeb3, 0xc4b59e, 0x9c9a95].map(
    (c) => new THREE.Color(c),
  );
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const isTower = (lot) => hash(lot.seed + 1) > 0.88;
  const towers = lots.filter(isTower);
  const blocks = lots.filter((lot) => !isTower(lot));
  const concreteMesh = new THREE.InstancedMesh(box, concrete, blocks.length);
  const glassMesh = new THREE.InstancedMesh(
    box,
    glass,
    Math.max(1, towers.length),
  );
  concreteMesh.name = "dense-concrete";
  glassMesh.name = "dense-glass";
  const matrix = new THREE.Matrix4();
  const place = (lot, tower) => {
    const height = (8 + 52 * hash(lot.seed) ** 2) * (tower ? 1.6 : 1);
    const footprint = pitch * 0.45;
    matrix.makeScale(
      footprint + pitch * 0.25 * hash(lot.seed + 3),
      height,
      footprint + pitch * 0.25 * hash(lot.seed + 4),
    );
    matrix.setPosition(lot.x, 0, lot.z);
    return matrix;
  };
  blocks.forEach((lot, k) => {
    concreteMesh.setMatrixAt(k, place(lot, false));
    concreteMesh.setColorAt(
      k,
      palette[Math.floor(hash(lot.seed + 2) * palette.length)],
    );
  });
  towers.forEach((lot, k) => glassMesh.setMatrixAt(k, place(lot, true)));
  // Bounds at the full allocation, before any count is set (see above).
  concreteMesh.computeBoundingSphere();
  concreteMesh.computeBoundingBox();
  glassMesh.computeBoundingSphere();
  glassMesh.computeBoundingBox();
  // The prefix of each kind that falls within the nearest n lots.
  const blocksBefore = [];
  const towersBefore = [];
  let b = 0;
  let t = 0;
  for (const lot of lots) {
    blocksBefore.push(b);
    towersBefore.push(t);
    if (isTower(lot)) t++;
    else b++;
  }
  blocksBefore.push(b);
  towersBefore.push(t);
  const group = new THREE.Group();
  group.name = "dense";
  group.add(concreteMesh, glassMesh);
  const setCount = (n) => {
    const count = Math.max(0, Math.min(lots.length, Math.floor(n)));
    concreteMesh.count = blocksBefore[count];
    glassMesh.count = towersBefore[count];
    group.visible = count > 0;
    group.userData.count = count;
  };
  const last = lots[lots.length - 1];
  group.userData = {
    pitch,
    max: lots.length,
    count: 0,
    farthest: last ? [last.x, last.z] : [0, 0],
    setCount,
  };
  setCount(0);
  return group;
}

function ridges() {
  const group = new THREE.Group();
  group.name = "ridges";
  const layers = [
    { radius: 2500, height: 120 },
    { radius: 5000, height: 260 },
    { radius: 9000, height: 520 },
  ];
  const segments = 256;
  layers.forEach(({ radius, height }, layer) => {
    const positions = [];
    const indices = [];
    for (let s = 0; s <= segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const top = height * (0.35 + 0.65 * ridgeProfile(angle, layer));
      positions.push(x, -30, z, x, top, z);
      if (s < segments) {
        const a = s * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x4a5a3f,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
    );
    mesh.name = `ridge-${layer}`;
    group.add(mesh);
  });
  return group;
}

/**
 * The height the pond and the material swatches float at (owner feedback
 * 2026-09-26, W1 plan M4): above the city, so a ring full of buildings never
 * hides them, and below the scene-top bound the atmosphere tests hold.
 */
export const FLOAT_HEIGHT_M = 105;
/** The floating pond's centre and radii (x, z), clear of the shadow probes. */
export const POND = { x: 120, z: -40, rx: 110, rz: 70 };

function swatches() {
  const group = new THREE.Group();
  group.name = "swatches";
  const sphere = new THREE.SphereGeometry(4, 48, 24);
  for (let k = 0; k < 6; k++) {
    const roughness = k / 5;
    const dielectric = new THREE.Mesh(
      sphere,
      new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness }),
    );
    dielectric.position.set(-50 + k * 20, FLOAT_HEIGHT_M, 170);
    const metal = new THREE.Mesh(
      sphere,
      new THREE.MeshStandardMaterial({
        color: 0xe6c07a,
        metalness: 1,
        roughness,
      }),
    );
    metal.position.set(-50 + k * 20, FLOAT_HEIGHT_M, 192);
    group.add(dielectric, metal);
  }
  return group;
}

function lake() {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    // A placeholder the page replaces with the framework's WaterSurface
    // (plan M4); kept dark and glossy so the scene still reads without it.
    new THREE.MeshStandardMaterial({ color: 0x1d3b4a, roughness: 0.06 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(POND.rx, POND.rz, 1);
  mesh.position.set(POND.x, FLOAT_HEIGHT_M, POND.z);
  mesh.name = "lake";
  return mesh;
}

/**
 * A shallow closed basin under the floating pond: from below it reads as a
 * slab, not as the back face of a sky mirror (W1 plan §4). Its top sits just
 * under the water.
 */
function basin() {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 3, 64),
    new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.9 }),
  );
  mesh.scale.set(POND.rx + 0.5, 1, POND.rz + 0.5);
  mesh.position.set(POND.x, FLOAT_HEIGHT_M - 1.6, POND.z);
  mesh.name = "basin";
  return mesh;
}

function markers() {
  const group = new THREE.Group();
  group.name = "markers";
  const diamond = new THREE.OctahedronGeometry(3);
  const pole = new THREE.CylinderGeometry(0.25, 0.25, 12, 8);
  const accent = new THREE.MeshStandardMaterial({
    color: 0xff7a1a,
    emissive: 0xff7a1a,
    emissiveIntensity: 0.6,
    roughness: 0.4,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x8a8f96,
    metalness: 0.8,
    roughness: 0.35,
  });
  for (const [x, z] of [
    [150, 40],
    [200, -130],
    [-160, 120],
  ]) {
    const stem = new THREE.Mesh(pole, steel);
    stem.position.set(x, 6, z);
    const top = new THREE.Mesh(diamond, accent);
    top.position.set(x, 16, z);
    group.add(stem, top);
  }
  return group;
}

/**
 * One object per OTHER material family the demos use (OsmDemo: Lambert
 * buildings in some modes, sprite labels, route lines). The haze patches
 * every fog-capable family, and a shader compile error in any of them only
 * logs, so each family must be drawn here where the smoke's console check
 * can see it (M2 review, finding 6).
 */
function materialFamilies() {
  const group = new THREE.Group();
  group.name = "families";
  const lambert = new THREE.Mesh(
    new THREE.BoxGeometry(14, 22, 14),
    new THREE.MeshLambertMaterial({ color: 0xb8a58c }),
  );
  lambert.position.set(-40, 11, 120);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ color: 0xff7a1a }),
  );
  sprite.scale.set(10, 10, 1);
  sprite.position.set(120, 40, 80);
  const route = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-150, 0.3, 150),
      new THREE.Vector3(0, 0.3, 150),
      new THREE.Vector3(150, 0.3, 40),
    ]),
    new THREE.LineBasicMaterial({ color: 0xffe08a }),
  );
  group.add(lambert, sprite, route);
  return group;
}

/** Build the stand-in world into `scene`. Returns the named parts. */
export function buildStandInScene(scene) {
  const parts = {
    ground: ground(),
    streets: streets(),
    city: cityBlock(),
    dense: denseCity(),
    ridges: ridges(),
    swatches: swatches(),
    lake: lake(),
    basin: basin(),
    markers: markers(),
    families: materialFamilies(),
  };
  for (const part of Object.values(parts)) scene.add(part);
  return parts;
}
