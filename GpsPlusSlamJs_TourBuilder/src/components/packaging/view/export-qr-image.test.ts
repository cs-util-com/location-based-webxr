// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rasterizeQrSvg } from "./export-qr-image.js";

/**
 * jsdom ships no real 2D canvas backend or SVG image decoder, so both are
 * stubbed — same approach `breadcrumb-guide.test.ts` uses for its canvas.
 * What's worth pinning here is the *contract*: a white fill happens before
 * the draw (so a transparent SVG background can never export as black), the
 * requested MIME type reaches `toBlob`, and a decode/encode failure rejects
 * instead of resolving with nothing.
 */

let fillRectCalls: unknown[][] = [];
let drawImageCalls: unknown[][] = [];
let fillStyleAtDraw: string[] = [];

const fake2dContext = {
  get fillStyle() {
    return "";
  },
  set fillStyle(value: string) {
    fillStyleAtDraw.push(value);
  },
  fillRect: (...args: unknown[]) => {
    fillRectCalls.push(args);
  },
  drawImage: (...args: unknown[]) => {
    drawImageCalls.push(args);
  },
};

let imageShouldFail = false;

beforeEach(() => {
  fillRectCalls = [];
  drawImageCalls = [];
  fillStyleAtDraw = [];
  imageShouldFail = false;

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    fake2dContext as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type,
  ) {
    callback(new Blob(["fake-image-bytes"], { type: type ?? "image/png" }));
  });
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        // Deferred like a real decode, so callers see this as async.
        queueMicrotask(() => {
          if (imageShouldFail) this.onerror?.();
          else this.onload?.();
        });
      }
    },
  );
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#fff"/></svg>';

describe("rasterizeQrSvg", () => {
  it("fills white behind the code before drawing it, so a transparent background never exports black", async () => {
    await rasterizeQrSvg(SVG, "png");

    expect(fillStyleAtDraw[0]).toBe("#ffffff");
    expect(fillRectCalls).toHaveLength(1);
    expect(drawImageCalls).toHaveLength(1);
  });

  it("encodes as PNG when asked", async () => {
    const blob = await rasterizeQrSvg(SVG, "png");
    expect(blob.type).toBe("image/png");
  });

  it("encodes as JPEG when asked", async () => {
    const blob = await rasterizeQrSvg(SVG, "jpeg");
    expect(blob.type).toBe("image/jpeg");
  });

  it("rejects instead of resolving when the SVG can't be decoded", async () => {
    imageShouldFail = true;
    await expect(rasterizeQrSvg(SVG, "png")).rejects.toThrow(
      /could not decode/i,
    );
  });

  it("rejects instead of resolving when canvas can't encode", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, callback) {
        callback(null);
      },
    );
    await expect(rasterizeQrSvg(SVG, "png")).rejects.toThrow(
      /could not encode/i,
    );
  });

  it("revokes the object URL it created for the SVG, even on failure", async () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: revoke,
    });
    imageShouldFail = true;

    await expect(rasterizeQrSvg(SVG, "png")).rejects.toThrow();
    expect(revoke).toHaveBeenCalledWith("blob:fake");
  });
});
