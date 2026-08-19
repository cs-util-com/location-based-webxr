import { describe, expect, it } from "vitest";

import { arPressAction, shouldOfferAr } from "./ar-entry.js";

/**
 * WHY THESE TESTS MATTER (round three, G6, DEC-W2).
 *
 * The thirteenth session reported two things about the AR button in one
 * paragraph: it "does nothing" before Location has been pressed, and it is not
 * clear when it is active. The state model was already right — `arButtonState`
 * distinguishes hidden from disabled and carries a hint — but the hint reached
 * only `title` and `aria-label`, neither of which a phone shows. So on touch it
 * was a slightly faint square that did nothing, with no way to find out why.
 *
 * THE FIX REMOVES THE STATE RATHER THAN EXPLAINING IT. A press with no fix now
 * does what the GPS button does; when the fix lands, the user is OFFERED entry.
 * That is still two taps, but the second is offered rather than remembered.
 *
 * WHY NOT ONE TAP, which was planned first and abandoned: three recorded
 * invariants forbid re-anchoring a live session — `setZeroPos` is a no-op once
 * set, the scene anchor is `frozen` while a session runs, and the horizontal
 * placement is computed once at session start. `startArMode` also refuses
 * outright without a fix. So "press AR, both happen at once" would have started
 * a session anchored where the user is not, permanently, for its whole life.
 * Deciding the press HERE — before anything is started — is what keeps all of
 * that untouched.
 *
 * THE PREDICATE IS THE EXISTING 100 m GATE, reused rather than invented. An
 * earlier draft used `placeChangeDeclared`, which cannot work: it is a one-shot
 * flag read and cleared inside the same synchronous dispatch that sets it, so
 * it is `false` at every moment a user could press the button — and a map click
 * never sets it at all, which is the case the feedback names first.
 */
const HERE = { lat: 50.9413, lng: 6.958 };
/** ~1.3 km away — a map click, or a jump to another city. */
const AWAY = { lat: 50.9531, lng: 6.958 };
/** ~30 m away: the user has moved, but the view still shows where they are. */
const NEARBY = { lat: 50.94157, lng: 6.958 };

describe("arPressAction", () => {
  it("exits a running session, whatever else is true", () => {
    // A running session must always offer a way out — the same rule
    // `arButtonState` puts above every other branch, and for the same reason: a
    // disabled exit on a full-screen session reads as being trapped.
    expect(
      arPressAction({
        sessionRunning: true,
        hasOrigin: false,
        lastFix: undefined,
        viewPosition: AWAY,
      }),
    ).toEqual({ kind: "exit" });
  });

  it("LOCATES when no fix has ever arrived — the reported case", () => {
    // "Wenn ich noch nicht auf Location geklickt habe, dann macht der AR Button
    // noch nichts." It does something now, and what it does is the thing that
    // had to happen first anyway.
    expect(
      arPressAction({
        sessionRunning: false,
        hasOrigin: false,
        lastFix: undefined,
        viewPosition: HERE,
      }),
    ).toEqual({ kind: "locate" });
  });

  it("LOCATES when the view has been moved away from the user", () => {
    // The second half of the same report: after a map click or a jump to
    // another city the button stayed enabled, so AR could be entered while the
    // scene was anchored somewhere the user is not. One rule covers both — if
    // the app is not showing where you are, the press makes it show that first.
    expect(
      arPressAction({
        sessionRunning: false,
        hasOrigin: true,
        lastFix: HERE,
        viewPosition: AWAY,
      }),
    ).toEqual({ kind: "locate" });
  });

  it("ENTERS when the view is at the user", () => {
    expect(
      arPressAction({
        sessionRunning: false,
        hasOrigin: true,
        lastFix: HERE,
        viewPosition: HERE,
      }),
    ).toEqual({ kind: "enter" });
  });

  it("ENTERS while the user is within the existing 100 m gate", () => {
    // NOT AN EXACT-MATCH TEST, which would make the button unusable: a real fix
    // moves metre by metre, so "at my position" has to be a radius. It is the
    // SAME radius `ar-walking.ts` already refetches on, so the demo has one
    // notion of "far enough to matter" rather than two that can disagree.
    expect(
      arPressAction({
        sessionRunning: false,
        hasOrigin: true,
        lastFix: HERE,
        viewPosition: NEARBY,
      }),
    ).toEqual({ kind: "enter" });
  });

  it("LOCATES when an origin exists but no fix is on record", () => {
    // THIS COMMENT USED TO SAY "an origin implies a fix arrived once, so this
    // should be unreachable". It was reachable, and the PR review found the
    // path: `main.ts` cleared its fix variable on any locate FAILURE — a rule
    // written for readout staleness — so one timed-out lookup made AR
    // unenterable in a single tap for as long as GPS kept failing. The caller
    // now passes a never-cleared `lastKnownFixPosition`, so this really is the
    // defensive case again. Recording that it was NOT, once, is the useful part:
    // "unreachable" in a comment is a claim about the whole codebase, and this
    // one was made about a caller that did not exist yet.
    expect(
      arPressAction({
        sessionRunning: false,
        hasOrigin: true,
        lastFix: undefined,
        viewPosition: HERE,
      }),
    ).toEqual({ kind: "locate" });
  });

  it("LOCATES rather than entering when a coordinate is not finite", () => {
    // A browser can hand back NaN. THIS TEST DOES NOT GUARD THE FINITE CHECKS
    // and is not claimed to: mutation testing showed it green with both of them
    // deleted, because `greatCircleDistance` returns NaN rather than throwing
    // and `NaN <= x` is false, so "is it WITHIN the gate" already answers no.
    // What it pins is that PROPERTY — that the predicate is phrased in the
    // direction where an uncomparable distance fails closed — which is worth
    // holding because flipping it to `> gate` and negating would look
    // equivalent and would not be.
    expect(
      arPressAction({
        sessionRunning: false,
        hasOrigin: true,
        lastFix: { lat: Number.NaN, lng: 6.958 },
        viewPosition: HERE,
      }),
    ).toEqual({ kind: "locate" });
  });
});

describe("shouldOfferAr", () => {
  /**
   * WHY THE OFFER NEEDS ITS OWN PREDICATE, and why it is the risky half.
   *
   * A prompt that appears when the user did not ask for AR is a worse bug than
   * the one being fixed. The offer belongs to the AR press, so the intent has
   * to be remembered across the wait and dropped on anything that supersedes
   * it — pressing AR again, entering AR, or moving somewhere else.
   */
  it("offers when a fix lands after an AR press asked for it", () => {
    expect(
      shouldOfferAr({
        awaitingFix: true,
        sessionRunning: false,
        hasOrigin: true,
        lastFix: HERE,
        viewPosition: HERE,
      }),
    ).toBe(true);
  });

  it("does NOT offer when the user only pressed the GPS button", () => {
    // The locate control is used on its own constantly — by a desktop user
    // finding themselves on the map, and by every AR session's own watch. An
    // offer keyed on "a fix arrived" rather than on "AR was asked for" would
    // fire at all of them.
    expect(
      shouldOfferAr({
        awaitingFix: false,
        sessionRunning: false,
        hasOrigin: true,
        lastFix: HERE,
        viewPosition: HERE,
      }),
    ).toBe(false);
  });

  it("does NOT offer while a session is already running", () => {
    // The watch delivers ~1 Hz for the whole session; an offer that survived
    // entry would re-appear once a second on top of the AR view.
    expect(
      shouldOfferAr({
        awaitingFix: true,
        sessionRunning: true,
        hasOrigin: true,
        lastFix: HERE,
        viewPosition: HERE,
      }),
    ).toBe(false);
  });

  it("does NOT offer while the view is still not at the user", () => {
    // The fix arrived, but something moved the view again before it did. The
    // offer says "enter AR here", so it may only appear when pressing AR would
    // in fact enter.
    expect(
      shouldOfferAr({
        awaitingFix: true,
        sessionRunning: false,
        hasOrigin: true,
        lastFix: HERE,
        viewPosition: AWAY,
      }),
    ).toBe(false);
  });

  it("does NOT offer before any fix exists", () => {
    expect(
      shouldOfferAr({
        awaitingFix: true,
        sessionRunning: false,
        hasOrigin: false,
        lastFix: undefined,
        viewPosition: HERE,
      }),
    ).toBe(false);
  });

  it("agrees with `arPressAction` exactly — the offer means the press would enter", () => {
    // THE INVARIANT THAT KEEPS THE TWO HONEST. The prompt's whole promise is
    // "pressing AR now works", so it must never be reachable in a state where
    // the press would do something else. Stated as a test rather than as a
    // comment because these are separate functions and could drift apart.
    const states = [
      { hasOrigin: true, lastFix: HERE, viewPosition: HERE },
      { hasOrigin: true, lastFix: HERE, viewPosition: NEARBY },
      { hasOrigin: true, lastFix: HERE, viewPosition: AWAY },
      { hasOrigin: false, lastFix: undefined, viewPosition: HERE },
      { hasOrigin: true, lastFix: undefined, viewPosition: HERE },
    ] as const;

    for (const state of states) {
      const offered = shouldOfferAr({
        awaitingFix: true,
        sessionRunning: false,
        ...state,
      });
      const press = arPressAction({ sessionRunning: false, ...state });
      expect(offered).toBe(press.kind === "enter");
    }
  });
});
