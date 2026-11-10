/**
 * Why these tests matter: the inspector's file field, a file dropped on
 * it and the session's file swap must agree on which field holds a
 * block's file, or a replaced file would land in a field nothing reads
 * (and a video would keep the poster of the clip it no longer shows).
 */
import { describe, expect, it } from "vitest";

import { blockFileId, blockFileKind, withBlockFile } from "./block-file.js";

describe("block-file", () => {
  it("names each file kind's field and asset kind, and none for words", () => {
    expect(blockFileKind({ kind: "picture" })).toBe("image");
    expect(blockFileKind({ kind: "audio" })).toBe("audio");
    expect(blockFileKind({ kind: "video" })).toBe("video");
    expect(blockFileKind({ kind: "model" })).toBe("model");
    expect(blockFileKind({ kind: "shortText" })).toBeNull();
    // An inherited key is no kind.
    expect(blockFileKind({ kind: "toString" })).toBeNull();
    expect(blockFileId({ kind: "picture", image: "p1" })).toBe("p1");
    expect(blockFileId({ kind: "model", asset: "m1" })).toBe("m1");
    expect(blockFileId({ kind: "audio" })).toBeNull();
    expect(blockFileId({ kind: "longText" })).toBeNull();
  });

  it("puts the new file in its field and keeps everything else", () => {
    expect(
      withBlockFile({ kind: "audio", audio: "a1", title: "Bells" }, "a2"),
    ).toEqual({ kind: "audio", audio: "a2", title: "Bells" });
    expect(
      withBlockFile({ kind: "model", asset: "m1", sizeM: 2 }, "m2"),
    ).toEqual({ kind: "model", asset: "m2", sizeM: 2 });
    expect(withBlockFile({ kind: "shortText" }, "x")).toBeNull();
  });

  // Why: the old poster shows the old clip; it goes unless a new one came.
  it("gives a video the new poster, or none", () => {
    const video = { kind: "video", video: "v1", poster: "p1" };
    expect(withBlockFile(video, "v2", "p2")).toEqual({
      kind: "video",
      video: "v2",
      poster: "p2",
    });
    expect(withBlockFile(video, "v2")).toEqual({ kind: "video", video: "v2" });
  });
});
