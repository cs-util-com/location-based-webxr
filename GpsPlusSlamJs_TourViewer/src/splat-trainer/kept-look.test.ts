import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserLookTools,
  closePicture,
  fitWithin,
  LOUPE_LOOK_PX,
  lookKeeper,
  TILE_LOOK_PX,
  type LookTools,
} from "./kept-look.js";

/** A picture of the given size; it records whether it was closed. */
const picture = (width: number, height: number) => ({
  width,
  height,
  closed: false,
  close() {
    this.closed = true;
  },
});

/** Tools that record the sizes asked for. */
function recording(over: Partial<LookTools> = {}) {
  const asked: { shrink: number[][]; encode: number[][] } = {
    shrink: [],
    encode: [],
  };
  const tools: LookTools = {
    shrink: (_p, w, h) => {
      asked.shrink.push([w, h]);
      return Promise.resolve(picture(w, h) as unknown as CanvasImageSource);
    },
    encode: (_p, w, h) => {
      asked.encode.push([w, h]);
      return Promise.resolve(new Blob([`${String(w)}x${String(h)}`]));
    },
    ...over,
  };
  return { tools, asked };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fitWithin", () => {
  // Why: the two copies must keep the look's shape; a swapped width and
  // height or an inverted scale squashes the picture in its tile.
  it("scales the longer side to the limit and keeps the aspect", () => {
    expect(fitWithin(1600, 1200, 480)).toEqual({ width: 480, height: 360 });
    expect(fitWithin(1200, 1600, 480)).toEqual({ width: 360, height: 480 });
    expect(fitWithin(4000, 3, 480)).toEqual({ width: 480, height: 1 });
  });

  // Why: a picture small enough already is kept, never enlarged.
  it("leaves a picture within the limit alone", () => {
    expect(fitWithin(480, 320, 480)).toBeNull();
    expect(fitWithin(64, 48, 480)).toBeNull();
  });

  it("refuses sizes that are not positive numbers", () => {
    expect(() => fitWithin(0, 10, 480)).toThrow(RangeError);
    expect(() => fitWithin(10, Number.NaN, 480)).toThrow(RangeError);
    expect(() => fitWithin(10, 10, -1)).toThrow(RangeError);
  });
});

describe("lookKeeper", () => {
  // Why: a finished stretch keeps a small picture for its tile and a
  // sharp copy for the loupe, which draws at 1200 px: the small one
  // alone looked soft there, stretched 2.5 times.
  it("keeps a tile-sized picture and a loupe-sized copy", async () => {
    const { tools, asked } = recording();
    const kept = await lookKeeper(tools)(picture(1600, 1200));
    expect(asked.shrink).toEqual([[TILE_LOOK_PX, 360]]);
    expect(asked.encode).toEqual([[LOUPE_LOOK_PX, 900]]);
    expect(kept.small).toMatchObject({ width: 480, height: 360 });
    expect(await kept.sharp?.text()).toBe("1200x900");
  });

  // Why: between the two sizes the loupe's copy keeps the look's own
  // size; it is never enlarged.
  it("encodes a look smaller than the loupe at its own size", async () => {
    const { tools, asked } = recording();
    await lookKeeper(tools)(picture(800, 600));
    expect(asked.shrink).toEqual([[480, 360]]);
    expect(asked.encode).toEqual([[800, 600]]);
  });

  // Why: a look already as small as the tile is kept as it is, with no
  // second copy; one of no readable size too.
  it("keeps a small look or one of no size as it is", async () => {
    const { tools, asked } = recording();
    const keep = lookKeeper(tools);
    const small = picture(480, 320) as unknown as CanvasImageSource;
    expect(await keep(small)).toEqual({ small, sharp: null });
    const sizeless = {} as CanvasImageSource;
    expect(await keep(sizeless)).toEqual({ small: sizeless, sharp: null });
    expect(asked).toEqual({ shrink: [], encode: [] });
  });

  // Why: a copy for the loupe that cannot be encoded must not cost the
  // tile its picture; a picture that cannot be shrunk is the caller's to
  // drop. Neither closes the look itself, which the caller still owns.
  it("keeps the tile's picture when the copy cannot be encoded", async () => {
    const look = picture(1600, 1200);
    const { tools } = recording({
      encode: () => Promise.reject(new Error("no encoder")),
    });
    const kept = await lookKeeper(tools)(look);
    expect(kept.sharp).toBeNull();
    expect(kept.small).toMatchObject({ width: 480 });
    const broken = recording({
      shrink: () => Promise.reject(new Error("no bitmap")),
    });
    await expect(
      lookKeeper(broken.tools)(look as unknown as CanvasImageSource),
    ).rejects.toThrow("no bitmap");
    expect(look.closed).toBe(false);
  });
});

describe("browserLookTools", () => {
  // Why: the page's own tools pass the sizes on as width and height; a
  // swap here would pass every keeper test above.
  it("resizes to the width and height asked for", async () => {
    const make = vi.fn(() => Promise.resolve("bitmap"));
    vi.stubGlobal("createImageBitmap", make);
    const look = picture(1600, 1200) as unknown as CanvasImageSource;
    await browserLookTools.shrink(look, 480, 360);
    expect(make).toHaveBeenCalledWith(look, {
      resizeWidth: 480,
      resizeHeight: 360,
      resizeQuality: "medium",
    });
  });

  it("draws the copy at the size asked for and encodes it as a JPEG", async () => {
    const drawn: unknown[][] = [];
    const made: number[][] = [];
    class FakeCanvas {
      constructor(width: number, height: number) {
        made.push([width, height]);
      }
      getContext() {
        return { drawImage: (...a: unknown[]) => drawn.push(a) };
      }
      convertToBlob(o: unknown) {
        return Promise.resolve(new Blob([JSON.stringify(o)]));
      }
    }
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    const look = picture(1600, 1200) as unknown as CanvasImageSource;
    const blob = await browserLookTools.encode(look, 1200, 900);
    expect(made).toEqual([[1200, 900]]);
    expect(drawn).toEqual([[look, 0, 0, 1200, 900]]);
    expect(JSON.parse(await blob.text())).toEqual({
      type: "image/jpeg",
      quality: 0.9,
    });
  });
});

describe("closePicture", () => {
  it("closes what can be closed and ignores the rest", () => {
    const p = picture(1, 1);
    closePicture(p);
    expect(p.closed).toBe(true);
    expect(() => closePicture(undefined)).not.toThrow();
    const throwing = {
      close: () => {
        throw new Error("closed already");
      },
    };
    expect(() =>
      closePicture(throwing as unknown as CanvasImageSource),
    ).not.toThrow();
  });
});
