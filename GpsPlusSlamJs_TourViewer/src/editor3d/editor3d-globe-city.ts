/**
 * The buildings in the globe editor: OSM's buildings, trees and roads at
 * the tour, as the globe lab draws them (`createGlobeCity` and its step
 * from the Globe package), mounted on the editor's terms:
 *
 * - at the tour's centre, on the relief's own heights (its source and its
 *   zoom), so a building stands on the ground the relief draws;
 * - loaded once the camera is below `EDITOR_CITY.topM` and faded in by
 *   altitude, or warmed up at the start of the approach (`warmUp`); the
 *   flight is not paced on it;
 * - see-through near the selection: the buildings and trees within a
 *   cylinder around it (its radius plus `seeThroughM`) are drawn as a
 *   screen door, one pixel in four, so a station inside a block stays
 *   visible and can be picked (picking never hits the city: the editor
 *   picks the stations and the sampled ground, not the scene);
 * - shown or hidden by the view (`setShown`): hiding stops a load that
 *   runs (the worker is told, nothing it still sends is built), and while
 *   hidden nothing loads and nothing is drawn; shown again, the place is
 *   loaded again.
 *
 * A city that throws (its worker cannot be made) is held off for the
 * view's life with its message in the stats: a frame must never stop on
 * it.
 *
 * @see editor3d-globe-city.ts.md
 */
import * as THREE from "three";

import {
  createGlobeCityStep,
  type GlobeCity,
  type GlobeCityState,
  type GlobeCityStep,
} from "gps-plus-slam-globe/view";

/** The editor's city: where it shows, its ground law, the see-through. */
export const EDITOR_CITY = Object.freeze({
  /** The city fades in below this altitude (m), the globe lab's 30 km. */
  topM: 30_000,
  /** The editor's relief is drawn at true heights everywhere. */
  law: Object.freeze({ near: 1 }),
  /** How far past the selection's own radius (m) the city turns
   *  see-through: about a street's width either side. */
  seeThroughM: 30,
});

/** The selection the city turns see-through around (world space). */
interface EditorCitySelection {
  readonly at: THREE.Vector3;
  /** The ground's up there (unit). */
  readonly up: THREE.Vector3;
  readonly radiusM: number;
}

export interface EditorCityOptions {
  readonly city: Pick<
    GlobeCity,
    "root" | "load" | "abort" | "setFade" | "state" | "dispose"
  >;
  /** The tour's centre (degrees). */
  readonly place: { readonly lat: number; readonly lng: number };
  /** The relief's global zoom: the city's heights' zoom. */
  readonly zoom: number;
  /** The city's step (default: the Globe package's, over `city`). */
  readonly step?: GlobeCityStep;
}

/** The buildings' part of the editor's stats. */
export interface EditorCityStats {
  readonly shown: boolean;
  /** The city's phase (`idle`, `loading`, `ready`, `failed`), or
   *  `unavailable` when its worker could not be made. */
  readonly worker: string;
  readonly message: string | null;
  /** The step's gate: idle, loading, ended or gave-up. */
  readonly gate: string;
  /** The last delivery's Overpass tiles, buildings and features. */
  readonly tiles: number;
  readonly buildings: number;
  readonly features: number;
  readonly missingTiles: number;
  /** The three.js objects drawn and their geometry's bytes. */
  readonly objects: number;
  readonly geometryBytes: number;
  /** The requested fade and the share drawn (with the arrival's fade). */
  readonly fade: number;
  readonly drawn: number;
  readonly visible: boolean;
  /** The city's ground at the tour's centre, the relief's there, and the
   *  difference (m; null until both are known). */
  readonly groundM: number | null;
  readonly reliefGroundM: number | null;
  readonly parityM: number | null;
  readonly load: {
    readonly outcome: string | null;
    readonly ended: boolean;
    readonly progress: number;
    readonly overpass: unknown;
  } | null;
  readonly seeThrough: {
    readonly on: boolean;
    readonly radiusM: number;
    readonly materials: number;
  };
}

export interface EditorCity {
  /** Each frame: the load, retry and fade at the camera's altitude (m),
   *  and the see-through around the selection (null: none). */
  step(frame: {
    readonly altitudeM: number;
    readonly selection: EditorCitySelection | null;
  }): void;
  /** At the approach's start: the city's data loads during the flight. */
  warmUp(): void;
  /** Shown (the default) or hidden: hiding stops a running load; while
   *  hidden, nothing loads or draws. */
  setShown(on: boolean): void;
  /** What stands on the ground for the clouds' depth: the city's root
   *  while it is drawn, else none. */
  extra(): readonly THREE.Object3D[];
  stats(reliefGroundM: number | null): EditorCityStats;
  dispose(): void;
}

/** The see-through's uniforms, one set for every patched material. */
interface SeeThroughUniforms {
  readonly uSeeCentre: { value: THREE.Vector3 };
  readonly uSeeUp: { value: THREE.Vector3 };
  readonly uSeeRadius: { value: number };
}

/** Where a material keeps the see-through's uniforms, and its mark. */
const SEE_THROUGH_KEY = "editorSeeThrough";
const SEE_THROUGH_WRAPPED = "editorSeeThroughWrapped";
/**
 * The define that compiles the see-through in. Without it a material runs
 * a shader with no discard (one would keep the GPU from its early depth
 * test for every building); three.js keys its programs on the defines, so
 * an edge switches between two programs it keeps, never a compile a
 * frame.
 */
const SEE_THROUGH_DEFINE = "EDITOR_SEE_THROUGH";

const VERTEX_HEAD = "#include <common>";
const VERTEX_ANCHOR = "#include <project_vertex>";
const FRAGMENT_HEAD = "#include <common>";
const FRAGMENT_ANCHOR = "#include <clipping_planes_fragment>";

/**
 * A material's shader with the see-through: the world position carried
 * to the fragment, which is discarded three pixels in four inside the
 * cylinder about `uSeeUp` through `uSeeCentre`; all of it only where the
 * material defines `EDITOR_SEE_THROUGH`. False when a shader lacks an
 * anchor (left unchanged).
 */
export function patchSeeThrough(
  shader: { vertexShader: string; fragmentShader: string; uniforms: object },
  uniforms: SeeThroughUniforms,
): boolean {
  const { vertexShader: vs, fragmentShader: fs } = shader;
  if (
    !vs.includes(VERTEX_HEAD) ||
    !vs.includes(VERTEX_ANCHOR) ||
    !fs.includes(FRAGMENT_HEAD) ||
    !fs.includes(FRAGMENT_ANCHOR)
  ) {
    return false;
  }
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = vs
    .replace(
      VERTEX_HEAD,
      `${VERTEX_HEAD}
#ifdef ${SEE_THROUGH_DEFINE}
varying vec3 vSeeWorld;
#endif`,
    )
    .replace(
      VERTEX_ANCHOR,
      `${VERTEX_ANCHOR}
#ifdef ${SEE_THROUGH_DEFINE}
vec4 seeAt = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
seeAt = instanceMatrix * seeAt;
#endif
vSeeWorld = (modelMatrix * seeAt).xyz;
#endif`,
    );
  shader.fragmentShader = fs
    .replace(
      FRAGMENT_HEAD,
      `${FRAGMENT_HEAD}
#ifdef ${SEE_THROUGH_DEFINE}
varying vec3 vSeeWorld;
uniform vec3 uSeeCentre;
uniform vec3 uSeeUp;
uniform float uSeeRadius;
#endif`,
    )
    .replace(
      FRAGMENT_ANCHOR,
      `${FRAGMENT_ANCHOR}
#ifdef ${SEE_THROUGH_DEFINE}
{
  vec3 seeD = vSeeWorld - uSeeCentre;
  vec3 seeFlat = seeD - dot(seeD, uSeeUp) * uSeeUp;
  vec2 seeCell = mod(floor(gl_FragCoord.xy), 2.0);
  if (length(seeFlat) < uSeeRadius && seeCell.x + seeCell.y > 0.5) discard;
}
#endif`,
    );
  return true;
}

/** An object's materials, one or many. */
function materialsOf(object: THREE.Object3D): THREE.Material[] {
  const { material } = object as Partial<THREE.Mesh>;
  if (material === undefined) return [];
  return Array.isArray(material) ? material : [material];
}

/** The geometry bytes of the root's meshes (its attributes and index). */
function geometryBytesOf(root: THREE.Object3D): number {
  let bytes = 0;
  root.traverse((o) => {
    const geometry = (o as Partial<THREE.Mesh>).geometry;
    if (geometry === undefined) return;
    for (const attribute of Object.values(geometry.attributes)) {
      bytes += (attribute as THREE.BufferAttribute).array.byteLength;
    }
    bytes += geometry.index?.array.byteLength ?? 0;
  });
  return bytes;
}

const finiteOr0 = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A finite number as it is, anything else as null. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The current load's part of the stats (null before the first). */
function loadStats(load: GlobeCityState["load"]): EditorCityStats["load"] {
  return (
    load && {
      outcome: load.outcome,
      ended: load.ended,
      progress: load.progress,
      overpass: load.counts.overpass,
    }
  );
}

/** The editor's city over `city` (`EditorCityOptions`). */
export function mountEditorCity(options: EditorCityOptions): EditorCity {
  const { city, place, zoom } = options;
  const cityStep = options.step ?? createGlobeCityStep({ city });
  const uniforms: SeeThroughUniforms = {
    uSeeCentre: { value: new THREE.Vector3() },
    uSeeUp: { value: new THREE.Vector3(0, 1, 0) },
    uSeeRadius: { value: 0 },
  };
  /** The materials patched (each once; the trees' are shared). */
  const patched = new WeakSet<THREE.Material>();
  let patchedCount = 0;
  /** Whether the see-through is on (a selection, the city shown). */
  let seeOn = false;
  let shown = true;
  /** Why the city is held off (its worker could not be made). */
  let broken: string | null = null;

  /**
   * The see-through on a material, once: the trees' materials outlive a
   * view (the library shares them with every later city), so a later
   * view's mount only hands them its uniforms and recompiles; wrapping
   * the compile again would declare the see-through twice.
   */
  const patchMaterial = (material: THREE.Material) => {
    if (patched.has(material)) return;
    patched.add(material);
    patchedCount++;
    material.userData[SEE_THROUGH_KEY] = uniforms;
    if (material.userData[SEE_THROUGH_WRAPPED] !== true) {
      material.userData[SEE_THROUGH_WRAPPED] = true;
      const before = material.onBeforeCompile.bind(material);
      material.onBeforeCompile = (shader, renderer) => {
        before(shader, renderer);
        patchSeeThrough(
          shader,
          material.userData[SEE_THROUGH_KEY] as SeeThroughUniforms,
        );
      };
    }
    material.needsUpdate = true;
  };

  /** The define set to `seeOn`; a change recompiles (once per edge). */
  const defineSeeThrough = (material: THREE.Material) => {
    const defines = (material.defines ??= {}) as Record<string, unknown>;
    if (SEE_THROUGH_DEFINE in defines === seeOn) return;
    if (seeOn) defines[SEE_THROUGH_DEFINE] = "";
    else delete defines[SEE_THROUGH_DEFINE];
    material.needsUpdate = true;
  };

  /** Every building and tree material patched, its define at `seeOn`. */
  const patchObjects = () => {
    for (const object of city.root.children) {
      if (object.userData.cityLayer === "roads") continue;
      for (const material of materialsOf(object)) {
        patchMaterial(material);
        defineSeeThrough(material);
      }
    }
  };

  const aim = (selection: EditorCitySelection | null) => {
    seeOn = selection !== null;
    if (selection === null) return;
    uniforms.uSeeCentre.value.copy(selection.at);
    uniforms.uSeeUp.value.copy(selection.up).normalize();
    uniforms.uSeeRadius.value = selection.radiusM + EDITOR_CITY.seeThroughM;
  };

  /** Runs `act` on the city; a throw holds the city off. */
  const guarded = (act: () => void) => {
    if (broken !== null) return;
    try {
      act();
    } catch (error) {
      broken = messageOf(error);
      city.setFade(0);
    }
  };

  return {
    step({ altitudeM, selection }) {
      if (!shown || broken !== null) {
        seeOn = false;
        patchObjects();
        return;
      }
      // A camera not placed yet has no altitude: the frame is skipped
      // (the step's fade law refuses one), the city is not held off.
      if (!Number.isFinite(altitudeM)) return;
      guarded(() => {
        cityStep.step({
          place,
          arrival: null,
          altitudeM,
          topM: EDITOR_CITY.topM,
          zoom,
          law: EDITOR_CITY.law,
        });
      });
      aim(selection);
      patchObjects();
    },
    warmUp() {
      if (!shown) return;
      guarded(() => {
        cityStep.warmUp(place, { zoom, law: EDITOR_CITY.law });
      });
    },
    setShown(on) {
      shown = on;
      if (!on) {
        guarded(() => city.abort());
        city.setFade(0);
        seeOn = false;
        patchObjects();
      }
    },
    extra: () => (shown && city.root.visible ? [city.root] : []),
    stats(reliefGroundM) {
      const s = city.state();
      const counts = (s.counts ?? {}) as Record<string, unknown>;
      const groundM = finiteOrNull(s.groundM);
      return {
        shown,
        worker: broken === null ? s.phase : "unavailable",
        message: broken ?? s.message ?? null,
        gate: cityStep.gate(),
        tiles: finiteOr0(counts["tiles"]),
        buildings: finiteOr0(counts["volumes"]),
        features: finiteOr0(counts["features"]),
        missingTiles: finiteOr0(counts["missingTiles"]),
        objects: s.objects ?? 0,
        geometryBytes: geometryBytesOf(city.root),
        fade: s.fade,
        drawn: s.shown,
        visible: city.root.visible,
        groundM,
        reliefGroundM,
        parityM:
          groundM === null || reliefGroundM === null
            ? null
            : groundM - reliefGroundM,
        load: loadStats(s.load),
        seeThrough: {
          on: seeOn,
          radiusM: uniforms.uSeeRadius.value,
          materials: patchedCount,
        },
      };
    },
    dispose() {
      city.dispose();
    },
  };
}
