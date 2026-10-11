/**
 * `creator-previews.ts` on its own, with the photo decoder injected: the
 * composed suites cannot decode a texture in node (`decodeFrameTexture`
 * needs `createImageBitmap`), so which BYTES a photo preview is decoded
 * from was invisible to them - the sampled mutant "finished photo bytes
 * dropped" survived as a known gap until this split (code book refactor
 * plan M1 review #6, M2).
 */

import { describe, expect, it } from "vitest";
import { Group, Object3D, Texture } from "three";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { wireCreatorPreviews } from "./creator-previews.js";
import type { AuthoringObject } from "./object-editing.js";
import type { TourSession } from "./tour-session.js";
import {
  createTourViewerSession,
  createTourViewerStore,
} from "./tour-viewer-session.js";

const ZERO = { lat: 47.5, lon: 8.7 };

function photo(id: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-10-06T00:00:00.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

/** A hosted object with nothing on this device: its preview's bytes come
 *  from the Finish's keep, or else from the zip. */
function hosted(object: TourObject): AuthoringObject {
  return { object, hosted: true, changed: false, placed: null };
}

function harness(objects: readonly AuthoringObject[]) {
  const ctx = createTourViewerSession();
  const zipBytes = new Blob(["zip"]);
  const zipReads: string[] = [];
  ctx.session = {
    loadContentEntry: (name: string) => {
      zipReads.push(name);
      return Promise.resolve(zipBytes);
    },
  } as unknown as TourSession;
  const real = createTourViewerStore();
  const arStore = {
    ...real,
    getState: () => ({ ...real.getState(), gpsData: { zero: ZERO } }) as never,
  } as unknown as ReturnType<typeof createTourViewerStore>;
  const scene = new Group();
  const decoded: Blob[] = [];
  const previews = wireCreatorPreviews({
    ctx,
    arStore,
    seams: {
      getScene: () => scene,
      getArWorldGroup: () => null,
      createLabel: () => ({ object: new Object3D(), dispose: () => undefined }),
    },
    creator: true,
    objects: () => objects,
    decodePhoto: (blob) => {
      decoded.push(blob);
      return Promise.resolve(new Texture());
    },
  });
  const settled = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return { ctx, previews, decoded, zipBytes, zipReads, settled };
}

describe("creator-previews: a photo's bytes", () => {
  // Why this test matters: a Finish takes a photo out of `placedObjects`
  // while the hosted zip does not carry its bytes yet (the creator still
  // has to upload the rebuilt file). Its preview must decode the bytes the
  // Finish kept; reading the zip instead finds nothing and the photo
  // vanishes from the scene until the next open.
  it("decodes the bytes a Finish kept, not the hosted zip's", async () => {
    const h = harness([hosted(photo("g"))]);
    const kept = new Blob(["kept"]);
    h.previews.keepFinishedPhoto("g", kept);
    h.previews.sync();
    await h.settled();
    expect(h.decoded).toEqual([kept]);
    expect(h.zipReads).toEqual([]);
    expect(h.ctx.placedPreviews.has("g")).toBe(true);
  });

  // The positive control: without a kept copy the zip is read, so the test
  // above distinguishes the two sources.
  it("reads a hosted photo from the zip when no Finish kept its bytes", async () => {
    const h = harness([hosted(photo("g"))]);
    h.previews.sync();
    await h.settled();
    expect(h.zipReads).toEqual(["content/g.jpg"]);
    expect(h.decoded).toEqual([h.zipBytes]);
  });

  // Why this test matters: the kept bytes belong to the tour they were
  // finished in; a tour close must not hand them to the next tour's photo
  // of the same id.
  it("forgets the kept bytes when the tour closes", async () => {
    const h = harness([hosted(photo("g"))]);
    h.previews.keepFinishedPhoto("g", new Blob(["kept"]));
    h.previews.reset();
    h.previews.sync();
    await h.settled();
    expect(h.decoded).toEqual([h.zipBytes]);
  });
});
