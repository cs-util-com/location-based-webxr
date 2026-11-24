import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  checkGlbInert,
  checkImageWithinCap,
} from "gps-plus-slam-app-framework/ar/tour-media";
import {
  isTourBlockChild,
  tourStories,
} from "gps-plus-slam-app-framework/ar/tour-story";

// Why these tests matter: the anchor field test runs on a phone through
// this committed file (scripts/build-anchor-test-tour.mjs), opened with
// `?relocate=here`. Nothing else checks it: a tour missing one of the
// cases the test walks for (a tall animated model, ten or more pins with a
// wide label, an edge hint and a character's story), or a file the viewer
// refuses, would only show in the field. These read the committed file
// through the parsers and checks the viewer uses.

const ZIP = fileURLToPath(
  new URL("../public/samples/anchor-test-tour.zip", import.meta.url),
);

async function entries(): Promise<Map<string, Uint8Array>> {
  const reader = new ZipReader(new BlobReader(new Blob([readFileSync(ZIP)])));
  const out = new Map<string, Uint8Array>();
  for (const entry of await reader.getEntries()) {
    if (entry.directory || entry.getData === undefined) continue;
    out.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
  }
  await reader.close();
  return out;
}

async function manifest(): Promise<TourManifest> {
  const files = await entries();
  return parseTourManifest(
    JSON.parse(new TextDecoder().decode(files.get("tour.json"))) as unknown,
  );
}

/** The JSON chunk of a binary glTF. */
function glbJson(bytes: Uint8Array): {
  nodes: { name?: string; children?: number[]; translation?: number[] }[];
  accessors: { min?: number[]; max?: number[] }[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  animations?: {
    name: string;
    channels: { target: { node: number; path: string } }[];
  }[];
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  const length = view.getUint32(12, true);
  return JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + length)),
  ) as ReturnType<typeof glbJson>;
}

const M_PER_DEG = 111_320;
function metres(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const cos = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(
    (b.lat - a.lat) * M_PER_DEG,
    (b.lon - a.lon) * M_PER_DEG * cos,
  );
}

describe("the anchor test tour (public/samples/anchor-test-tour.zip)", () => {
  it("is a valid tour of three stations, in any order, written back to the same bytes", async () => {
    const files = await entries();
    const json = JSON.parse(
      new TextDecoder().decode(files.get("tour.json")),
    ) as unknown;
    const tour = parseTourManifest(json);
    expect(tour.stations.map((s) => s.id)).toEqual(["tower", "pins", "hint"]);
    expect(tour.order).toBe("any");
    expect(serializeTourManifest(tour)).toBe(
      new TextDecoder().decode(files.get("tour.json")),
    );
  });

  it("stands its stations 20-40 m apart, so each is found on its own", async () => {
    const geos = (await manifest()).stations.map((s) => s.geo);
    for (let i = 0; i < geos.length; i += 1) {
      for (let j = i + 1; j < geos.length; j += 1) {
        const d = metres(geos[i]!, geos[j]!);
        expect(d).toBeGreaterThan(20);
        expect(d).toBeLessThan(40);
      }
    }
  });

  it("A: a tall model that plays a clip its file has, moving a part of it", async () => {
    const tour = await manifest();
    const station = tour.stations.find((s) => s.id === "tower")!;
    const model = station.children.find(
      (c) => isTourBlockChild(c) && c.kind === "model",
    );
    expect(model).toMatchObject({
      kind: "model",
      view: "placed",
      sizeM: 8,
      animation: { name: "swing", autoplay: true },
    });
    const files = await entries();
    const glb = files.get("content/tower.glb")!;
    expect(checkGlbInert(glb)).toEqual({ ok: true });
    const gltf = glbJson(glb);
    const clip = gltf.animations?.find((a) => a.name === "swing");
    expect(clip?.channels[0]?.target).toEqual({ node: 1, path: "rotation" });
    // The moving part sits on the mast's top: 7.5 m up.
    expect(gltf.nodes[0]?.children).toEqual([1]);
    expect(gltf.nodes[1]?.translation?.[1]).toBeCloseTo(7.5, 6);
    // Its largest side is the height: the mast's own bounds plus the arm.
    const mast =
      gltf.accessors[gltf.meshes[0]!.primitives[0]!.attributes.POSITION]!;
    expect(mast.max![1]! - mast.min![1]!).toBeCloseTo(7.5, 6);
  });

  it("B: at least ten pins standing free, one with a label at the caption's limit", async () => {
    const station = (await manifest()).stations.find((s) => s.id === "pins")!;
    const pins = station.children.filter(
      (c) => isTourBlockChild(c) && c.kind === "shortText" && c.view === "pin",
    );
    expect(pins.length).toBeGreaterThanOrEqual(10);
    const widest = Math.max(
      ...pins.map((p) => ("caption" in p ? String(p.caption).length : 0)),
    );
    expect(widest).toBe(40);
  });

  it("C: a short text in the edge hint view and a story with a character", async () => {
    const tour = await manifest();
    const station = tour.stations.find((s) => s.id === "hint")!;
    expect(
      station.children.some(
        (c) =>
          isTourBlockChild(c) &&
          c.kind === "shortText" &&
          c.view === "edgeHint",
      ),
    ).toBe(true);
    const stories = tourStories(station);
    expect(stories).toHaveLength(1);
    expect(JSON.stringify(stories[0])).toContain('"kind":"character"');
    const files = await entries();
    expect(checkImageWithinCap(files.get("content/knight.png")!)).toEqual({
      ok: true,
    });
  });

  it("stores its entries uncompressed, so a visitor can stream them", async () => {
    const reader = new ZipReader(new BlobReader(new Blob([readFileSync(ZIP)])));
    for (const entry of await reader.getEntries()) {
      expect(entry.compressionMethod, entry.filename).toBe(0);
    }
    await reader.close();
  });
});

// Why: the committed zip is what the phone opens, and the build script is
// what a reviewer reads; a script edited without rebuilding the zip (or a
// zip edited by hand) would test one tour and ship another.
describe("the committed anchor test tour and its build script", () => {
  it("are the same bytes", async () => {
    const script = new URL(
      "../scripts/build-anchor-test-tour.mjs",
      import.meta.url,
    ).href;
    const built = (await import(script)) as {
      buildAnchorTestTourZip(): Promise<Uint8Array>;
    };
    expect(
      Buffer.from(await built.buildAnchorTestTourZip()).equals(
        readFileSync(ZIP),
      ),
    ).toBe(true);
  });
});
