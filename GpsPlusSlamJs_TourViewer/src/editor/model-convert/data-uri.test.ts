/**
 * Why these tests matter: a `.gltf` may carry its buffers and pictures as
 * `data:` URIs, and the text is untrusted. The decoder must refuse a URI
 * whose decoded size passes the cap BEFORE it allocates (a short header
 * can announce a huge payload only through its length, which is checked
 * first), and must never accept anything but strict base64, so a garbled
 * file is a refusal in words, not a half-decoded buffer.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { decodeDataUri, decodedLengthOf } from "./data-uri.js";

const encode = (bytes: Uint8Array, mime = "application/octet-stream") =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

describe("decodeDataUri", () => {
  it("decodes a base64 URI and reads its MIME type", () => {
    const result = decodeDataUri(
      encode(Uint8Array.of(1, 2, 3), "image/png"),
      10,
    );
    expect(result).toEqual({
      ok: true,
      bytes: Uint8Array.of(1, 2, 3),
      mime: "image/png",
    });
  });

  it("takes parameters before ;base64 and an empty MIME type", () => {
    const withParam = decodeDataUri(
      "data:text/plain;charset=utf-8;base64,AAE=",
      9,
    );
    expect(withParam).toEqual({
      ok: true,
      bytes: Uint8Array.of(0, 1),
      mime: "text/plain",
    });
    const bare = decodeDataUri("data:;base64,AAE=", 9);
    expect(bare).toEqual({ ok: true, bytes: Uint8Array.of(0, 1), mime: "" });
  });

  it("refuses a URI that is not strict base64, or not a data URI", () => {
    for (const uri of [
      "data:,hello",
      "data:text/plain,%41",
      "data:;base64,AA E=",
      "data:;base64,A",
      "data:;base64,AAE=AAE=",
      "data:;base64,AA*=",
      "data;base64,AAE=",
      "https://example.invalid/x.bin",
      "",
    ]) {
      expect(decodeDataUri(uri, 100), uri).toEqual({
        ok: false,
        why: "malformed",
      });
    }
  });

  it("refuses an over-cap URI from its length alone, before decoding", () => {
    // A payload of 4 MiB of "A" decodes to 3 MiB; at a 1 MiB cap the
    // refusal must come without the decode (a malformed tail proves it:
    // decoding first would report "malformed").
    const uri = "data:;base64," + "A".repeat(4 * 1024 * 1024 - 4) + "A*==";
    expect(decodeDataUri(uri, 1024 * 1024)).toEqual({
      ok: false,
      why: "too-large",
    });
  });

  it("accepts a URI of exactly the cap", () => {
    const result = decodeDataUri(encode(new Uint8Array(30)), 30);
    expect(result.ok).toBe(true);
  });
});

describe("decodeDataUri, properties", () => {
  it("round-trips any bytes and any cap at least their length", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 300 }),
        fc.nat(50),
        (bytes, slack) => {
          const result = decodeDataUri(encode(bytes), bytes.length + slack);
          expect(result).toEqual({
            ok: true,
            bytes,
            mime: "application/octet-stream",
          });
        },
      ),
    );
  });

  it("refuses every URI whose bytes exceed the cap, and the length it judges by is exact", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 300 }), (bytes) => {
        const payload = Buffer.from(bytes).toString("base64");
        expect(decodedLengthOf(payload)).toBe(bytes.length);
        expect(decodeDataUri(encode(bytes), bytes.length - 1)).toEqual({
          ok: false,
          why: "too-large",
        });
      }),
    );
  });

  it("never throws on any string", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(1000), (text, cap) => {
        expect(() => decodeDataUri(text, cap)).not.toThrow();
        expect(() => decodeDataUri("data:;base64," + text, cap)).not.toThrow();
      }),
    );
  });
});
