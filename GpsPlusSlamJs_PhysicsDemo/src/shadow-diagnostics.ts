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
 * when the program object changed (the status line updates every frame).
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
      lastText = flagsText(programFlags(renderer.getContext(), program));
    }
    return lastText;
  };
}

export interface FirstVisitRebuildDeps {
  /** The Mesh dropdown's path: recreate the occluder, same mode. */
  readonly rebuild: () => void;
  /** Triangles in the current occlusion mesh. */
  readonly meshTris: () => number;
  /** The receiver's program flags now ("none" before it is compiled). */
  readonly readFlags: () => string;
  /** The page clock (ms). */
  readonly now: () => number;
  /** When the AR session started (the clock of `now`). */
  readonly startedAtMs: number;
}

/** Frames to wait for the rebuilt receiver to be attached and drawn. */
const AFTER_FRAMES_MAX = 120;

/**
 * Once, on the first frame where the XR session is `visible` AND the
 * occlusion mesh has triangles, rebuild the occluder the way the Mesh
 * dropdown does; record the receiver's flags before, and after once the new
 * receiver has a program. `tick` runs once per XR frame.
 */
export function createFirstVisitRebuild(deps: FirstVisitRebuildDeps) {
  let state: "waiting" | "rebuilt" | "done" = "waiting";
  let atMs = 0;
  let before = "";
  let after = "";
  let framesSince = 0;
  return {
    tick(visibility: string): void {
      if (state === "waiting") {
        if (visibility !== "visible" || deps.meshTris() <= 0) return;
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
    /** "rebuild pending", or "rebuilt 3.2 s S1N0D1>S1N1D1". */
    text(): string {
      if (state === "waiting") return "rebuild pending";
      const seconds = (atMs / 1000).toFixed(1);
      return `rebuilt ${seconds} s ${before}>${after || "..."}`;
    },
    rebuilt: () => state !== "waiting",
  };
}
