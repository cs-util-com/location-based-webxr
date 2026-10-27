/**
 * Why these tests matter: the film plays by itself, so everything a
 * visitor can do to it (look away, tap, jump, come back) and everything
 * the page does to it (scroll it out of view, start AR) must leave it in
 * a state the visitor can read, and must cost nothing while it is still:
 * no animation frame is requested while it is paused, finished, out of
 * view or waiting (the page's phone budget). The frame scheduler is a
 * seam, so "no frames" is counted, not assumed.
 */
import { describe, expect, it } from "vitest";

import {
  createFilmPlayer,
  type FilmPlayerOptions,
  type PlayerSnapshot,
} from "./film-player.js";
import { createTimeline } from "./film-timeline.js";

const TL = createTimeline(
  [
    { durS: 2, views: [{ atS: 0, view: "a" }] },
    { durS: 2, views: [{ atS: 0, view: "b" }] },
    { durS: 2, views: [{ atS: 0, view: "b" }] },
  ],
  { speed: 1, holdS: 0, camS: 1, settleS: 0 },
);
// total: 2 + (1 + 2) + (0 + 2) = 7 s

function setup(overrides: Partial<FilmPlayerOptions> = {}) {
  const pending = new Map<number, (now: number) => void>();
  let nextId = 1;
  let requested = 0;
  const renders: number[] = [];
  const changes: PlayerSnapshot[] = [];
  const player = createFilmPlayer({
    timeline: TL,
    reducedMotion: false,
    startShare: 0.5,
    leaveShare: 0.1,
    requestFrame(cb) {
      requested++;
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    cancelFrame(id) {
      pending.delete(id);
    },
    render(t) {
      renders.push(t);
    },
    onChange(s) {
      changes.push(s);
    },
    ...overrides,
  });
  let now = 1000;
  /** Runs the pending frame (if any) `ms` after the previous one. */
  const frame = (ms = 50) => {
    now += ms;
    const [id, cb] = [...pending.entries()][0] ?? [];
    if (id === undefined || cb === undefined) return false;
    pending.delete(id);
    cb(now);
    return true;
  };
  return {
    player,
    frame,
    pending: () => pending.size,
    requested: () => requested,
    renders,
    changes,
  };
}

describe("film player: autoplay and play once", () => {
  it("waits without frames until its start share is in view, then plays", () => {
    const h = setup();
    h.player.setViewShare(0.3);
    expect(h.player.snapshot().status).toBe("waiting");
    expect(h.requested()).toBe(0);
    h.player.setViewShare(0.5);
    expect(h.player.snapshot().status).toBe("playing");
    expect(h.pending()).toBe(1);
  });

  it("advances by the time between frames, the first frame of a run counting zero", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.frame(500);
    expect(h.player.snapshot().t).toBe(0);
    h.frame(50);
    expect(h.player.snapshot().t).toBeCloseTo(0.05, 12);
    expect(h.renders.at(-1)).toBeCloseTo(0.05, 12);
  });

  it("never jumps more than a tenth of a second in one frame (a stalled tab)", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.frame();
    h.frame(5000);
    expect(h.player.snapshot().t).toBeCloseTo(0.1, 12);
  });

  it("plays once: stops on the last frame, finished, and asks for no more frames", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.frame();
    for (let i = 0; i < 200 && h.frame(100); i++);
    const s = h.player.snapshot();
    expect(s.status).toBe("finished");
    expect(s.t).toBe(TL.totalS);
    expect(s.position.finished).toBe(true);
    expect(h.renders.at(-1)).toBe(TL.totalS);
    expect(h.pending()).toBe(0);
    // looking away and back does not start it again
    h.player.setViewShare(0);
    h.player.setViewShare(1);
    expect(h.player.snapshot().status).toBe("finished");
    expect(h.pending()).toBe(0);
  });
});

describe("film player: the view", () => {
  it("pauses with no frames when it leaves the view, and resumes where it stopped", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.frame();
    h.frame(100);
    h.player.setViewShare(0.05);
    expect(h.player.snapshot()).toMatchObject({
      status: "paused",
      pausedBy: "view",
    });
    expect(h.pending()).toBe(0);
    const before = h.requested();
    h.player.setViewShare(0.3);
    expect(h.requested()).toBe(before);
    h.player.setViewShare(0.6);
    expect(h.player.snapshot().status).toBe("playing");
    h.frame(900);
    expect(h.player.snapshot().t).toBeCloseTo(0.1, 12);
  });

  it("keeps playing between the leave and the start share", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.player.setViewShare(0.2);
    expect(h.player.snapshot().status).toBe("playing");
    expect(h.player.snapshot().moving).toBe(false);
    h.player.setViewShare(0.7);
    expect(h.player.snapshot().moving).toBe(true);
  });

  it("reads a garbage share as out of view", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.player.setViewShare(Number.NaN);
    expect(h.player.snapshot()).toMatchObject({
      status: "paused",
      pausedBy: "view",
    });
  });
});

describe("film player: tap, the button and jumps", () => {
  it("pauses on a tap and holds the pause through leaving and re-entering the view", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.frame();
    h.player.tap();
    expect(h.player.snapshot()).toMatchObject({
      status: "paused",
      pausedBy: "user",
      moving: false,
    });
    expect(h.pending()).toBe(0);
    h.player.setViewShare(0);
    h.player.setViewShare(1);
    expect(h.player.snapshot()).toMatchObject({
      status: "paused",
      pausedBy: "user",
    });
    h.player.tap();
    expect(h.player.snapshot().status).toBe("playing");
  });

  it("starts a waiting film on a tap, without waiting for the view", () => {
    const h = setup();
    h.player.tap();
    expect(h.player.snapshot().status).toBe("playing");
  });

  it("does nothing on a tap once finished; the button plays it again from the start", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.player.jumpTo(2);
    h.frame();
    for (let i = 0; i < 50 && h.frame(100); i++);
    expect(h.player.snapshot().status).toBe("finished");
    h.player.tap();
    expect(h.player.snapshot().status).toBe("finished");
    h.player.toggle();
    expect(h.player.snapshot()).toMatchObject({ status: "playing", t: 0 });
  });

  it("jumps to a part's start and plays from there, clearing a pause", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.player.tap();
    h.player.jumpTo(1);
    expect(h.player.snapshot()).toMatchObject({
      status: "playing",
      pausedBy: null,
      t: TL.startOf(1),
    });
    expect(h.player.snapshot().position.beat).toBe(1);
    expect(h.renders.at(-1)).toBe(TL.startOf(1));
  });

  it("refuses a jump to a part that does not exist, changing nothing", () => {
    const h = setup();
    expect(() => h.player.jumpTo(3)).toThrow(RangeError);
    expect(h.player.snapshot().status).toBe("waiting");
  });
});

describe("film player: reduced motion", () => {
  it("opens on the final frame with no autoplay, and plays from the start on request", () => {
    const h = setup({ reducedMotion: true });
    expect(h.player.snapshot()).toMatchObject({
      status: "finished",
      opening: true,
      t: TL.totalS,
    });
    h.player.setViewShare(1);
    expect(h.player.snapshot().status).toBe("finished");
    expect(h.requested()).toBe(0);
    h.player.toggle();
    expect(h.player.snapshot()).toMatchObject({
      status: "playing",
      opening: false,
      t: 0,
    });
  });
});

describe("film player: the AR handoff", () => {
  it("pauses on release and stays still until the hero comes into view again", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.frame();
    h.player.release();
    expect(h.player.snapshot()).toMatchObject({
      status: "paused",
      pausedBy: "release",
    });
    expect(h.pending()).toBe(0);
    h.player.setViewShare(1);
    expect(h.player.snapshot().status).toBe("paused");
    h.player.setViewShare(0);
    h.player.setViewShare(0.8);
    expect(h.player.snapshot().status).toBe("playing");
  });

  it("resumes on a tap after a release, and leaves a finished film finished", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.player.release();
    h.player.tap();
    expect(h.player.snapshot().status).toBe("playing");

    const r = setup({ reducedMotion: true });
    r.player.release();
    expect(r.player.snapshot().status).toBe("finished");
  });

  it("keeps a user's pause a user's pause through a release", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.player.tap();
    h.player.release();
    h.player.setViewShare(0);
    h.player.setViewShare(1);
    expect(h.player.snapshot()).toMatchObject({
      status: "paused",
      pausedBy: "user",
    });
  });
});

describe("film player: redraw and destroy", () => {
  it("redraws once at the current position without starting frames", () => {
    const h = setup();
    h.player.redraw();
    expect(h.renders).toEqual([0]);
    expect(h.requested()).toBe(0);
  });

  it("stops everything on destroy", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.player.destroy();
    expect(h.pending()).toBe(0);
    h.player.setViewShare(0);
    h.player.setViewShare(1);
    h.player.tap();
    expect(h.pending()).toBe(0);
  });

  it("tells the page about every change it renders", () => {
    const h = setup();
    h.player.setViewShare(1);
    h.frame();
    h.frame();
    expect(h.changes.length).toBeGreaterThanOrEqual(3);
    expect(h.changes.at(-1)?.t).toBeCloseTo(0.05, 12);
  });
});

describe("film player: options", () => {
  it("refuses shares that make the view rule meaningless", () => {
    expect(() => setup({ startShare: 0 })).toThrow(RangeError);
    expect(() => setup({ startShare: 1.2 })).toThrow(RangeError);
    expect(() => setup({ startShare: 0.5, leaveShare: 0.5 })).toThrow(
      RangeError,
    );
    expect(() => setup({ leaveShare: -0.1 })).toThrow(RangeError);
  });
});
