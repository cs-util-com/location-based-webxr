/**
 * Why these tests matter: the object list is the creator's only way to
 * edit, move or delete what a tour carries (authoring plan 2026-09-28-0953
 * §3.4, owner item 6: "create works; move, edit and delete do not"). What
 * it offers must match what the actions can do - a Move offered on a photo
 * or on a desktop page would be a button that can only fail - and in AR
 * the selection must come first without any object disappearing from the
 * list. The DOM half is covered by the Playwright suite.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import {
  objectListModel,
  SELECT_HINT,
  type ObjectListEntry,
  type ObjectListState,
} from "./object-list.js";

// The geodesy behind the distance is licence-gated; the store's
// construction activates it (the same activation main.ts performs at boot).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

function pin(id: string, lat = 47.5): TourObject {
  return {
    id,
    kind: "pin",
    label: `pin ${id}`,
    createdAtIso: "2026-09-30T00:00:00.000Z",
    geo: { lat, lon: 8.7, alt: 400, headingDeg: 0 },
  };
}

function photo(id: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-09-30T00:00:00.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

function entry(object: TourObject, hosted = true, changed = false) {
  return { object, hosted, changed };
}

function state(overrides: Partial<ObjectListState>): ObjectListState {
  return {
    entries: [],
    codes: [],
    inAr: false,
    selectedId: null,
    busy: new Map(),
    locked: false,
    note: "",
    undo: false,
    ...overrides,
  };
}

describe("objectListModel on the page", () => {
  it("lists every object with edit and delete, and no Move - that needs AR", () => {
    const model = objectListModel(
      state({ entries: [entry(pin("a")), entry(photo("p"), false, true)] }),
    );
    expect(model.hidden).toBe(false);
    expect(model.heading).toBe("Objects in this tour (2)");
    expect(model.rows.map((r) => r.id)).toEqual(["a", "p"]);
    expect(model.rows.map((r) => r.canMove)).toEqual([false, false]);
    // A photo's caption is shown nowhere, so it gets no Edit text.
    expect(model.rows.map((r) => r.canEditText)).toEqual([true, false]);
    expect(model.hint).toMatch(/AR setup/);
  });

  it("says where each object stands and how far it is from the code", () => {
    const codes = [pin("code", 47.5).geo];
    const model = objectListModel(
      state({
        codes,
        entries: [
          // ~11.1 m north of the code.
          entry(pin("a", 47.5001)),
          entry(pin("b"), true, true),
          entry(pin("c"), false, true),
        ],
      }),
    );
    expect(model.rows.map((r) => r.detail)).toEqual([
      "Pin · in the zip · 11 m from the code",
      "Pin · changed, not yet in the zip · 0 m from the code",
      "Pin · new, not yet in the zip · 0 m from the code",
    ]);
    expect(model.rows[0]?.title).toBe("pin a");
  });

  it("names the NEAREST code when the tour has several, and none without a code", () => {
    const two = objectListModel(
      state({
        codes: [pin("far", 47.501).geo, pin("near", 47.5001).geo],
        entries: [entry(pin("a"))],
      }),
    );
    expect(two.rows[0]?.detail).toBe(
      "Pin · in the zip · 11 m from the nearest code",
    );
    const none = objectListModel(state({ entries: [entry(photo("p"))] }));
    expect(none.rows[0]?.detail).toBe("Photo · in the zip");
    expect(none.rows[0]?.title).toBe("Photo");
  });

  it("is hidden with nothing to list and nothing to say", () => {
    expect(objectListModel(state({})).hidden).toBe(true);
    // ...but a last outcome ("Deleted ...") still shows with an empty list.
    expect(objectListModel(state({ note: "Deleted." })).hidden).toBe(false);
  });

  it("offers Undo beside the note while a delete can still be undone, on the page and in AR (M4 review #5)", () => {
    // Why: a delete had no confirm and no undo, so one mis-tap lost a
    // hosted note. The Undo lives with the outcome it undoes, and keeps the
    // list shown even when the delete emptied it.
    for (const inAr of [false, true]) {
      const model = objectListModel(
        state({ inAr, note: 'Deleted "Gate".', undo: true }),
      );
      expect(model.undo).toBe(true);
      expect(model.hidden).toBe(false);
    }
    expect(objectListModel(state({ note: "Saved." })).undo).toBe(false);
  });

  it("locks a busy row, and every row while a Finish runs", () => {
    const busy = objectListModel(
      state({
        entries: [entry(pin("a")), entry(pin("b"))],
        busy: new Map([["a", "Saving…"]]),
      }),
    );
    expect(busy.rows.map((r) => [r.enabled, r.busy])).toEqual([
      [false, "Saving…"],
      [true, null],
    ]);
    const locked = objectListModel(
      state({ entries: [entry(pin("a"))], locked: true }),
    );
    expect(locked.rows[0]?.enabled).toBe(false);
  });
});

describe("objectListModel in AR", () => {
  it("shows ONLY the selected object, with Move for a pin - nothing else over the camera", () => {
    // Why: the DOM overlay IS the screen and cannot be scrolled; a closed
    // disclosure of every object still laid its buttons out below the
    // first screen on a small phone (ar-layout.spec.js, 360x640). The page
    // lists everything; in AR a tap picks the one to edit.
    const model = objectListModel(
      state({
        inAr: true,
        selectedId: "b",
        entries: [entry(pin("a")), entry(pin("b")), entry(photo("p"))],
      }),
    );
    expect(model.rows.map((r) => [r.id, r.selected, r.canMove])).toEqual([
      ["b", true, true],
    ]);
    expect(model).not.toHaveProperty("moreRows");
    expect(model.hint).toBe("");
  });

  it("offers a chooser that reaches every object without aiming - its place, or the count before a selection (M4 review #4)", () => {
    // Why: a far, small or occluded object may be impossible to tap, and
    // Move is AR-only and acts on the selection - so without a way to step
    // through the objects some could never be moved. The page lists them
    // all and needs no chooser.
    const entries = [entry(pin("a")), entry(pin("b")), entry(photo("p"))];
    expect(
      objectListModel(state({ inAr: true, selectedId: "b", entries })).chooser,
    ).toEqual({ position: "2 of 3" });
    expect(objectListModel(state({ inAr: true, entries })).chooser).toEqual({
      position: "3 objects",
    });
    expect(
      objectListModel(state({ inAr: true, entries: [entry(pin("a"))] }))
        .chooser,
    ).toEqual({ position: "1 object" });
    expect(objectListModel(state({ inAr: true })).chooser).toBeNull();
    expect(objectListModel(state({ entries })).chooser).toBeNull();
  });

  it("says how to select while nothing is selected", () => {
    const model = objectListModel(
      state({ inAr: true, entries: [entry(pin("a"))] }),
    );
    expect(model.rows).toEqual([]);
    expect(model.hint).toBe(SELECT_HINT);
  });

  it("lists every object exactly once on the page, and in AR at most the selected one (property)", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom("a", "b", "c", "d", "e"), {
          maxLength: 5,
        }),
        fc.option(fc.constantFrom("a", "b", "c", "x")),
        fc.boolean(),
        (ids, selectedId, inAr) => {
          const entries: ObjectListEntry[] = ids.map((id) => entry(pin(id)));
          const model = objectListModel(state({ entries, selectedId, inAr }));
          const shown = model.rows.map((r) => r.id);
          const selectedShown =
            selectedId !== null && (ids as string[]).includes(selectedId)
              ? [selectedId]
              : [];
          expect([...shown].sort()).toEqual(
            inAr ? selectedShown : [...ids].sort(),
          );
          // The count is in the heading on the page; AR has no heading.
          expect(model.heading).toBe(
            inAr ? "" : `Objects in this tour (${String(ids.length)})`,
          );
        },
      ),
    );
  });
});
