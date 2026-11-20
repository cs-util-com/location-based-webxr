import { describe, expect, it } from "vitest";

import {
  checkSplatJs,
  loadSplatJs,
  SPLAT_JS_COMMIT,
  SPLAT_JS_URL,
} from "./splat-js.js";

/**
 * Why these tests matter: the trainer runs code it does not ship. It must
 * load exactly the commit it was measured with, from the one address, and
 * a module that is not that library (a changed API, a broken download)
 * must be refused in words before a session is created.
 */

const good = {
  createSession: () => ({}),
  parseCameras: () => [],
  TRAIN_MAX_DIM: 1600,
};

describe("SPLAT_JS_URL", () => {
  it("names one pinned commit on jsDelivr's GitHub mirror", () => {
    expect(SPLAT_JS_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(SPLAT_JS_URL).toBe(
      `https://cdn.jsdelivr.net/gh/arrival-space/splat.js@${SPLAT_JS_COMMIT}/src/index.js`,
    );
  });
});

describe("checkSplatJs", () => {
  it("accepts the exports the trainer calls", () => {
    expect(checkSplatJs(good)).toBe(good);
  });

  it("refuses, naming what is missing, anything else", () => {
    expect(() => checkSplatJs(null)).toThrow(/not the version.*no module/);
    expect(() => checkSplatJs({ ...good, parseCameras: 1 })).toThrow(
      /no parseCameras/,
    );
    expect(() => checkSplatJs({ ...good, createSession: undefined })).toThrow(
      /no createSession/,
    );
    expect(() => checkSplatJs({ ...good, TRAIN_MAX_DIM: 0 })).toThrow(
      /no TRAIN_MAX_DIM/,
    );
  });
});

describe("loadSplatJs", () => {
  it("imports the pinned address and checks what came back", async () => {
    const asked: string[] = [];
    const mod = await loadSplatJs((url) => {
      asked.push(url);
      return Promise.resolve(good);
    });
    expect(asked).toEqual([SPLAT_JS_URL]);
    expect(mod).toBe(good);
  });

  it("says in words when the download fails or the module is wrong", async () => {
    await expect(
      loadSplatJs(() => Promise.reject(new Error("net::ERR_FAILED"))),
    ).rejects.toThrow(/could not be loaded \(net::ERR_FAILED\)/);
    await expect(loadSplatJs(() => Promise.resolve({}))).rejects.toThrow(
      /not the version/,
    );
  });
});
