/**
 * The "my location" button's state machine.
 *
 * Why these tests matter:
 * The demo starts at Cologne cathedral with no way to jump to where you are
 * standing, which on a phone makes it untestable at the one place a phone is
 * good for. Adding the button is easy; the part that goes wrong is the
 * FEEDBACK. `CLAUDE.md`'s async-UI rule asks for a distinguishable in-progress
 * state and a distinguishable outcome, for the success path and the failure
 * path — and geolocation fails in three different ways that need three
 * different messages, because "denied" is fixed in browser settings, "timeout"
 * by walking outside, and "unavailable" not at all.
 *
 * @see locate-state.ts.md
 */

import { describe, it, expect } from "vitest";

import { labelFor, stateForError, type LocateState } from "./locate-state.js";

describe("labelFor", () => {
  it("distinguishes idle from in-progress, which is the whole async-feedback rule", () => {
    expect(labelFor("idle")).not.toBe(labelFor("locating"));
    expect(labelFor("locating")).toMatch(/locating|…/i);
  });

  it("gives every state a non-empty label", () => {
    // A state with no label is a button that goes blank mid-interaction.
    const states: LocateState[] = [
      "idle",
      "locating",
      "located",
      "denied",
      "timeout",
      "unavailable",
    ];
    for (const state of states) expect(labelFor(state).trim()).not.toBe("");
  });

  it("says something actionable for each failure, not just 'error'", () => {
    // The three failures have three different remedies: browser settings, going
    // outside, and nothing at all. One shared "failed" would hide that.
    const denied = labelFor("denied");
    const timedOut = labelFor("timeout");
    const unavailable = labelFor("unavailable");
    expect(new Set([denied, timedOut, unavailable]).size).toBe(3);
    expect(denied).toMatch(/denied|permission/i);
    expect(timedOut).toMatch(/timed out|timeout/i);
  });
});

describe("stateForError", () => {
  it("maps the three GeolocationPositionError codes", () => {
    expect(stateForError(1)).toBe("denied");
    expect(stateForError(2)).toBe("unavailable");
    expect(stateForError(3)).toBe("timeout");
  });

  it("treats an unknown code as unavailable rather than crashing", () => {
    // The codes are a fixed set in the spec, but this is a browser API and the
    // error object is whatever the browser hands over. A button that throws
    // inside its own error handler leaves the UI stuck in `locating` forever.
    expect(stateForError(99)).toBe("unavailable");
    expect(stateForError(undefined)).toBe("unavailable");
  });
});
