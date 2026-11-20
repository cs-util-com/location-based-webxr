/**
 * Entry of the splat trainer page (`splat/index.html`): picks the trainer
 * from the address, builds the page's store with the real recording reader,
 * and mounts the page. The trainer is the real one on the graphics card,
 * in a worker; `?trainer=practice` runs the scripted practice trainer.
 *
 * @see splat-main.ts.md
 */

import {
  downloadBlob,
  ZIP_FILE_TYPE,
} from "gps-plus-slam-app-framework/storage";
import { writeFileOrAbort } from "gps-plus-slam-app-framework/storage/write-file-or-abort";

import { createPracticeTrainer, practicePictures } from "./fake-trainer.js";
import { createGpuTrainer } from "./gpu-trainer.js";
import { readRecordingPhotos, readSplatInputs } from "./recording-reader.js";
import type { GpuLike } from "./trainer-adapter.js";
import { trainerChoiceFrom } from "./trainer-choice.js";
import { spawnTrainerWorker } from "./trainer-worker-spawn.js";
import { mountSplatTrainerPage } from "./trainer-page.js";
import { createTrainerPageStore } from "./trainer-page-store.js";
import { windowPlanner } from "./window-plan.js";

const root = document.getElementById("splat-root");
if (root !== null) {
  const choice = trainerChoiceFrom(location.search);
  const paper = (): string =>
    getComputedStyle(root).getPropertyValue("--print-paper").trim() ||
    "#2c3142";
  const timer = {
    now: () => performance.now(),
    set: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
    clear: (id: unknown) => window.clearTimeout(id as number),
  };
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  const adapter =
    choice.trainer === "practice"
      ? createPracticeTrainer({
          timer,
          pace: choice.pace,
          gpu: choice.gpu,
          lostStretch: choice.lost,
          picture: practicePictures(document, paper),
        })
      : createGpuTrainer({
          gpu,
          readPhotos: readRecordingPhotos,
          spawn: spawnTrainerWorker,
          timer,
        });
  const controller = createTrainerPageStore({
    adapter,
    read: (file, onProgress) => readSplatInputs(file, { onProgress }),
    plan: windowPlanner(),
    write: (handle, blob) => writeFileOrAbort(handle, blob),
    download: (blob, name) => downloadBlob(blob, name, ZIP_FILE_TYPE),
    thumbnail: shrinkLook,
  });
  const isPhone = window.matchMedia("(max-width: 700px)").matches;
  const page = mountSplatTrainerPage(root, controller, {
    win: window,
    isPhone,
  });
  if (!isPhone) void controller.probe();
  // A page kept in the back/forward cache comes back alive (pageshow
  // with persisted): only a page that is really going away is torn down.
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    page.dispose();
    controller.dispose();
  });
}

/** Longest side of the look a finished stretch keeps (px): about 0.7 MB
 *  of pixels, against several MB at the trainer's photo size. */
const KEPT_LOOK_PX = 480;

/** A copy of `picture` no larger than {@link KEPT_LOOK_PX} on its longest
 *  side; a picture already that small is kept as it is. */
async function shrinkLook(
  picture: CanvasImageSource,
): Promise<CanvasImageSource> {
  const { width, height } = picture as { width?: unknown; height?: unknown };
  if (typeof width !== "number" || typeof height !== "number") return picture;
  const longest = Math.max(width, height);
  if (!(longest > KEPT_LOOK_PX)) return picture;
  const scale = KEPT_LOOK_PX / longest;
  return createImageBitmap(picture, {
    resizeWidth: Math.max(1, Math.round(width * scale)),
    resizeHeight: Math.max(1, Math.round(height * scale)),
    resizeQuality: "medium",
  });
}
