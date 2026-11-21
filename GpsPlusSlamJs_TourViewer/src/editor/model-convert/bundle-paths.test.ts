/**
 * Why these tests matter: a model's text names its other files by
 * relative path, and the text is untrusted. The resolver is the only code
 * that turns such a name into one of the files the creator gave, so it
 * must never answer with a file outside that set (a `../` escape is
 * refused, not guessed), never treat a URL as a file (only `data:` is
 * read; nothing is ever fetched), and still find the files real exporters
 * name sloppily: URL-encoded spaces, backslashes, the wrong case, an
 * absolute path from the artist's own disk.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { normalizeBundlePath, resolveReference } from "./bundle-paths.js";

const FILES = [
  "model/scene.gltf",
  "model/Box With Spaces.bin",
  "model/textures/Wood.PNG",
  "model/textures/stone.jpg",
  "other/stone.jpg",
  "top.bin",
];

const resolve = (uri: string, from = "model/scene.gltf") =>
  resolveReference(uri, from, FILES);

describe("normalizeBundlePath", () => {
  it("folds backslashes, '.' and '..' and drops leading slashes", () => {
    expect(normalizeBundlePath("a\\b\\c.png")).toBe("a/b/c.png");
    expect(normalizeBundlePath("./a/./b/../c.png")).toBe("a/c.png");
    expect(normalizeBundlePath("/a//b.png")).toBe("a/b.png");
  });

  it("refuses a path that climbs out of the root, and an empty one", () => {
    expect(normalizeBundlePath("../a.png")).toBeNull();
    expect(normalizeBundlePath("a/../../b.png")).toBeNull();
    expect(normalizeBundlePath("")).toBeNull();
    expect(normalizeBundlePath("./")).toBeNull();
  });
});

describe("resolveReference", () => {
  it("resolves a relative path against the model's own folder", () => {
    expect(resolve("textures/stone.jpg")).toEqual({
      kind: "file",
      path: "model/textures/stone.jpg",
    });
    expect(resolve("../top.bin")).toEqual({ kind: "file", path: "top.bin" });
  });

  it("percent-decodes the name (Box%20With%20Spaces.bin)", () => {
    expect(resolve("Box%20With%20Spaces.bin")).toEqual({
      kind: "file",
      path: "model/Box With Spaces.bin",
    });
  });

  it("keeps a name whose percent signs are no escape as it is", () => {
    expect(resolveReference("100%.bin", "a.gltf", ["100%.bin"])).toEqual({
      kind: "file",
      path: "100%.bin",
    });
  });

  it("matches the wrong case when only one file matches", () => {
    expect(resolve("TEXTURES/wood.png")).toEqual({
      kind: "file",
      path: "model/textures/Wood.PNG",
    });
  });

  it("falls back to a basename that names exactly one file, e.g. an artist's absolute path", () => {
    expect(resolve("C:\\Users\\artist\\tex\\wood.png")).toEqual({
      kind: "file",
      path: "model/textures/Wood.PNG",
    });
    expect(resolve("maps/Box With Spaces.bin")).toEqual({
      kind: "file",
      path: "model/Box With Spaces.bin",
    });
  });

  it("prefers the exact path over a basename that names several files", () => {
    expect(resolve("textures/stone.jpg")).toEqual({
      kind: "file",
      path: "model/textures/stone.jpg",
    });
    expect(resolve("elsewhere/stone.jpg")).toEqual({
      kind: "missing",
      name: "stone.jpg",
    });
  });

  it("refuses a '../' escape out of the files given, even when the basename exists", () => {
    expect(resolve("../../top.bin")).toEqual({
      kind: "outside",
      name: "top.bin",
    });
  });

  it("answers missing with the decoded file name for the words", () => {
    expect(resolve("scene%201.bin")).toEqual({
      kind: "missing",
      name: "scene 1.bin",
    });
  });

  it("reads only data: among schemes, and fetches nothing", () => {
    const fetched: unknown[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (...args: unknown[]) => {
      fetched.push(args);
      return Promise.reject(new Error("no fetch"));
    };
    try {
      expect(resolve("data:;base64,AAE=")).toEqual({
        kind: "data",
        uri: "data:;base64,AAE=",
      });
      for (const uri of [
        "https://example.invalid/top.bin",
        "http://example.invalid/top.bin",
        "file:///C:/top.bin",
        "blob:https://example.invalid/1234",
      ]) {
        expect(resolve(uri).kind, uri).toBe("scheme");
      }
    } finally {
      globalThis.fetch = original;
    }
    expect(fetched).toEqual([]);
  });

  it("ignores a query and a fragment", () => {
    expect(resolve("textures/stone.jpg?v=2#x")).toEqual({
      kind: "file",
      path: "model/textures/stone.jpg",
    });
  });

  it("treats names such as __proto__ and constructor as plain file names", () => {
    const files = ["__proto__", "constructor", "a/toString"];
    expect(resolveReference("__proto__", "x.gltf", files)).toEqual({
      kind: "file",
      path: "__proto__",
    });
    expect(resolveReference("hasOwnProperty", "x.gltf", files)).toEqual({
      kind: "missing",
      name: "hasOwnProperty",
    });
    expect(resolveReference("TOSTRING", "x.gltf", files)).toEqual({
      kind: "file",
      path: "a/toString",
    });
  });
});

/** Path-like strings built from a small alphabet, so collisions, `..`,
 *  case and separators happen often. */
const pathPart = fc.constantFrom(
  "a",
  "A",
  "b",
  "..",
  ".",
  "",
  "x.bin",
  "X.BIN",
  "t.png",
  "%20",
  "c d",
  "__proto__",
);
const pathish = fc
  .array(pathPart, { minLength: 1, maxLength: 5 })
  .chain((parts) =>
    fc
      .array(fc.constantFrom("/", "\\"), {
        minLength: parts.length - 1,
        maxLength: parts.length - 1,
      })
      .map((seps) => parts.map((p, i) => p + (seps[i] ?? "")).join("")),
  );
const anyReference = fc.oneof(
  pathish,
  fc.string(),
  fc.constantFrom(
    "data:;base64,AAE=",
    "https://h/x.bin",
    "C:\\x\\t.png",
    "//server/x.bin",
  ),
);

describe("resolveReference, properties", () => {
  it("never resolves to a file outside the given set, and is total on any string", () => {
    fc.assert(
      fc.property(
        anyReference,
        pathish,
        fc.array(pathish, { maxLength: 8 }),
        (uri, from, files) => {
          const result = resolveReference(uri, from, files);
          expect(result.kind !== "file" || files.includes(result.path)).toBe(
            true,
          );
        },
      ),
    );
  });

  it("only a data: URI resolves as data, and every other scheme is refused", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9+.-]{1,8}$/),
        fc.string(),
        (scheme, rest) => {
          const result = resolveReference(`${scheme}:${rest}`, "a.gltf", [
            `${scheme}:${rest}`,
          ]);
          expect(result.kind).toBe(scheme === "data" ? "data" : "scheme");
        },
      ),
    );
  });

  it("an exact path wins over a basename that matches another file", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,5}$/),
        fc.stringMatching(/^[a-z]{1,5}$/),
        fc.stringMatching(/^[a-z]{1,5}\.bin$/),
        (dirA, dirB, name) => {
          fc.pre(dirA !== dirB);
          const files = [`${dirB}/${name}`, `${dirA}/${name}`];
          expect(resolveReference(name, `${dirA}/m.gltf`, files)).toEqual({
            kind: "file",
            path: `${dirA}/${name}`,
          });
        },
      ),
    );
  });

  it("normalisation is idempotent and never leaves '.', '..', backslashes or empty segments", () => {
    fc.assert(
      fc.property(fc.oneof(pathish, fc.string()), (path) => {
        const once = normalizeBundlePath(path);
        if (once === null) return;
        expect(normalizeBundlePath(once)).toBe(once);
        expect(once.includes("\\")).toBe(false);
        for (const segment of once.split("/")) {
          expect(["", ".", ".."]).not.toContain(segment);
        }
      }),
    );
  });
});
