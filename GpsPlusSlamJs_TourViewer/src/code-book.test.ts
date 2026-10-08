/**
 * Why these tests matter (code book refactor plan
 * GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md,
 * M1): authoring kept ONE code "in hand", so a Finish could write one code
 * and every decision went through one slot. The code book is the one model
 * of every code of the open tour that authoring reads AND writes. What a
 * Finish writes and what the leave guard calls unsaved both come from it,
 * so getting them wrong either loses a measured poster or rewrites files
 * nobody changed.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  afterFinish,
  codesNotHosted,
  codesToWrite,
  liveText,
  openCodeBook,
  referenceCodes,
  withHosted,
  withMeasurement,
  withReference,
  withDraft,
  withoutMeasurement,
  withSaved,
  type CodeBook,
} from "./code-book";
import type { CodeMeasurement } from "./visit-settle";

const measurement = (levelId: string, visit = 1): CodeMeasurement => ({
  levelId,
  text: `https://gps.csutil.com/tour/?qr=${levelId}`,
  odomPose: { position: [0, 1.5, -2], rotation: [0, 0, 0, 1] },
  sizeM: 0.2,
  visit,
});

const hosted = new Map([
  ["a", '{"a":1}'],
  ["b", '{"b":1}'],
]);

describe("openCodeBook", () => {
  it("holds every hosted code as saved, nothing to write, nothing taken as reference", () => {
    const book = openCodeBook({ hosted });
    expect([...book.keys()]).toEqual(["a", "b"]);
    expect(book.get("a")).toEqual({
      levelId: "a",
      saved: '{"a":1}',
      hosted: '{"a":1}',
      measurement: null,
      reference: false,
      finished: null,
    });
    expect(codesToWrite(book)).toEqual([]);
    expect(referenceCodes(book)).toEqual([]);
  });

  it("takes a restored draft's codes as saved and as references, and writes the ones the zip does not hold", () => {
    // Why: a draft restore fills what the creator measured before the tab
    // died; the hosted file still holds the old pose (or none).
    const book = openCodeBook({
      hosted,
      draft: [
        { id: "a", json: '{"a":2}' },
        { id: "c", json: '{"c":1}' },
      ],
    });
    expect(codesToWrite(book)).toEqual([
      { id: "a", json: '{"a":2}' },
      { id: "c", json: '{"c":1}' },
    ]);
    expect(referenceCodes(book)).toEqual(["a", "c"]);
  });

  it("does not write a draft code identical to the hosted file", () => {
    const book = openCodeBook({
      hosted,
      draft: [{ id: "a", json: '{"a":1}' }],
    });
    expect(codesToWrite(book)).toEqual([]);
    expect(referenceCodes(book)).toEqual(["a"]);
  });
});

describe("a restore before the tour's levels arrive", () => {
  it("keeps the draft's codes and compares them once the hosted texts land", () => {
    const early = openCodeBook({
      hosted: new Map(),
      draft: [{ id: "a", json: '{"a":1}' }],
    });
    // Unknown so far: written, to be safe.
    expect(codesToWrite(early)).toEqual([{ id: "a", json: '{"a":1}' }]);
    const late = withHosted(early, hosted);
    expect(codesToWrite(late)).toEqual([]);
    expect(late.get("b")?.saved).toBe('{"b":1}');
    expect(late.get("a")?.reference).toBe(true);
  });
});

describe("measuring and settling", () => {
  it("a new code measured becomes saved, a reference, and something to write", () => {
    const book = withMeasurement(
      openCodeBook({ hosted }),
      { id: "c", json: '{"c":1}' },
      measurement("c"),
    );
    expect(book.get("c")?.measurement).toEqual(measurement("c"));
    expect(referenceCodes(book)).toEqual(["c"]);
    expect(codesToWrite(book)).toEqual([{ id: "c", json: '{"c":1}' }]);
  });

  it("two codes measured are both written (the owner's two posters)", () => {
    let book = openCodeBook({ hosted: new Map() });
    book = withMeasurement(book, { id: "p1", json: "1" }, measurement("p1"));
    book = withMeasurement(book, { id: "p2", json: "2" }, measurement("p2"));
    expect(codesToWrite(book).map((c) => c.id)).toEqual(["p1", "p2"]);
  });

  it("a stored code taken as reference changes nothing that is written", () => {
    const book = withReference(openCodeBook({ hosted }), "a");
    expect(referenceCodes(book)).toEqual(["a"]);
    expect(codesToWrite(book)).toEqual([]);
    expect(withReference(book, "unknown-id")).toBe(book);
  });

  it("a settle's re-mint or improvement replaces the saved pose", () => {
    const book = withSaved(openCodeBook({ hosted }), {
      id: "a",
      json: '{"a":9}',
    });
    expect(codesToWrite(book)).toEqual([{ id: "a", json: '{"a":9}' }]);
  });
});

describe("afterFinish", () => {
  it("what a Finish wrote is not unsaved any more, though the hosted zip is still the old one", () => {
    // Why (second review #6): the hosted file changes only when the creator
    // uploads the saved zip; until then a written code must not keep the
    // save guard saying "Finish and save your changes".
    let book = withSaved(openCodeBook({ hosted }), {
      id: "a",
      json: '{"a":9}',
    });
    book = afterFinish(book, codesToWrite(book));
    expect(codesToWrite(book)).toEqual([]);
    expect(book.get("a")?.hosted).toBe('{"a":1}');
    // A later change is unsaved again.
    book = withSaved(book, { id: "a", json: '{"a":10}' });
    expect(codesToWrite(book)).toEqual([{ id: "a", json: '{"a":10}' }]);
  });
});

describe("after a Finish, the next one builds on that Finish's file (M1 review #1)", () => {
  // Why: the next Finish rebuilds from the previous Finish's zip, not from
  // the hosted one. A code reverting to the hosted text after a Finish
  // wrote something else must be written again, or the zip keeps the
  // stale pose.
  it("writes a code that went back to the hosted text after a Finish wrote another", () => {
    let book = withSaved(openCodeBook({ hosted }), { id: "a", json: "X" });
    book = afterFinish(book, codesToWrite(book));
    book = withSaved(book, { id: "a", json: '{"a":1}' });
    expect(codesToWrite(book)).toEqual([{ id: "a", json: '{"a":1}' }]);
  });
});

describe("withDraft - a draft restored after the tour opened", () => {
  // Why (M1 review #2): restoring is a tap on an offer that comes after
  // the open; a code measured live since is newer than the draft and wins.
  it("restores the draft's codes, but never over a code measured live", () => {
    let book = withMeasurement(
      openCodeBook({ hosted }),
      { id: "a", json: "live" },
      measurement("a"),
    );
    book = withDraft(book, [
      { id: "a", json: "draft-a" },
      { id: "c", json: "draft-c" },
    ]);
    expect(book.get("a")?.saved).toBe("live");
    expect(book.get("c")?.saved).toBe("draft-c");
    expect(referenceCodes(book)).toEqual(["a", "c"]);
  });
});

describe("liveText - what this page changed live", () => {
  // Why (the M5d-2 review's #9a): a draft handed back into the empty hand
  // must not undo live work; this is the one question both restores ask.
  it("is the saved text of a code measured or improved live, else null", () => {
    let book = withMeasurement(
      openCodeBook({ hosted }),
      { id: "a", json: "live" },
      measurement("a"),
    );
    book = withSaved(book, { id: "c", json: "improved" });
    expect(liveText(book, "a")).toBe("live");
    expect(liveText(book, "c")).toBe("improved");
    expect(liveText(book, "b"), "the hosted text, unchanged").toBeNull();
    expect(liveText(book, "x"), "not in the book").toBeNull();
  });

  // Why (the M5d + S2 milestone review's #1): before the first Finish the
  // book has no hosted text; the open tour's texts stand in for it, so a
  // code only kept at its hosted pose is not live work.
  it("judges a code kept before any Finish against the open tour's texts", () => {
    const kept = withReference(
      withSaved(new Map(), { id: "a", json: "H" }),
      "a",
    );
    expect(liveText(kept, "a"), "no baseline at all").toBe("H");
    expect(liveText(kept, "a", new Map([["a", "H"]]))).toBeNull();
    expect(liveText(kept, "a", new Map([["a", "other"]]))).toBe("H");
    const restored = withDraft(
      kept,
      [{ id: "a", json: "D" }],
      new Map([["a", "H"]]),
    );
    expect(restored.get("a")?.saved).toBe("D");
  });
});

describe("withoutMeasurement - a code to be measured again (a new print size)", () => {
  // Why (M1 review #2): adopting a measured print size drops what was
  // measured at the old size; the code falls back to what the zip holds,
  // and is measured again.
  it("drops the measurement and falls back to the zip's text", () => {
    let book = withMeasurement(
      openCodeBook({ hosted }),
      { id: "a", json: "old-size" },
      measurement("a"),
    );
    book = withoutMeasurement(book, "a");
    expect(book.get("a")).toMatchObject({
      saved: '{"a":1}',
      measurement: null,
      reference: false,
    });
    expect(codesToWrite(book)).toEqual([]);
    // A new code measured and dropped before any Finish has nothing left.
    book = withMeasurement(book, { id: "n", json: "n1" }, measurement("n"));
    book = withoutMeasurement(book, "n");
    expect(book.get("n")?.saved).toBeNull();
    expect(codesToWrite(book)).toEqual([]);
  });
});

describe("properties, against a model of the zip", () => {
  // The model is independent of the implementation: the hosted files,
  // with every Finish's writes applied. What it proves: a Finish brings the
  // zip to every saved pose, and never rewrites a file with what it holds.
  const ids = fc.constantFrom("a", "b", "c", "d");
  type Op =
    | { kind: "measure" | "save" | "draft"; id: string; v: number }
    | { kind: "reference" | "unmeasure"; id: string }
    | { kind: "finish" };
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      kind: fc.constantFrom(
        "measure" as const,
        "save" as const,
        "draft" as const,
      ),
      id: ids,
      v: fc.nat(3),
    }),
    fc.record({
      kind: fc.constantFrom("reference" as const, "unmeasure" as const),
      id: ids,
    }),
    fc.record({ kind: fc.constant("finish" as const) }),
  );

  // Hosted texts the generated ones can equal ("a0", "b0"): without that
  // no sequence ever reverts a code to its hosted text, and the property
  // misses the baseline bug it exists for (checked by mutation).
  const zipHosted = new Map([
    ["a", "a0"],
    ["b", "b0"],
  ]);
  function run(ops: readonly Op[]) {
    let book: CodeBook = openCodeBook({ hosted: zipHosted });
    const zip = new Map(zipHosted);
    let rewroteHeld = false;
    const finish = () => {
      const written = codesToWrite(book);
      for (const { id, json } of written) {
        if (zip.get(id) === json) rewroteHeld = true;
        zip.set(id, json);
      }
      book = afterFinish(book, written);
    };
    for (const o of ops) {
      const json = "v" in o ? `${o.id}${String(o.v)}` : "";
      if (o.kind === "measure") {
        book = withMeasurement(book, { id: o.id, json }, measurement(o.id));
      } else if (o.kind === "save") {
        book = withSaved(book, { id: o.id, json });
      } else if (o.kind === "draft") {
        book = withDraft(book, [{ id: o.id, json }]);
      } else if (o.kind === "reference") {
        book = withReference(book, o.id);
      } else if (o.kind === "unmeasure") {
        book = withoutMeasurement(book, o.id);
      } else {
        finish();
      }
    }
    return { book, zip, rewroteHeld };
  }

  it("a Finish brings the zip to every saved pose, and leaves nothing to write", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 24 }), (ops) => {
        const r = run([...ops, { kind: "finish" }]);
        const saved = [...r.book.values()].filter((c) => c.saved !== null);
        for (const code of saved) {
          expect(r.zip.get(code.levelId)).toBe(code.saved);
        }
        expect(codesToWrite(r.book)).toEqual([]);
      }),
    );
  });

  it("never rewrites a file with the text the zip already holds", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 24 }), (ops) => {
        expect(run(ops).rewroteHeld).toBe(false);
      }),
    );
  });

  it("every measured code is a reference", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 24 }), (ops) => {
        for (const code of run(ops).book.values()) {
          expect(code.measurement === null || code.reference).toBe(true);
        }
      }),
    );
  });
});

describe("codesNotHosted - what the draft must keep (M4c-1)", () => {
  // Why: a Finish's zip reaches the world only when the creator uploads
  // it, so the draft must keep every code whose saved text the HOSTED zip
  // does not hold yet - including codes a Finish already wrote. A crash
  // between the Finish and the upload otherwise lost the measurement.
  it("keeps a code a Finish wrote until the hosted zip holds it", () => {
    let book = withSaved(openCodeBook({ hosted }), { id: "a", json: "X" });
    book = afterFinish(book, codesToWrite(book));
    expect(codesToWrite(book)).toEqual([]);
    expect(codesNotHosted(book)).toEqual([{ id: "a", json: "X" }]);
    // The upload: the reopened tour hosts it.
    book = withHosted(book, new Map([["a", "X"]]));
    expect(codesNotHosted(book)).toEqual([]);
  });

  it("keeps a new code, and leaves out a hosted code kept unchanged", () => {
    let book = withMeasurement(
      openCodeBook({ hosted }),
      { id: "c", json: "C" },
      measurement("c"),
    );
    book = withReference(book, "b");
    expect(codesNotHosted(book)).toEqual([{ id: "c", json: "C" }]);
  });
});
