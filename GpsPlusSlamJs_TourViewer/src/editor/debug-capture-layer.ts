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
export const DEBUG_THUMB_WIDTH_PX = 32;

/** What the layer draws into (the editor map's debug pane). */
export interface DebugLayerView<T> {
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
    options: Required<Pick<DebugCaptureOptions, "shouldContinue">>,
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
      let read: DebugCapturesRead;
      try {
        read = await deps.read({ shouldContinue: () => !stopped });
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
        // eslint-disable-next-line no-await-in-loop -- sequential on purpose
        const picture = await thumbnailOf(c.image);
        if (stopped) return;
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
 * The browser's downscaled decode of a capture's picture: a canvas
 * `DEBUG_THUMB_WIDTH_PX` wide (the height keeps the aspect), the decoded
 * bitmap closed at once. Call it only after `pictureProblem` passed.
 */
export async function decodeDebugThumbnail(
  blob: Blob,
): Promise<HTMLCanvasElement> {
  const ratio = window.devicePixelRatio > 1 ? 2 : 1;
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: DEBUG_THUMB_WIDTH_PX * ratio,
    resizeQuality: "low",
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.style.width = `${String(DEBUG_THUMB_WIDTH_PX)}px`;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}
