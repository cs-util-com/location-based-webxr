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
import { POI_MODELS, type MeshData } from "gps-plus-slam-osm";

/** A human, for scale. The one reference that makes every model readable. */
const HUMAN_HEIGHT_M = 1.8;

/** Pad edge, metres. Comfortably under the pitch so the gaps read as gaps. */
const PAD_M = 6.4;

/**
 * The stand-in building in the roof-symbol state, and the symbol's clearance
 * above it (DEC-S18).
 *
 * A SINGLE STOREY rather than a tower: the question this state answers is "does
 * the symbol still read with nothing under it", so the box has to be
 * unmistakably a building and otherwise get out of the way. Something 15 m tall
 * would put the symbol above the pad's own label and make the row unreadable.
 *
 * The clearance is a gap rather than contact because roofs are PITCHED, and
 * stage 1 will lift by exactly this kind of margin above a measured roof height
 * rather than trying to find a contact point on a slope.
 */
const HOST_HEIGHT_M = 4;
const HOST_CLEARANCE_M = 0.6;

/**
 * Clear ground between one pad and the next, metres.
 *
 * **TRIPLED ON THE OWNER'S FIRST LOOK** — _"insgesamt bitte mehr Abstand
 * zwischen den Kacheln, mindestens dreimal so viel Platz lassen"_. The original
 * 1.6 m was derived from the pads not overlapping, which is the wrong bar: at a
 * 6.4 m pad a 1.6 m gap reads as a grid of touching tiles, and the eye groups
 * neighbouring kinds together instead of reading each pad as one candidate. The
 * gap is what separates one comparison from the next, so it is the number that
 * belongs in a constant of its own.
 */
const PAD_GAP_M = 1.6 * 3;

/** Metres between pad centres. Derived, so the gap above is the real control. */
const PITCH_M = PAD_M + PAD_GAP_M;

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
 * How one entry is labelled.
 *
 * WAS A COMPARISON, IS NOW A CATALOGUE (DEC-R7b-2a). This used to append the
 * source letter and a `← chosen` mark, because every kind showed the shipped
 * model beside its liked alternatives and the page doubled as a check that the
 * owner's spoken verdict had been transcribed correctly.
 *
 * That verdict has been adopted — the winners ARE the shipped models now — so
 * there is nothing left to compare and no second table to check against. The
 * kind is the whole label.
 */
export function rowLabel(kind: string): string {
  return kind;
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

  // ONE COLUMN PER KIND, one model per column (DEC-R7b-2a). The page used to
  // put each kind's liked alternatives behind it so the two could be judged side
  // by side; the owner has since chosen, the winners have been adopted, and the
  // losing geometry is deleted. What remains is the catalogue — the only place
  // in the repo that shows what every POI kind actually looks like at real scale
  // beside a human.
  // TWO SLOTS FOR A FAMILY-S KIND, ONE FOR FAMILY L (DEC-S18, stage 0d).
  //
  // Slot 0 is the marker as it ships: symbol on its column. Slot 1 is the SYMBOL
  // ALONE, floating over a grey box standing in for a building — which is the
  // other half of how it will actually be used (DEC-S2), and the half no test
  // can judge. The contract can assert a symbol has geometry, stands on its own
  // base and fits the envelope; only an eye can say whether it still means
  // "pharmacy" with nothing underneath it.
  //
  // It also restores the view the winners were PICKED in. All five prototype
  // galleries showed the paired states, so judging the port in a single merged
  // view would be judging it by a different standard than the one that selected
  // it.
  //
  // The Z axis already exists for exactly this shape — DEC-R6-32 put variants on
  // it — so this needs no new layout, and family L keeps one slot because a
  // bench has no symbol to float.
  const models = [...POI_MODELS.values()];
  const positions = galleryPositions(
    models.map((entry) => (entry.symbol === undefined ? 1 : 2)),
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
  // The stand-in building for the roof-symbol state. Deliberately plain and
  // deliberately NOT pad-sized: it has to read as a building the symbol belongs
  // to, without becoming the thing being looked at.
  const hostGeometry = new THREE.BoxGeometry(3.2, HOST_HEIGHT_M, 3.2);
  const hostMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a3f4a,
    roughness: 0.95,
  });

  models.forEach((entry, kindIndex) => {
    const slots = positions[kindIndex];
    if (slots === undefined) return;
    {
      const at = slots[0];
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

      // THE HEIGHT IS ON THE LABEL because the scale reference beside it only
      // answers "does this look right"; the number answers "how tall is it",
      // which is the question a model's own contract test asserts.
      const label = labelFor(
        rowLabel(entry.kind),
        `${entry.heightM.toFixed(2)} m`,
      );
      label.position.set(0, -1.2, PAD_M / 2);
      group.add(label);

      scene.add(group);
    }

    // SLOT 1 — the symbol alone, over a stand-in building (DEC-S18).
    const roofSlot = slots[1];
    const symbol = entry.symbol;
    if (roofSlot !== undefined && symbol !== undefined) {
      const group = new THREE.Group();
      group.position.set(roofSlot.x, 0, roofSlot.z);

      const building = new THREE.Mesh(hostGeometry, hostMaterial);
      building.position.y = HOST_HEIGHT_M / 2;
      group.add(building);

      const mesh = new THREE.Mesh(
        geometryFor(symbol),
        new THREE.MeshStandardMaterial({
          color: entry.colour,
          roughness: 0.65,
          metalness: 0.05,
          ...(symbol.colours === undefined ? {} : { vertexColors: true }),
        }),
      );
      // FLOATING ABOVE THE ROOF, not resting on it, because roofs are pitched
      // and stage 1 will lift by a clearance rather than by a contact point.
      mesh.position.y = HOST_HEIGHT_M + HOST_CLEARANCE_M;
      group.add(mesh);

      const label = labelFor(rowLabel(entry.kind), "symbol alone, over a roof");
      label.position.set(0, -1.2, PAD_M / 2);
      group.add(label);

      scene.add(group);
    }
  });

  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    2000,
  );
  // OPENS ON THE FIRST FEW KINDS, NOT ON THE WHOLE SHEET, and this reverses the
  // previous framing deliberately.
  //
  // That framing was `sqrt(50) * PITCH` high and back, chosen so "the default
  // camera frames the sheet rather than opening on a quarter of it". Its
  // premise was models up to 15 m tall. After the symbol port every marker is
  // ~2.5 m, so the same camera renders fifty two-metre objects across a 400 m
  // row and **nothing on the page is legible** — which defeats its one job.
  // Verified from the e2e's own screenshot rather than reasoned about.
  //
  // Panning is already part of using this page (the row has been 400 m wide
  // since DEC-R6-32 put variants on Z), so the trade is only about where it
  // STARTS. It starts at the left, because `poi-ranking.ts` orders kinds by
  // global usage — so opening on the left is opening on the markers a user will
  // actually meet most often.
  const visibleKinds = 7;
  const span = visibleKinds * PITCH_M;
  const leftmost = (-(models.length - 1) / 2) * PITCH_M;
  const focusX = leftmost + span / 2;
  // HIGH AND BACK RATHER THAN A LOW THREE-QUARTER VIEW: the roof-state row sits
  // behind the column row, and a shallow angle would let the front row occlude
  // it — which is the opposite of what showing both states is for.
  camera.position.set(focusX, span * 0.55, span * 0.62);
  camera.lookAt(focusX, 1.2, 0);

  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // THE TARGET, NOT JUST `lookAt`, and this is a trap rather than a detail.
  // `MapControls` defaults its target to the origin and `controls.update()` —
  // called on every frame in `draw()` — re-points the camera at it. So a
  // `camera.lookAt` before this line is silently discarded on the first frame.
  // The previous framing did not notice because it looked at the origin anyway;
  // opening off-centre does, and the symptom is a view down the length of the
  // row instead of across it.
  controls.target.set(focusX, 1.2, 0);

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
    // THE SECOND COUNT IS REPORTED FROM THE DATA, not written by hand, so the
    // e2e can tell "the roof row drew" from "the roof row is missing" — which
    // are otherwise identical to a pixel count, since a missing row just makes
    // the sheet smaller. Same reasoning as the model count beside it.
    const roofStates = models.filter(
      (entry) => entry.symbol !== undefined,
    ).length;
    status.textContent = `${models.length} POI models, ranked by global usage · ${roofStates} shown again as a symbol alone over a roof · the block beside each is ${HUMAN_HEIGHT_M} m tall`;
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
