import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import {
  classifyEditorFile,
  classifyEditorFiles,
} from "./classify-editor-file.js";
import { NOT_A_TOUR, NOT_A_ZIP } from "./editor-open.js";

async function zipFile(
  name: string,
  entries: readonly { path: string; data: string }[],
): Promise<File> {
  const blob = await packFilesAsZip(entries);
  return new File([blob], name, { type: "application/zip" });
}

/** A File that counts the bytes its readers slice out of it. */
class CountingFile extends File {
  bytesRead = 0;
  override slice(start?: number, end?: number, type?: string): Blob {
    const part = super.slice(start, end, type);
    this.bytesRead += part.size;
    return part;
  }
}

const IDENTITY = JSON.stringify({
  format: 1,
  seriesId: null,
  tour: "Castle walk",
  file: "castle.zip",
  writtenAt: "2026-11-19T10:00:00.000Z",
});

/**
 * Why these tests matter: the editor decides from this what a dropped or
 * chosen file IS before opening anything - a tour opens, a scan is added
 * beside a tour, anything else is refused in words. A scan read as a tour
 * would open a recording as an empty tour; a tour read as a scan would
 * never open.
 */
describe("classifyEditorFile", () => {
  it("sorts a tour.json zip as a tour", async () => {
    const file = await zipFile("castle.zip", [
      { path: "tour.json", data: "{}" },
    ]);
    expect(await classifyEditorFile(file)).toEqual({ kind: "tour", file });
  });

  it("sorts a zip of printed codes only as a tour", async () => {
    const file = await zipFile("codes.zip", [
      { path: "qr/abc.json", data: "{}" },
    ]);
    expect((await classifyEditorFile(file)).kind).toBe("tour");
  });

  // Why: a tour may carry its own walk; it is still the tour, never a scan.
  it("sorts a tour that carries a walk as a tour", async () => {
    const file = await zipFile("walked.zip", [
      { path: "tour.json", data: "{}" },
      { path: "actions/000001.json", data: "[]" },
    ]);
    expect((await classifyEditorFile(file)).kind).toBe("tour");
  });

  it("sorts a plain Recorder zip as a recording scan", async () => {
    const file = await zipFile("walk.zip", [
      { path: "session.json", data: "{}" },
      { path: "actions/000001.json", data: "[]" },
    ]);
    expect(await classifyEditorFile(file)).toEqual({
      kind: "scan",
      file,
      scan: { kind: "recording" },
    });
  });

  it("sorts a debug bundle as a bundle scan with its identity", async () => {
    const file = await zipFile("castle-debug.zip", [
      { path: "actions/000001.json", data: "[]" },
      { path: "debug-bundle.json", data: IDENTITY },
    ]);
    const kind = await classifyEditorFile(file);
    expect(kind.kind).toBe("scan");
    if (kind.kind !== "scan" || kind.scan.kind !== "bundle") throw new Error();
    expect(kind.scan.identity.tour).toBe("Castle walk");
  });

  // Why: the e2e refusal specs drop a zip of only a session.json; it must
  // keep saying it is not a tour, as the open did before.
  it("refuses a zip with neither a tour nor a recording as not a tour", async () => {
    const file = await zipFile("session.zip", [
      { path: "session.json", data: "{}" },
    ]);
    expect(await classifyEditorFile(file)).toEqual({
      kind: "neither",
      file,
      reason: NOT_A_TOUR,
    });
  });

  it("refuses a file that is not a zip by name, and one whose bytes are not", async () => {
    const text = new File(["hello"], "notes.txt", { type: "text/plain" });
    expect(await classifyEditorFile(text)).toEqual({
      kind: "neither",
      file: text,
      reason: NOT_A_ZIP,
    });
    const fake = new File(["not a zip"], "fake.zip", {
      type: "application/zip",
    });
    const kind = await classifyEditorFile(fake);
    expect(kind.kind).toBe("neither");
  });

  it("refuses a bundle whose identity is unreadable, with the bundle's reason", async () => {
    const file = await zipFile("bad.zip", [
      { path: "actions/000001.json", data: "[]" },
      { path: "debug-bundle.json", data: "{ not json" },
    ]);
    const kind = await classifyEditorFile(file);
    expect(kind.kind).toBe("neither");
    if (kind.kind !== "neither") throw new Error();
    expect(kind.reason).not.toBe(NOT_A_TOUR);
  });

  // Why: the plan's "chips without reading the scan" - a scan sorts from
  // its directory; its walk's bytes are never read.
  it("reads only the directory of a scan, never its walk", async () => {
    const big = "x".repeat(2_000_000);
    const blob = await packFilesAsZip([
      { path: "actions/000001.json", data: big },
      { path: "content/photo.jpg", data: big },
    ]);
    const file = new CountingFile([blob], "walk.zip", {
      type: "application/zip",
    });
    expect((await classifyEditorFile(file)).kind).toBe("scan");
    expect(file.bytesRead).toBeGreaterThan(0);
    // The byte source reads in cache blocks (tens of KB): a fixed cost,
    // not one that grows with the walk.
    expect(file.bytesRead).toBeLessThan(200_000);
    expect(file.size).toBeGreaterThan(4_000_000);
  });

  // Why: a list sorts every file, in its order, and one bad file costs
  // only itself.
  it("sorts every file of a list, in order", async () => {
    const tour = await zipFile("t.zip", [{ path: "tour.json", data: "{}" }]);
    const scan = await zipFile("s.zip", [
      { path: "actions/1.json", data: "[]" },
    ]);
    const text = new File(["x"], "x.txt");
    const kinds = await classifyEditorFiles([tour, text, scan]);
    expect(kinds.map((k) => k.kind)).toEqual(["tour", "neither", "scan"]);
    expect(kinds.map((k) => k.file)).toEqual([tour, text, scan]);
  });

  // Why: the file is untrusted - whatever entry names it carries, the
  // classifier answers and never rejects, and a tour entry always wins.
  it("never rejects, and a tour entry always makes a tour", async () => {
    const name = fc.oneof(
      fc.constantFrom(
        "tour.json",
        "qr/a.json",
        "actions/1.json",
        "debug-bundle.json",
      ),
      fc.stringMatching(/^[a-z]{1,6}(\/[a-z]{1,6}){0,2}\.(json|jpg|bin)$/),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(name, { maxLength: 6 }),
        async (names) => {
          const file = await zipFile(
            "f.zip",
            names.map((path) => ({ path, data: "{}" })),
          );
          const kind = await classifyEditorFile(file);
          const tourish = names.some(
            (n) => n === "tour.json" || /^qr\/[^/]+\.json$/.test(n),
          );
          const walk = names.some((n) => n.startsWith("actions/"));
          const allowed = tourish
            ? ["tour"]
            : walk
              ? ["scan", "neither"]
              : ["neither"];
          expect(allowed).toContain(kind.kind);
        },
      ),
      { numRuns: 60 },
    );
  });
});
