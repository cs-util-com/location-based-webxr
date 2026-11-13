/**
 * The 3D model step of the asset optimizer's Worker: a `.glb` taken apart
 * (`glb-file.ts`), its textures made smaller (`model-textures.ts`, with the
 * picture step's device), its geometry stored in fewer bytes
 * (`model-quantize.ts`), and written back as a `.glb` that passes the
 * tour's own check (`checkGlbInert`) and needs no decoder.
 *
 * The passes run in this order on purpose: a later level-of-detail pass
 * belongs between reading and quantizing, where the positions are still
 * floats.
 *
 * @see model-step.ts.md
 */

import { checkGlbInert } from "gps-plus-slam-app-framework/ar/tour-media";

import { readGlb, writeGlb } from "./glb-file.js";
import { quantizeModel } from "./model-quantize.js";
import { shrinkTextures } from "./model-textures.js";
import {
  stoppedError,
  type WorkerStepAnswer,
  type WorkerStepControl,
} from "./optimizer-protocol.js";
import type { OptimizerSettings } from "./optimizer-settings.js";
import type { DecodedPicture, PictureDevice } from "./picture-step.js";

/** The textures' share of a run's progress (quantizing is quick). */
const TEXTURE_SHARE = 0.85;

/** The step: `payload` is the model's file as it came in. */
export async function optimizeModel<P extends DecodedPicture>(
  payload: unknown,
  settings: OptimizerSettings,
  control: WorkerStepControl,
  device: PictureDevice<P>,
): Promise<WorkerStepAnswer> {
  if (!(payload instanceof Blob))
    throw new Error("no 3D model was handed over");
  const read = readGlb(new Uint8Array(await payload.arrayBuffer()));
  if (!read.ok && read.why === "unsupported") {
    return { type: "kept", reason: `Kept as it is: ${read.reason}.` };
  }
  if (!read.ok)
    throw new Error(`it could not be read as a 3D model: ${read.reason}`);
  const { parts } = read;
  await shrinkTextures(parts, settings.model, device, control, {
    from: 0,
    to: TEXTURE_SHARE,
  });
  if (control.signal.aborted) throw stoppedError();
  quantizeModel(parts, settings.model);
  const bytes = writeGlb(parts);
  const check = checkGlbInert(bytes);
  if (!check.ok) {
    throw new Error(
      `the smaller model would not open in a tour: ${check.reason}`,
    );
  }
  control.progress(1);
  return {
    type: "done",
    blob: new Blob([bytes], { type: "model/gltf-binary" }),
    extension: "glb",
  };
}
