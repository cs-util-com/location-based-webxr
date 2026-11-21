/**
 * Why these tests matter: a model's text names its other files by
 * relative path, and the text is untrusted. The resolver is the only code
 * that turns such a name into one of the files the creator gave, so it
 * must never answer with a file outside that set (a `../` escape is
 * refused, not guessed, however it is encoded), never treat a URL as a
 * file (only `data:` is read; nothing is ever fetched), still find the
 * files real exporters name sloppily (URL-encoded spaces, backslashes,
 * the wrong case, a macOS name in another Unicode form, a path on the
 * artist's own computer), and say when it guessed, so the creator can be
 * told which file stood in for a name.
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
      match: "exact",
    });
    expect(resolve("../top.bin")).toEqual({
      kind: "file",
      path: "top.bin",
      match: "exact",
    });
  });

  it("percent-decodes the name (Box%20With%20Spaces.bin)", () => {
    expect(resolve("Box%20With%20Spaces.bin")).toEqual({
      kind: "file",
      path: "model/Box With Spaces.bin",
      match: "exact",
    });
  });

  it("matches a macOS (NFD) file name to its percent-encoded NFC spelling, and the other way round", () => {
    const nfd = "model/Cafe\u0301.bin";
    expect(resolveReference("Caf%C3%A9.bin", "model/m.gltf", [nfd])).toEqual({
      kind: "file",
      path: nfd,
      match: "exact",
    });
    expect(
      resolveReference("Cafe%CC%81.bin", "model/m.gltf", [
        "model/Caf\u00e9.bin",
      ]),
    ).toEqual({ kind: "file", path: "model/Caf\u00e9.bin", match: "exact" });
  });

  it("keeps a name whose percent signs are no escape as it is", () => {
    expect(resolveReference("100%.bin", "a.gltf", ["100%.bin"])).toEqual({
      kind: "file",
      path: "100%.bin",
      match: "exact",
    });
  });

  it("matches the wrong case when only one file matches, and says so", () => {
    expect(resolve("TEXTURES/wood.png")).toEqual({
      kind: "file",
      path: "model/textures/Wood.PNG",
      match: "case",
    });
  });

  it("falls back to a basename that names exactly one file, e.g. a path on the artist's computer, and says so", () => {
    for (const uri of [
      "C:\\Users\\artist\\tex\\wood.png",
      "C:wood.png",
      "file:///C:/Users/artist/tex/wood.png",
      "//server/share/wood.png",
    ]) {
      expect(resolve(uri), uri).toEqual({
        kind: "file",
        path: "model/textures/Wood.PNG",
        match: "basename",
      });
    }
    expect(resolve("maps/Box With Spaces.bin")).toEqual({
      kind: "file",
      path: "model/Box With Spaces.bin",
      match: "basename",
    });
  });

  it("without the basename fallback, a path on another computer is elsewhere and a wrong folder is missing", () => {
    const strict = (uri: string) =>
      resolveReference(uri, "model/scene.gltf", FILES, { byBasename: false });
    expect(strict("C:\\Users\\artist\\top.bin")).toEqual({
      kind: "elsewhere",
      name: "top.bin",
    });
    expect(strict("file:///C:/data/top.bin")).toEqual({
      kind: "elsewhere",
      name: "top.bin",
    });
    expect(strict("maps/Box With Spaces.bin")).toEqual({
      kind: "missing",
      name: "Box With Spaces.bin",
    });
    // The case-insensitive match stays: it cannot pick a file from
    // another folder.
    expect(strict("box with spaces.BIN")).toEqual({
      kind: "file",
      path: "model/Box With Spaces.bin",
      match: "case",
    });
  });

  it("a path on another computer that no file stands in for is elsewhere, not missing", () => {
    expect(resolve("D:\\renders\\gone.png")).toEqual({
      kind: "elsewhere",
      name: "gone.png",
    });
  });

  it("prefers the exact path over a basename that names several files", () => {
    expect(resolve("textures/stone.jpg")).toEqual({
      kind: "file",
      path: "model/textures/stone.jpg",
      match: "exact",
    });
    expect(resolve("elsewhere/stone.jpg")).toEqual({
      kind: "missing",
      name: "stone.jpg",
    });
  });

  it("refuses a '../' escape out of the files given, even when the basename exists, however it is encoded", () => {
    for (const uri of [
      "../../top.bin",
      "%2e%2e/%2e%2e/top.bin",
      "..%5c..%5ctop.bin",
      "..\\..\\top.bin",
    ]) {
      expect(resolve(uri), uri).toEqual({ kind: "outside", name: "top.bin" });
    }
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
        "blob:https://example.invalid/1234",
      ]) {
        expect(resolve(uri).kind, uri).toBe("scheme");
      }
      expect(resolve("file:///C:/top.bin").kind).toBe("file");
    } finally {
      globalThis.fetch = original;
    }
    expect(fetched).toEqual([]);
  });

  it("ignores a query and a fragment", () => {
    expect(resolve("textures/stone.jpg?v=2#x")).toEqual({
      kind: "file",
      path: "model/textures/stone.jpg",
      match: "exact",
    });
  });

  it("treats names such as __proto__ and constructor as plain file names", () => {
    const files = ["__proto__", "constructor", "a/toString"];
    expect(resolveReference("__proto__", "x.gltf", files)).toEqual({
      kind: "file",
      path: "__proto__",
      match: "exact",
    });
    expect(resolveReference("hasOwnProperty", "x.gltf", files)).toEqual({
      kind: "missing",
      name: "hasOwnProperty",
    });
    expect(resolveReference("TOSTRING", "x.gltf", files)).toEqual({
      kind: "file",
      path: "a/toString",
      match: "basename",
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
  "%2e%2e",
  "c d",
  "e\u0301",
  "\u00e9",
  "__proto__",
);
const pathish = fc
  .array(pathPart, { minLength: 1, maxLength: 5 })
  .chain((parts) =>
    fc
      .array(fc.constantFrom("/", "\\", "%5c"), {
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
    "C:t.png",
    "file:///C:/x/t.png",
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
        fc.boolean(),
        (uri, from, files, byBasename) => {
          const result = resolveReference(uri, from, files, { byBasename });
          expect(result.kind !== "file" || files.includes(result.path)).toBe(
            true,
          );
        },
      ),
    );
  });

  it("without the basename fallback, every file found is in the folder the path names", () => {
    fc.assert(
      fc.property(
        pathish,
        pathish,
        fc.array(pathish, { maxLength: 8 }),
        (uri, from, files) => {
          const result = resolveReference(uri, from, files, {
            byBasename: false,
          });
          expect(result.kind === "file" ? result.match : "exact").not.toBe(
            "basename",
          );
        },
      ),
    );
  });

  it("only a data: URI resolves as data, file: is a path, and every other scheme is refused", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9+.-]{1,8}$/),
        fc.string(),
        (scheme, rest) => {
          const result = resolveReference(`${scheme}:${rest}`, "a.gltf", [
            `${scheme}:${rest}`,
          ]);
          const expected =
            scheme === "data"
              ? ["data"]
              : scheme === "file"
                ? ["file", "elsewhere"]
                : ["scheme"];
          expect(expected).toContain(result.kind);
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
            match: "exact",
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
