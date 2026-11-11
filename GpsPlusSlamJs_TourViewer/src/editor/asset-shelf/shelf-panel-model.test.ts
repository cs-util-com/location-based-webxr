/**
 * Why these tests matter: the shelf panel is where a creator learns what
 * a phone will download, and each line here is a promise about a file. A
 * wrong state line ("ready" for a file still queued), a summary that
 * counts a failed file as made smaller, a rail that hides a failure or a
 * badge that stays after the work ended would each tell the creator the
 * tour is lighter, or busier, than it is.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ShelfPhase } from "./asset-jobs.js";
import type { ShelfRow } from "./asset-shelf-slice.js";
import {
  cardKindLine,
  cardMore,
  cardState,
  cardWarning,
  fileExt,
  filteredRows,
  formatBytes,
  gainPercent,
  pillView,
  RAIL_RINGS,
  railView,
  shapeKey,
  shelfBadge,
  shelfChips,
  shelfSummary,
  stateLine,
  usesLabel,
} from "./shelf-panel-model.js";

const MB = 1024 * 1024;

/** A row; `optimizedBytes: undefined` stands for a file never made
 *  smaller. */
function row(
  over: Partial<Omit<ShelfRow, "optimizedBytes">> & {
    optimizedBytes?: number | undefined;
  } = {},
): ShelfRow {
  return {
    id: "a",
    kind: "audio",
    name: "bells.wav",
    origin: "added",
    status: "optimized",
    progress: 1,
    retryable: false,
    originalBytes: 9 * MB,
    optimizedBytes: 1.5 * MB,
    estimatedBytes: 1.5 * MB,
    queuePosition: null,
    placesInUse: 1,
    swaps: 0,
    canUseOriginal: true,
    ...over,
  } as ShelfRow;
}

describe("formatBytes", () => {
  it("says KB under a MB, one decimal under 10 MB, whole MB above", () => {
    expect(formatBytes(0)).toBe("1 KB");
    expect(formatBytes(300 * 1024)).toBe("300 KB");
    expect(formatBytes(1.5 * MB)).toBe("1.5 MB");
    expect(formatBytes(9.94 * MB)).toBe("9.9 MB");
    expect(formatBytes(48 * MB)).toBe("48 MB");
  });

  it("reads a bad size as the smallest", () => {
    expect(formatBytes(Number.NaN)).toBe("1 KB");
    expect(formatBytes(-5)).toBe("1 KB");
  });
});

describe("the card", () => {
  it("maps the job's phase onto the card's look", () => {
    const cases: [ShelfPhase, string][] = [
      ["queued", "queued"],
      ["running", "processing"],
      ["optimized", "ready"],
      ["idle", "idle"],
      ["kept", "kept"],
      ["failed", "failed"],
    ];
    for (const [phase, state] of cases) expect(cardState(phase)).toBe(state);
  });

  it("names the kind, the extension and the size it came in", () => {
    expect(cardKindLine(row())).toBe("Sound · WAV · 9.0 MB");
    expect(cardKindLine(row({ kind: "model", name: "tram" }))).toBe(
      "3D model · FILE · 9.0 MB",
    );
    expect(fileExt("photo.Large.jpeg")).toBe("JPEG");
  });

  // Why: a character's entry holds his files; its kind line names him a
  // character and counts the files, never one file's extension.
  it("names a character's entry with its count of files", () => {
    const files = [
      { id: "a", name: "Sir.png", bytes: 1024 },
      { id: "b", name: "Sir poses.png", bytes: 2048 },
    ];
    expect(
      cardKindLine(
        row({
          kind: "image",
          character: { id: "sir", files },
          originalBytes: 9 * 1024 * 1024,
        }),
      ),
    ).toBe("Character · 2 files · 9.0 MB");
    expect(
      cardKindLine(
        row({
          kind: "image",
          character: { id: "sir", files: files.slice(0, 1) },
        }),
      ),
    ).toMatch(/^Character · 1 file · /);
  });

  it("says how many files are before a queued one", () => {
    expect(stateLine(row({ status: "queued", queuePosition: 2 }))).toEqual({
      kind: "queued",
      text: "Queued, 2 before it",
    });
    expect(stateLine(row({ status: "queued", queuePosition: 0 }))).toEqual({
      kind: "queued",
      text: "Queued, next",
    });
  });

  it("shows a running file's work in whole percent, within 0 to 100", () => {
    expect(
      stateLine(row({ kind: "image", status: "running", progress: 0.426 })),
    ).toEqual({
      kind: "processing",
      phase: "Making the picture smaller",
      percent: 43,
    });
    expect(stateLine(row({ status: "running", progress: 3 }))).toMatchObject({
      percent: 100,
    });
  });

  // Why: a gain of 0 or less must not read as "-0 %": a file that did not
  // get smaller is shown with its sizes only.
  it("shows a ready file's sizes, and the gain only when it is smaller", () => {
    expect(stateLine(row())).toEqual({
      kind: "ready",
      sizes: "9.0 MB → 1.5 MB",
      gain: 83,
    });
    expect(
      stateLine(row({ optimizedBytes: 9 * MB, estimatedBytes: 9 * MB })),
    ).toMatchObject({ gain: null });
  });

  it("says why a file failed, and offers a retry only where one can help", () => {
    expect(
      stateLine(row({ status: "failed", retryable: true, reason: "Busy." })),
    ).toEqual({
      kind: "failed",
      title: "Not optimized",
      retry: true,
      why: "Busy.",
    });
    expect(stateLine(row({ status: "failed", retryable: false }))).toEqual({
      kind: "failed",
      title: "Cannot be used",
      retry: false,
      why: "",
    });
  });

  it("names an opened tour's file and a kept original", () => {
    expect(stateLine(row({ status: "idle" }))).toEqual({
      kind: "idle",
      text: "In the tour, not made smaller",
    });
    expect(stateLine(row({ status: "kept" }))).toEqual({
      kind: "kept",
      text: "The original is used",
      size: "9.0 MB",
    });
  });

  it("says in an opened card what happens to the file", () => {
    expect(cardMore(row())).toContain("still go back to it");
    expect(cardMore(row({ canUseOriginal: false }))).not.toContain("go back");
    expect(cardMore(row({ status: "queued" }))).toContain(
      "Until then the original (9.0 MB) is used",
    );
    expect(cardMore(row({ status: "idle" }))).toContain("Optimize this tour");
    expect(cardMore(row({ status: "kept", reason: "As you asked." }))).toBe(
      "As you asked.",
    );
  });

  it("counts the places a file is used in", () => {
    expect(usesLabel(0)).toBe("Not used");
    expect(usesLabel(3)).toBe("Used in 3");
  });
});

describe("gainPercent", () => {
  it("is whole, and null for a file not smaller or a size unknown", () => {
    expect(gainPercent(100, 25)).toBe(75);
    expect(gainPercent(100, 100)).toBeNull();
    expect(gainPercent(100, 120)).toBeNull();
    expect(gainPercent(0, 0)).toBeNull();
  });

  it("is between 1 and 100 whenever it is given (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e9 }),
        fc.integer({ min: 0, max: 2e9 }),
        (before, after) => {
          const gain = gainPercent(before, after);
          // Given only for a file that got smaller, and then 1 to 100.
          expect(
            gain === null || (gain >= 1 && gain <= 100 && after < before),
          ).toBe(true);
          expect(gain === null).toBe(
            after >= before || Math.round((1 - after / before) * 100) <= 0,
          );
        },
      ),
    );
  });
});

describe("shelfSummary", () => {
  it("says the shelf is empty", () => {
    expect(shelfSummary([])).toEqual({
      kind: "empty",
      text: "Nothing on the shelf yet.",
    });
  });

  it("counts the files in the works, with their mean progress", () => {
    expect(
      shelfSummary([
        row({ id: "1", status: "running", progress: 0.5 }),
        row({ id: "2", status: "queued", progress: 0 }),
        row({ id: "3" }),
        row({ id: "4", status: "failed", retryable: true }),
      ]),
    ).toEqual({
      kind: "busy",
      lead: "Optimizing 2 of 4",
      failed: 1,
      percent: 25,
      optour: null,
    });
  });

  // Why: what a phone downloads is every file's size as the tour holds it:
  // a failed or opened file counts with its whole original, never as saved.
  it("says what a phone downloads instead of the originals", () => {
    const summary = shelfSummary([
      row({ id: "1", originalBytes: 8 * MB, estimatedBytes: 2 * MB }),
      row({
        id: "2",
        status: "failed",
        originalBytes: 2 * MB,
        optimizedBytes: undefined,
        estimatedBytes: 2 * MB,
      }),
    ]);
    expect(summary).toEqual({
      kind: "done",
      lead: "1 ready",
      failed: 1,
      after: "4.0 MB",
      before: "10 MB",
      gain: 60,
      optour: null,
    });
  });

  it("names the opened tour's files not made smaller, in the singular and the plural", () => {
    expect(shelfSummary([row({ status: "idle" })])).toMatchObject({
      optour: "1 file of the opened tour is not made smaller.",
    });
    expect(
      shelfSummary([
        row({ id: "1", status: "idle" }),
        row({ id: "2", status: "idle" }),
        row({ id: "3", status: "running" }),
      ]),
    ).toMatchObject({
      kind: "busy",
      optour: "2 files of the opened tour are not made smaller.",
    });
  });
});

describe("the kind chips", () => {
  const rows = [
    row({ id: "1", kind: "audio" }),
    row({ id: "2", kind: "image" }),
    row({ id: "3", kind: "image" }),
  ];

  it("are none under two files", () => {
    expect(shelfChips([row()], "all")).toEqual([]);
  });

  it("offer All and each kind on the shelf, with counts, one on", () => {
    expect(shelfChips(rows, "image")).toEqual([
      { filter: "all", label: "All", count: 3, on: false },
      { filter: "audio", label: "Sounds", count: 1, on: false },
      { filter: "image", label: "Pictures", count: 2, on: true },
    ]);
    expect(filteredRows(rows, "image").map((r) => r.id)).toEqual(["2", "3"]);
  });

  // Why: a filter whose last file was deleted would show an empty list
  // with files on the shelf.
  it("fall back to All when the kind filtered has left the shelf", () => {
    expect(filteredRows(rows, "video")).toBe(rows);
    expect(shelfChips(rows, "video")[0]?.on).toBe(true);
  });
});

describe("the folded rail", () => {
  it("rings each file in the works, a failure full, and counts the rest", () => {
    const rows = [
      row({ id: "f", status: "failed", progress: 0 }),
      ...Array.from({ length: RAIL_RINGS + 2 }, (_, i) =>
        row({ id: `q${String(i)}`, status: "queued", progress: 0 }),
      ),
      row({ id: "done" }),
    ];
    const rail = railView(rows);
    expect(rail.rings).toHaveLength(RAIL_RINGS);
    expect(rail.rings[0]).toMatchObject({
      id: "f",
      state: "failed",
      progress: 1,
    });
    expect(rail.rest).toBe(3);
    expect(rail.allReady).toBe(false);
    expect(rail.rings.map((r) => r.id)).not.toContain("done");
  });

  it("shows a check once nothing is in the works, and nothing on an empty shelf", () => {
    expect(railView([row()]).allReady).toBe(true);
    expect(railView([]).allReady).toBe(false);
  });

  it("keeps every ring's progress within 0 to 1 (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            status: fc.constantFrom<ShelfPhase>(
              "queued",
              "running",
              "failed",
              "optimized",
            ),
            progress: fc.double({ min: -2, max: 3, noNaN: true }),
          }),
        ),
        (specs) => {
          const rail = railView(
            specs.map((s, i) => row({ ...s, id: String(i) })),
          );
          for (const ring of rail.rings) {
            expect(ring.progress).toBeGreaterThanOrEqual(0);
            expect(ring.progress).toBeLessThanOrEqual(1);
          }
          expect(rail.rings.length + rail.rest).toBe(
            specs.filter((s) => s.status !== "optimized").length,
          );
        },
      ),
    );
  });
});

describe("the badge and the pill", () => {
  it("count the failures first, marked bad, else the files in the works", () => {
    const busy = [row({ id: "1", status: "running" }), row({ id: "2" })];
    expect(shelfBadge(busy)).toEqual({ count: 1, bad: false });
    expect(shelfBadge([...busy, row({ id: "3", status: "failed" })])).toEqual({
      count: 1,
      bad: true,
    });
    expect(pillView(busy)).toEqual({
      text: "Optimizing 1 file",
      busy: true,
      bad: false,
    });
    expect(pillView([row({ status: "failed" })])).toEqual({
      text: "1 not optimized",
      busy: false,
      bad: true,
    });
  });

  // Why: a badge or pill left after the work ended keeps saying "busy".
  it("go away once everything is done", () => {
    expect(shelfBadge([row(), row({ id: "2", status: "kept" })])).toBeNull();
    expect(pillView([row()])).toBeNull();
    expect(pillView([])).toBeNull();
  });
});

describe("shapeKey", () => {
  // Why: the panel redraws its cards only when this changes, and moves the
  // bars alone otherwise; a key that changed with the progress would
  // redraw (and drop the focus) on every tick.
  it("ignores the progress and changes with anything shown", () => {
    const base = row({ status: "running", progress: 0.1 });
    expect(shapeKey([base])).toBe(shapeKey([{ ...base, progress: 0.9 }]));
    expect(shapeKey([base])).not.toBe(shapeKey([{ ...base, placesInUse: 2 }]));
    expect(shapeKey([base])).not.toBe(
      shapeKey([{ ...base, status: "failed" }]),
    );
  });
});

describe("cardWarning", () => {
  // Why: the warning is for a video large for its length, judged on what
  // the tour adds now; a video of unknown length or another kind of file
  // must never carry it, and a redraw must follow a newly read look.
  it("warns a video large for its length, and nothing else", () => {
    const video = (over: Partial<ShelfRow>) =>
      row({
        kind: "video",
        status: "kept",
        optimizedBytes: undefined,
        ...over,
      });
    expect(
      cardWarning(video({ estimatedBytes: 120 * MB, seconds: 60 })),
    ).toContain("about 120 MB a minute");
    expect(
      cardWarning(video({ estimatedBytes: 20 * MB, seconds: 60 })),
    ).toBeNull();
    expect(cardWarning(video({ estimatedBytes: 120 * MB }))).toBeNull();
    expect(
      cardWarning(
        row({ kind: "audio", estimatedBytes: 120 * MB, seconds: 60 }),
      ),
    ).toBeNull();
  });

  it("redraws a card when its poster, its length or its bytes change", () => {
    const base = row({ kind: "video" });
    expect(shapeKey([row({ kind: "video", seconds: 9 })])).not.toBe(
      shapeKey([base]),
    );
    expect(shapeKey([row({ kind: "video", posterId: "p" })])).not.toBe(
      shapeKey([base]),
    );
    expect(shapeKey([row({ kind: "video", swaps: 1 })])).not.toBe(
      shapeKey([base]),
    );
  });
});
