/**
 * Why this test matters: the 4,096 x 2,048 cloud map (round-3 plan
 * 2026-10-08-2345 M1) decoded on the main thread would stall a frame as the
 * flight starts, so it is decoded off the thread where the browser honours
 * the decoder's options; where it does not (Safari before 17, Firefox
 * before 98: three's own rule for glTF), an off-thread map would be drawn
 * upside down, so those take the plain image element.
 */
import { describe, expect, it } from "vitest";

import { decodesOffThread } from "./globe-map-loader.js";

const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const SAFARI = (v: number) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v}.0 Mobile/15E148 Safari/604.1`;
const FIREFOX = (v: number) =>
  `Mozilla/5.0 (X11; Linux x86_64; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`;

describe("decodesOffThread", () => {
  it("decodes off the thread in Chrome, Safari 17 and Firefox 98 on", () => {
    expect(decodesOffThread(CHROME_ANDROID, true)).toBe(true);
    expect(decodesOffThread(SAFARI(17), true)).toBe(true);
    expect(decodesOffThread(SAFARI(18), true)).toBe(true);
    expect(decodesOffThread(FIREFOX(98), true)).toBe(true);
  });

  it("takes the image element in Safari before 17 and Firefox before 98", () => {
    expect(decodesOffThread(SAFARI(16), true)).toBe(false);
    expect(decodesOffThread(SAFARI(15), true)).toBe(false);
    expect(decodesOffThread(FIREFOX(97), true)).toBe(false);
  });

  it("takes the image element without createImageBitmap, whatever the browser", () => {
    expect(decodesOffThread(CHROME_ANDROID, false)).toBe(false);
    expect(decodesOffThread(undefined, false)).toBe(false);
  });

  it("decodes off the thread when no user agent is known but the API is there", () => {
    expect(decodesOffThread(undefined, true)).toBe(true);
  });
});
