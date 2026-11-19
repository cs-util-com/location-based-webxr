import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyEditorFile } from "./classify-editor-file.js";

const CORPUS = fileURLToPath(
  new URL("../../../GpsPlusSlamJs_ExampleRecordings/", import.meta.url),
);

/** A File over a file on disk that counts the bytes sliced out of it. */
class CountingFile extends File {
  bytesRead = 0;
  override slice(start?: number, end?: number, type?: string): Blob {
    const part = super.slice(start, end, type);
    this.bytesRead += part.size;
    return part;
  }
}

/**
 * Why this test matters: a scan's chip should appear at once, so a scan
 * must sort from its zip directory without its walk being read. On the
 * repo's real Recorder zips (the largest some 70 MB) it must sort as a
 * scan and read a small fixed share of the file. The bytes read are the
 * machine-independent bound (the time follows from them; a clock would
 * make the verdict depend on the machine). Each line printed is the
 * measurement: file, size, bytes read.
 */
describe("classifying the example Recorder zips", () => {
  const zips = fs.existsSync(CORPUS)
    ? fs.readdirSync(CORPUS).filter((n) => n.endsWith(".zip"))
    : [];

  it.skipIf(zips.length === 0)(
    "sorts every one as a scan from its directory alone",
    async () => {
      for (const name of zips) {
        const disk = await fs.openAsBlob(path.join(CORPUS, name));
        const file = new CountingFile([disk], name, {
          type: "application/zip",
        });
        const kind = await classifyEditorFile(file);
        console.log(
          `classify ${name}: ${(file.size / 1e6).toFixed(1)} MB, read ${(
            file.bytesRead / 1e3
          ).toFixed(0)} kB`,
        );
        expect(kind.kind).toBe("scan");
        expect(file.bytesRead).toBeLessThan(Math.max(2e6, file.size / 50));
      }
    },
  );
});
