import { readFileSync } from "node:fs";

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

describe("the page's content security policy", () => {
  const html = readFileSync(
    new URL("../../splat/index.html", import.meta.url),
    "utf8",
  );
  const csp =
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(
      html,
    )?.[1] ?? "";
  const directive = (name: string): string[] =>
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .find((d) => d[0] === name)
      ?.slice(1) ?? [];

  // Why: the page runs code it does not ship. The policy lets scripts come
  // only from this site, the worker shim and the one pinned commit, so a
  // pin changed in the code but not here fails before a browser does; and
  // nothing the trainer runs may send data anywhere but this site.
  it("allows scripts only from this site, blob: and the pinned commit", () => {
    const pinned = `https://cdn.jsdelivr.net/gh/arrival-space/splat.js@${SPLAT_JS_COMMIT}/`;
    expect(SPLAT_JS_URL.startsWith(pinned)).toBe(true);
    expect(directive("script-src").sort()).toEqual(
      ["'self'", "blob:", pinned].sort(),
    );
    // 'self' because a module worker's static imports are fetched as
    // worker scripts: the blob: start module imports the built worker
    // script statically (trainer-worker-spawn.ts).
    expect(directive("worker-src").sort()).toEqual(["'self'", "blob:"]);
    expect(directive("connect-src")).toEqual(["'self'"]);
    expect(directive("default-src")).toEqual(["'self'"]);
    expect(directive("object-src")).toEqual(["'none'"]);
  });

  // Why: the policy limits where requests go, not what they carry; the
  // no-referrer meta is what keeps the page's address out of the CDN's
  // request (see trainer-worker-spawn.ts).
  it("keeps the no-referrer meta beside it", () => {
    expect(html).toMatch(/<meta name="referrer" content="no-referrer" \/>/);
  });
});
