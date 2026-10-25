import { describe, expect, it } from "vitest";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";

import type { GuideView } from "./station-guide";
import {
  applyWalkStep,
  startWalk,
  walkRoute,
  type WalkProgress,
  type WalkStep,
} from "./station-run";
import {
  awayModel,
  walkHasProgress,
  walkSheetModel,
  WALK_SEGMENT_LIMIT,
  type WalkSheetInput,
} from "./walk-sheet-model";

/**
 * Why these tests matter: the sheet is what the visitor reads of the walk
 * in AR - the peek's eyebrow, title, distance and tail split today's
 * station line, the list a row per station, the completion card, and the
 * away block on the start page. Each text and each state is the prototype's or
 * today's; a wrong one is a wrong instruction in front
 * of the visitor, so every state of the peek and of a row is pinned here.
 */

const step = {
  id: "s",
  block: { kind: "text", text: "Hi" },
  advance: { mode: "tap" },
} as const;

function station(id: string, title: string): TourStation {
  return {
    id,
    title,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
    activateRadiusM: 30,
    foundRadiusM: 10,
    hint: "arrow",
    steps: [step],
    items: [],
  };
}

const TOUR = [
  station("gate", "The gate"),
  station("well", "The well"),
  station("tower", "The tower"),
  station("garden", "The garden"),
];

function walk(order: TourOrder, steps: WalkStep[] = []): WalkProgress {
  return steps.reduce(
    (p, s) => applyWalkStep(p, s).progress,
    startWalk(walkRoute(TOUR), order),
  );
}

const done = (id: string): WalkStep[] => [
  { kind: "found", id },
  { kind: "finish", id },
];

function view(over: Partial<GuideView> = {}): GuideView {
  return {
    focusId: "well",
    position: "distance",
    precision: "gps",
    accuracyM: null,
    bearings: new Map(),
    headingDeg: null,
    snapshot: null,
    distances: new Map([
      ["gate", 30],
      ["well", 46.4],
      ["tower", 120],
      ["garden", 190],
    ]),
    quick: { kind: "ask-skip", id: "well" },
    end: null,
    chosenId: null,
    canChoose: true,
    rowArmedId: null,
    noGuess: false,
    chooser: false,
    undo: null,
    note: null,
    trackingLost: false,
    ...over,
  };
}

function input(over: Partial<WalkSheetInput> = {}): WalkSheetInput {
  return {
    stations: TOUR,
    order: "any",
    tourTitle: "Old town walk",
    progress: walk("any", done("gate")),
    view: view(),
    story: null,
    sheet: "peek",
    ...over,
  };
}

describe("the peek", () => {
  it("any order, several offered: 'N stations to find - nearest', the title and the distance", () => {
    const m = walkSheetModel(input());
    expect(m.peek).toEqual({
      kind: "walk",
      eyebrow: "3 stations to find - nearest",
      title: "The well",
      distance: "46 m",
      arrowDeg: null,
      tail: "",
    });
  });

  it("fixed order: 'Next - station N of M'", () => {
    const m = walkSheetModel(
      input({ order: "fixed", progress: walk("fixed", done("gate")) }),
    );
    expect(m.peek.eyebrow).toBe("Next - station 2 of 4");
    expect(m.peek.title).toBe("The well");
  });

  it("one offered (any order, the last one left): 'Next'", () => {
    const m = walkSheetModel(
      input({
        progress: walk("any", [
          ...done("gate"),
          ...done("well"),
          ...done("tower"),
        ]),
        view: view({ focusId: "garden" }),
      }),
    );
    expect(m.peek.eyebrow).toBe("Next");
    expect(m.peek.title).toBe("The garden");
  });

  it("branch order: 'Next', its one station", () => {
    const m = walkSheetModel(
      input({ order: "branch", progress: walk("branch", done("gate")) }),
    );
    expect(m.peek.eyebrow).toBe("Next");
  });

  it("no distance: the tail says why, today's words, and no distance shows", () => {
    expect(
      walkSheetModel(input({ view: view({ position: "pending" }) })).peek,
    ).toMatchObject({ distance: null, tail: "Waiting for your position…" });
    expect(
      walkSheetModel(input({ view: view({ position: "weak", accuracyM: 40 }) }))
        .peek,
    ).toMatchObject({
      distance: null,
      tail: "GPS too weak to guide you (±40 m); step into the open.",
    });
  });

  it("nothing vouches for the position, several offered: no station named ('Position unknown')", () => {
    const m = walkSheetModel(
      input({
        view: view({
          position: "none",
          precision: "none",
          focusId: null,
          noGuess: true,
        }),
      }),
    );
    expect(m.peek).toEqual({
      kind: "none",
      eyebrow: "Position unknown",
      title: "3 stations to find",
      distance: null,
      arrowDeg: null,
      tail: "Scan one of the tour's codes so the guide knows where you are.",
    });
  });

  it("nothing vouches for the position, one offered: the station, the same ask", () => {
    const m = walkSheetModel(
      input({
        order: "fixed",
        progress: walk("fixed", done("gate")),
        view: view({ position: "none" }),
      }),
    );
    expect(m.peek).toMatchObject({
      eyebrow: "Next - station 2 of 4",
      title: "The well",
      tail: "Scan one of the tour's codes so the guide knows where you are.",
    });
  });

  // Why: "nearest" is a distance's ranking. With one station left to
  // find (a found one still offered beside it) and no distance, the peek
  // names it as the one left, as the guide's line does.
  it("one left to find and no distance: 'Next', never 'nearest'", () => {
    const oneLeft = walk("any", [
      ...done("gate"),
      { kind: "found", id: "well" },
      ...done("tower"),
    ]);
    const peek = (over: Partial<GuideView>) =>
      walkSheetModel(
        input({
          progress: oneLeft,
          view: view({ focusId: "garden", ...over }),
        }),
      ).peek.eyebrow;
    expect(peek({})).toBe("2 stations to find - nearest");
    expect(peek({ position: "none" })).toBe("Next");
    expect(peek({ position: "weak", precision: "weak", accuracyM: 40 })).toBe(
      "Next",
    );
    expect(peek({ position: "none", chosenId: "garden" })).toBe(
      "2 stations to find - your choice",
    );
  });

  it("a story playing with nothing unfound offered: 'Station found', its title", () => {
    const m = walkSheetModel(
      input({
        order: "fixed",
        progress: walk("fixed", [
          ...done("gate"),
          { kind: "found", id: "well" },
        ]),
        view: view({ focusId: null }),
        story: { stationId: "well" },
      }),
    );
    expect(m.peek).toEqual({
      kind: "story",
      eyebrow: "Station found",
      title: "The well",
      distance: null,
      arrowDeg: null,
      tail: "Its story is playing.",
    });
  });

  it("complete: the tour's title, 'Tour complete', the skipped count or every station", () => {
    const all = [
      ...done("gate"),
      ...done("well"),
      ...done("tower"),
      ...done("garden"),
    ];
    expect(
      walkSheetModel(
        input({ progress: walk("any", all), view: view({ focusId: null }) }),
      ).peek,
    ).toEqual({
      kind: "complete",
      eyebrow: "Old town walk",
      title: "Tour complete",
      distance: null,
      arrowDeg: null,
      tail: "Every station visited.",
    });
    const skipped = walk("any", [
      ...done("gate"),
      ...done("well"),
      { kind: "skip", id: "tower" },
      ...done("garden"),
    ]);
    expect(
      walkSheetModel(
        input({ progress: skipped, view: view({ focusId: null }) }),
      ).peek.tail,
    ).toBe("1 skipped.");
  });
});

describe("the story card's place", () => {
  it("takes the peek's place while a story plays, and gives it back with the list open", () => {
    const playing = input({
      progress: walk("any", [{ kind: "found", id: "gate" }]),
      story: { stationId: "gate" },
    });
    expect(walkSheetModel(playing).storyCard).toEqual({ title: "The gate" });
    expect(walkSheetModel({ ...playing, sheet: "list" }).storyCard).toBeNull();
    expect(walkSheetModel(input()).storyCard).toBeNull();
  });
});

describe("the segments and the rows", () => {
  it("one per station in tour order: found, here, skipped, next, left", () => {
    const m = walkSheetModel(
      input({
        progress: walk("any", [
          ...done("gate"),
          { kind: "skip", id: "tower" },
          { kind: "found", id: "garden" },
        ]),
      }),
    );
    expect(m.segments).toEqual({
      kind: "each",
      states: ["found", "next", "skipped", "here"],
    });
    expect(m.list.rows.map((r) => [r.number, r.title, r.state, r.sub])).toEqual(
      [
        [1, "The gate", "found", "Found"],
        [2, "The well", "next", "46 m"],
        [3, "The tower", "skipped", "Skipped"],
        [4, "The garden", "here", "You are here - its story is playing"],
      ],
    );
  });

  it("fixed order: the stations after the next are 'Later'", () => {
    const m = walkSheetModel(
      input({ order: "fixed", progress: walk("fixed", done("gate")) }),
    );
    expect(m.list.rows.map((r) => [r.state, r.sub])).toEqual([
      ["found", "Found"],
      ["next", "46 m"],
      ["later", "Later"],
      ["later", "Later"],
    ]);
  });

  it("a row's distance follows the position: unknown under none and too weak, waiting while pending", () => {
    const sub = (v: GuideView) =>
      walkSheetModel(input({ view: v })).list.rows[2]!.sub;
    expect(sub(view({ position: "none" }))).toBe("Distance unknown");
    expect(sub(view({ position: "weak", accuracyM: 40 }))).toBe(
      "Distance unknown",
    );
    expect(sub(view({ position: "pending" }))).toBe(
      "Waiting for your position…",
    );
    expect(sub(view({ distances: new Map() }))).toBe(
      "Waiting for your position…",
    );
  });

  it("branch order lists the stations offered so far and the current one only", () => {
    const m = walkSheetModel(
      input({ order: "branch", progress: walk("branch", done("gate")) }),
    );
    expect(m.list.rows.map((r) => r.id)).toEqual(["gate", "well"]);
    expect(m.segments).toEqual({ kind: "each", states: ["found", "next"] });
  });

  it(`above ${String(WALK_SEGMENT_LIMIT)} stations one continuous bar with the counts`, () => {
    const many = Array.from({ length: WALK_SEGMENT_LIMIT + 1 }, (_, i) =>
      station(`s${String(i)}`, `S ${String(i)}`),
    );
    const progress = [
      { kind: "found", id: "s0" },
      { kind: "finish", id: "s0" },
      { kind: "skip", id: "s1" },
    ].reduce(
      (p, s) => applyWalkStep(p, s as WalkStep).progress,
      startWalk(walkRoute(many), "any"),
    );
    const m = walkSheetModel(
      input({ stations: many, progress, view: view({ focusId: "s2" }) }),
    );
    expect(m.segments).toEqual({
      kind: "bar",
      found: 1,
      skipped: 1,
      toFind: WALK_SEGMENT_LIMIT - 1,
    });
    const atLimit = walkSheetModel(
      input({
        stations: many.slice(0, WALK_SEGMENT_LIMIT),
        progress: startWalk(
          walkRoute(many.slice(0, WALK_SEGMENT_LIMIT)),
          "any",
        ),
        view: view({ focusId: "s0" }),
      }),
    );
    expect(atLimit.segments.kind).toBe("each");
  });
});

describe("the direction words and arrows", () => {
  // Why: with a heading the peek says which way the focus is and the rows
  // which way each station is, in the one direction rule's words
  // (`walk-direction.ts`), with an arrow turned to the station; without a
  // heading only the distance ("N m"), and no arrow anywhere a distance is
  // not shown.
  const directions = new Map([
    ["well", { word: "right" as const, angleDeg: 61.6 }],
    ["tower", { word: "behind" as const, angleDeg: -170 }],
    ["garden", { word: "ahead" as const, angleDeg: 4 }],
  ]);

  it("the peek's tail says the focus's direction and its arrow turns to it", () => {
    const m = walkSheetModel(input({ directions }));
    expect(m.peek).toMatchObject({
      distance: "46 m",
      arrowDeg: 62,
      tail: "To your right.",
    });
  });

  it("rows: 'N m - <direction>' with an arrow; found and later rows have none", () => {
    const m = walkSheetModel(input({ directions }));
    expect(m.list.rows.map((r) => [r.id, r.sub, r.arrowDeg])).toEqual([
      ["gate", "Found", null],
      ["well", "46 m - to your right", 62],
      ["tower", "120 m - behind you", -170],
      ["garden", "190 m - ahead", 4],
    ]);
  });

  it("without a heading: the distance alone, no arrow", () => {
    const m = walkSheetModel(input());
    expect(m.peek).toMatchObject({ arrowDeg: null, tail: "" });
    expect(m.list.rows[2]).toMatchObject({ sub: "120 m", arrowDeg: null });
  });

  it("no direction where no distance is shown", () => {
    for (const position of ["weak", "none", "pending"] as const) {
      const m = walkSheetModel(
        input({ directions, view: view({ position, accuracyM: 40 }) }),
      );
      expect(m.peek.arrowDeg).toBeNull();
      expect(m.peek.tail).not.toMatch(/^(Ahead|To your|Behind)/);
      expect(m.list.rows.every((r) => r.arrowDeg === null)).toBe(true);
    }
  });
});

describe("the list's header and progress line", () => {
  it("the tour's title, the order chip and the grab's name", () => {
    expect(walkSheetModel(input()).list).toMatchObject({
      title: "Old town walk",
      chip: "Any order",
    });
    expect(walkSheetModel(input()).grabLabel).toBe("Show all stations");
    expect(walkSheetModel(input({ sheet: "list" })).grabLabel).toBe(
      "Hide the list",
    );
  });

  // Why this test matters: the order chip is only worth its space when it
  // tells the visitor something they act on. "Any order" does (they may
  // choose); "In order" and "Your path" told them nothing to do, and every
  // tour the editor makes reads as fixed, so the chip read "In order" on
  // every walk.
  it("the order chip only for 'any' order: none for fixed and branch", () => {
    expect(walkSheetModel(input({ order: "any" })).list.chip).toBe("Any order");
    expect(walkSheetModel(input({ order: "fixed" })).list.chip).toBeNull();
    expect(walkSheetModel(input({ order: "branch" })).list.chip).toBeNull();
  });

  it("'N of M found - K skipped - L to find', the zero parts left out", () => {
    expect(walkSheetModel(input()).list.progress).toEqual({
      lead: "1 of 4 found",
      rest: ["3 to find"],
    });
    const skipped = walk("any", [
      ...done("gate"),
      { kind: "skip", id: "tower" },
    ]);
    expect(walkSheetModel(input({ progress: skipped })).list.progress).toEqual({
      lead: "1 of 4 found",
      rest: ["1 skipped", "2 to find"],
    });
    expect(
      walkSheetModel(input({ progress: walk("any") })).list.progress,
    ).toEqual({ lead: "0 of 4 found", rest: ["4 to find"] });
  });

  it("branch order counts no 'of M' and no 'to find': the path decides how many", () => {
    expect(
      walkSheetModel(
        input({ order: "branch", progress: walk("branch", done("gate")) }),
      ).list.progress,
    ).toEqual({ lead: "1 found", rest: [] });
  });
});

describe("the completion card", () => {
  const all = [
    ...done("gate"),
    ...done("well"),
    ...done("tower"),
    ...done("garden"),
  ];
  it("none before the tour is complete", () => {
    expect(walkSheetModel(input()).list.completion).toBeNull();
  });

  it("today's line as its title, and the thanks", () => {
    expect(
      walkSheetModel(
        input({ progress: walk("any", all), view: view({ focusId: null }) }),
      ).list.completion,
    ).toEqual({
      title: "Tour complete - every station visited.",
      text: "Thank you for walking with us.",
    });
  });

  // A skipped station comes back at any time, so the card says so (the
  // prototype's words); before that rule it would have been false
  // once the 6 s undo had passed.
  it("with a station skipped: 'M of N found. A skipped station can still be brought back.'", () => {
    const skipped = walk("any", [
      ...done("gate"),
      ...done("well"),
      { kind: "skip", id: "tower" },
      ...done("garden"),
    ]);
    expect(
      walkSheetModel(
        input({ progress: skipped, view: view({ focusId: null }) }),
      ).list.completion,
    ).toEqual({
      title: "Tour complete - 1 skipped.",
      text: "3 of 4 found. A skipped station can still be brought back.",
    });
  });

  it("branch order: the path's line, and no count", () => {
    const branch = walk("branch", [
      ...done("gate"),
      { kind: "skip", id: "well" },
    ]);
    const last = [...done("tower"), ...done("garden")].reduce(
      (p, s) => applyWalkStep(p, s).progress,
      branch,
    );
    const m = walkSheetModel(
      input({ order: "branch", progress: last, view: view({ focusId: null }) }),
    );
    expect(m.list.completion).toEqual({
      title: "Tour complete - you reached the end of your path, 1 skipped.",
      text: "A skipped station can still be brought back.",
    });
  });
});

describe("leaving AR", () => {
  it("progress exists once a station is found, done or skipped", () => {
    expect(walkHasProgress(null)).toBe(false);
    expect(walkHasProgress(walk("any"))).toBe(false);
    expect(walkHasProgress(walk("any", [{ kind: "found", id: "gate" }]))).toBe(
      true,
    );
    expect(walkHasProgress(walk("any", [{ kind: "skip", id: "well" }]))).toBe(
      true,
    );
  });

  it("the away block: the text, the segments and a row per station with Found / Skipped / To find", () => {
    const m = awayModel({
      stations: TOUR,
      order: "any",
      progress: walk("any", [
        ...done("gate"),
        { kind: "found", id: "well" },
        { kind: "skip", id: "tower" },
      ]),
    });
    expect(m.text).toBe(
      "You left AR. Your progress is kept while this page is open.",
    );
    expect(m.rows).toEqual([
      { id: "gate", title: "The gate", status: "Found" },
      { id: "well", title: "The well", status: "Found" },
      { id: "tower", title: "The tower", status: "Skipped" },
      { id: "garden", title: "The garden", status: "To find" },
    ]);
    expect(m.segments).toEqual({
      kind: "each",
      states: ["found", "here", "skipped", "left"],
    });
  });
});

describe("the walk's rules in the sheet", () => {
  // Why: with no station guessed the peek names none and says what
  // the position is doing, in the chip's words where the prototype had none.
  it("the peek with no station guessed: the position's state under each no-distance kind and the hold", () => {
    const r2 = (over: Partial<GuideView>) =>
      walkSheetModel(
        input({ view: view({ focusId: null, noGuess: true, ...over }) }),
      ).peek;
    expect(r2({ position: "weak", precision: "weak", accuracyM: 40 })).toEqual({
      kind: "none",
      eyebrow: "GPS - about 40 m, too weak",
      title: "3 stations to find",
      distance: null,
      arrowDeg: null,
      tail: "GPS too weak to guide you (±40 m); step into the open.",
    });
    expect(r2({ position: "pending", precision: "pending" })).toMatchObject({
      eyebrow: "Finding your position…",
      tail: "Waiting for your position…",
    });
    expect(
      r2({ position: "distance", precision: "gps", accuracyM: 6 }),
    ).toMatchObject({
      eyebrow: "GPS - about 6 m",
      title: "3 stations to find",
      distance: null,
      tail: "Waiting for a steady position…",
    });
    // A story playing with stations still to find: still no guess.
    expect(
      walkSheetModel(
        input({
          progress: walk("any", [{ kind: "found", id: "gate" }]),
          view: view({ focusId: null, noGuess: true, position: "none" }),
        }),
      ).peek.kind,
    ).toBe("none");
  });

  it("the list's hint: the position's cause, and 'which one' once asked to skip", () => {
    const hint = (over: Partial<GuideView>) =>
      walkSheetModel(input({ view: view({ focusId: null, ...over }) })).list
        .hint;
    expect(hint({})).toBeNull();
    expect(hint({ noGuess: true, position: "none" })).toBe(
      "Your position is unknown - scan one of the tour's codes, or pick a station below.",
    );
    expect(hint({ noGuess: true, chooser: true, position: "none" })).toBe(
      "Your position is unknown, so the guide can't tell which station is nearest. Which one can't you reach?",
    );
    expect(hint({ noGuess: true, chooser: true, position: "weak" })).toBe(
      "GPS is too weak, so the guide can't tell which station is nearest. Which one can't you reach?",
    );
    expect(hint({ noGuess: true, chooser: true, position: "pending" })).toBe(
      "The guide is still waiting for your position, so it can't tell which station is nearest. Which one can't you reach?",
    );
  });

  // Why: while tracking is lost no row offers a Skip, so a hint asking
  // "Which one can't you reach?" would ask a question nothing on the
  // screen answers. The plain hint stays: a station can still be picked.
  it("while tracking is lost the hint does not ask which station to skip", () => {
    const hint = (over: Partial<GuideView>) =>
      walkSheetModel(input({ view: view({ focusId: null, ...over }) })).list
        .hint;
    expect(
      hint({
        noGuess: true,
        chooser: true,
        position: "none",
        trackingLost: true,
      }),
    ).toBe(
      "Your position is unknown - scan one of the tour's codes, or pick a station below.",
    );
  });

  // Why: every row carries its own action - Skip for a
  // station to find, its confirm once armed, "Undo: bring back" with its
  // bar for the last skip, "Bring back" for any other skipped one, at any
  // time - so a skip is never more than a row away and never final.
  it("the rows' actions: Skip, the armed confirm, the undo with its time, Bring back", () => {
    const m = walkSheetModel(
      input({
        progress: walk("any", [
          ...done("gate"),
          { kind: "skip", id: "tower" },
          { kind: "skip", id: "garden" },
        ]),
        view: view({
          rowArmedId: "well",
          undo: { id: "garden", leftMs: 2_500 },
        }),
      }),
    );
    const [gate, well, tower, garden] = m.list.rows;
    expect(gate).toMatchObject({ action: null, confirm: null });
    expect(well).toMatchObject({
      action: null,
      confirm: "Skip The well - I can't get there",
    });
    expect(tower!.action).toEqual({
      kind: "bring",
      label: "Bring back",
      ariaLabel: "Bring back The tower",
    });
    expect(garden).toMatchObject({
      action: {
        kind: "undo",
        label: "Undo: bring back The garden",
        ariaLabel: "Undo: bring back The garden",
      },
      undoLeftMs: 2_500,
    });
    const plain = walkSheetModel(input()).list.rows[2]!;
    expect(plain.action).toEqual({
      kind: "skip",
      label: "Skip",
      ariaLabel: "Skip The tower",
    });
  });

  // Why: while tracking is lost the guide cannot tell where the
  // visitor is, so a row offers no Skip and no confirm (an armed row
  // asks again once tracking is back); what undoes a skip - the undo and
  // Bring back - stays, since taking a skip back needs no position.
  it("tracking lost: no Skip and no confirm on any row; the undo and Bring back stay", () => {
    const m = walkSheetModel(
      input({
        progress: walk("any", [
          ...done("gate"),
          { kind: "skip", id: "tower" },
          { kind: "skip", id: "garden" },
        ]),
        view: view({
          trackingLost: true,
          rowArmedId: "well",
          undo: { id: "garden", leftMs: 2_500 },
        }),
      }),
    );
    const [gate, well, tower, garden] = m.list.rows;
    expect(gate).toMatchObject({ action: null, confirm: null });
    expect(well).toMatchObject({ action: null, confirm: null });
    expect(tower!.action?.kind).toBe("bring");
    expect(garden!.action?.kind).toBe("undo");
    const plain = walkSheetModel(input({ view: view({ trackingLost: true }) }))
      .list.rows;
    expect(plain.map((r) => r.action?.kind ?? null)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  // Why: the chosen target is the peek's, marked on its row, and
  // only a waiting station of a tour with a choice can be chosen.
  it("the chosen target: 'your choice' in the peek and its row, 'Guide me here' on a choosable row", () => {
    const m = walkSheetModel(
      input({ view: view({ focusId: "tower", chosenId: "tower" }) }),
    );
    expect(m.peek.eyebrow).toBe("3 stations to find - your choice");
    const tower = m.list.rows[2]!;
    expect(tower).toMatchObject({
      chosen: true,
      choosable: true,
      sub: "120 m - your choice",
      mainLabel: "The tower: 120 m - your choice. Guide me here",
    });
    expect(m.list.rows[0]).toMatchObject({
      choosable: false,
      mainLabel: "The gate: Found",
    });
    const fixed = walkSheetModel(input({ view: view({ canChoose: false }) }))
      .list.rows[1]!;
    expect(fixed.choosable).toBe(false);
  });
});
