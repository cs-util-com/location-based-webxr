/**
 * Entry of the splat trainer page (`splat/index.html`): picks the trainer
 * from the address, builds the page's store with the real recording reader,
 * and mounts the page. Without `?trainer=practice` the trainer is the one
 * that is not available yet, so the page says so instead of pretending.
 *
 * @see splat-main.ts.md
 */

import {
  downloadBlob,
  ZIP_FILE_TYPE,
} from "gps-plus-slam-app-framework/storage";
import { writeFileOrAbort } from "gps-plus-slam-app-framework/storage/write-file-or-abort";

import { createPracticeTrainer, practicePictures } from "./fake-trainer.js";
import { readSplatInputs } from "./recording-reader.js";
import { createUnavailableTrainer, type GpuLike } from "./trainer-adapter.js";
import { trainerChoiceFrom } from "./trainer-choice.js";
import { mountSplatTrainerPage } from "./trainer-page.js";
import { createTrainerPageStore } from "./trainer-page-store.js";
import { windowPlanner } from "./window-plan.js";

const root = document.getElementById("splat-root");
if (root !== null) {
  const choice = trainerChoiceFrom(location.search);
  const paper = (): string =>
    getComputedStyle(root).getPropertyValue("--print-paper").trim() ||
    "#2c3142";
  const adapter = choice.practice
    ? createPracticeTrainer({
        timer: {
          now: () => performance.now(),
          set: (fn, ms) => window.setTimeout(fn, ms),
          clear: (id) => window.clearTimeout(id),
        },
        pace: choice.pace,
        gpu: choice.gpu,
        lostStretch: choice.lost,
        picture: practicePictures(document, paper),
      })
    : createUnavailableTrainer(
        (navigator as Navigator & { gpu?: GpuLike }).gpu,
      );
  const controller = createTrainerPageStore({
    adapter,
    read: (file) => readSplatInputs(file),
    plan: windowPlanner(),
    write: (handle, blob) => writeFileOrAbort(handle, blob),
    download: (blob, name) => downloadBlob(blob, name, ZIP_FILE_TYPE),
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
