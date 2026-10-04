/**
 * Why these tests matter: the signature line is what a visitor reads to
 * decide whether to trust a tour (tour kit plan K1, K-D2), so its wording
 * is behaviour. Three rules are pinned here: a signature the browser could
 * not check never reads as checked; a key is never called a person; and
 * every warning names the key it expected and the one it got, by the same
 * short fingerprint the "signed by" line uses.
 */

import { describe, expect, it } from "vitest";

import { trustLines, type TrustCopyInput } from "./tour-trust-copy.js";

const A = "did:key:A";
const B = "did:key:B";
const fingerprintOf = (author: string): string =>
  author === A ? "aaaa 1111 aaaa" : "bbbb 2222 bbbb";

function lines(input: Partial<TrustCopyInput>): string[] {
  return trustLines({
    signature: { kind: "none" },
    warnings: [],
    links: [],
    fingerprintOf,
    ...input,
  });
}

describe("trustLines", () => {
  it("names the signing key by its fingerprint, and says a key is not a person", () => {
    const [line] = lines({ signature: { kind: "signed", author: A } });
    expect(line).toContain("Signed by key aaaa 1111 aaaa");
    expect(line).toContain("not a verified person");
  });

  it("a signature this browser cannot check is said to be NOT checked, never valid", () => {
    const [line] = lines({ signature: { kind: "unsupported", author: A } });
    expect(line).toContain("this browser cannot check signatures");
    expect(line).toContain("NOT checked");
    expect(line).not.toMatch(/has not been changed/);
  });

  it("an unsigned tour says so plainly, with or without a list of its files", () => {
    expect(lines({ signature: { kind: "none" } })[0]).toMatch(
      /^Not signed: there is no way to check/,
    );
    expect(lines({ signature: { kind: "listed" } })[0]).toMatch(
      /^Not signed: its files match/,
    );
  });

  it("words each trust warning with both keys", () => {
    const out = lines({
      signature: { kind: "signed", author: B },
      warnings: [
        { kind: "source-key-changed", source: "link", was: A, now: B },
        { kind: "source-lost-signature", source: "code", was: A },
        { kind: "series-key-changed", seriesId: "S", was: A, now: null },
      ],
    });
    expect(out[1]).toBe(
      "Warning: this link used to open a tour signed by key aaaa 1111 aaaa. This one is signed by key bbbb 2222 bbbb, so it may not come from the same author.",
    );
    expect(out[2]).toContain(
      "this printed code used to open a tour signed by key aaaa 1111 aaaa",
    );
    expect(out[2]).toContain("This copy is not signed");
    expect(out[3]).toContain("This one is not signed.");
  });

  it("lists linked series, marking the ones signed by the same key", () => {
    const out = lines({
      signature: { kind: "signed", author: A },
      links: [
        { seriesId: "K7fQ2mX9pL4sT8vB1nR6wA", author: A },
        { seriesId: "Z9yX8wV7uT6sR5qP4oN3mL", author: B },
      ],
    });
    expect(out.at(-1)).toBe(
      "Links to 2 other tours: K7fQ2mX9 (same key), Z9yX8wV7 (key bbbb 2222 bbbb).",
    );
  });

  it("never calls a link 'same key' when the tour itself is not signed by it", () => {
    const out = lines({
      signature: { kind: "unsupported", author: A },
      links: [{ seriesId: "K7fQ2mX9pL4sT8vB1nR6wA", author: A }],
    });
    expect(out.at(-1)).toBe(
      "Links to 1 other tour: K7fQ2mX9 (key aaaa 1111 aaaa).",
    );
  });

  it("adds no links line without links", () => {
    expect(lines({})).toHaveLength(1);
  });
});
