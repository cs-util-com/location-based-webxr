/**
 * Why these tests matter: a video brought into the tour gets a poster -
 * its first frame as a picture - minted once at the import, so a phone can
 * show the item before a byte of the video loads. Reading a frame depends
 * on the browser's decoder, which can stall or refuse; every such case
 * must end in "no poster" (the import goes on without one), never in a
 * hang or a throw, and the object URL must be let go either way.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  videoLookOf,
  type PosterVideo,
  type VideoPosterOptions,
} from "./video-poster.js";

/** The poster alone, as most of these tests read it. */
const videoPosterOf = async (
  blob: Blob,
  options: VideoPosterOptions,
): Promise<Blob | null> => (await videoLookOf(blob, options)).poster;

/** A video element stand-in that plays `script` once its src is set. */
function fakeVideo(
  script: "frame" | "error" | "stall" | "empty",
  duration = 4,
  /** What an unknown (Infinity) length turns out to be once a seek far
   *  past the end makes the browser read it (Chrome); none: never. */
  resolvesTo?: number,
) {
  const listeners = new Map<string, (() => void)[]>();
  const video = {
    muted: false,
    preload: "",
    playsInline: false,
    videoWidth: script === "empty" ? 0 : 640,
    videoHeight: script === "empty" ? 0 : 360,
    duration,
    seekedTo: null as number | null,
    get currentTime() {
      return this.seekedTo ?? 0;
    },
    set currentTime(t: number) {
      // A seek to where the video already is fires no "seeked" (Chrome).
      if (t === this.currentTime) return;
      this.seekedTo = t;
      queueMicrotask(() => {
        if (
          this.duration === Number.POSITIVE_INFINITY &&
          resolvesTo !== undefined &&
          t > resolvesTo
        ) {
          this.duration = resolvesTo;
          this.seekedTo = resolvesTo;
          for (const f of listeners.get("durationchange") ?? []) f();
        }
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
        if (event !== "loadedmetadata") return;
        for (const f of listeners.get("loadeddata") ?? []) f();
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

function deps(
  script: "frame" | "error" | "stall" | "empty",
  duration?: number,
  resolvesTo?: number,
) {
  const revoked: string[] = [];
  const drawn: { w: number; h: number }[] = [];
  const video = fakeVideo(script, duration, resolvesTo);
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

afterEach(() => {
  vi.useRealTimers();
});

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

  // Why: a video whose length the browser does not know (0, NaN) has
  // nowhere to seek to but its start, and a seek to where it already is
  // fires no "seeked": the import waited the whole timeout and got no
  // poster. Its first frame is drawn once loaded.
  it("draws the first frame of a video with no known length, without waiting for a seek", async () => {
    for (const duration of [0, Number.NaN]) {
      const d = deps("frame", duration);
      d.options.timeoutMs = 60_000;
      const poster = await videoPosterOf(new Blob(["v"]), d.options);
      expect(await poster?.text()).toBe("jpeg");
      expect(d.drawn).toEqual([{ w: 640, h: 360 }]);
      expect(d.revoked).toEqual(["blob:video"]);
    }
  });

  // Why: the app's own recorded clips report a
  // length of Infinity (MediaRecorder, Chrome), and they got their first
  // frame - often black, the frame POSTER_AT_S exists to avoid. A seek far
  // past the end makes the browser read the length; the poster is then
  // taken just after the start like any other video's.
  it("reads a recorded clip's unknown length first, then draws the frame just after the start", async () => {
    const d = deps("frame", Number.POSITIVE_INFINITY, 3);
    d.options.timeoutMs = 60_000;
    const poster = await videoPosterOf(new Blob(["v"]), d.options);
    expect(await poster?.text()).toBe("jpeg");
    expect(d.video.seekedTo).toBe(0.1);
    expect(d.drawn).toEqual([{ w: 640, h: 360 }]);
    expect(d.revoked).toEqual(["blob:video"]);
  });

  // Why: a length that never resolves must not cost the poster: after a
  // short wait the first frame is drawn, as before the fix.
  it("draws the first frame of a recorded clip whose length never resolves", async () => {
    for (const lengthTimeoutMs of [0, 5, 30]) {
      const d = deps("frame", Number.POSITIVE_INFINITY);
      d.options.timeoutMs = 60_000;
      const poster = await videoPosterOf(new Blob(["v"]), {
        ...d.options,
        lengthTimeoutMs,
      });
      expect(await poster?.text()).toBe("jpeg");
      expect(d.video.seekedTo).toBe(0);
      expect(d.drawn).toEqual([{ w: 640, h: 360 }]);
    }
  });

  // Why (#881 review): a clip that takes the far seek and then goes quiet
  // (no "seeked", no length) got no poster at all: the fallback's seek
  // back to the start waited for a "seeked" that never came, until the
  // whole timeout ran out. The fallback now takes a frame regardless.
  it("draws a recorded clip's frame even when no seek ever answers", async () => {
    for (const lengthTimeoutMs of [0, 5, 30]) {
      const d = deps("frame", Number.POSITIVE_INFINITY);
      Object.defineProperty(d.video, "currentTime", {
        get: () => d.video.seekedTo ?? 0,
        set: (t: number) => {
          d.video.seekedTo = t;
        },
      });
      d.options.timeoutMs = 1_000;
      const poster = await videoPosterOf(new Blob(["v"]), {
        ...d.options,
        lengthTimeoutMs,
      });
      expect(await poster?.text()).toBe("jpeg");
      expect(d.drawn).toEqual([{ w: 640, h: 360 }]);
      expect(d.revoked).toEqual(["blob:video"]);
    }
  });

  // Why: when the clip never took the far seek it is still at the start,
  // so the fallback's seek back to the start answers at once; the second
  // wait it starts must still be cleared, not left to fire after the
  // poster is made.
  it("leaves no timer behind when the fallback's seek to the start answers at once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const d = deps("frame", Number.POSITIVE_INFINITY);
    Object.defineProperty(d.video, "currentTime", {
      get: () => 0,
      set: () => undefined,
    });
    d.options.timeoutMs = 60_000;
    const poster = videoPosterOf(new Blob(["v"]), {
      ...d.options,
      lengthTimeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(await (await poster)?.text()).toBe("jpeg");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("scales a large frame down to the longest side it keeps", async () => {
    const d = deps("frame");
    d.video.videoWidth = 3840;
    d.video.videoHeight = 2160;
    await videoPosterOf(new Blob(["v"]), d.options);
    expect(d.drawn).toEqual([{ w: 1920, h: 1080 }]);
  });
});

describe("videoLookOf", () => {
  // Why: the shelf warns about a video large for its length, and the
  // length must come from the element that minted the poster - a
  // recorded clip's Infinity resolved by the seek, an unknown one never
  // guessed, and a known length kept even when no poster could be drawn.
  it("gives the poster with the length the poster's element read", async () => {
    const d = deps("frame", 12);
    const look = await videoLookOf(new Blob(["v"]), d.options);
    expect(await look.poster?.text()).toBe("jpeg");
    expect(look.seconds).toBe(12);
    const recorded = deps("frame", Number.POSITIVE_INFINITY, 3);
    recorded.options.timeoutMs = 60_000;
    expect((await videoLookOf(new Blob(["v"]), recorded.options)).seconds).toBe(
      3,
    );
  });

  it("gives no length it does not know, and a known one without a poster", async () => {
    for (const duration of [0, Number.NaN]) {
      const d = deps("frame", duration);
      d.options.timeoutMs = 60_000;
      expect(
        (await videoLookOf(new Blob(["v"]), d.options)).seconds,
      ).toBeNull();
    }
    const empty = await videoLookOf(new Blob(["v"]), deps("empty", 9).options);
    expect(empty).toEqual({ poster: null, seconds: 9 });
    const never = deps("frame", Number.POSITIVE_INFINITY);
    never.options.timeoutMs = 60_000;
    Object.assign(never.options, { lengthTimeoutMs: 0 });
    expect(
      (await videoLookOf(new Blob(["v"]), never.options)).seconds,
    ).toBeNull();
  });
});
