/**
 * The synthetic splat scene's check page (`splat-scene-check.html`):
 * builds a walk through the synthetic scene (straight or loop), renders
 * its photos, zips it as a recording, then reads the zip back with the
 * splat trainer's reader and says what it found. The zip can be saved to
 * train on. Linked from nothing.
 *
 * The page's state is one attribute, `#state[data-state]`: `idle`,
 * `building`, `read` (the reader accepted the zip), `refused` (it gave a
 * reason) or `error` (building failed). The e2e
 * (`playwright-tests/splat-scene-check.spec.js`) waits on it.
 *
 * @see splat-scene-check.ts.md
 */
import { DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE } from "gps-plus-slam-app-framework/ar/depth-sampler";

import { readSplatInputs } from "../../splat-trainer/recording-reader.js";
import {
  sceneDepthSample,
  sceneProjection,
  sceneWalk,
  type WalkKind,
} from "./splat-scene.js";
import { renderSceneFrames } from "./splat-scene-render.js";
import { zipSceneWalk } from "./splat-scene-zip.js";

/** The depth grid's side, the recorder's reconstruction grid. */
const DEPTH_GRID = DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE;
/** The most photos one walk renders; the frame field's `max` says the
 *  same, but only as a hint a typed value can pass. */
const MAX_FRAMES = 400;
/** The walk's first capture time and the time between captures. */
const T0_MS = 1_700_000_000_000;
const INTERVAL_MS = 500;

type CheckState = "idle" | "building" | "read" | "refused" | "error";

export interface SplatSceneCheckDeps {
  readonly render: typeof renderSceneFrames;
}

/** The photo sizes on offer, `width x height`. */
const SIZES: Readonly<Record<string, readonly [number, number]>> = {
  "320x240": [320, 240],
  "640x480": [640, 480],
  "960x720": [960, 720],
};

/** Wire the page in `doc`. Returns the build, for tests. */
export function startSplatSceneCheck(
  doc: Document,
  deps: SplatSceneCheckDeps = { render: renderSceneFrames },
): () => Promise<void> {
  const el = <T extends HTMLElement>(id: string): T => {
    const found = doc.getElementById(id);
    if (found === null) throw new Error(`The page has no #${id}`);
    return found as T;
  };
  const walk = el<HTMLSelectElement>("walk");
  const frames = el<HTMLInputElement>("frames");
  const size = el<HTMLSelectElement>("size");
  const build = el<HTMLButtonElement>("build");
  const state = el<HTMLElement>("state");
  const result = el<HTMLElement>("result");
  const save = el<HTMLAnchorElement>("save");
  const firstPhoto = el<HTMLImageElement>("first-photo");

  const show = (s: CheckState, words: string): void => {
    state.dataset.state = s;
    state.textContent = words;
  };
  let saved: string | null = null;
  let shown: string | null = null;

  const run = async (): Promise<void> => {
    build.disabled = true;
    save.hidden = true;
    result.textContent = "";
    firstPhoto.hidden = true;
    for (const url of [saved, shown])
      if (url !== null) URL.revokeObjectURL(url);
    saved = null;
    shown = null;
    try {
      const kind: WalkKind = walk.value === "loop" ? "loop" : "straight";
      const count = Math.min(Number(frames.value), MAX_FRAMES);
      const [width, height] = SIZES[size.value] ?? [320, 240];
      const projection = sceneProjection(width, height);
      const poses = sceneWalk(kind, count);
      show("building", `Rendering 0 of ${String(count)} photos...`);
      const photos = await deps.render(
        poses,
        width,
        height,
        projection,
        (i) => {
          show(
            "building",
            `Rendering ${String(i + 1)} of ${String(count)} photos...`,
          );
        },
      );
      const first = photos[0];
      if (first !== undefined) {
        shown = URL.createObjectURL(new Blob([first], { type: "image/jpeg" }));
        firstPhoto.src = shown;
        firstPhoto.hidden = false;
      }
      show("building", "Zipping the walk...");
      const file = await zipSceneWalk(
        poses.map((pose, i) => ({
          jpeg: photos[i] ?? new Uint8Array(),
          depth: sceneDepthSample(
            pose,
            projection,
            DEPTH_GRID,
            T0_MS + i * INTERVAL_MS,
          ),
        })),
        width,
        height,
        `synthetic-${kind}-walk.zip`,
      );
      const read = await readSplatInputs(file);
      saved = URL.createObjectURL(file);
      save.href = saved;
      save.download = file.name;
      save.hidden = false;
      if (read.kind === "refused") {
        show("refused", `The reader refused the walk: ${read.reason}`);
        return;
      }
      const c = read.inputs.census;
      show(
        "read",
        `Read: ${String(c.frames)} frames of ${String(c.frameWidth)} x ${String(c.frameHeight)}, ` +
          `${c.pathM.toFixed(1)} m of path, ${String(c.depthSamples)} depth samples.`,
      );
      result.textContent = `${file.name}, ${(file.size / 1024).toFixed(0)} KB`;
    } catch (err) {
      show(
        "error",
        `Building failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      build.disabled = false;
    }
  };

  build.addEventListener("click", () => {
    void run();
  });
  show("idle", "");
  return run;
}
