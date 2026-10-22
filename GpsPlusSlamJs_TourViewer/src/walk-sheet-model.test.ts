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
 * Why these tests matter (visitor walk W4 build plan
 * GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md,
 * M2, §1.5, §1.6, §1.8): the sheet is what the visitor reads of the walk
 * in AR - the peek's eyebrow, title, distance and tail split today's
 * station line, the list a row per station, the completion card, and the
 * away block on the start page. Each text and each state is W4's or
 * today's, named in the plan; a wrong one is a wrong instruction in front
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
    accuracyM: null,
    distances: new Map([
      ["gate", 30],
      ["well", 46.4],
      ["tower", 120],
      ["garden", 190],
    ]),
    quick: { kind: "ask-skip", id: "well" },
    note: null,
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

describe("the peek (§1.5)", () => {
  it("any order, several offered: 'N stations to find - nearest', the title and the distance", () => {
    const m = walkSheetModel(input());
    expect(m.peek).toEqual({
      kind: "walk",
      eyebrow: "3 stations to find - nearest",
      title: "The well",
      distance: "46 m",
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

  it("nothing vouches for the position, several offered: no station named (W4 'Position unknown')", () => {
    const m = walkSheetModel(input({ view: view({ position: "none" }) }));
    expect(m.peek).toEqual({
      kind: "none",
      eyebrow: "Position unknown",
      title: "3 stations to find",
      distance: null,
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

describe("the story card's place (§1.5)", () => {
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

describe("the segments and the rows (§1.5, §1.6)", () => {
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

describe("the list's header and progress line (§1.6)", () => {
  it("the tour's title, the order chip and the grab's name", () => {
    expect(walkSheetModel(input()).list).toMatchObject({
      title: "Old town walk",
      chip: "Any order",
    });
    expect(walkSheetModel(input({ order: "fixed" })).list.chip).toBe(
      "In order",
    );
    expect(walkSheetModel(input({ order: "branch" })).list.chip).toBe(
      "Your path",
    );
    expect(walkSheetModel(input()).grabLabel).toBe("Show all stations");
    expect(walkSheetModel(input({ sheet: "list" })).grabLabel).toBe(
      "Hide the list",
    );
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

describe("the completion card (§1.6)", () => {
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

  it("with a station skipped: 'M of N found.'", () => {
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
    ).toEqual({ title: "Tour complete - 1 skipped.", text: "3 of 4 found." });
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
      text: "Thank you for walking with us.",
    });
  });
});

describe("leaving AR (§1.8)", () => {
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
