import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import type { DebugCapture, DebugCapturesRead } from "../debug-captures";
import {
  createDebugCaptureLayer,
  DEBUG_READING_LINE,
  debugDeclinedLine,
  debugShownLine,
  revokeDebugThumbnail,
  type DebugLayerDeps,
} from "./debug-capture-layer";

/**
 * Why these tests matter: the desktop editor's debug layer shows the
 * walk's camera captures, which are debug data - never the tour's
 * content. So it must say what it is doing while the join replays the
 * walk, say why when it shows nothing, draw one marker per capture and
 * one thumbnail per picture it may decode (the tour's pixel cap first,
 * one decode at a time so a long walk never holds many full-size
 * pictures at once), and stop cleanly when the tour closes - and it
 * reaches nothing but its own view: no store, no save, no draft.
 */

function capture(i: number): DebugCapture {
  return {
    image: `images/frame-${String(i).padStart(6, "0")}.jpg`,
    geo: { lat: 47.5 + i * 1e-5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

function placed(n: number): DebugCapturesRead {
  return {
    kind: "placed",
    captures: {
      fixes: 4,
      gpsAccuracyMedianM: 3,
      captures: Array.from({ length: n }, (_, i) => capture(i)),
    },
  };
}

/** A recording view and fakes for every seam; `log` is what reached the
 *  view and the status line, in order. */
function harness(
  read: () => Promise<DebugCapturesRead>,
  overrides: Partial<DebugLayerDeps<string>> = {},
) {
  const log: string[] = [];
  let inFlight = 0;
  let mostInFlight = 0;
  let asked: (() => boolean) | null = null;
  const deps: DebugLayerDeps<string> = {
    read: (options) => {
      asked = options.shouldContinue;
      return read();
    },
    loadPicture: (image) => Promise.resolve(new Blob([image])),
    pictureProblem: () => Promise.resolve(null),
    thumbnail: async (blob) => {
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      const text = await blob.text();
      inFlight -= 1;
      return `thumb:${text}`;
    },
    view: {
      draw: (captures) => {
        log.push(`draw ${captures.map((c) => c.image).join(",")}`);
      },
      thumb: (image, picture) => {
        log.push(`thumb ${image} ${picture}`);
      },
      visible: (on) => {
        log.push(`visible ${String(on)}`);
      },
      clear: () => {
        log.push("clear");
      },
    },
    status: (line) => {
      log.push(`status ${line}`);
    },
    discard: (picture) => {
      log.push(`discard ${picture}`);
    },
    ...overrides,
  };
  return {
    layer: createDebugCaptureLayer(deps),
    log,
    mostInFlight: () => mostInFlight,
    shouldContinue: () => asked?.() ?? null,
  };
}

describe("the debug camera capture layer", () => {
  it("says it is reading, then draws one marker per capture, a thumbnail each, and how many it shows", async () => {
    const { layer, log, mostInFlight } = harness(() =>
      Promise.resolve(placed(3)),
    );
    await layer.start();
    expect(log).toEqual([
      `status ${DEBUG_READING_LINE}`,
      "draw images/frame-000000.jpg,images/frame-000001.jpg,images/frame-000002.jpg",
      "visible true",
      `status ${debugShownLine(3)}`,
      "thumb images/frame-000000.jpg thumb:images/frame-000000.jpg",
      "thumb images/frame-000001.jpg thumb:images/frame-000001.jpg",
      "thumb images/frame-000002.jpg thumb:images/frame-000002.jpg",
    ]);
    // One decode at a time: a walk of a thousand frames never holds more
    // than one full-size picture decoded at once.
    expect(mostInFlight()).toBe(1);
  });

  it("says why it shows nothing when the join declines, and draws nothing", async () => {
    const { layer, log } = harness(() =>
      Promise.resolve({
        kind: "declined",
        reason: "the recording contains no camera captures",
      }),
    );
    await layer.start();
    expect(log).toEqual([
      `status ${DEBUG_READING_LINE}`,
      `status ${debugDeclinedLine("the recording contains no camera captures")}`,
    ]);
  });

  it("says the recording could not be read when the read throws, and draws nothing", async () => {
    // Why: a cap's refusal or a failed integrity check reaches the join as
    // a throw; the layer must still end in a final state, never stay on
    // "Reading...".
    const { layer, log } = harness(() =>
      Promise.reject(new Error("too large")),
    );
    await layer.start();
    expect(log).toEqual([
      `status ${DEBUG_READING_LINE}`,
      `status ${debugDeclinedLine("the recording could not be read (too large)")}`,
    ]);
  });

  it("decodes no picture over the tour's pixel cap, and none whose read fails, and keeps their markers", async () => {
    // Why: a picture is measured before it is decoded (the tour's cap,
    // `image-cap.ts`); a failed read is one frame lost, not the layer.
    const decoded: string[] = [];
    const { layer, log } = harness(() => Promise.resolve(placed(3)), {
      pictureProblem: async (blob) =>
        (await blob.text()).endsWith("000000.jpg") ? "too many pixels" : null,
      loadPicture: (image) =>
        image.endsWith("000001.jpg")
          ? Promise.reject(new Error("gone"))
          : Promise.resolve(new Blob([image])),
      thumbnail: async (blob) => {
        const text = await blob.text();
        decoded.push(text);
        return `thumb:${text}`;
      },
    });
    await layer.start();
    expect(decoded).toEqual(["images/frame-000002.jpg"]);
    expect(log.filter((l) => l.startsWith("draw"))).toHaveLength(1);
    expect(log.filter((l) => l.startsWith("thumb"))).toEqual([
      "thumb images/frame-000002.jpg thumb:images/frame-000002.jpg",
    ]);
  });

  it("keeps a decode that fails to its own frame", async () => {
    const { layer, log } = harness(() => Promise.resolve(placed(2)), {
      thumbnail: async (blob) => {
        const text = await blob.text();
        if (text.endsWith("000000.jpg")) throw new Error("not a picture");
        return `thumb:${text}`;
      },
    });
    await layer.start();
    expect(log.filter((l) => l.startsWith("thumb"))).toEqual([
      "thumb images/frame-000001.jpg thumb:images/frame-000001.jpg",
    ]);
  });

  it("stops the replay and draws nothing when stopped while reading", async () => {
    // Why: another tour opened meanwhile; this one's captures must never
    // land on its map.
    let answer: (read: DebugCapturesRead) => void = () => undefined;
    const { layer, log, shouldContinue } = harness(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const started = layer.start();
    expect(shouldContinue()).toBe(true);
    layer.stop();
    expect(shouldContinue()).toBe(false);
    answer(placed(2));
    await started;
    expect(log).toEqual([`status ${DEBUG_READING_LINE}`, "clear"]);
  });

  it("decodes no further thumbnail once stopped", async () => {
    const decoded: string[] = [];
    let layerRef: { stop(): void } | null = null;
    const { layer, log } = harness(() => Promise.resolve(placed(3)), {
      thumbnail: async (blob) => {
        const text = await blob.text();
        decoded.push(text);
        layerRef?.stop();
        return `thumb:${text}`;
      },
    });
    layerRef = layer;
    await layer.start();
    expect(decoded).toEqual(["images/frame-000000.jpg"]);
    // The one in flight when it stopped lands nowhere either - and is
    // discarded, so its blob URL does not outlive the tour. (Changed
    // expectation, debug-captures M1: the last entry was the clear; the
    // discard of the stranded thumbnail now follows it.)
    expect(log.filter((l) => l.startsWith("thumb"))).toEqual([]);
    expect(log.slice(-2)).toEqual([
      "clear",
      "discard thumb:images/frame-000000.jpg",
    ]);
  });

  it("discards a thumbnail whose decode ends after the tour closed, and nothing else", async () => {
    // Why (debug-captures M1): a thumbnail is a small image shown from a blob
    // URL, which is the caller's to revoke. One still decoding when the
    // tour closed was dropped with its URL alive for the page's life, so
    // every tour closed during a long walk's decode leaked one.
    let release: (() => void) | null = null;
    const { layer, log } = harness(() => Promise.resolve(placed(2)), {
      thumbnail: async (blob) => {
        const text = await blob.text();
        if (text.endsWith("000001.jpg")) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return `thumb:${text}`;
      },
    });
    const started = layer.start();
    await vi.waitFor(() => {
      expect(release).not.toBeNull();
    });
    layer.stop();
    release!();
    await started;
    expect(log.filter((l) => l.startsWith("discard"))).toEqual([
      "discard thumb:images/frame-000001.jpg",
    ]);
    // The first thumbnail reached the map, whose clear revokes it.
    expect(log).toContain(
      "thumb images/frame-000000.jpg thumb:images/frame-000000.jpg",
    );
  });

  it("shows and hides its markers on the switch, also before they are drawn", async () => {
    const { layer, log } = harness(() => Promise.resolve(placed(1)));
    layer.setVisible(false);
    await layer.start();
    expect(log.slice(0, 4)).toEqual([
      "visible false",
      `status ${DEBUG_READING_LINE}`,
      "draw images/frame-000000.jpg",
      "visible false",
    ]);
    layer.setVisible(true);
    expect(log.at(-1)).toBe("visible true");
  });

  it("thumbnails exactly the pictures it may decode, each once, in capture order (property)", async () => {
    // Why: whatever mix of readable, over-cap and unreadable pictures a
    // walk has, every capture keeps its marker and each readable picture
    // gets one thumbnail - none twice, none out of order.
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom("ok", "cap", "gone", "bad"), {
          minLength: 1,
          maxLength: 12,
        }),
        async (kinds) => {
          const kindOf = (image: string): string =>
            kinds[Number(/(\d+)\.jpg$/.exec(image)![1])]!;
          const { layer, log } = harness(
            () => Promise.resolve(placed(kinds.length)),
            {
              loadPicture: (image) =>
                kindOf(image) === "gone"
                  ? Promise.reject(new Error("gone"))
                  : Promise.resolve(new Blob([image])),
              pictureProblem: async (blob) =>
                kindOf(await blob.text()) === "cap" ? "too large" : null,
              thumbnail: async (blob) => {
                const image = await blob.text();
                if (kindOf(image) === "bad") throw new Error("bad");
                return image;
              },
            },
          );
          await layer.start();
          const drawn = log.filter((l) => l.startsWith("draw "));
          expect(drawn).toHaveLength(1);
          expect(drawn[0]!.slice(5).split(",")).toHaveLength(kinds.length);
          const thumbs = log
            .filter((l) => l.startsWith("thumb "))
            .map((l) => l.split(" ")[1]);
          expect(thumbs).toEqual(
            kinds.flatMap((kind, i) =>
              kind === "ok" ? [capture(i).image] : [],
            ),
          );
        },
      ),
    );
  });
});

describe("a thumbnail's blob URL", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A stand-in image element: the one class `revokeDebugThumbnail` frees. */
  class FakeImage {
    src = "";
  }

  it("is revoked for a thumbnail image, and nothing else is touched", () => {
    // Why (debug-captures M1): the map revokes a thumbnail's URL when its
    // marker goes; a revoke that freed the wrong thing, or nothing, would
    // leak one URL per capture per opened tour.
    vi.stubGlobal("HTMLImageElement", FakeImage);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {
      // Nothing to free in a test.
    });
    const thumb = new FakeImage();
    thumb.src = "blob:http://localhost/abc";
    revokeDebugThumbnail(thumb as unknown as Element);
    expect(revoke).toHaveBeenCalledWith("blob:http://localhost/abc");
    revoke.mockClear();
    // An image from anywhere else, and an element that is no image.
    const other = new FakeImage();
    other.src = "https://example.org/a.jpg";
    revokeDebugThumbnail(other as unknown as Element);
    revokeDebugThumbnail({ src: "blob:x" } as unknown as Element);
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe("the debug layer's lines", () => {
  it("never call a debug capture a photo", () => {
    // Why: the frames are debug data; the page's words keep them apart
    // from the creator's photos.
    for (const line of [
      DEBUG_READING_LINE,
      debugDeclinedLine("no recording in this tour"),
      debugShownLine(1),
      debugShownLine(58),
    ]) {
      expect(line.toLowerCase()).not.toContain("photo");
    }
    expect(debugShownLine(1)).toBe("Debug data: 1 camera capture on the map.");
    expect(debugShownLine(58)).toBe(
      "Debug data: 58 camera captures on the map.",
    );
    expect(debugDeclinedLine("no recording in this tour")).toBe(
      "No debug data shown: no recording in this tour.",
    );
  });
});
