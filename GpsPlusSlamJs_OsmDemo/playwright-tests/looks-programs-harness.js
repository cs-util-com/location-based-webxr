// @ts-check
/**
 * Draws the colour-looks shader programs of `gps-plus-slam-osm/three` in a
 * real WebGL 2 context, for `looks-programs.spec.js`. The unit tests check
 * the shader TEXT the patches write; only a GPU driver says whether that
 * text compiles and links, and what it draws. Each check renders the fixed
 * program and the looks program side by side from the same data, reads the
 * pixels back, and reports every program info log three.js saw.
 */

import * as THREE from "three";
import { applyGroundTint } from "gps-plus-slam-osm/three";

/** The square canvas every check draws into, pixels. */
const SIZE = 64;

/**
 * A renderer that collects shader errors instead of printing them.
 *
 * @returns {{ renderer: THREE.WebGLRenderer, errors: string[] }}
 */
function checkedRenderer() {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  /** @type {string[]} */
  const errors = [];
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    errors.push(
      [
        gl.getProgramInfoLog(program),
        gl.getShaderInfoLog(vertex),
        gl.getShaderInfoLog(fragment),
      ].join("\n"),
    );
  };
  return { renderer, errors };
}

/**
 * Renders `scene` from `camera` and returns the canvas pixels (RGBA,
 * bottom row first).
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @returns {Uint8Array}
 */
function draw(renderer, scene, camera) {
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

/**
 * The largest per-channel difference between two RGBA readbacks.
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
function maxDifference(a, b) {
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  return worst;
}

/**
 * How many different red values the middle pixel row holds: a hard class
 * edge gives two, a filtered one a ramp.
 *
 * @param {Uint8Array} pixels
 */
function middleRowShades(pixels) {
  const y = SIZE >> 1;
  const shades = new Set();
  for (let x = 0; x < SIZE; x++) shades.add(pixels[(y * SIZE + x) * 4]);
  return shades.size;
}

/** The four looks' palettes: neutral, then two land-use classes. */
const LOOK_PALETTES = [
  [0x6b7280, 0xd04030, 0x30a050],
  [0x5a5f70, 0xe0a040, 0x2060c0],
  [0x404858, 0xa03070, 0x60c0a0],
  [0x283040, 0x704020, 0x90b030],
];

/**
 * A ground tint 4 texels by 1, 10 m each, classes 1 1 2 2: the edge
 * between texels 1 and 2 lies at x = 0 of the render plane.
 *
 * @param {readonly number[]} palette
 * @param {readonly (readonly number[])[] | undefined} lookPalettes
 * @returns {import("gps-plus-slam-osm").GroundTint}
 */
function edgeTint(palette, lookPalettes) {
  return {
    width: 4,
    height: 1,
    texelM: 10,
    originX: -20,
    originY: -5,
    classes: Uint8Array.from([1, 1, 2, 2]),
    palette,
    shares: {},
    skipped: 0,
    ...(lookPalettes === undefined ? {} : { lookPalettes }),
  };
}

/**
 * A ground plane over the tint's window, lit evenly, seen from straight
 * above across the class edge: 12 m wide, so the whole ramp of a linear
 * filter (texel centre to texel centre, 10 m) fits, 60 cm a pixel.
 *
 * @returns {{ scene: THREE.Scene, camera: THREE.OrthographicCamera, material: THREE.MeshLambertMaterial }}
 */
function groundScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  const material = new THREE.MeshLambertMaterial();
  const plane = new THREE.PlaneGeometry(40, 10).rotateX(-Math.PI / 2);
  scene.add(new THREE.Mesh(plane, material));
  const camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 100);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  return { scene, camera, material };
}

/**
 * The land-use tint's looks program against the fixed one: the looks
 * program at a weight of 1 for look 0 and look 2, and at a 50/50 mix,
 * each frame compared with the fixed tint of the matching palette.
 *
 * @returns {{ errors: string[], atWeightOne: number[], fixedShades: number, looksShades: number, mixDrawn: boolean }}
 */
export function groundLooksCheck() {
  const { renderer, errors } = checkedRenderer();
  const fixed = groundScene();
  const looks = groundScene();
  const applied = applyGroundTint(
    looks.material,
    edgeTint(LOOK_PALETTES[0] ?? [], LOOK_PALETTES),
    { fadeM: 0 },
  );
  /** @type {number[]} */
  const atWeightOne = [];
  let fixedShades = 0;
  let looksShades = 0;
  for (const k of [0, 2]) {
    const tint = applyGroundTint(
      fixed.material,
      edgeTint(LOOK_PALETTES[k] ?? [], undefined),
      { fadeM: 0 },
    );
    const want = draw(renderer, fixed.scene, fixed.camera);
    applied.setLookWeights([0, 1, 2, 3].map((i) => (i === k ? 1 : 0)));
    const got = draw(renderer, looks.scene, looks.camera);
    atWeightOne.push(maxDifference(want, got));
    if (k === 0) {
      fixedShades = middleRowShades(want);
      looksShades = middleRowShades(got);
    }
    tint.dispose();
  }
  applied.setLookWeights([0.5, 0.5, 0, 0]);
  const mixed = draw(renderer, looks.scene, looks.camera);
  const mixDrawn = mixed.some((v, i) => i % 4 !== 3 && v > 0);
  applied.dispose();
  renderer.dispose();
  return { errors, atWeightOne, fixedShades, looksShades, mixDrawn };
}
