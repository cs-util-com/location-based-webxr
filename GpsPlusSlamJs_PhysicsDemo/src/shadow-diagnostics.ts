/**
 * Shadow diagnostics for the status line, and the one-shot receiver rebuild
 * (owner report on r753, 2026-09-27): on a preview's FIRST visit (a new
 * origin, so Chrome's camera/AR permission prompt) the balls rest on the
 * mesh but cast no shadow until the Mesh dropdown is switched and back, which
 * recreates the occluder and its receiver. The cause is not known; this
 * module reads what the receiver was compiled with, and rebuilds it once
 * the way the Mesh dropdown does, so one screenshot of the status line shows
 * the state before and after.
 *
 * @see shadow-diagnostics.ts.md
 */

import type * as THREE from "three";

/** The occlusion mesh's receiver skin, by the framework's node name. */
export const RECEIVER_NODE = "occupancy-occluder-shadow-receiver";

/** What a compiled program was built with, from its shader sources. */
export interface ProgramFlags {
  /** `USE_SHADOWMAP`: the program samples a shadow map at all. */
  readonly shadowMap: boolean;
  /** `HAS_NORMAL`: the program reads the geometry's normals. */
  readonly normals: boolean;
  /**
   * Directional lights it samples a map for (`NUM_DIR_LIGHT_SHADOWS`, which
   * three substitutes into the body, so it is read from the arrays' size).
   */
  readonly dirShadows: number;
}

/** The part of a WebGL context the flags are read with (a stub in tests). */
export interface ShaderSourceReader {
  getAttachedShaders(program: WebGLProgram): WebGLShader[] | null;
  getShaderSource(shader: WebGLShader): string | null;
}

/**
 * The flags a GL program was linked with, read from its attached shaders'
 * sources (three prefixes them with its `#define`s); null when there is no
 * program or no source.
 */
export function programFlags(
  gl: ShaderSourceReader,
  program: WebGLProgram | null | undefined,
): ProgramFlags | null {
  if (!program) return null;
  const shaders = gl.getAttachedShaders(program) ?? [];
  const source = shaders.map((s) => gl.getShaderSource(s) ?? "").join("\n");
  if (source.length === 0) return null;
  const dir = /directionalShadow(?:Map|Matrix)\s*\[\s*(\d+)\s*\]/.exec(source);
  return {
    shadowMap: /#define USE_SHADOWMAP\b/.test(source),
    normals: /#define HAS_NORMAL\b/.test(source),
    dirShadows: dir ? Number(dir[1]) : 0,
  };
}

/** "S1N0D1": shadow map, normals, directional shadows; "none" without. */
export function flagsText(flags: ProgramFlags | null): string {
  if (!flags) return "none";
  return `S${flags.shadowMap ? 1 : 0}N${flags.normals ? 1 : 0}D${flags.dirShadows}`;
}

/** The renderer state the reader needs (the real WebGLRenderer in the app). */
export interface ProgramRenderer {
  /** three's per-material state; typed `unknown` there, so read defensively. */
  readonly properties: { get(material: THREE.Material): unknown };
  getContext(): ShaderSourceReader;
}

/**
 * Reads the receiver's program flags, re-reading the shader sources only
 * when the program object changed. "off": no receiver attached; "none":
 * attached, not compiled yet; "unreadable": a program exists but its shader
 * sources came back empty.
 */
export function createReceiverFlagsReader(
  renderer: ProgramRenderer,
  root: THREE.Object3D,
) {
  let lastProgram: WebGLProgram | null = null;
  let lastText = "none";
  return (): string => {
    const node = root.getObjectByName(RECEIVER_NODE) as THREE.Mesh | undefined;
    const material = node?.material as THREE.Material | undefined;
    if (!material) return "off";
    const state = renderer.properties.get(material) as
      { currentProgram?: { program?: WebGLProgram } } | undefined;
    const program = state?.currentProgram?.program;
    if (!program) return "none";
    if (program !== lastProgram) {
      lastProgram = program;
      const flags = programFlags(renderer.getContext(), program);
      lastText = flags ? flagsText(flags) : "unreadable";
    }
    return lastText;
  };
}

/** `?rebuild=0` (or `off` / `false`) turns the first-visit rebuild off. */
export function rebuildEnabledFromSearch(search: string): boolean {
  const value = new URLSearchParams(search).get("rebuild");
  return value === null || !["0", "off", "false"].includes(value.toLowerCase());
}

export interface FirstVisitRebuildDeps {
  /** False with `?rebuild=0`: never rebuild (the owner's A/B). */
  readonly enabled: boolean;
  /** The Mesh dropdown's path: recreate the occluder, same mode. */
  readonly rebuild: () => void;
  /** Triangles in the current occlusion mesh. */
  readonly meshTris: () => number;
  /** The receiver's program flags now (`createReceiverFlagsReader`). */
  readonly readFlags: () => string;
  /** Whether three has allocated the light's shadow map yet. */
  readonly mapAllocated: () => boolean;
  /** How many balls exist (a shadow can be looked for). */
  readonly balls: () => number;
  /** The page clock (ms). */
  readonly now: () => number;
  /** When the AR session started (the clock of `now`). */
  readonly startedAtMs: number;
}

/** Frames to wait for the rebuilt receiver to be attached and drawn. */
const AFTER_FRAMES_MAX = 120;
/** With no ball yet, wait this long after the first triangles (ms). */
export const REBUILD_GRACE_MS = 2000;

/**
 * Once, when the symptom's preconditions hold, rebuild the occluder the
 * way the Mesh dropdown does, and record the receiver's flags before and,
 * once the new receiver has a program, after. The preconditions: the XR
 * session is `visible`, the mesh has triangles, a receiver is attached
 * (shadows on), the shadow map is allocated, and a ball exists or
 * REBUILD_GRACE_MS passed since the first triangles. `tick` runs once per
 * XR frame, before the shadows' update.
 */
export function createFirstVisitRebuild(deps: FirstVisitRebuildDeps) {
  let state: "waiting" | "rebuilt" | "done" = "waiting";
  let firstTrisAtMs: number | null = null;
  let atMs = 0;
  let before = "";
  let after = "";
  let framesSince = 0;
  const ready = (visibility: string): boolean => {
    if (!deps.enabled || visibility !== "visible") return false;
    if (deps.meshTris() <= 0) return false;
    firstTrisAtMs ??= deps.now();
    if (deps.readFlags() === "off" || !deps.mapAllocated()) return false;
    return deps.balls() > 0 || deps.now() - firstTrisAtMs >= REBUILD_GRACE_MS;
  };
  return {
    tick(visibility: string): void {
      if (state === "waiting") {
        if (!ready(visibility)) return;
        before = deps.readFlags();
        atMs = deps.now() - deps.startedAtMs;
        deps.rebuild();
        state = "rebuilt";
        return;
      }
      if (state === "rebuilt") {
        framesSince += 1;
        const flags = deps.readFlags();
        // The rebuilt receiver is attached on the next shadows update and
        // compiled on the render after it.
        if (
          (flags !== "none" && flags !== "off") ||
          framesSince >= AFTER_FRAMES_MAX
        ) {
          after = flags;
          state = "done";
        }
      }
    },
    /** "off", "pending", or "3.2 s S1N0D1>S1N1D1" (after "rebuild "). */
    text(): string {
      if (!deps.enabled) return "off";
      if (state === "waiting") return "pending";
      const seconds = (atMs / 1000).toFixed(1);
      return `${seconds} s ${before}>${after || "..."}`;
    },
    rebuilt: () => state !== "waiting",
  };
}

/**
 * Counts a visibility state's transitions (an XR session's
 * `visibilitychange`, the page's `document.visibilitychange`): each entry
 * into `visible-blurred` and `hidden`, and the current state. Events are
 * what see a prompt that comes and goes between two frames.
 */
export function createVisibilityCounter(initial = "unknown") {
  let state = initial;
  let blurred = 0;
  let hidden = 0;
  return {
    observe(next: string): void {
      if (next === state) return;
      state = next;
      if (next === "visible-blurred") blurred += 1;
      if (next === "hidden") hidden += 1;
    },
    state: () => state,
    blurred: () => blurred,
    hidden: () => hidden,
  };
}

/** True at most once per `intervalMs` of `now` (the diagnostics' rate). */
export function createEvery(intervalMs: number) {
  let last = Number.NEGATIVE_INFINITY;
  return (nowMs: number): boolean => {
    if (nowMs - last < intervalMs) return false;
    last = nowMs;
    return true;
  };
}
