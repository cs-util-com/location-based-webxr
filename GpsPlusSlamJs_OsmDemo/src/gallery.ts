/**
 * Every POI model, on a neutral pad, at true relative scale (W7, closes F28).
 *
 * WHY THIS IS A SEPARATE PAGE RATHER THAN A BUTTON IN THE DEMO. The round-5
 * notes proposed spawning all fifty models into the live scene, 40–50 m above
 * the ground, and left the choice open — _"kannst ja mal drüber nachdenken, was
 * da wirklich sinnvoller ist"_. DEC-R5-5 chose a page, for three reasons that
 * are about cost rather than taste:
 *
 * - **In-scene, they would need a registry entry or a deliberate exception to
 *   one.** The layer, pick and details registries are exhaustive over their
 *   unions by construction, which is what keeps a layer from existing that
 *   nothing can switch off. A fifty-model debug spawn is none of those things.
 * - **It would perturb the measurements.** The draw-call readout and the
 *   difference-count e2e proxies both read the live scene; round 4 had to
 *   rebuild two of those proxies once already when the palette changed.
 * - **Relative scale is the whole point and a city hides it.** DEC-R4-14 said so
 *   when it declined the contact sheet: _"a bench the size of a kiosk is much
 *   harder to see in a city scene than on a neutral row."_ Fifty models scattered
 *   across Cologne at their real sizes is exactly the arrangement that cannot
 *   answer the question they are being shown for.
 *
 * WHAT IT DELIBERATELY DOES NOT HAVE: no store, no worker, no Overpass, no
 * terrain, no affordance grid. `POI_MODELS` is pure data from the package, so
 * this page is a camera, a light and a loop.
 *
 * @see gallery.ts.md
 */

import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { POI_MODELS, poiVariantsFor, type MeshData } from "gps-plus-slam-osm";

/** Metres between pad centres. Wide enough that a fuel canopy cannot overlap. */
const PITCH_M = 8;

/** A human, for scale. The one reference that makes every model readable. */
const HUMAN_HEIGHT_M = 1.8;

/** Pad edge, metres. Slightly under the pitch so the gaps read as gaps. */
const PAD_M = 6.4;

/**
 * Where every kind and every one of its variants stands (DEC-R6-32).
 *
 * KINDS STAY IN RANKING ORDER along x: `poi-ranking.ts` chose these fifty by
 * global usage count, so reading left to right is reading most-common to least
 * — which is the order in which a wrong model matters.
 *
 * **ONE COLUMN PER KIND ON X, VARIANTS RECEDING ON Z, and the up axis unused.**
 * The owner chose this after the shipped models were rejected: comparing three
 * versions of a cafe needs them adjacent and at the same scale, and the axis has
 * to be a dedicated one or "next model" and "next variant" become the same
 * movement.
 *
 * **THIS REVERSES THE SQUARE GRID, whose reason has NOT expired.** The previous
 * layout kept the sheet roughly square because "a 1x50 strip cannot be framed,
 * and comparing the first model with the last needs a camera journey" — which is
 * still true, and at a 8 m pitch fifty kinds is a 400 m row. The trade was taken
 * anyway because the grid used Z for its own rows, so variants had nowhere
 * unambiguous to go: a variant behind a kind would sit on top of the kind in the
 * next row. **Panning is now part of using this page**, and that is the accepted
 * cost rather than an oversight.
 *
 * Variants recede along −z, away from the default camera, so index 0 — the
 * shipped model — is the one nearest the viewer.
 */
export function galleryPositions(
  variantCounts: readonly number[],
): { x: number; z: number }[][] {
  const deepest = Math.max(0, ...variantCounts);
  // Centred on both axes, so the default camera frames the sheet rather than
  // opening on a quarter of it.
  const halfDepth = ((deepest - 1) * PITCH_M) / 2;
  return variantCounts.map((count, kindIndex) => {
    const x = (kindIndex - (variantCounts.length - 1) / 2) * PITCH_M;
    return Array.from({ length: count }, (_, variantIndex) => ({
      x,
      z: halfDepth - variantIndex * PITCH_M,
    }));
  });
}

/**
 * Takes a `MeshData` rather than a `PoiModel`, because a variant is not one.
 *
 * Carries the per-face colours through when the mesh has them (§4's painting),
 * so a variant that paints its parts reads here the way it will in the demo.
 */
function geometryFor(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(mesh.positions, 3),
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  if (mesh.colours !== undefined) {
    geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colours, 3));
  }
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return geometry;
}

/**
 * A text label as a canvas sprite.
 *
 * A sprite rather than DOM overlays: fifty absolutely-positioned elements would
 * have to be re-projected on every camera move, which is a second render loop
 * running against the first. A sprite is part of the scene and follows for free.
 */
function labelFor(text: string, sub: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "#e6e8ef";
    ctx.font = "600 42px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 52, 500);
    ctx.fillStyle = "#9aa3b8";
    ctx.font = "34px system-ui, sans-serif";
    ctx.fillText(sub, 256, 100, 500);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true }),
  );
  sprite.scale.set(7.6, 1.9, 1);
  return sprite;
}

export function buildGallery(container: HTMLElement): () => void {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    // NEEDED PRECISELY BECAUSE THERE IS NO PERMANENT rAF LOOP — see
    // `requestFrame` below. Frames are scheduled on demand, so by the time a
    // test reads the canvas nothing is repainting and the buffer has already
    // been cleared after the last composite. Without this the e2e read comes
    // back empty while the page looks perfect to a human, which is the most
    // confusing possible failure: the screenshot shows a working page and the
    // assertion shows nothing drawn. `building-view.ts` carries the same flag
    // for the same reason.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1e26);

  // Lighting chosen to READ SHAPE, not to match the demo. The demo's sun follows
  // the camera (DEC-R4-6) precisely so a highlight is never lost; here the models
  // are static and the camera orbits, so a fixed key plus a hemisphere fill gives
  // every facet a stable, comparable tone.
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  scene.add(new THREE.HemisphereLight(0xaabbdd, 0x4a5058, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(30, 60, 40);
  scene.add(key);

  // EVERY KIND KEEPS ITS COLUMN, and its liked alternatives recede behind it
  // (DEC-R6-32). The shipped model is always index 0 so the incumbent is the
  // nearest of each row — Q-V1 of the variant plan notes that a liked
  // alternative may still lose to what is already there, which cannot be judged
  // if the incumbent is not in the comparison.
  const models = [...POI_MODELS.values()];
  const rows = models.map((model) => {
    const alternatives = poiVariantsFor(model.kind).filter(
      // The seven §4 rebuilds are re-exposed as their own `L` variant, so
      // skipping any variant that shares the shipped mesh keeps a kind from
      // showing the same geometry twice under two labels.
      (variant) => variant.mesh !== model.mesh,
    );
    return { model, alternatives };
  });
  const positions = galleryPositions(
    rows.map((row) => 1 + row.alternatives.length),
  );

  const padGeometry = new THREE.BoxGeometry(PAD_M, 0.08, PAD_M);
  const padMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2f3a,
    roughness: 0.9,
  });
  const humanGeometry = new THREE.BoxGeometry(0.4, HUMAN_HEIGHT_M, 0.25);
  const humanMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d4552,
    roughness: 0.8,
  });

  rows.forEach((row, kindIndex) => {
    const slots = positions[kindIndex];
    if (slots === undefined) return;
    // The shipped model first, then each alternative receding behind it.
    const entries = [
      {
        mesh: row.model.mesh,
        colour: row.model.colour,
        heightM: row.model.heightM,
        label: "shipped",
      },
      ...row.alternatives.map((variant) => ({
        mesh: variant.mesh,
        colour: variant.colour,
        heightM: variant.heightM,
        label: variant.source,
      })),
    ];

    entries.forEach((entry, variantIndex) => {
      const at = slots[variantIndex];
      if (at === undefined) return;
      const group = new THREE.Group();
      group.position.set(at.x, 0, at.z);

      const pad = new THREE.Mesh(padGeometry, padMaterial);
      pad.position.y = -0.04;
      group.add(pad);

      const mesh = new THREE.Mesh(
        geometryFor(entry.mesh),
        new THREE.MeshStandardMaterial({
          color: entry.colour,
          roughness: 0.65,
          metalness: 0.05,
          ...(entry.mesh.colours === undefined ? {} : { vertexColors: true }),
        }),
      );
      group.add(mesh);

      // THE SCALE REFERENCE, and it is the reason this page exists rather than a
      // screenshot: "is this bench too tall" is unanswerable without a human
      // beside it, and unanswerable in a city because nothing there is a known
      // size. Every variant gets its own, because comparing two variants is also
      // comparing each against real scale.
      const human = new THREE.Mesh(humanGeometry, humanMaterial);
      human.position.set(-PAD_M / 2 + 0.5, HUMAN_HEIGHT_M / 2, PAD_M / 2 - 0.5);
      group.add(human);

      // THE SOURCE IS ON THE LABEL, and it has to be: once these are rendered
      // they are indistinguishable, and "which file was that one from" is
      // exactly the question the comparison has to answer.
      const label = labelFor(
        `${row.model.kind}${entries.length > 1 ? ` · ${entry.label}` : ""}`,
        `${entry.heightM.toFixed(2)} m`,
      );
      label.position.set(0, -1.2, PAD_M / 2);
      group.add(label);

      scene.add(group);
    });
  });

  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    2000,
  );
  const span = Math.ceil(Math.sqrt(models.length)) * PITCH_M;
  // HIGH AND BACK, framing the whole sheet. A low three-quarter view lets the
  // building-scale entries (pub, guest house, hospital) occlude the street
  // furniture behind them, which is the opposite of what this page is for.
  camera.position.set(0, span * 0.8, span * 0.72);
  camera.lookAt(0, 0, 0);

  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // ON DEMAND, like the demo (DEC-R3-9): a permanent rAF loop repainting a static
  // grid is a phone battery for nothing. Damping needs frames while it settles,
  // so `change` scheduling covers exactly the moments there is something to draw.
  let pending = 0;
  const draw = () => {
    pending = 0;
    controls.update();
    renderer.render(scene, camera);
  };
  const requestFrame = () => {
    if (pending === 0) pending = requestAnimationFrame(draw);
  };
  controls.addEventListener("change", requestFrame);

  const resize = () => {
    const width = container.clientWidth;
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestFrame();
  };
  // THE CONTEXT CAN ARRIVE AFTER THE FIRST FRAME, AND ON A PAGE THAT PAINTS ONCE
  // THAT IS FATAL. Chromium brings the GPU channel up asynchronously: measured
  // here, the context reports `isContextLost()` immediately after load, fires
  // `webglcontextlost`, and is restored ~1 s later. A page with a permanent rAF
  // loop never notices — the next frame redraws. This page draws exactly one
  // frame, and without the handler below it draws it into a context that is
  // about to be replaced, leaving a permanently blank canvas with nothing logged.
  //
  // The demo does not hit this only because its async boot (rule table, worker,
  // fetch, terrain) schedules frames for a second or two afterwards.
  //
  // `preventDefault` on the loss is what allows the browser to restore at all,
  // but three registers its own handler first and already calls it — so the one
  // below is belt-and-braces, not the thing that enables restoration. **The
  // handler that actually matters is the RESTORED one**: three re-creates its GL
  // resources, and has no opinion about when a page that paints on demand should
  // schedule its next frame.
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    requestFrame();
  });

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  // FIRST PAINT IS SYNCHRONOUS, and that is a correctness point rather than an
  // optimisation. Everything above is synchronous, so the page reports "50 POI
  // models" the instant the module evaluates — while the scene is still waiting
  // on an animation frame that has not run yet. Anything reading the canvas in
  // that gap (the e2e did) sees an untouched buffer and concludes nothing was
  // drawn. A static grid has no reason to defer its only necessary frame.
  draw();

  const status = document.getElementById("gallery-status");
  if (status !== null) {
    status.textContent = `${models.length} POI models, ranked by global usage · the block beside each is ${HUMAN_HEIGHT_M} m tall`;
  }

  return () => {
    // Cancel first: a frame queued by a controls `change` immediately before
    // teardown would otherwise call `draw()` against a disposed renderer.
    if (pending !== 0) cancelAnimationFrame(pending);
    observer.disconnect();
    controls.dispose();
    renderer.dispose();
  };
}

// NO BOOTSTRAP HERE, deliberately. Calling `buildGallery` at module scope would
// make importing this file for a unit test construct a `WebGLRenderer` — so the
// layout arithmetic, the one part that can be wrong without a GPU, would be
// untestable. `gallery-main.ts` is the entry; this is the module.
