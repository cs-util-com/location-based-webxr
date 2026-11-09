/**
 * Why these tests matter: a station's place in the tour is the order a
 * visitor walks it, and the tree's drag (and its Earlier and Later
 * buttons) is how a creator changes it. An off-by-one here moves a
 * station one place too far, or drops a drag that should have moved it;
 * both are invisible until a visitor walks the tour in the wrong order.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { dropSlot, movedAcross, movedTo } from "./tree-reorder.js";

describe("dropSlot", () => {
  it("is the slot before the first card whose middle lies below the pointer", () => {
    const middles = [10, 30, 50];
    expect(dropSlot(middles, 0)).toBe(0);
    expect(dropSlot(middles, 9.9)).toBe(0);
    // On a middle: past it (the card's lower half is after it).
    expect(dropSlot(middles, 10)).toBe(1);
    expect(dropSlot(middles, 31)).toBe(2);
    expect(dropSlot(middles, 50)).toBe(3);
    expect(dropSlot(middles, 500)).toBe(3);
    expect(dropSlot([], 5)).toBe(0);
  });

  it("refuses a pointer that is not a number", () => {
    expect(() => dropSlot([1], Number.NaN)).toThrow(RangeError);
  });
});

describe("movedTo", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves a station before the slot it is dropped at, the others in their order", () => {
    expect(movedTo(ids, 0, 4)).toEqual(["b", "c", "d", "a"]);
    expect(movedTo(ids, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(movedTo(ids, 1, 3)).toEqual(["a", "c", "b", "d"]);
    expect(movedTo(ids, 2, 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("is null for a drop on either side of the station itself: nothing moved", () => {
    expect(movedTo(ids, 1, 1)).toBeNull();
    expect(movedTo(ids, 1, 2)).toBeNull();
  });

  it("refuses a station or a slot outside the list", () => {
    expect(() => movedTo(ids, 4, 0)).toThrow(RangeError);
    expect(() => movedTo(ids, -1, 0)).toThrow(RangeError);
    expect(() => movedTo(ids, 0, 5)).toThrow(RangeError);
    expect(() => movedTo(ids, 0.5, 2)).toThrow(RangeError);
  });

  // Why a property: every drag, from every place to every slot, must
  // keep each station exactly once and move only the dragged one.
  it("keeps every station once, the dragged one where it was dropped (property)", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 3 }), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.nat(),
        fc.nat(),
        (list, rawFrom, rawSlot) => {
          const from = rawFrom % list.length;
          const slot = rawSlot % (list.length + 1);
          const out = movedTo(list, from, slot);
          // Dropped where it was: nothing to write.
          const stays = slot === from || slot === from + 1;
          expect(out === null).toBe(stays);
          const moved = out ?? list;
          expect([...moved].sort()).toEqual([...list].sort());
          expect(moved.indexOf(list[from] ?? "")).toBe(
            stays ? from : slot > from ? slot - 1 : slot,
          );
          const others = (l: readonly string[]) =>
            l.filter((id) => id !== list[from]);
          expect(others(moved)).toEqual(others(list));
        },
      ),
    );
  });
});

// Why: the tree's nested drag moves an item between a station's lists (a
// story's entries, its free items); an off-by-one or a lost id here would
// drop the item in the wrong story or write it twice.
describe("movedAcross", () => {
  const LISTS = { a: ["a1", "a2"], b: ["b1"] };

  it("moves inside one list by movedTo's rule, null where it was", () => {
    expect(
      movedAcross(LISTS, { list: "a", index: 0 }, { list: "a", slot: 2 }),
    ).toEqual({ a: ["a2", "a1"], b: ["b1"] });
    expect(
      movedAcross(LISTS, { list: "a", index: 0 }, { list: "a", slot: 1 }),
    ).toBeNull();
  });

  it("moves across two lists to the slot, into an empty list too", () => {
    expect(
      movedAcross(LISTS, { list: "a", index: 1 }, { list: "b", slot: 0 }),
    ).toEqual({ a: ["a1"], b: ["a2", "b1"] });
    expect(
      movedAcross(LISTS, { list: "b", index: 0 }, { list: "c", slot: 0 }),
    ).toEqual({ a: ["a1", "a2"], b: [], c: ["b1"] });
  });

  it("refuses a list, a place or a slot that is not there", () => {
    expect(() =>
      movedAcross(LISTS, { list: "x", index: 0 }, { list: "a", slot: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      movedAcross(LISTS, { list: "a", index: 2 }, { list: "b", slot: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      movedAcross(LISTS, { list: "a", index: 0 }, { list: "b", slot: 2 }),
    ).toThrow(RangeError);
    expect(() =>
      movedAcross(
        LISTS,
        { list: "toString", index: 0 },
        { list: "a", slot: 0 },
      ),
    ).toThrow(RangeError);
  });

  it("loses and doubles nothing, and the move back undoes it (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 4 }), { minLength: 1, maxLength: 4 }),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        (sizes, rawFrom, rawIndex, rawTo, rawSlot) => {
          const lists: Record<string, string[]> = {};
          sizes.forEach((n, l) => {
            lists[`l${String(l)}`] = Array.from(
              { length: n },
              (_, i) => `l${String(l)}-${String(i)}`,
            );
          });
          const names = Object.keys(lists);
          const filled = names.filter((n) => (lists[n] ?? []).length > 0);
          if (filled.length === 0) return;
          const fromList = filled[rawFrom % filled.length] as string;
          const source = lists[fromList] ?? [];
          const index = rawIndex % source.length;
          const toList = names[rawTo % names.length] as string;
          const room = (lists[toList] ?? []).length + 1;
          const slot = rawSlot % room;
          const out = movedAcross(
            lists,
            { list: fromList, index },
            { list: toList, slot },
          );
          const all = (l: Record<string, readonly string[]>) =>
            Object.values(l).flat().sort();
          // Only a move within its own list may come back as "unchanged".
          expect(out === null ? toList : fromList).toBe(fromList);
          if (out === null) return;
          expect(all(out)).toEqual(all(lists));
          const id = source[index] as string;
          const at = (out[toList] ?? []).indexOf(id);
          const back = movedAcross(
            out,
            { list: toList, index: at },
            {
              list: fromList,
              slot:
                toList === fromList ? (at < index ? index + 1 : index) : index,
            },
          );
          expect(back).toEqual(lists);
        },
      ),
    );
  });
});
