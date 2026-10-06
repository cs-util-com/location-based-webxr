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
  codesToWrite,
  openCodeBook,
  referenceCodes,
  withHosted,
  withMeasurement,
  withReference,
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

describe("properties", () => {
  const ids = fc.constantFrom("a", "b", "c", "d");
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant("measure" as const), id: ids, v: fc.nat(3) }),
    fc.record({ kind: fc.constant("save" as const), id: ids, v: fc.nat(3) }),
    fc.record({ kind: fc.constant("reference" as const), id: ids }),
    fc.record({ kind: fc.constant("finish" as const) }),
  );
  type Op =
    | { kind: "measure" | "save"; id: string; v: number }
    | { kind: "reference"; id: string }
    | { kind: "finish" };
  function run(ops: readonly Op[]): CodeBook {
    let book = openCodeBook({ hosted });
    for (const o of ops) {
      if (o.kind === "measure") {
        book = withMeasurement(
          book,
          { id: o.id, json: `${o.id}${String(o.v)}` },
          measurement(o.id),
        );
      } else if (o.kind === "save") {
        book = withSaved(book, { id: o.id, json: `${o.id}${String(o.v)}` });
      } else if (o.kind === "reference") {
        book = withReference(book, o.id);
      } else {
        book = afterFinish(book, codesToWrite(book));
      }
    }
    return book;
  }

  it("never writes a code whose saved pose equals the hosted file or the last Finish", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 20 }), (ops) => {
        const book = run(ops);
        for (const { id, json } of codesToWrite(book)) {
          const code = book.get(id)!;
          expect(json).toBe(code.saved);
          expect(json === code.hosted || json === code.finished).toBe(false);
        }
      }),
    );
  });

  it("a Finish leaves nothing to write, and every measured code is a reference", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 20 }), (ops) => {
        const book = run(ops);
        expect(codesToWrite(afterFinish(book, codesToWrite(book)))).toEqual([]);
        for (const code of book.values()) {
          expect(code.measurement === null || code.reference).toBe(true);
        }
      }),
    );
  });
});
