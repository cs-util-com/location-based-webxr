/**
 * Every reader of a `.glb`'s chunks in the Tour Viewer, run against the
 * same bytes: the tour's own check (`checkGlbInert`), the model
 * optimizer's `readGlb` and the optimizer check page's `glbByteShares`.
 *
 * Why this test matters: the three used to carry their own copy of the
 * chunk walk, and the copies did not agree on malformed files (the check
 * page's copy read past a wrong version, a header length that is not the
 * data's, and extra chunks). They now share one reader, so a file one of
 * them refuses must be refused by all, and a file the tour accepts must be
 * readable by all. A change to one reader that the others do not follow
 * shows up here.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkGlbInert } from "gps-plus-slam-app-framework/ar/tour-media";
import { glbByteShares } from "../../checks/asset-optimizer-check.js";
import { readGlb } from "./glb-file.js";

const MAGIC = 0x46546c67;
const JSON_TYPE = 0x4e4f534a;
const BIN_TYPE = 0x004e4942;

interface Chunk {
  readonly type: number;
  readonly data: Uint8Array;
  /** The length written in the chunk header, when not `data.length`. */
  readonly length?: number;
}

/** A GLB of `chunks`, with header fields overridable to make broken files. */
function build(
  chunks: readonly Chunk[],
  header: { magic?: number; version?: number; total?: number } = {},
): Uint8Array {
  const size = chunks.reduce((sum, c) => sum + 8 + c.data.length, 12);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, header.magic ?? MAGIC, true);
  view.setUint32(4, header.version ?? 2, true);
  view.setUint32(8, header.total ?? size, true);
  let at = 12;
  for (const chunk of chunks) {
    view.setUint32(at, chunk.length ?? chunk.data.length, true);
    view.setUint32(at + 4, chunk.type, true);
    out.set(chunk.data, at + 8);
    at += 8 + chunk.data.length;
  }
  return out;
}

/** `json` as JSON chunk data, space-padded to `pad` bytes (4 = the spec). */
function jsonData(json: unknown, pad = 4): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const length = Math.ceil(text.length / pad) * pad;
  const out = new Uint8Array(length).fill(0x20);
  out.set(text, 0);
  return out;
}

const MODEL = {
  asset: { version: "2.0" },
  buffers: [{ byteLength: 8 }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }],
};
const BARE = { asset: { version: "2.0" } };

const json = (value: unknown = MODEL): Chunk => ({
  type: JSON_TYPE,
  data: jsonData(value),
});
const bin = (length = 8): Chunk => ({
  type: BIN_TYPE,
  data: new Uint8Array(length),
});

/** What each reader makes of `bytes`: accepted (true) or refused. */
function verdicts(bytes: Uint8Array): {
  inert: boolean;
  optimizer: boolean;
  shares: boolean;
} {
  let shares: boolean;
  try {
    glbByteShares(bytes);
    shares = true;
  } catch {
    shares = false;
  }
  return {
    inert: checkGlbInert(bytes).ok,
    optimizer: readGlb(bytes).ok,
    shares,
  };
}

const ALL = { inert: true, optimizer: true, shares: true };
const NONE = { inert: false, optimizer: false, shares: false };

describe("the GLB chunk readers on the same bytes", () => {
  it("all read a JSON chunk with a binary chunk, and one without", () => {
    expect(verdicts(build([json(), bin()]))).toEqual(ALL);
    expect(verdicts(build([json(BARE)]))).toEqual(ALL);
  });

  it("all accept a JSON chunk that is not padded to 4 bytes", () => {
    // The spec asks for 4-byte padding; the tour has always accepted an
    // unpadded JSON chunk, and three.js reads one, so refusing it now
    // would refuse tours that open today.
    expect(
      verdicts(build([{ type: JSON_TYPE, data: jsonData(BARE, 1) }])),
    ).toEqual(ALL);
    const odd = jsonData(MODEL, 1);
    expect(odd.length % 4).not.toBe(0);
    expect(verdicts(build([{ type: JSON_TYPE, data: odd }, bin()]))).toEqual(
      ALL,
    );
  });

  it("all refuse a file shorter than the header and the first chunk header", () => {
    const whole = build([json(BARE)]);
    for (const length of [0, 8, 12, 19]) {
      expect(verdicts(whole.slice(0, length))).toEqual(NONE);
    }
  });

  it("all refuse a wrong magic and a version other than 2", () => {
    expect(verdicts(build([json()], { magic: 0x12345678 }))).toEqual(NONE);
    expect(verdicts(build([json(), bin()], { version: 1 }))).toEqual(NONE);
    expect(verdicts(build([json(), bin()], { version: 3 }))).toEqual(NONE);
  });

  it("all refuse a chunk whose length runs past the buffer", () => {
    const longJson = { ...json(BARE), length: 4096 };
    expect(verdicts(build([longJson]))).toEqual(NONE);
    expect(verdicts(build([json(), { ...bin(), length: 400 }]))).toEqual(NONE);
  });

  it("all refuse a header length that is not the data's, and data past the last chunk", () => {
    const model = build([json(), bin()]);
    expect(
      verdicts(build([json(), bin()], { total: model.length - 4 })),
    ).toEqual(NONE);
    const trailing = new Uint8Array(model.length + 8);
    trailing.set(model, 0);
    new DataView(trailing.buffer).setUint32(8, trailing.length, true);
    expect(verdicts(trailing)).toEqual(NONE);
  });

  it("all refuse a first chunk that is not JSON, and a chunk after the binary one", () => {
    expect(verdicts(build([{ type: BIN_TYPE, data: jsonData(BARE) }]))).toEqual(
      NONE,
    );
    expect(verdicts(build([json(), json(BARE)]))).toEqual(NONE);
    expect(verdicts(build([json(), bin(), bin()]))).toEqual(NONE);
  });

  it("all refuse a JSON chunk that does not parse, or is no object", () => {
    const text = new TextEncoder().encode("{ not json ");
    const broken = new Uint8Array(12).fill(0x20);
    broken.set(text, 0);
    expect(verdicts(build([{ type: JSON_TYPE, data: broken }]))).toEqual(NONE);
    expect(verdicts(build([json([1, 2])]))).toEqual(NONE);
    expect(verdicts(build([json(null)]))).toEqual(NONE);
  });

  // The property below found this one (a "buffer" key changed by one byte
  // to "#uffer"): the tour refused a view that names no buffer while the
  // check page measured it. A view must name a buffer of the file, by a
  // whole number below the buffer count, for every reader.
  it("all refuse a buffer view that names no buffer of the file", () => {
    const viewOver = (view: object, buffers: object[] = [{ byteLength: 0 }]) =>
      build([
        json({ asset: { version: "2.0" }, buffers, bufferViews: [view] }),
        bin(0),
      ]);
    // The shrunk counterexample of seed -1948290153.
    expect(
      verdicts(viewOver({ "#uffer": 0, byteOffset: 0, byteLength: 0 })),
    ).toEqual(NONE);
    // The shrunk counterexample of seed -845185933: the same class over a
    // 16-byte binary chunk its one buffer covers.
    expect(
      verdicts(
        build([
          json({
            asset: { version: "2.0" },
            buffers: [{ byteLength: 16 }],
            bufferViews: [{ " uffer": 0, byteOffset: 0, byteLength: 16 }],
          }),
          bin(16),
        ]),
      ),
    ).toEqual(NONE);
    expect(
      verdicts(viewOver({ buffer: 1, byteOffset: 0, byteLength: 0 })),
    ).toEqual(NONE);
    expect(
      verdicts(viewOver({ buffer: 0, byteOffset: 0, byteLength: 0 }, [])),
    ).toEqual(NONE);
    expect(
      verdicts(viewOver({ buffer: 0, byteOffset: 0, byteLength: 0 })),
    ).toEqual(ALL);
  });

  // The tour refuses a buffer or a picture that points outside the file
  // (three.js would fetch it); the check page must not measure one either,
  // or the two disagree on a file the tour never takes.
  it("the tour and the check page refuse a buffer or a picture that points outside the file", () => {
    const outside = { inert: false, shares: false };
    expect(
      verdicts(
        build([
          json({ ...MODEL, buffers: [{ byteLength: 8, uri: "model.bin" }] }),
          bin(),
        ]),
      ),
    ).toMatchObject(outside);
    expect(
      verdicts(
        build([
          json({
            ...MODEL,
            images: [{ uri: "https://example.invalid/a.png" }],
          }),
          bin(),
        ]),
      ),
    ).toMatchObject(outside);
    expect(
      verdicts(build([json({ ...MODEL, images: {} }), bin()])),
    ).toMatchObject(outside);
  });
});

/** A well-formed GLB: an object JSON chunk (padded to `pad`) naming
 *  `views` buffer views over an optional binary chunk. */
const wellFormed = fc
  .record({
    binLength: fc.integer({ min: 0, max: 64 }).map((n) => n * 4),
    pad: fc.constantFrom(1, 2, 4),
    withBin: fc.boolean(),
    name: fc.string({ maxLength: 12 }),
  })
  .map(({ binLength, pad, withBin, name }) => {
    const model = withBin
      ? {
          asset: { version: "2.0", generator: name },
          buffers: [{ byteLength: binLength }],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binLength }],
        }
      : { asset: { version: "2.0", generator: name } };
    const chunks: Chunk[] = [{ type: JSON_TYPE, data: jsonData(model, pad) }];
    if (withBin) chunks.push(bin(binLength));
    return build(chunks);
  });

describe("the GLB chunk readers agree (properties)", () => {
  it("every well-formed GLB is read by all of them", () => {
    fc.assert(
      fc.property(wellFormed, (bytes) => {
        expect(verdicts(bytes)).toEqual(ALL);
      }),
    );
  });

  it("random bytes, and a well-formed GLB with one byte changed, get one verdict from all", () => {
    const changed = fc
      .tuple(wellFormed, fc.nat(), fc.integer({ min: 0, max: 255 }))
      .map(([bytes, at, value]) => {
        const out = bytes.slice();
        out[at % out.length] = value;
        return out;
      });
    const random = fc.uint8Array({ maxLength: 96 });
    fc.assert(
      fc.property(fc.oneof(changed, random), (bytes) => {
        const { inert, optimizer, shares } = verdicts(bytes);
        // What the tour's check refuses, no reader takes. What it accepts,
        // the check page can measure (this generator names no image, so
        // the image lookups never decide); the optimizer may still refuse
        // a changed buffer view, which is its own check, not the chunks'.
        expect(optimizer && !inert).toBe(false);
        expect(shares).toBe(inert);
      }),
    );
  });
});
