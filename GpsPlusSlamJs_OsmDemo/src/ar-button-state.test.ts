/**
 * The AR button's states, and the two DEC-12 rules they encode.
 *
 * Why these tests matter: the reference consumer's pattern is
 * `startArButton.hidden = !arSupported; simNote.hidden = arSupported`, and
 * copying it here would mean **any WebXR-capable phone loses the map view** —
 * the primary interface, and the only way to drive the data. DEC-12 says the
 * map stays and AR is an additional mode. That is a rule about what must NOT
 * happen, so it needs a test that would fail if someone reached for the
 * familiar pattern.
 *
 * The second rule is subtler: "appears once GPS is live" has two failure modes
 * pointing opposite ways — hiding the button until a fix lands makes it appear
 * without warning under the user's thumb, and enabling it before one lands
 * gives them a session anchored to nothing.
 *
 * @see ar-button-state.ts.md
 */

import { describe, it, expect } from "vitest";

import { arButtonState, type ArButtonInputs } from "./ar-button-state.js";

const inputs = (over: Partial<ArButtonInputs> = {}): ArButtonInputs => ({
  support: "supported",
  willLocateFirst: false,
  active: false,
  ...over,
});

describe("before AR is possible", () => {
  it("hides the button while support is still being probed", () => {
    // The probe resolves in milliseconds. A control that flickers
    // disabled→enabled on every load is worse than one that appears once.
    expect(arButtonState(inputs({ support: "checking" })).hidden).toBe(true);
  });

  it("hides it on a device that cannot do AR, rather than greying it forever", () => {
    // There is no action the user can take, and the map is the whole app on
    // this device. A permanently disabled control advertises something they
    // cannot have.
    const state = arButtonState(inputs({ support: "unsupported" }));
    expect(state.hidden).toBe(true);
  });

  it("stays ENABLED when a press would find the user first, and says so", () => {
    // THIS ASSERTED `disabled: true` UNTIL ROUND THREE, with a comment arguing
    // that "visible but disabled" was the one case where the distinction earned
    // its keep: the state is temporary and self-resolving, so the control had to
    // be discoverable before it became usable.
    //
    // The argument was sound and the outcome was still wrong. The thirteenth
    // session met exactly what it describes — a discoverable control that did
    // nothing when discovered — and reported it as broken, because the
    // explanation lived in `title`/`aria-label` and a phone shows neither. The
    // press now performs the step it was waiting for (DEC-W2), so there is
    // nothing left to disable.
    const state = arButtonState(inputs({ willLocateFirst: true }));

    expect(state.hidden).toBe(false);
    expect(state.disabled).toBe(false);
    // The hint survives as a PROMISE rather than an excuse — "finds your
    // location first". Nothing rests on it now, which is the point.
    expect(state.hint).toBeDefined();
  });

  it("has no reachable disabled state at all", () => {
    // WHY THIS IS WORTH ASSERTING. The round-three plan first designed a
    // disabled-but-tappable button that would explain itself in a toast; the
    // cold review showed no input could produce a disabled state once the fix
    // gate went, so it would have shipped inert — the same failure the previous
    // round's review found three times. The decision was deleted. This test is
    // what stops it being re-introduced by accident.
    for (const support of ["checking", "supported", "unsupported"] as const) {
      for (const willLocateFirst of [true, false]) {
        for (const active of [true, false]) {
          const state = arButtonState({ support, willLocateFirst, active });
          if (state.hidden) continue;
          expect(
            state.disabled,
            `visible but disabled: ${support}/${String(willLocateFirst)}/${String(active)}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("once AR is available", () => {
  it("offers entry", () => {
    const state = arButtonState(inputs());
    expect(state).toMatchObject({ hidden: false, disabled: false });
    expect(state.label).toContain("AR");
  });

  it("always offers a way OUT of a running session", () => {
    // `active` wins over every other input, including a support probe that
    // somehow reports unsupported mid-session: a disabled exit on a
    // full-screen AR view reads as being trapped, and the Android back gesture
    // is not discoverable enough to be the only way out.
    for (const support of ["checking", "supported", "unsupported"] as const) {
      const state = arButtonState(inputs({ active: true, support }));
      expect(state.hidden, `support=${support}`).toBe(false);
      expect(state.disabled, `support=${support}`).toBe(false);
      expect(state.label).toBe("Exit AR");
    }
  });

  it("offers the exit even if the fix is lost mid-session", () => {
    // Losing the fix must not strand the user in a session they cannot leave.
    const state = arButtonState(
      inputs({ active: true, willLocateFirst: true }),
    );
    expect(state.disabled).toBe(false);
  });
});

describe("DEC-12: the map is never traded for AR", () => {
  it("never reports a state that would justify hiding the map", () => {
    // THE RULE THIS FILE EXISTS FOR, asserted over every input combination
    // rather than at the one call site that happens to exist today. The
    // reference consumer toggles a `simNote` inversely to AR support; a future
    // edit reaching for that pattern here would take the map with it.
    //
    // This module deliberately exposes NOTHING about the map — no `showMap`,
    // no `hideMap`. The assertion is that its whole surface stays that way, so
    // the map cannot become a function of AR support by accident.
    for (const support of ["checking", "supported", "unsupported"] as const) {
      for (const willLocateFirst of [true, false]) {
        for (const active of [true, false]) {
          // AN EXACT KEY SET, not `arrayContaining` plus two guessed names.
          // The first version asserted `hideMap` and `showMap` were absent and
          // allowed arbitrary extra keys, so a field called `mapHidden` would
          // have sailed through the check written to forbid exactly that.
          const state = arButtonState({ support, willLocateFirst, active });
          const keys = Object.keys(state).sort();
          const allowed = ["disabled", "hidden", "hint", "label"];
          expect(
            keys.every((key) => allowed.includes(key)),
            `unexpected key on ${support}/${String(willLocateFirst)}/${String(active)}: ${keys.join(",")}`,
          ).toBe(true);
        }
      }
    }
  });

  it("gives every combination a defined label, so no state renders blank", () => {
    for (const support of ["checking", "supported", "unsupported"] as const) {
      for (const willLocateFirst of [true, false]) {
        for (const active of [true, false]) {
          const { label } = arButtonState({ support, willLocateFirst, active });
          expect(
            label.length,
            `${support}/${willLocateFirst}/${active}`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});
