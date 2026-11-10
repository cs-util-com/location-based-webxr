/**
 * The cut Worker's logic without the Worker: it takes a request, decodes a
 * new picture (through an injected decoder, so Node tests pass a fake) or
 * reuses the one it kept, runs the cut and posts the phases and the answer.
 * `character-cut.worker.ts` only wires it to the real decoder and
 * `postMessage`.
 *
 * @see cut-service.ts.md
 */

import { cutSettingsOf, type CutSettings } from "./cut-settings.js";
import { requestOf, transferOf, type CutAnswer } from "./cut-protocol.js";
import type { RgbaImage } from "./rgba-image.js";
import { analyzeSheet } from "./sheet-analyze.js";
import { CutError, type CutErrorCode, type CutPhase } from "./sheet-cut.js";

/** Decodes a picture file into pixels; throws `CutError` (phase "read")
 *  for a file that is no picture, cannot be opened, or has a refused size. */
export type PictureDecoder = (
  picture: Blob,
  settings: CutSettings,
) => Promise<RgbaImage>;

export type AnswerPoster = (answer: CutAnswer, transfer: ArrayBuffer[]) => void;

/** One service per Worker: it keeps the last decoded picture, so a slider
 *  re-runs the cut without decoding (or sending) the file again. */
export function createCutService(
  decode: PictureDecoder,
  post: AnswerPoster,
): (data: unknown) => Promise<void> {
  let kept: RgbaImage | null = null;

  async function picture(
    job: number,
    file: Blob | undefined,
    s: CutSettings,
  ): Promise<RgbaImage> {
    if (file === undefined) {
      if (kept === null) {
        throw new CutError("read", "decode", "Choose a picture first.");
      }
      return kept;
    }
    post({ type: "phase", job, phase: "read", state: "running" }, []);
    kept = null;
    const img = await decode(file, s);
    kept = img;
    post(
      {
        type: "phase",
        job,
        phase: "read",
        state: "done",
        note: `${img.width} x ${img.height}`,
      },
      [],
    );
    return img;
  }

  return async (data) => {
    const request = requestOf(data);
    if (request === null) {
      return;
    }
    const { job } = request;
    const s = cutSettingsOf(request.settings);
    let running: CutPhase = "read";
    try {
      const img = await picture(job, request.picture, s);
      const result = analyzeSheet(img, s, (phase, state, note) => {
        running = phase;
        post(
          { type: "phase", job, phase, state, ...(note ? { note } : {}) },
          [],
        );
      });
      post({ type: "done", job, result }, transferOf(result));
    } catch (err) {
      post(failure(job, running, err), []);
    }
  };
}

function failure(job: number, running: CutPhase, err: unknown): CutAnswer {
  if (err instanceof CutError) {
    return {
      type: "failed",
      job,
      phase: err.phase,
      code: err.code,
      message: err.message,
      detail: err.detail,
    };
  }
  const code: CutErrorCode | "failed" = "failed";
  return {
    type: "failed",
    job,
    phase: running,
    code,
    message: err instanceof Error ? err.message : String(err),
    detail: {},
  };
}
