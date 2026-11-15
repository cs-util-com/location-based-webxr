/**
 * Why these tests matter: a phone decodes only a few videos at once, and
 * two voices over each other are noise. The cap is the one place that
 * says which free videos play and which one is heard, so each of its
 * rules is pinned here: the first two to start play, a third waits its
 * turn in the order it asked, the newest start with sound takes the
 * sound, and a video that stops (paused, left, ended, gone) frees its
 * place for the next in line.
 */
import { describe, expect, it } from "vitest";

import {
  capStep,
  EMPTY_CAP,
  VIDEO_PLAY_CAP,
  videoCap,
  type CapSeat,
} from "./video-cap.js";

describe("the play cap's rule", () => {
  it("plays at most two at once, and a third waits", () => {
    expect(VIDEO_PLAY_CAP).toBe(2);
    let s = capStep(EMPTY_CAP, { type: "ask", id: "a" });
    expect(s.granted).toEqual(["a"]);
    s = capStep(s.state, { type: "ask", id: "b" });
    expect(s.granted).toEqual(["b"]);
    s = capStep(s.state, { type: "ask", id: "c" });
    expect(s.granted).toEqual([]);
    expect(s.state).toEqual({
      playing: ["a", "b"],
      waiting: ["c"],
      audible: null,
    });
  });

  it("asking again keeps a video's place, playing or waiting", () => {
    let s = capStep(EMPTY_CAP, { type: "ask", id: "a" });
    s = capStep(s.state, { type: "ask", id: "b" });
    s = capStep(s.state, { type: "ask", id: "c" });
    s = capStep(s.state, { type: "ask", id: "d" });
    s = capStep(s.state, { type: "ask", id: "c" });
    s = capStep(s.state, { type: "ask", id: "a" });
    expect(s.state.playing).toEqual(["a", "b"]);
    expect(s.state.waiting).toEqual(["c", "d"]);
  });

  it("gives a freed place to the first that waits", () => {
    let s = capStep(EMPTY_CAP, { type: "ask", id: "a" });
    s = capStep(s.state, { type: "ask", id: "b" });
    s = capStep(s.state, { type: "ask", id: "c" });
    s = capStep(s.state, { type: "ask", id: "d" });
    s = capStep(s.state, { type: "leave", id: "b" });
    expect(s.granted).toEqual(["c"]);
    expect(s.state.playing).toEqual(["a", "c"]);
    expect(s.state.waiting).toEqual(["d"]);
    // One that gave up waiting is out of the line.
    s = capStep(s.state, { type: "leave", id: "d" });
    s = capStep(s.state, { type: "leave", id: "a" });
    expect(s.granted).toEqual([]);
    expect(s.state).toEqual({ playing: ["c"], waiting: [], audible: null });
  });

  it("gives the sound to the newest that plays with it, and mutes the other", () => {
    let s = capStep(EMPTY_CAP, { type: "ask", id: "a" });
    s = capStep(s.state, { type: "ask", id: "b" });
    s = capStep(s.state, { type: "heard", id: "a" });
    expect(s.muted).toEqual([]);
    s = capStep(s.state, { type: "heard", id: "b" });
    expect(s.muted).toEqual(["a"]);
    expect(s.state.audible).toBe("b");
    // Heard again: nobody else to mute.
    expect(capStep(s.state, { type: "heard", id: "b" }).muted).toEqual([]);
    // Muted by the visitor, or stopped: nobody is heard.
    expect(capStep(s.state, { type: "quiet", id: "b" }).state.audible).toBe(
      null,
    );
    expect(capStep(s.state, { type: "leave", id: "b" }).state.audible).toBe(
      null,
    );
    // A quiet from one not heard changes nothing.
    expect(capStep(s.state, { type: "quiet", id: "a" }).state.audible).toBe(
      "b",
    );
  });

  it("hears none that does not play", () => {
    let s = capStep(EMPTY_CAP, { type: "ask", id: "a" });
    s = capStep(s.state, { type: "ask", id: "b" });
    s = capStep(s.state, { type: "ask", id: "c" });
    s = capStep(s.state, { type: "heard", id: "a" });
    s = capStep(s.state, { type: "heard", id: "c" });
    expect(s.muted).toEqual([]);
    expect(s.state.audible).toBe("a");
  });

  it("follows a limit other than two", () => {
    let s = capStep(EMPTY_CAP, { type: "ask", id: "a" }, 1);
    s = capStep(s.state, { type: "ask", id: "b" }, 1);
    expect(s.state.playing).toEqual(["a"]);
    // A limit that is no whole number of at least one counts as one.
    for (const bad of [0, -2, Number.NaN, 1.5]) {
      let t = capStep(EMPTY_CAP, { type: "ask", id: "a" }, bad);
      t = capStep(t.state, { type: "ask", id: "b" }, bad);
      expect(t.state.playing).toEqual(["a"]);
    }
  });
});

describe("the page's cap", () => {
  /** A seat that writes down what the cap tells it. */
  function seat(name: string, log: string[]): CapSeat {
    return {
      granted: () => log.push(`${name} plays`),
      muted: () => log.push(`${name} muted`),
    };
  }

  it("tells a waiting seat when it may play, and a heard one when it loses its sound", () => {
    const log: string[] = [];
    const cap = videoCap();
    const [a, b, c] = [seat("a", log), seat("b", log), seat("c", log)];
    expect(cap.ask(a)).toBe(true);
    expect(cap.ask(b)).toBe(true);
    expect(cap.ask(c)).toBe(false);
    cap.heard(a);
    cap.heard(b);
    expect(log).toEqual(["a muted"]);
    cap.leave(a);
    expect(log).toEqual(["a muted", "c plays"]);
    // A seat told it plays asks again from its callback: it holds already.
    expect(cap.ask(c)).toBe(true);
  });

  it("commits each step before it calls a seat back, so a seat may call it again", () => {
    const cap = videoCap();
    const order: string[] = [];
    const a: CapSeat = { granted: () => undefined, muted: () => undefined };
    const b: CapSeat = {
      granted: () => {
        order.push(`b asks: ${String(cap.ask(b))}`);
        cap.heard(b);
      },
      muted: () => undefined,
    };
    const c: CapSeat = {
      granted: () => undefined,
      muted: () => order.push("c muted"),
    };
    cap.ask(a);
    cap.ask(c);
    cap.heard(c);
    cap.ask(b);
    cap.leave(a);
    expect(order).toEqual(["b asks: true", "c muted"]);
  });
});
