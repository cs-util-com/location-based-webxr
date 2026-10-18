/**
 * The poster text a creator prints with the codes (polish round D-P7,
 * r820 feedback R8).
 *
 * Why these tests matter: the owner asked twice for posters that can be
 * hung as they come out of the printer - a title, a line saying what this
 * is, and what to do. The fields start filled in, an emptied field stays
 * empty (it is left off the poster, not refilled behind the creator's
 * back), and what a creator typed for a tour comes back for that tour.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DEFAULT_CALL_TO_ACTION,
  DEFAULT_EXPLANATION,
  defaultPosterFields,
  readPosterFields,
  writePosterFields,
} from "./poster-text.js";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("defaultPosterFields", () => {
  it("fills in the owner's wording, and the tour's name as the title", () => {
    expect(DEFAULT_EXPLANATION).toBe("AR tour starts here");
    expect(DEFAULT_CALL_TO_ACTION).toBe("Scan with an Android phone");
    expect(defaultPosterFields("Harbour Lights")).toEqual({
      title: "Harbour Lights",
      explanation: DEFAULT_EXPLANATION,
      callToAction: DEFAULT_CALL_TO_ACTION,
    });
  });

  it("leaves the title empty when the tour has no name yet", () => {
    expect(defaultPosterFields(null).title).toBe("");
    expect(defaultPosterFields("   ").title).toBe("");
  });
});

describe("the per-tour memory", () => {
  it("gives back what was written for the same tour link, and nothing for another", () => {
    const store = memoryStore();
    const fields = {
      title: "Hafenführung",
      explanation: "",
      callToAction: "Scan me",
    };
    writePosterFields(store, "https://a.example/t.zip", fields);
    expect(readPosterFields(store, "https://a.example/t.zip")).toEqual(fields);
    expect(readPosterFields(store, "https://b.example/t.zip")).toBeNull();
  });

  // An emptied field is a choice (D-P7: left off the poster). Reading it
  // back as "missing" would refill it with the default next time.
  it("keeps an emptied field empty", () => {
    const store = memoryStore();
    writePosterFields(store, "L", {
      title: "",
      explanation: "",
      callToAction: "",
    });
    expect(readPosterFields(store, "L")).toEqual({
      title: "",
      explanation: "",
      callToAction: "",
    });
  });

  it("reads nothing from a missing store, a throwing store or a damaged value", () => {
    expect(readPosterFields(undefined, "L")).toBeNull();
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPosterFields(throwing, "L")).toBeNull();
    expect(() => {
      writePosterFields(throwing, "L", defaultPosterFields(null));
    }).not.toThrow();
    const store = memoryStore();
    for (const bad of ["{", "null", "[]", '{"title":3}', '"x"']) {
      store.data.clear();
      writePosterFields(store, "L", defaultPosterFields(null));
      const key = [...store.data.keys()][0] ?? "";
      store.data.set(key, bad);
      expect(readPosterFields(store, "L"), bad).toBeNull();
    }
  });

  it("round-trips any text a creator can type (property)", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.record({
          title: fc.string(),
          explanation: fc.string(),
          callToAction: fc.string(),
        }),
        (link, fields) => {
          const store = memoryStore();
          writePosterFields(store, link, fields);
          expect(readPosterFields(store, link)).toEqual(fields);
        },
      ),
    );
  });
});
