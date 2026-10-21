import { describe, expect, it } from "vitest";

import {
  FIND_CODE,
  GPS_PLACED,
  VISITOR_STATUS_STATES,
  WALK,
  type VisitorStatusParts,
  type VisitorStatusState,
} from "./visitor-status";
import { walkStatusRouting, type StatusRoute } from "./walk-status-routing";

/**
 * Why these tests matter (visitor walk W4 build plan
 * GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md,
 * M2, §1.4): W4 has no status line over the camera, so the visitor's one
 * sentence (`visitor-status.ts`, kept) is routed to the coach, the scan
 * card, a toast or the peek's tail - or, where the sheet and the radar
 * already say it, nowhere. A state routed nowhere by mistake is a visitor
 * left without the one instruction that helps, so the table below names
 * EVERY state the sentence has, and the test fails when a new one is added
 * without a route.
 */

function parts(
  state: VisitorStatusState,
  text: string,
  notes: string[] = [],
): VisitorStatusParts {
  return { state, text, notes };
}

const NONE: StatusRoute = {
  coach: null,
  scanCard: null,
  toasts: [],
  codeTail: false,
};

/** One sentence per state (today's texts), and where it goes. */
const ROUTES: Record<
  VisitorStatusState,
  { text: string; scanShown?: boolean; route: StatusRoute }
> = {
  // Before AR the start page speaks (its own status line, kept).
  "before-ar": { text: "", route: NONE },
  checking: {
    text: "Checking whether this phone can show the tour in AR…",
    route: NONE,
  },
  unsupported: { text: "This tour needs an Android phone…", route: NONE },
  error: { text: "AR could not start. Tap Try again.", route: NONE },
  starting: {
    text: "Starting AR…",
    route: { ...NONE, coach: { text: "Starting AR…", look: "spinner" } },
  },
  stopping: {
    text: "Closing AR…",
    route: { ...NONE, coach: { text: "Closing AR…", look: "spinner" } },
  },
  // No walk runs in these: the coach is the one centred card (builder's).
  "no-tour": {
    text: "No tour is open here, so there is nothing to show. Open the tour's link again.",
    route: {
      ...NONE,
      coach: {
        text: "No tour is open here, so there is nothing to show. Open the tour's link again.",
        look: "plain",
      },
    },
  },
  unfinished: {
    text: "This tour is not finished yet.",
    route: {
      ...NONE,
      coach: { text: "This tour is not finished yet.", look: "plain" },
    },
  },
  nothing: {
    text: "This tour has no printed codes, and without location nothing can place it.",
    route: {
      ...NONE,
      coach: {
        text: "This tour has no printed codes, and without location nothing can place it.",
        look: "plain",
      },
    },
  },
  // The scan card carries the code situations before placement (S1, kept).
  scan: {
    text: "Point your phone at the tour's code (on the poster).",
    scanShown: true,
    route: { ...NONE, scanCard: "scan" },
  },
  "measuring-code": {
    text: "Hold steady - the code is being measured.",
    scanShown: true,
    route: { ...NONE, scanCard: "scan" },
  },
  "code-other-tour": {
    text: "This code isn't part of this tour. Point your phone at the tour's own code.",
    scanShown: true,
    route: { ...NONE, scanCard: "scan" },
  },
  "code-unusable": {
    text: "This code can't line up the tour. Point your phone at another of the tour's codes.",
    scanShown: true,
    route: { ...NONE, scanCard: "scan" },
  },
  locking: {
    text: "Code found - placing the tour…",
    route: { ...NONE, scanCard: "found" },
  },
  // The coaching states.
  "warming-up": {
    text: "Move the phone slowly so it can see the surroundings.",
    route: {
      ...NONE,
      coach: {
        text: "Move the phone slowly so it can see the surroundings.",
        look: "sway",
      },
    },
  },
  "tracking-lost": {
    text: "Tracking lost - slowly look around to let it recover.",
    route: {
      ...NONE,
      coach: {
        text: "Tracking lost - slowly look around to let it recover.",
        look: "sway",
      },
    },
  },
  placing: {
    text: "Placing the tour…",
    route: { ...NONE, coach: { text: "Placing the tour…", look: "spinner" } },
  },
  "finding-direction": {
    text: WALK,
    route: { ...NONE, coach: { text: WALK, look: "plain" } },
  },
  // News, said once.
  "code-moved": {
    text: "This code seems to have been moved, so the tour is placed by GPS (less exact).",
    route: {
      ...NONE,
      toasts: [
        "This code seems to have been moved, so the tour is placed by GPS (less exact).",
      ],
    },
  },
  "placed-gps": {
    text: `${GPS_PLACED}. Look around.`,
    route: { ...NONE, toasts: [GPS_PLACED] },
  },
  // The peek and the radar say where to go: not shown in AR.
  placed: { text: "Tour placed. Look around.", route: NONE },
  "to-station": { text: "Walk to a station to see its content.", route: NONE },
  // The peek's tail carries the one thing that helps.
  "needs-code": {
    text: `Tour placed. ${FIND_CODE}`,
    route: { ...NONE, codeTail: true },
  },
};

describe("walkStatusRouting (§1.4)", () => {
  it("routes every state the sentence has", () => {
    expect(Object.keys(ROUTES).sort()).toEqual(
      [...VISITOR_STATUS_STATES].sort(),
    );
    for (const state of VISITOR_STATUS_STATES) {
      const { text, scanShown, route } = ROUTES[state];
      expect(
        walkStatusRouting(parts(state, text), scanShown ?? false),
        state,
      ).toEqual(route);
    }
  });

  it("while the scan card shows, it carries whatever the sentence says (kept)", () => {
    for (const state of VISITOR_STATUS_STATES) {
      expect(
        walkStatusRouting(parts(state, "Any sentence."), true).scanCard,
        state,
      ).toBe("scan");
      expect(
        walkStatusRouting(parts(state, "Any sentence."), true).coach,
      ).toBeNull();
    }
  });

  it("a code situation without the scan card (no gate) goes to the coach", () => {
    expect(
      walkStatusRouting(
        parts("code-other-tour", "This code isn't part of this tour."),
        false,
      ),
    ).toEqual({
      ...NONE,
      coach: { text: "This code isn't part of this tour.", look: "plain" },
    });
  });

  it("the walk request rides the coach, the code request the peek's tail", () => {
    expect(
      walkStatusRouting(
        parts("finding-direction", `${WALK} ${FIND_CODE}`),
        false,
      ),
    ).toEqual({
      ...NONE,
      coach: { text: WALK, look: "plain" },
      codeTail: true,
    });
    expect(
      walkStatusRouting(
        parts("placed", `Tour placed. Look around. ${FIND_CODE}`),
        false,
      ),
    ).toEqual({ ...NONE, codeTail: true });
    expect(
      walkStatusRouting(
        parts(
          "to-station",
          `Walk to a station to see its content. ${FIND_CODE}`,
        ),
        false,
      ),
    ).toEqual({ ...NONE, codeTail: true });
  });

  it("a GPS placement: its reason as a toast, the walk request in the coach, the code in the tail", () => {
    expect(
      walkStatusRouting(
        parts("placed-gps", `${GPS_PLACED}. ${WALK} ${FIND_CODE}`),
        false,
      ),
    ).toEqual({
      coach: { text: WALK, look: "plain" },
      scanCard: null,
      toasts: [GPS_PLACED],
      codeTail: true,
    });
    expect(
      walkStatusRouting(
        parts(
          "placed-gps",
          `${GPS_PLACED}: this browser can't read codes. Walk to a station to see its content.`,
        ),
        false,
      ).toasts,
    ).toEqual([`${GPS_PLACED}: this browser can't read codes`]);
  });

  it("placing waits with the spinner, the walk request kept after it", () => {
    expect(
      walkStatusRouting(parts("placing", `Placing the tour… ${WALK}`), false)
        .coach,
    ).toEqual({ text: `Placing the tour… ${WALK}`, look: "spinner" });
  });

  it("what could not load is news: a toast each, whatever the state", () => {
    const notes = [
      "2 items could not load.",
      "Some of the tour's content could not load.",
    ];
    expect(
      walkStatusRouting(
        parts("placed", "Tour placed. Look around.", notes),
        false,
      ),
    ).toEqual({ ...NONE, toasts: notes });
    expect(
      walkStatusRouting(
        parts("placed-gps", `${GPS_PLACED}. Look around.`, notes),
        false,
      ).toasts,
    ).toEqual([GPS_PLACED, ...notes]);
  });

  // Why: a tour whose stations hold only stories places no content, so
  // the sentence stays at "placing" / "Code found - placing the tour…"
  // while the guide already walks the visitor (found in the M2
  // side-by-side: the found card stood over the walk for good). Once the
  // sheet shows, the walk is what happens; the wait gives way to it.
});
