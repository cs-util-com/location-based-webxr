/**
 * The desktop editor's debug layer (M1 of the debug-captures plan): the
 * walk's camera captures, placed by the capture-time join
 * (`debug-captures.ts`) once the tour has opened, drawn as small
 * thumbnails on the map. They are debug data - never the tour's content:
 * this module reaches only its view and its status line, never the tour
 * document, a save or the draft, and a creator cannot select, move or
 * tab to a capture. The phone has no such layer.
 *
 * The controller is pure of the DOM (its view, decoder and reads are
 * seams); `decodeDebugThumbnail` is the browser's downscaled decode.
 *
 * @see debug-capture-layer.ts.md
 */

import type {
  DebugCapture,
  DebugCaptureOptions,
  DebugCapturesRead,
} from "../debug-captures.js";

/** The line while the join replays the walk. */
export const DEBUG_READING_LINE = "Reading the debug data...";

/** The reading line with how far the replay is, in whole percent. */
export function debugReadingLine(percent: number): string {
  return `${DEBUG_READING_LINE} ${String(percent)} %`;
}

/** The line when the layer shows nothing, naming why. */
export function debugDeclinedLine(reason: string): string {
  return `No debug data shown: ${reason}.`;
}

/** The line once the captures are on the map. */
export function debugShownLine(count: number): string {
  return `Debug data: ${String(count)} camera ${count === 1 ? "capture" : "captures"} on the map.`;
}

/** A thumbnail's width in CSS pixels; its height keeps the picture's
 *  aspect. Small on purpose: a long walk has a thousand of them. */
const DEBUG_THUMB_WIDTH_PX = 32;

/** What the layer draws into (the editor map's debug pane). */
interface DebugLayerView<T> {
  /** One marker per capture, without a picture yet. */
  draw(captures: readonly DebugCapture[]): void;
  /** The capture's thumbnail into its marker. */
  thumb(image: string, picture: T): void;
  /** Show or hide every marker. */
  visible(on: boolean): void;
  /** Remove every marker. */
  clear(): void;
}

export interface DebugLayerDeps<T> {
  /** The join over the open tour (`debugCapturesOf`). */
  read(
    options: Required<Pick<DebugCaptureOptions, "shouldContinue" | "onChunk">>,
  ): Promise<DebugCapturesRead>;
  /** A capture's picture by its entry name. */
  loadPicture(image: string): Promise<Blob>;
  /** Why the picture may not be decoded, or null (`pictureProblem`). */
  pictureProblem(blob: Blob): Promise<string | null>;
  /** The downscaled decode (`decodeDebugThumbnail`). */
  thumbnail(blob: Blob): Promise<T>;
  readonly view: DebugLayerView<T>;
  /** The layer's status line. */
  status(line: string): void;
  /** Free a thumbnail that reached no marker (its decode ended after the
   *  tour closed): `revokeDebugThumbnail` in the page. */
  discard(picture: T): void;
}

export interface DebugLayer {
  /** Read, draw and thumbnail; settles when done or stopped. Once. */
  start(): Promise<void>;
  /** The "Show debug data" switch. */
  setVisible(on: boolean): void;
  /** The tour closed: stop reading and decoding, remove the markers. */
  stop(): void;
}

export function createDebugCaptureLayer<T>(
  deps: DebugLayerDeps<T>,
): DebugLayer {
  let stopped = false;
  let visible = true;

  async function thumbnailOf(image: string): Promise<T | null> {
    try {
      const blob = await deps.loadPicture(image);
      if (stopped) return null;
      // Measured before it is decoded (the tour's pixel cap): a picture
      // over it, or one whose size cannot be read, keeps a plain marker.
      if ((await deps.pictureProblem(blob)) !== null) return null;
      if (stopped) return null;
      return await deps.thumbnail(blob);
    } catch {
      // One frame lost, not the layer: its marker stays without a picture.
      return null;
    }
  }

  return {
    async start() {
      deps.status(DEBUG_READING_LINE);
      // The replay's progress, once per whole percent: a long walk replays
      // for seconds, and a line without movement reads as stuck.
      let shownPercent = -1;
      const onChunk = (done: number, total: number): void => {
        if (stopped || !(total > 0)) return;
        const percent = Math.min(100, Math.floor((done * 100) / total));
        if (percent === shownPercent) return;
        shownPercent = percent;
        deps.status(debugReadingLine(percent));
      };
      let read: DebugCapturesRead;
      try {
        read = await deps.read({ shouldContinue: () => !stopped, onChunk });
      } catch (err) {
        if (stopped) return;
        const why = err instanceof Error ? err.message : String(err);
        deps.status(
          debugDeclinedLine(`the recording could not be read (${why})`),
        );
        return;
      }
      if (stopped) return;
      if (read.kind === "declined") {
        deps.status(debugDeclinedLine(read.reason));
        return;
      }
      const { captures } = read.captures;
      deps.view.draw(captures);
      deps.view.visible(visible);
      deps.status(debugShownLine(captures.length));
      // One decode at a time, in capture order: a long walk never holds
      // more than one full-size picture decoded at once.
      for (const c of captures) {
        const picture = await thumbnailOf(c.image);
        if (stopped) {
          // Decoded for a tour that closed meanwhile: no marker takes it,
          // so nothing else would ever free its blob URL.
          if (picture !== null) deps.discard(picture);
          return;
        }
        if (picture !== null) deps.view.thumb(c.image, picture);
      }
    },
    setVisible(on) {
      visible = on;
      deps.view.visible(on);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      deps.view.clear();
    },
  };
}

/**
 * The browser's downscaled decode of a capture's picture, as a small
 * `<img>` `DEBUG_THUMB_WIDTH_PX` wide (the height keeps the aspect): the
 * picture is decoded at that size (`createImageBitmap` with
 * `resizeWidth`, twice it on a high-density screen), drawn once into a
 * scratch canvas, re-encoded as a small JPEG and shown from a blob URL;
 * the bitmap and the canvas are freed at once. An image, not the canvas
 * itself: measured, a thousand canvases on the map made each frame of a
 * pan three times as long as a thousand images (the layer-cost results,
 * M1 of the debug-captures plan). The URL is the caller's to revoke
 * (`revokeDebugThumbnail`). Call it only after `pictureProblem` passed.
 */
export async function decodeDebugThumbnail(
  blob: Blob,
): Promise<HTMLImageElement> {
  const ratio = window.devicePixelRatio > 1 ? 2 : 1;
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: DEBUG_THUMB_WIDTH_PX * ratio,
    resizeQuality: "low",
  });
  const canvas = document.createElement("canvas");
  let small: Blob | null;
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    small = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.8);
    });
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
  if (small === null) throw new Error("the thumbnail could not be encoded");
  const img = document.createElement("img");
  // Decorative: the capture is debug data, never announced.
  img.alt = "";
  img.width = DEBUG_THUMB_WIDTH_PX;
  img.src = URL.createObjectURL(small);
  try {
    await img.decode();
  } catch (err) {
    revokeDebugThumbnail(img);
    throw err;
  }
  return img;
}

/** Free a thumbnail's blob URL (`decodeDebugThumbnail`); anything else is
 *  left alone. */
export function revokeDebugThumbnail(picture: Element): void {
  if (picture instanceof HTMLImageElement && picture.src.startsWith("blob:")) {
    URL.revokeObjectURL(picture.src);
  }
}
