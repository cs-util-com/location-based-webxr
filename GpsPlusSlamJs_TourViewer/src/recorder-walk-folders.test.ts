/**
 * Why this test matters (S1 milestone review #3): the lean published copy
 * leaves out the creator's walk, which `tour-read-set.ts` defines by what a
 * recording WRITES. Besides session.json, actions/ and the frames, the
 * Recorder's zip contributors add whole folders - the COLMAP export under
 * sparse/ (the occupancy point cloud and every frame's camera pose) and
 * refPoints/ (timestamped GPS points) - and a first version of the rule
 * missed both, publishing the scan it was meant to leave out. The Tour
 * Viewer cannot import the Recorder, so this reads the Recorder's
 * contributors and fails when one is added or renamed without a decision
 * here: is its folder the walk, or something visitors read?
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEmptyTourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { scanEntryNames } from "./tour-read-set";

const RECORDER_SRC = fileURLToPath(
  new URL("../../GpsPlusSlamJs_RecorderApp/src", import.meta.url),
);

/** Every `subdir:` a Recorder zip contributor declares, literal or via a
 *  same-file constant. */
function contributorSubdirs(): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/zip-contributor\.ts$/.test(entry.name)) {
        const text = readFileSync(path, "utf8");
        for (const m of text.matchAll(/subdir:\s*([A-Za-z_'"][\w'"]*)/g)) {
          const token = m[1]!;
          const literal = /^['"](\w+)['"]$/.exec(token)?.[1];
          const viaConst = new RegExp(
            String.raw`const ${token}\s*=\s*['"](\w+)['"]`,
          ).exec(text)?.[1];
          found.set(entry.name, literal ?? viaConst ?? `?${token}`);
        }
      }
    }
  };
  walk(RECORDER_SRC);
  return found;
}

/** The decision per Recorder folder: the walk, or what visitors read. */
const DECIDED: Record<string, "walk" | "visitor"> = {
  sparse: "walk",
  refPoints: "walk",
  qr: "visitor", // the code levels a visitor's viewer relocalizes against
};

describe("the Recorder's zip folders are each decided for the lean copy", () => {
  it("every contributor's folder is known here", () => {
    const subdirs = [...contributorSubdirs().values()].sort();
    expect(subdirs).toEqual(Object.keys(DECIDED).sort());
  });

  it("the walk's folders are left out of a recording tour's lean copy, the visitor's kept", () => {
    const names = [
      "tour.json",
      "actions/000001.json",
      "sparse/0/points3D.txt",
      "sparse/0/images.txt",
      "refPoints/ref-1.json",
      "qr/abc123.json",
    ];
    const walk = scanEntryNames(names, createEmptyTourManifest(), "");
    for (const [folder, decision] of Object.entries(DECIDED)) {
      const inFolder = names.filter((n) => n.startsWith(`${folder}/`));
      for (const name of inFolder) {
        expect(walk.includes(name), name).toBe(decision === "walk");
      }
    }
  });
});
