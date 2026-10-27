/**
 * Which renderer the film draws with, and when: the 3D scene while WebGL
 * works, the flat drawing (`film-floor.ts`) without it. Each 3D scene the
 * film creates gets a token; a lost context is a real loss only for the
 * live scene. A scene released on purpose (AR starting) is not live any
 * more, so its lost-context event is not a loss, and a new scene is built
 * the next time the film is wanted. A real loss, or a renderer that fails
 * to start, falls back to the drawing for the life of the film.
 *
 * Pure: the mount does the WebGL work and asks this what it means.
 *
 * @see film-gpu.ts.md
 */
export type FallbackReason = "no-webgl" | "context-lost";

export interface GpuLifecycle {
  /** "3d" while WebGL is in use or wanted, "floor" once fallen back. */
  kind(): "3d" | "floor";
  /** Set when the film starts on the drawing (no WebGL): report it once. */
  readonly initialFallback: FallbackReason | null;
  /** True when a 3D scene should be built now (3D, none live). */
  wantsScene(): boolean;
  /** A scene was built; returns its token. */
  created(): number;
  /** Building the scene threw: the drawing from now on. The reason the first time, else null. */
  createFailed(): FallbackReason | null;
  /** The live scene was released on purpose (AR): no fallback. */
  released(): void;
  /** Scene `token` lost its context: the reason to report for the live scene, null otherwise. */
  contextLost(token: number): FallbackReason | null;
}

export function createGpuLifecycle(o: {
  readonly webgl: boolean;
}): GpuLifecycle {
  let kind: "3d" | "floor" = o.webgl ? "3d" : "floor";
  let live = 0;
  let next = 1;
  const fallBack = (reason: FallbackReason): FallbackReason | null => {
    if (kind === "floor") return null;
    kind = "floor";
    live = 0;
    return reason;
  };
  return {
    kind: () => kind,
    initialFallback: o.webgl ? null : "no-webgl",
    wantsScene: () => kind === "3d" && live === 0,
    created() {
      live = next++;
      return live;
    },
    createFailed: () => fallBack("no-webgl"),
    released() {
      live = 0;
    },
    contextLost(token) {
      if (token === 0 || token !== live) return null;
      return fallBack("context-lost");
    },
  };
}
