/**
 * Why these tests matter: a video brought into the tour gets a poster -
 * its first frame as a picture - minted once at the import, so a phone can
 * show the item before a byte of the video loads. Reading a frame depends
 * on the browser's decoder, which can stall or refuse; every such case
 * must end in "no poster" (the import goes on without one), never in a
 * hang or a throw, and the object URL must be let go either way.
 */
import { describe, expect, it } from "vitest";

import { videoPosterOf, type PosterVideo } from "./video-poster.js";

/** A video element stand-in that plays `script` once its src is set. */
function fakeVideo(script: "frame" | "error" | "stall" | "empty") {
  const listeners = new Map<string, (() => void)[]>();
  const video = {
    muted: false,
    preload: "",
    playsInline: false,
    videoWidth: script === "empty" ? 0 : 640,
    videoHeight: script === "empty" ? 0 : 360,
    duration: 4,
    seekedTo: null as number | null,
    get currentTime() {
      return this.seekedTo ?? 0;
    },
    set currentTime(t: number) {
      this.seekedTo = t;
      queueMicrotask(() => {
        for (const f of listeners.get("seeked") ?? []) f();
      });
    },
    set src(_url: string) {
      queueMicrotask(() => {
        const event =
          script === "error"
            ? "error"
            : script === "stall"
              ? null
              : "loadedmetadata";
        if (event === null) return;
        for (const f of listeners.get(event) ?? []) f();
      });
    },
    addEventListener(type: string, f: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), f]);
    },
    removeAttribute: () => undefined,
    load: () => undefined,
  };
  return video;
}

function deps(script: "frame" | "error" | "stall" | "empty") {
  const revoked: string[] = [];
  const drawn: { w: number; h: number }[] = [];
  const video = fakeVideo(script);
  return {
    revoked,
    drawn,
    video,
    options: {
      createVideo: () => video,
      draw: (_v: PosterVideo, w: number, h: number) => {
        drawn.push({ w, h });
        return Promise.resolve(new Blob(["jpeg"], { type: "image/jpeg" }));
      },
      objectUrl: {
        create: () => "blob:video",
        revoke: (url: string) => {
          revoked.push(url);
        },
      },
      timeoutMs: 20,
    },
  };
}

describe("videoPosterOf", () => {
  it("draws the frame just after the start at the video's own size", async () => {
    const d = deps("frame");
    const poster = await videoPosterOf(new Blob(["v"]), d.options);
    expect(await poster?.text()).toBe("jpeg");
    expect(d.drawn).toEqual([{ w: 640, h: 360 }]);
    expect(d.video.seekedTo).toBeGreaterThan(0);
    expect(d.video.muted).toBe(true);
    expect(d.revoked).toEqual(["blob:video"]);
  });

  it("gives no poster for a video the browser refuses, one that never loads, and one with no picture", async () => {
    for (const script of ["error", "stall", "empty"] as const) {
      const d = deps(script);
      expect(await videoPosterOf(new Blob(["v"]), d.options)).toBeNull();
      expect(d.drawn).toEqual([]);
      expect(d.revoked).toEqual(["blob:video"]);
    }
  });

  it("scales a large frame down to the longest side it keeps", async () => {
    const d = deps("frame");
    d.video.videoWidth = 3840;
    d.video.videoHeight = 2160;
    await videoPosterOf(new Blob(["v"]), d.options);
    expect(d.drawn).toEqual([{ w: 1920, h: 1080 }]);
  });
});
