/**
 * Why these tests matter (UI round 1, U1; usability review F1, F15): the
 * visitor's only feedback in AR is one line. It used to be a debug readout
 * ("Visitor mode - AR running · 412 camera frames · Relocalizing - 2 of 3
 * vote batches. Pose error 1.3 px."). Each state a visitor can be in must
 * now read as ONE plain sentence with no counters, and every state that
 * exists must still be told apart (the cold review's G-1 list), because a
 * silent or wrong line is how a visitor gets lost. The `state` name is the
 * stable channel tests and the page read instead of the wording.
 */
import { describe, expect, it } from "vitest";

import type { ArStatusInput } from "./tour-flow";
import { visitorStatus } from "./visitor-status";

function input(overrides: Partial<ArStatusInput> = {}): ArStatusInput {
  return {
    mode: "visitor",
    arStatus: "running",
    cameraFrames: 412,
    tour: { kind: "open", levelCount: 1 },
    qr: {
      status: "scanning",
      unknownCode: null,
      unusableCode: null,
      votedLocks: 0,
      lockedText: null,
      reprojectionErrorPx: null,
    },
    readiness: null,
    placement: { kind: "idle" },
    contentError: null,
    gate: { kind: "scanning", escapeOffered: false },
    content: { kind: "none" },
    ...overrides,
  };
}

const qr = (o: Partial<ArStatusInput["qr"]>) => ({ ...input().qr, ...o });

/** A code's votes lining the tour up, as they do once the gate passed on
 *  it (until a frame change ends its trust, tested at the end). */
const LINED_UP = {
  status: "tracking",
  lockedText: "c",
  votedLocks: 3,
} as const;

describe("visitorStatus - one plain sentence per state", () => {
  it.each<[string, Partial<ArStatusInput>, string, string]>([
    [
      "checking AR support",
      { arStatus: "checking" },
      "checking",
      "Checking whether this phone can show the tour in AR…",
    ],
    ["starting AR", { arStatus: "starting" }, "starting", "Starting AR…"],
    [
      "an unsupported phone",
      { arStatus: "unsupported" },
      "unsupported",
      "This tour needs an Android phone with Chrome, and this phone or browser can't show it in AR. Copy the link and open it in Chrome on an Android phone.",
    ],
    [
      "AR failed to start",
      { arStatus: "error" },
      "error",
      "AR could not start. Tap Try again.",
    ],
    ["ready, before AR", { arStatus: "ready" }, "before-ar", ""],
    [
      "scanning for the code",
      {},
      "scan",
      "Point your phone at the tour's code (on the poster).",
    ],
    [
      "scanning, the GPS escape offered",
      { gate: { kind: "scanning", escapeOffered: true } },
      "scan",
      "Point your phone at the tour's code (on the poster), or tap Continue with GPS only below.",
    ],
    [
      "the code in view, its position still being measured",
      {
        qr: qr({
          status: "tracking",
          fusedHint: "Measuring the code: keep moving slowly, still measuring.",
        }),
      },
      "measuring-code",
      "Measuring the code: keep moving slowly, still measuring.",
    ],
    [
      "a code of another tour",
      { qr: qr({ unknownCode: "https://example.test/other" }) },
      "code-other-tour",
      "This code isn't part of this tour. Point your phone at the tour's own code.",
    ],
    [
      "a code that cannot line up the tour",
      { qr: qr({ unusableCode: "https://example.test/t" }) },
      "code-unusable",
      "This code can't line up the tour. Point your phone at another of the tour's codes.",
    ],
    [
      "a code the moved-code check ignores",
      {
        qr: qr({ ignoredCode: "https://example.test/t" }),
        gate: { kind: "passed", via: "ignored" },
      },
      "code-moved",
      "This code seems to have been moved, so the tour is placed by GPS (less exact).",
    ],
    [
      "the code found, the tour not placed yet",
      {
        gate: { kind: "passed", via: "code" },
        qr: qr({ status: "tracking", lockedText: "t", votedLocks: 1 }),
      },
      "locking",
      "Code found - placing the tour…",
    ],
    [
      "waiting for tracking, the framework's hint",
      {
        gate: { kind: "passed", via: "code" },
        placement: { kind: "waiting-ready" },
        readiness: {
          phase: "walk",
          hint: "Walk a few steps so the phone finds its bearings.",
        } as never,
      },
      "warming-up",
      "Walk a few steps so the phone finds its bearings.",
    ],
    // (A row "placed through the code" stood here with the walk's recorded
    // photos placed; a visitor no longer sees them, so a placed tour is its
    // content placed - the next row.)
    [
      "placed through the code",
      {
        gate: { kind: "passed", via: "code" },
        qr: qr(LINED_UP),
        content: { kind: "placed", count: 4, skipped: 0 },
      },
      "placed",
      "Tour placed. Look around.",
    ],
    [
      "placed by GPS after the escape",
      {
        gate: { kind: "passed", via: "skipped" },
        content: { kind: "placed", count: 3, skipped: 0 },
      },
      "placed-gps",
      "Tour placed by GPS (less exact). Look around. Find the poster's code to line it up.",
    ],
    [
      "a browser without a code reader",
      {
        gate: { kind: "not-required", reason: "no-detector" },
        content: { kind: "placed", count: 2, skipped: 0 },
      },
      "placed-gps",
      "Tour placed by GPS (less exact): this browser can't read codes. Look around.",
    ],
    [
      "the tour's code file unreadable",
      {
        gate: { kind: "not-required", reason: "levels-unavailable" },
        placement: { kind: "idle" },
      },
      "placing",
      "Placing the tour by GPS (less exact)…",
    ],
  ])("%s", (_name, overrides, state, text) => {
    expect(visitorStatus(input(overrides))).toEqual({ state, text });
  });
});

describe("visitorStatus - why AR did not start, in plain words (review F5)", () => {
  it.each<[string, string, string]>([
    [
      "a blocked camera or AR permission",
      "NotAllowedError",
      "Camera access was blocked. Allow the camera for this site in the browser settings, then tap Try again.",
    ],
    [
      "a session the browser refuses",
      "NotSupportedError: The specified session configuration is not supported.",
      "This phone can't start AR for this tour, which needs an Android phone with Chrome. Open this page there.",
    ],
    [
      "anything else",
      "world group missing",
      "AR could not start. Tap Try again.",
    ],
  ])("%s", (_name, error, text) => {
    expect(visitorStatus(input({ arStatus: "error", arError: error }))).toEqual(
      {
        state: "error",
        text,
      },
    );
  });
});

describe("visitorStatus - states the first version got wrong (U1 milestone review)", () => {
  // Why: the review drove the reachable states the example table missed,
  // and each one below read a stuck or misleading sentence.
  // (Two tests of review #2 stood here: a declined photo join with no
  // usable code, and after the escape, as dead ends. They went with the
  // walk's recorded photos, which a visitor no longer sees: the
  // placement has no declined state.)

  it("a stray code does not take over a placed tour (#3)", () => {
    expect(
      visitorStatus(
        input({
          gate: { kind: "passed", via: "code" },
          qr: qr({ ...LINED_UP, unknownCode: "https://shop.example/product" }),
          content: { kind: "placed", count: 3, skipped: 0 },
        }),
      ),
    ).toEqual({ state: "placed", text: "Tour placed. Look around." });
  });

  it("the unusable-code sentence mentions the GPS escape only while it is offered (#3)", () => {
    expect(
      visitorStatus(
        input({
          gate: { kind: "scanning", escapeOffered: true },
          qr: qr({ unusableCode: "https://example.test/t" }),
        }),
      ).text,
    ).toBe(
      "This code can't line up the tour. Point your phone at another of the tour's codes, or tap Continue with GPS only below.",
    );
  });

  it("after the escape, a code that then locked lined the tour up: no more 'find the code' (#4)", () => {
    expect(
      visitorStatus(
        input({
          gate: { kind: "passed", via: "skipped" },
          qr: qr({ status: "tracking", lockedText: "t", votedLocks: 2 }),
          content: { kind: "placed", count: 3, skipped: 0 },
        }),
      ),
    ).toEqual({ state: "placed", text: "Tour placed. Look around." });
  });

  it.each<[string, ArStatusInput["gate"], string]>([
    [
      "the code file unreadable",
      { kind: "not-required", reason: "levels-unavailable" },
      "Tour placed by GPS (less exact). Look around.",
    ],
    [
      "the code seems moved",
      { kind: "passed", via: "ignored" },
      "Tour placed by GPS (less exact): its code seems to have been moved. Look around.",
    ],
  ])(
    "placed by GPS because %s: no 'find the code' that cannot help (#4)",
    (_n, gate, text) => {
      expect(
        visitorStatus(
          input({ gate, content: { kind: "placed", count: 2, skipped: 0 } }),
        ),
      ).toEqual({ state: "placed-gps", text });
    },
  );

  it("the framework's location refusal reads as location, not camera (#5)", () => {
    expect(
      visitorStatus(
        input({
          arStatus: "error",
          arError: "Location permission is required for GPS AR.",
        }),
      ),
    ).toEqual({
      state: "error",
      text: "Location access was blocked. Allow location for this site in the browser settings, then tap Try again.",
    });
  });

  it("an unfinished tour says so, with whom to ask, whatever else the line knows", () => {
    // Why: the printed code may point at the hosted file before its first
    // Finish; a visitor in AR must not be told to scan or wait for a tour
    // that has nothing to show yet.
    expect(
      visitorStatus(
        input({
          tour: {
            kind: "open",
            levelCount: 0,
            unfinished: { contact: "mailto:guide@example.org" },
          },
          gate: { kind: "not-required", reason: "no-lockable-level" },
        }),
      ),
    ).toEqual({
      state: "unfinished",
      text: "This tour is not finished yet. Questions about this tour? Contact its maker: guide@example.org",
    });
    expect(
      visitorStatus(
        input({
          tour: {
            kind: "open",
            levelCount: 1,
            unfinished: { contact: undefined },
          },
        }),
      ),
    ).toEqual({ state: "unfinished", text: "This tour is not finished yet." });
  });

  it("AR with no tour open says so (#6)", () => {
    expect(visitorStatus(input({ tour: { kind: "none" } }))).toEqual({
      state: "no-tour",
      text: "No tour is open here, so there is nothing to show. Open the tour's link again.",
    });
  });

  it("tracking lost after placing reads the framework's hint, not 'Look around' (#7)", () => {
    expect(
      visitorStatus(
        input({
          gate: { kind: "passed", via: "code" },
          content: { kind: "placed", count: 3, skipped: 0 },
          readiness: {
            phase: "ar-lost",
            hint: "Tracking lost - move slowly.",
          } as never,
        }),
      ),
    ).toEqual({ state: "tracking-lost", text: "Tracking lost - move slowly." });
  });
});

describe("visitorStatus - what must never reach a visitor", () => {
  it("no counters, mode prefix or debug numbers in any running state", () => {
    const states: Partial<ArStatusInput>[] = [
      {},
      {
        gate: { kind: "passed", via: "code" },
        qr: qr({
          status: "tracking",
          lockedText: "t",
          votedLocks: 2,
          reprojectionErrorPx: 1.3,
        }),
        content: { kind: "placed", count: 12, skipped: 0 },
      },
    ];
    for (const s of states) {
      const { text } = visitorStatus(input(s));
      expect(text).not.toMatch(
        /Visitor mode|camera frames|vote batch|px|fixes|±/,
      );
    }
  });

  it("never tells a visitor who walked on to scan the code again (the hold ended)", () => {
    const { text, state } = visitorStatus(
      input({
        gate: { kind: "passed", via: "code" },
        qr: qr({
          status: "tracking",
          lockedText: "t",
          votedLocks: 10,
          hold: { kind: "ended", text: "t" } as never,
        }),
        content: { kind: "placed", count: 3, skipped: 0 },
      }),
    );
    expect(state).toBe("placed");
    expect(text).not.toMatch(/scan the code again/i);
  });

  it("says what could not load, after the state's sentence", () => {
    expect(
      visitorStatus(
        input({
          gate: { kind: "passed", via: "code" },
          qr: qr(LINED_UP),
          content: { kind: "placed", count: 4, skipped: 2 },
          contentError: "HTTP 404",
        }),
      ),
    ).toEqual({
      state: "placed",
      // (It said "Some photos could not load." for the walk's photos, which
      // a visitor no longer sees; the content's own failure is said here.)
      text: "Tour placed. Look around. 2 items could not load. Some of the tour's content could not load.",
    });
  });
});

// Why (QR-first plan 2026-10-14-0445 §7 #10, M1b-1): a visitor who declined
// location runs the tour on codes alone. Every line must say what that
// needs and never claim GPS: no "Continue with GPS only" (there is none),
// no "placed by GPS", and a browser that cannot read codes has nothing at
// all to place the tour with.
describe("visitorStatus - codes only, no location (QR-first M1b-1)", () => {
  it("asks for a code and offers no GPS while scanning", () => {
    expect(visitorStatus(input({ codesOnly: true }))).toEqual({
      state: "scan",
      // Under the scan card's title ("Scan the code again so the tour can
      // start"): what location's absence means, not a second "scan".
      text: "Without location, the tour's printed codes place it - any of them will do.",
    });
    // Even if an escape were offered, it is not named.
    expect(
      visitorStatus(
        input({
          codesOnly: true,
          gate: { kind: "scanning", escapeOffered: true },
        }),
      ).text,
    ).not.toMatch(/GPS only/);
  });

  it("says nothing can place the tour when the browser cannot read codes", () => {
    const status = visitorStatus(
      input({
        codesOnly: true,
        gate: { kind: "not-required", reason: "no-detector" },
        content: { kind: "placed", count: 3, skipped: 0 },
      }),
    );
    expect(status.state).toBe("nothing");
    expect(status.text).toBe(
      "This browser can't read the tour's codes, and without location nothing can place the tour.",
    );
    expect(status.text).not.toMatch(/placed by GPS/i);
  });

  it("reads 'placed' after a code places the tour, never 'by GPS'", () => {
    const status = visitorStatus(
      input({
        codesOnly: true,
        gate: { kind: "passed", via: "code" },
        qr: qr({ lockedText: "c", votedLocks: 10 }),
        content: { kind: "placed", count: 2, skipped: 0 } as never,
      }),
    );
    expect(status.state).toBe("placed");
  });
});

// Why (M1b-1 review #2): codes only on a tour whose codes cannot place it
// (none lockable, or the code file unreadable) hung on a coaching line
// forever - the gate waives the scan, and nothing else can place the tour.
describe("visitorStatus - codes only, and no code can place the tour (M1b-1 review #2)", () => {
  it.each([
    [
      "no-lockable-level" as const,
      "This tour has no printed codes, and without location nothing can place it.",
    ],
    [
      "levels-unavailable" as const,
      "The tour's code file could not be read, and without location nothing can place it.",
    ],
  ])("%s", (reason, text) => {
    const status = visitorStatus(
      input({
        codesOnly: true,
        gate: { kind: "not-required", reason },
        placement: { kind: "waiting-ready" },
      }),
    );
    expect(status).toEqual({ state: "nothing", text });
  });
});

// Why (D34 of the tour editor plan 2026-10-17-1816): until the AR entry has
// a heading the guide's arrows, breadcrumbs and a story's figure wait. A
// visitor who never walks never gets one, so the line must say what earns
// it - and go once a heading exists. It replaces only the bare "placed"
// line: every other sentence keeps its reason (a moved code, the GPS
// escape's "find the code") with the request after it. It is never said
// while tracking still initializes (the coaching says hold steady), nor
// without location, where walking cannot earn a heading.
describe("visitorStatus - away from every station", () => {
  // Why: content drawn per station leaves nothing in view between the
  // stations; "Tour placed. Look around." then sends the visitor looking
  // for nothing. The line says what to do instead, and keeps a GPS
  // placement's reason.
  const TO_STATION = "Walk to a station to see its content.";
  const placedAway = {
    gate: { kind: "passed", via: "code" } as const,
    qr: qr(LINED_UP),
    // (The walk's recorded photos placed, once; a visitor no longer sees
    // them, so a placed tour is its content placed.)
    content: { kind: "placed", count: 3, skipped: 0 } as const,
    awayFromStations: true,
  };

  it("a tour placed by its code asks for a station", () => {
    expect(visitorStatus(input(placedAway))).toEqual({
      state: "to-station",
      text: TO_STATION,
    });
  });

  it("is the placed line again at a station", () => {
    expect(
      visitorStatus(input({ ...placedAway, awayFromStations: false })),
    ).toEqual({ state: "placed", text: "Tour placed. Look around." });
  });

  it("a GPS placement keeps its reason, the station request in place of Look around", () => {
    expect(
      visitorStatus(
        input({
          ...placedAway,
          gate: { kind: "passed", via: "skipped" },
          qr: input().qr,
        }),
      ),
    ).toEqual({
      state: "placed-gps",
      text: `Tour placed by GPS (less exact). ${TO_STATION} Find the poster's code to line it up.`,
    });
  });

  it("the request for a few steps comes first (walking answers both)", () => {
    expect(
      visitorStatus(
        input({
          ...placedAway,
          stationsAwaitHeading: true,
          readiness: {
            phase: "move-around",
            percentReady: 0.4,
            hint: "Move the phone slowly.",
          } as never,
        }),
      ),
    ).toEqual({
      state: "finding-direction",
      text: "Walk a few steps so the guide knows the direction.",
    });
  });
});

describe("visitorStatus - the guide waits for a heading (D34)", () => {
  const WALK = "Walk a few steps so the guide knows the direction.";
  const tracking = {
    phase: "move-around",
    percentReady: 0.4,
    hint: "Move the phone slowly.",
  } as never;
  const initializing = {
    phase: "initializing",
    percentReady: 0,
    hint: "Hold the phone steady.",
  } as never;
  const lost = {
    phase: "ar-lost",
    percentReady: 0,
    hint: "Tracking lost - move slowly.",
  } as never;
  const content = { kind: "placed", count: 3, skipped: 0 } as const;
  const placedByCode = {
    gate: { kind: "passed", via: "code" } as const,
    qr: qr(LINED_UP),
    content,
    readiness: tracking,
  };

  it("replaces the placed line, which comes back once a heading exists", () => {
    expect(
      visitorStatus(input({ ...placedByCode, stationsAwaitHeading: true })),
    ).toEqual({ state: "finding-direction", text: WALK });
    expect(
      visitorStatus(input({ ...placedByCode, stationsAwaitHeading: false })),
    ).toEqual({ state: "placed", text: "Tour placed. Look around." });
  });

  it.each<[string, ArStatusInput["gate"], string]>([
    [
      "the GPS escape",
      { kind: "passed", via: "skipped" },
      `Tour placed by GPS (less exact). ${WALK} Find the poster's code to line it up.`,
    ],
    [
      "a moved code",
      { kind: "passed", via: "ignored" },
      `Tour placed by GPS (less exact): its code seems to have been moved. ${WALK}`,
    ],
    [
      "no code reader",
      { kind: "not-required", reason: "no-detector" },
      `Tour placed by GPS (less exact): this browser can't read codes. ${WALK}`,
    ],
  ])(
    "placed by GPS after %s: the reason stays, the request follows",
    (_, gate, text) => {
      expect(
        visitorStatus(
          input({
            gate,
            content,
            readiness: tracking,
            stationsAwaitHeading: true,
          }),
        ),
      ).toEqual({ state: "placed-gps", text });
    },
  );

  it("follows the sentence before placement too, keeping what could not load", () => {
    expect(
      visitorStatus(
        input({
          gate: { kind: "passed", via: "code" },
          placement: { kind: "waiting-ready" },
          readiness: tracking,
          contentError: "boom",
          stationsAwaitHeading: true,
        }),
      ),
    ).toEqual({
      state: "warming-up",
      // (It said "Some photos could not load." for the walk's photos, which
      // a visitor no longer sees; the content's own failure is said here.)
      text: `Move the phone slowly. ${WALK} Some of the tour's content could not load.`,
    });
  });

  it("keeps the moved code's sentence before placement, the request after it", () => {
    expect(
      visitorStatus(
        input({
          gate: { kind: "passed", via: "ignored" },
          qr: qr({ ignoredCode: "https://example.test/moved" }),
          readiness: tracking,
          stationsAwaitHeading: true,
        }),
      ),
    ).toEqual({
      state: "code-moved",
      text: `This code seems to have been moved, so the tour is placed by GPS (less exact). ${WALK}`,
    });
  });

  it("is never said while tracking initializes: the coaching's hold steady stays", () => {
    expect(
      visitorStatus(
        input({
          ...placedByCode,
          readiness: initializing,
          stationsAwaitHeading: true,
        }),
      ).state,
    ).toBe("placed");
    expect(
      visitorStatus(
        input({
          gate: { kind: "passed", via: "code" },
          placement: { kind: "waiting-ready" },
          readiness: initializing,
          stationsAwaitHeading: true,
        }),
      ),
    ).toEqual({ state: "warming-up", text: "Hold the phone steady." });
  });

  it("is never said without location: only a code gives a heading there (after a veto too)", () => {
    expect(
      visitorStatus(
        input({
          ...placedByCode,
          codesOnly: true,
          stationsAwaitHeading: true,
        }),
      ),
    ).toEqual({ state: "placed", text: "Tour placed. Look around." });
    const vetoed = visitorStatus(
      input({
        gate: { kind: "passed", via: "ignored" },
        qr: qr({ ignoredCode: "https://example.test/moved" }),
        readiness: tracking,
        codesOnly: true,
        stationsAwaitHeading: true,
      }),
    );
    expect(vetoed.text).not.toContain(WALK);
  });

  it("yields to a code that needs pointing elsewhere, and to tracking lost", () => {
    expect(
      visitorStatus(
        input({
          gate: { kind: "passed", via: "code" },
          qr: qr({ unknownCode: "https://example.test/other" }),
          readiness: tracking,
          stationsAwaitHeading: true,
        }),
      ).state,
    ).toBe("code-other-tour");
    expect(
      visitorStatus(
        input({ ...placedByCode, readiness: lost, stationsAwaitHeading: true }),
      ).state,
    ).toBe("tracking-lost");
    expect(
      visitorStatus(
        input({
          gate: { kind: "passed", via: "code" },
          placement: { kind: "waiting-ready" },
          readiness: lost,
          stationsAwaitHeading: true,
        }),
      ),
    ).toEqual({ state: "warming-up", text: "Tracking lost - move slowly." });
  });

  // Why: walking earns a heading for a guide that has something to show;
  // at a dead end it sends the visitor walking for nothing. (The two dead
  // ends of a declined photo join pinned here went with the walk's
  // recorded photos; the one left is a codes-only session that cannot
  // read codes.)
  it("is not added to a dead end: nothing can place the tour", () => {
    expect(
      visitorStatus(
        input({
          codesOnly: true,
          gate: { kind: "not-required", reason: "no-detector" },
          readiness: tracking,
          stationsAwaitHeading: true,
        }),
      ),
    ).toEqual({
      state: "nothing",
      text: "This browser can't read the tour's codes, and without location nothing can place the tour.",
    });
  });

  it("is never said before AR runs or without a tour", () => {
    expect(
      visitorStatus(
        input({
          arStatus: "starting",
          readiness: tracking,
          stationsAwaitHeading: true,
        }),
      ).state,
    ).toBe("starting");
    expect(
      visitorStatus(
        input({
          tour: { kind: "none" },
          readiness: tracking,
          stationsAwaitHeading: true,
        }),
      ).state,
    ).toBe("no-tour");
  });
});

// Why: a code's trust ends on an odometry-frame change - its votes name
// places in the old frame - while the gate stays passed on the code. The
// line kept saying "Tour placed. Look around." and never asked for the
// code, the one thing that lines the tour up again.
describe("visitorStatus - a code's trust ended (an odometry-frame change)", () => {
  const RESCAN = "Find the poster's code to line it up.";
  const ended = {
    gate: { kind: "passed", via: "code" } as const,
    // The gate passed on the code; the frame change reset its count.
    qr: qr({ status: "tracking", lockedText: null, votedLocks: 0 }),
    // (The walk's recorded photos placed, once; a visitor no longer sees
    // them, so a placed tour is its content placed.)
    content: { kind: "placed", count: 3, skipped: 0 } as const,
  };

  it("asks for the code after the placed line", () => {
    expect(visitorStatus(input(ended))).toEqual({
      state: "placed",
      text: `Tour placed. Look around. ${RESCAN}`,
    });
  });

  it("asks for the code after the station request and the request for steps", () => {
    expect(visitorStatus(input({ ...ended, awayFromStations: true }))).toEqual({
      state: "to-station",
      text: `Walk to a station to see its content. ${RESCAN}`,
    });
    expect(
      visitorStatus(
        input({
          ...ended,
          stationsAwaitHeading: true,
          readiness: {
            phase: "move-around",
            percentReady: 0.4,
            hint: "Move the phone slowly.",
          } as never,
        }),
      ),
    ).toEqual({
      state: "finding-direction",
      text: `Walk a few steps so the guide knows the direction. ${RESCAN}`,
    });
  });

  it("is the placed line again once the code's next lock lines the tour up", () => {
    expect(
      visitorStatus(
        input({ ...ended, qr: qr({ lockedText: "c", votedLocks: 3 }) }),
      ),
    ).toEqual({ state: "placed", text: "Tour placed. Look around." });
  });

  // Why: without location only a code judges presence, so once its trust
  // ends the present station is cleared (`station-guide.ts`) while the
  // visitor still stands there. "Walk to a station" then sends them away
  // from where they are, and no walk can help: the code is the only cure.
  it("without location asks for the code alone, never to walk to a station", () => {
    expect(
      visitorStatus(
        input({ ...ended, codesOnly: true, awayFromStations: true }),
      ),
    ).toEqual({ state: "needs-code", text: `Tour placed. ${RESCAN}` });
    expect(visitorStatus(input({ ...ended, codesOnly: true }))).toEqual({
      state: "placed",
      text: `Tour placed. Look around. ${RESCAN}`,
    });
  });
});
