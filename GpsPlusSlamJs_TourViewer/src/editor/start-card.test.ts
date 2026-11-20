import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { EditorFileKind } from "./classify-editor-file.js";
import { NOT_A_TOUR } from "./editor-open.js";
import {
  NO_FILE,
  ONE_SCAN_AT_A_TIME,
  ONE_TOUR_AT_A_TIME,
  editorStartActions,
  editorStartReducer,
  initialEditorStartState,
  scanKeptInsteadLine,
  sortScanPick,
  sortTourPick,
  startCardView,
  tourNotScanLine,
  type EditorStartState,
  type StartFrom,
} from "./start-card.js";

const file = (name: string) => new File(["x"], name);
const tour = (name: string): EditorFileKind => ({
  kind: "tour",
  file: file(name),
});
const scan = (name: string): EditorFileKind => ({
  kind: "scan",
  file: file(name),
  scan: { kind: "recording" },
});
const neither = (
  name: string,
  reason = `${name} is no use`,
): EditorFileKind => ({
  kind: "neither",
  file: file(name),
  reason,
});

const reduce = (
  state: EditorStartState,
  ...actions: Parameters<typeof editorStartReducer>[1][]
) => actions.reduce(editorStartReducer, state);
const act = editorStartActions;

/**
 * Why these tests matter: the start card asks two questions and opens the
 * editor with one button. What it may open must follow from the answers
 * alone - no button that opens nothing, no scan step for the example (it
 * is only looked at), and a scan never taken for the tour.
 */
describe("the start card's answers (editorStart slice)", () => {
  it("starts unanswered, and an answer replaces the last one", () => {
    expect(initialEditorStartState).toEqual({
      from: null,
      tour: null,
      scan: null,
    });
    const state = reduce(
      initialEditorStartState,
      act.startChosen({ from: "tour" }),
      act.startChosen({ from: "new" }),
    );
    expect(state.from).toBe("new");
  });

  it("ignores an answer it does not know, and a held name that is not text", () => {
    const state = reduce(
      initialEditorStartState,
      act.startChosen({ from: "tour" }),
      act.startChosen({ from: "bogus" as unknown as StartFrom }),
      act.tourHeld({ name: 7 as unknown as string }),
      act.scanHeld({ name: "" }),
    );
    expect(state).toEqual({ from: "tour", tour: null, scan: null });
  });

  it("holds a tour and a scan by name, lets them go, and forgets all at a reset", () => {
    let state = reduce(
      initialEditorStartState,
      act.startChosen({ from: "tour" }),
      act.tourHeld({ name: "castle.zip" }),
      act.scanHeld({ name: "walk.zip" }),
    );
    expect(state).toEqual({
      from: "tour",
      tour: "castle.zip",
      scan: "walk.zip",
    });
    state = reduce(state, act.scanHeld({ name: null }));
    expect(state.scan).toBeNull();
    state = reduce(state, act.startReset());
    expect(state).toEqual(initialEditorStartState);
  });
});

describe("startCardView", () => {
  const view = (patch: Partial<EditorStartState>, link = "") =>
    startCardView({ ...initialEditorStartState, ...patch }, link);

  it("opens nothing until a start is chosen", () => {
    expect(view({})).toMatchObject({
      tourStep: false,
      scanStep: false,
      canOpen: false,
      summary: "Choose where you start from.",
    });
  });

  it("asks for the tour, and opens once a file is held or a link typed", () => {
    expect(view({ from: "tour" })).toMatchObject({
      tourStep: true,
      scanStep: true,
      canOpen: false,
      summary: "Choose your tour file or paste its link first.",
    });
    expect(view({ from: "tour" }, "   ")).toMatchObject({ canOpen: false });
    expect(view({ from: "tour", tour: "castle.zip" })).toMatchObject({
      canOpen: true,
      summary: "Opens castle.zip.",
    });
    expect(
      view({ from: "tour" }, "https://example.org/castle.zip"),
    ).toMatchObject({
      canOpen: true,
      summary: "Opens the tour behind the link.",
    });
    expect(
      view({ from: "tour", tour: "castle.zip", scan: "walk.zip" }),
    ).toMatchObject({
      canOpen: true,
      summary: "Opens castle.zip, then shows the scan walk.zip.",
    });
  });

  it("starts a new tour at once, saying the editor asks where to save it", () => {
    expect(view({ from: "new" })).toMatchObject({
      tourStep: false,
      scanStep: true,
      canOpen: true,
      summary:
        "Starts a new, empty tour. The editor asks where to save it first.",
    });
    expect(view({ from: "new", scan: "walk.zip" }).summary).toBe(
      "Starts a new, empty tour. The editor asks where to save it first, then shows the scan walk.zip.",
    );
  });

  it("opens the example with no scan step, and says nothing is saved", () => {
    const shown = view({
      from: "example",
      tour: "castle.zip",
      scan: "walk.zip",
    });
    expect(shown).toMatchObject({
      tourStep: false,
      scanStep: false,
      canOpen: true,
      summary:
        "Opens the example tour to look around. Nothing is saved unless you choose Save.",
    });
  });

  it("property: the button opens something exactly when the answers name it, and the example never takes a scan", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<StartFrom | null>(null, "tour", "new", "example"),
        // Names the summary's own words never contain.
        fc.option(
          fc.nat().map((n) => `tour-${String(n)}.zip`),
          { nil: null },
        ),
        fc.option(
          fc.nat().map((n) => `scan-${String(n)}.zip`),
          { nil: null },
        ),
        fc.string(),
        (from, tourName, scanName, link) => {
          const v = startCardView(
            { from, tour: tourName, scan: scanName },
            link,
          );
          const named =
            from === "new" ||
            from === "example" ||
            (from === "tour" && (tourName !== null || link.trim() !== ""));
          expect(v.canOpen).toBe(named);
          expect(v.scanStep).toBe(from === "tour" || from === "new");
          expect(v.tourStep).toBe(from === "tour");
          // The example's summary never names a held scan.
          const exampleScan = from === "example" && scanName !== null;
          expect(exampleScan && v.summary.includes(scanName)).toBe(false);
        },
      ),
    );
  });
});

describe("sortTourPick", () => {
  it("holds a tour, and a scan that came with it", () => {
    const pick = sortTourPick([scan("walk.zip"), tour("castle.zip")]);
    expect(pick.kind).toBe("held");
    if (pick.kind !== "held") return;
    expect(pick.tour?.name).toBe("castle.zip");
    expect(pick.scan?.name).toBe("walk.zip");
    expect(pick.ignored).toEqual([]);
  });

  it("never takes a scan for the tour: a lone scan is kept as the scan, and says so", () => {
    const pick = sortTourPick([scan("walk.zip")]);
    expect(pick).toMatchObject({ kind: "held", tour: null });
    if (pick.kind !== "held") return;
    expect(pick.scan?.name).toBe("walk.zip");
    expect(scanKeptInsteadLine("walk.zip")).toBe(
      "walk.zip is a scan, not a tour: it is kept below as the scan. Now choose your tour.",
    );
  });

  it("holds a file the open will refuse in its own words, and refuses a precise one now", () => {
    const vague = sortTourPick([neither("notes.zip", NOT_A_TOUR)]);
    expect(vague).toMatchObject({ kind: "held" });
    expect(vague.kind === "held" ? vague.tour?.name : null).toBe("notes.zip");
    expect(
      sortTourPick([neither("walk.zip", "its identity is broken")]),
    ).toEqual({ kind: "refuse", reason: "walk.zip: its identity is broken" });
  });

  it("names unusable files that came along, and refuses an empty list", () => {
    const t = tour("t.zip");
    const n = neither("n.txt", "n.txt is no use");
    expect(sortTourPick([n, t])).toEqual({
      kind: "held",
      tour: t.file,
      scan: null,
      ignored: [{ file: n.file, reason: "n.txt is no use" }],
    });
    expect(sortTourPick([])).toEqual({ kind: "refuse", reason: NO_FILE });
  });

  it("refuses two tours or two scans", () => {
    expect(sortTourPick([tour("a.zip"), tour("b.zip")])).toEqual({
      kind: "refuse",
      reason: ONE_TOUR_AT_A_TIME,
    });
    expect(sortTourPick([scan("a.zip"), scan("b.zip")])).toEqual({
      kind: "refuse",
      reason: ONE_SCAN_AT_A_TIME,
    });
  });

  it("property: a scan is never held as the tour", () => {
    const kindOf = fc.constantFrom("tour", "scan", "neither");
    fc.assert(
      fc.property(fc.array(kindOf, { maxLength: 4 }), (kinds) => {
        const given = kinds.map((k, i) =>
          k === "tour"
            ? tour(`t${String(i)}.zip`)
            : k === "scan"
              ? scan(`s${String(i)}.zip`)
              : neither(`n${String(i)}.zip`, NOT_A_TOUR),
        );
        const pick = sortTourPick(given);
        const heldTour = pick.kind === "held" ? pick.tour : null;
        const held = given.find((g) => g.file === heldTour);
        expect(held?.kind ?? "none").not.toBe("scan");
      }),
    );
  });
});

describe("sortScanPick", () => {
  it("holds a scan", () => {
    const kind = scan("walk.zip");
    expect(sortScanPick(kind)).toEqual({ kind: "held", scan: kind.file });
  });

  it("refuses a tour as the scan, saying where it goes", () => {
    expect(sortScanPick(tour("castle.zip"))).toEqual({
      kind: "refuse",
      reason: tourNotScanLine("castle.zip"),
    });
    expect(tourNotScanLine("castle.zip")).toBe(
      'castle.zip is a tour, not a scan. To open it, choose "A tour I made" above.',
    );
  });

  it("refuses a file with no recording in plain words, and a precise reason as it is", () => {
    expect(sortScanPick(neither("notes.zip", NOT_A_TOUR))).toEqual({
      kind: "refuse",
      reason:
        "notes.zip is not a scan: it holds no Recorder recording and no debug data.",
    });
    expect(sortScanPick(neither("walk.zip", "its identity is broken"))).toEqual(
      {
        kind: "refuse",
        reason: "walk.zip: its identity is broken",
      },
    );
  });
});
