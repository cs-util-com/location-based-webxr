import { describe, expect, it } from "vitest";

import {
  decideStartSound,
  lookDwell,
  startFires,
  VIDEO_AWAY_M,
  VIDEO_DEFAULT_WITHIN_M,
  VIDEO_LOOK_DEG,
  VIDEO_LOOK_DWELL_S,
  VIDEO_MARGIN_M,
  videoHint,
  videoReachM,
  videoSoundChoice,
  videoStartOf,
  videoStep,
  videoThere,
  withVideoSound,
} from "./video-rules.js";

describe("a video's start trigger", () => {
  // Why: the creator's trigger is the one choice that decides whether a
  // visitor ever sees a video start by itself; each trigger is pinned.
  it("starts on entering by default, and on a near start once within its distance", () => {
    expect(videoStartOf({})).toBe("enter");
    expect(videoReachM({})).toBe(VIDEO_AWAY_M);
    expect(videoReachM({ start: "near" })).toBe(VIDEO_DEFAULT_WITHIN_M);
    expect(videoReachM({ start: "near", withinM: 3 })).toBe(3);
    // A distance set for another trigger is kept but not read.
    expect(videoReachM({ start: "look", withinM: 3 })).toBe(VIDEO_AWAY_M);
    expect(startFires("enter", true, 0)).toBe(true);
    expect(startFires("near", true, 0)).toBe(true);
    expect(startFires("enter", false, 0)).toBe(false);
  });

  it("starts on a look only once the look is held, and never by itself on a tap start", () => {
    expect(startFires("look", true, VIDEO_LOOK_DWELL_S - 0.01)).toBe(false);
    expect(startFires("look", true, VIDEO_LOOK_DWELL_S)).toBe(true);
    expect(startFires("look", false, 10)).toBe(false);
    expect(startFires("tap", true, 10)).toBe(false);
  });

  it("holds a look while the centre stays within the angle, and drops it outside", () => {
    let dwell = 0;
    for (let i = 0; i < 6; i++)
      dwell = lookDwell(dwell, VIDEO_LOOK_DEG - 1, 0.1);
    expect(dwell).toBeCloseTo(0.6);
    expect(lookDwell(dwell, VIDEO_LOOK_DEG, 0.1)).toBe(0);
    // Bad input counts as no step and as looking away.
    expect(lookDwell(0.3, Number.NaN, 0.1)).toBe(0);
    expect(lookDwell(0.3, 0, Number.NaN)).toBe(0.3);
    expect(lookDwell(0.3, 0, -1)).toBe(0.3);
  });
});

describe("whether the visitor is there", () => {
  // Why: a visitor standing at the edge must not pause and resume the
  // video at every step of the position's noise.
  it("comes within the reach and goes only beyond the reach plus the margin", () => {
    expect(videoThere(6, 6, false)).toBe(true);
    expect(videoThere(6.5, 6, false)).toBe(false);
    expect(videoThere(6.5, 6, true)).toBe(true);
    expect(videoThere(6 + VIDEO_MARGIN_M, 6, true)).toBe(true);
    expect(videoThere(6 + VIDEO_MARGIN_M + 0.01, 6, true)).toBe(false);
    expect(videoThere(Number.NaN, 6, true)).toBe(true);
  });
});

describe("the playing rule", () => {
  // Why: the agreed behaviour - leaving pauses and coming back resumes, a
  // finished video stays finished, and a tap replays it.
  it("starts once on its trigger or a tap, pauses on leaving and resumes on return", () => {
    expect(videoStep("waiting", "start")).toEqual({
      state: "playing",
      action: "play",
    });
    expect(videoStep("waiting", "tap")).toEqual({
      state: "playing",
      action: "play",
    });
    expect(videoStep("playing", "leave")).toEqual({
      state: "held",
      action: "pause",
    });
    expect(videoStep("held", "return")).toEqual({
      state: "playing",
      action: "resume",
    });
    expect(videoStep("playing", "start")).toEqual({
      state: "playing",
      action: "none",
    });
  });

  it("keeps the visitor's own pause through a leave and a return", () => {
    expect(videoStep("playing", "tap").state).toBe("paused");
    expect(videoStep("paused", "leave").state).toBe("paused");
    expect(videoStep("paused", "return").state).toBe("paused");
    expect(videoStep("paused", "start").state).toBe("paused");
    expect(videoStep("paused", "tap")).toEqual({
      state: "playing",
      action: "resume",
    });
    expect(videoStep("held", "tap")).toEqual({
      state: "paused",
      action: "none",
    });
  });

  it("stays finished on its trigger, a leave and a return, and replays on a tap", () => {
    expect(videoStep("playing", "ended")).toEqual({
      state: "finished",
      action: "none",
    });
    for (const event of ["start", "leave", "return", "ended"] as const) {
      expect(videoStep("finished", event)).toEqual({
        state: "finished",
        action: "none",
      });
    }
    expect(videoStep("finished", "tap")).toEqual({
      state: "playing",
      action: "replay",
    });
  });
});

describe("whether it starts with its sound", () => {
  // Why: the visitor's own choice wins over the creator's, and a page not
  // yet touched starts muted (the browser would refuse the sound).
  it("takes the visitor's choice, else the creator's, else off", () => {
    expect(
      decideStartSound({ chosen: null, creator: undefined, activated: true }),
    ).toEqual({ sound: false, blocked: false });
    expect(
      decideStartSound({ chosen: null, creator: "on", activated: true }),
    ).toEqual({ sound: true, blocked: false });
    expect(
      decideStartSound({ chosen: "off", creator: "on", activated: true }),
    ).toEqual({ sound: false, blocked: false });
    expect(
      decideStartSound({ chosen: "on", creator: "off", activated: true }),
    ).toEqual({ sound: true, blocked: false });
  });

  it("starts muted, blocked, when sound is wanted before the page was touched", () => {
    expect(
      decideStartSound({ chosen: null, creator: "on", activated: false }),
    ).toEqual({ sound: false, blocked: true });
    expect(
      decideStartSound({ chosen: "off", creator: "on", activated: false }),
    ).toEqual({ sound: false, blocked: false });
  });

  it("keeps the visitor's choice in the stored preferences, beside every other key", () => {
    const stored = { views: { video: { world: "screen" } }, other: 1 };
    const on = withVideoSound(stored, "on");
    expect(on).toEqual({ ...stored, videoSound: "on" });
    expect(stored).not.toHaveProperty("videoSound");
    expect(videoSoundChoice(on)).toBe("on");
    expect(videoSoundChoice(withVideoSound(on, null))).toBeNull();
    expect(withVideoSound(on, null)).toEqual(stored);
    // A value that is no choice, or a stored value that is no object.
    expect(videoSoundChoice({ videoSound: "loud" })).toBeNull();
    expect(videoSoundChoice(null)).toBeNull();
    expect(videoSoundChoice([1])).toBeNull();
    expect(withVideoSound("junk", "off")).toEqual({ videoSound: "off" });
  });
});

describe("the hint while it waits", () => {
  // Why: a tap start or a near start must tell the visitor what starts it.
  it("asks for a tap, or says how far to come, and is gone once it plays", () => {
    expect(videoHint("tap", "waiting", 3, VIDEO_AWAY_M)).toBe(
      "Tap the video to play",
    );
    expect(videoHint("near", "waiting", 10, 6)).toBe(
      "Walk closer to start · 4 m",
    );
    expect(videoHint("near", "waiting", 6.2, 6)).toBe(
      "Walk closer to start · 1 m",
    );
    expect(videoHint("near", "waiting", 5, 6)).toBeNull();
    expect(videoHint("enter", "waiting", 3, VIDEO_AWAY_M)).toBeNull();
    expect(videoHint("tap", "playing", 3, VIDEO_AWAY_M)).toBeNull();
  });
});
