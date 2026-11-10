/**
 * Why these tests matter: deleting a file that items use, and replacing it
 * everywhere, must tell a block MADE of the file (it goes, or takes the new
 * file) from one that only MENTIONS it in a field it stands without (a
 * narration, a poster, a voice: the field goes, or names the new file),
 * and from a long text that shows it inside its words (a delete refuses).
 * Getting one wrong deletes a whole long text for its narration's sound,
 * or a character for his voice. The classes are read from the format's
 * references, so these tests run over every kind the format knows.
 */
import { describe, expect, it } from "vitest";
import {
  tourBlockKinds,
  tourBlockRefs,
} from "gps-plus-slam-app-framework/ar/tour-kinds";

import { fileUseOf, withFileSwitched, withoutFields } from "./file-uses.js";

const pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;
const narrated = {
  id: "t",
  kind: "longText",
  view: "reading",
  pose,
  title: "Mill",
  body: "Before.\n\n![The gate](asset:gate)\n\nAfter.",
  narration: { audio: "voice", synthetic: false, timing: "timing/t.json" },
} as const;
const video = {
  id: "v",
  kind: "video",
  view: "card",
  pose,
  video: "clip",
  poster: "still",
} as const;
const character = {
  id: "c",
  kind: "character",
  view: "speak",
  pose,
  name: "Sir",
  image: "sir",
  voice: "hail",
} as const;
const picture = {
  id: "p",
  kind: "picture",
  view: "plane",
  pose,
  image: "gate",
  widthM: 1,
} as const;

describe("fileUseOf", () => {
  it("says a block is made of its own file", () => {
    expect(fileUseOf(picture, "gate")).toEqual({ kind: "own" });
    expect(fileUseOf(video, "clip")).toEqual({ kind: "own" });
    expect(fileUseOf(character, "sir")).toEqual({ kind: "own" });
  });

  it("says each optional reference is a mention of its field", () => {
    expect(fileUseOf(narrated, "voice")).toEqual({
      kind: "mention",
      fields: ["narration"],
    });
    expect(fileUseOf(video, "still")).toEqual({
      kind: "mention",
      fields: ["poster"],
    });
    expect(fileUseOf(character, "hail")).toEqual({
      kind: "mention",
      fields: ["voice"],
    });
  });

  it("says a long text showing the picture inside its words uses it inline", () => {
    expect(fileUseOf(narrated, "gate")).toEqual({ kind: "inline" });
  });

  it("says nothing for a file the block does not name", () => {
    expect(fileUseOf(narrated, "other")).toBeNull();
    expect(fileUseOf({ kind: "shortText" }, "gate")).toBeNull();
  });

  it("classes every reference of every kind the format knows", () => {
    // A new kind or field lands in one of the three classes by the
    // format's own flags; none is left unclassed.
    for (const kind of tourBlockKinds()) {
      for (const block of [narrated, video, character, picture]) {
        if (block.kind !== kind) continue;
        for (const ref of tourBlockRefs(block)) {
          expect(fileUseOf(block, ref.id)).not.toBeNull();
        }
      }
    }
  });
});

describe("withoutFields", () => {
  it("drops the mention and keeps everything else", () => {
    const left = withoutFields(narrated, ["narration"]);
    expect(left).not.toHaveProperty("narration");
    expect(left).toMatchObject({ title: "Mill", body: narrated.body });
    expect(withoutFields(video, ["poster"])).toEqual({
      id: "v",
      kind: "video",
      view: "card",
      pose,
      video: "clip",
    });
  });
});

describe("withFileSwitched", () => {
  it("switches a block's own file", () => {
    expect(withFileSwitched(picture, "gate", "arch")).toMatchObject({
      image: "arch",
      id: "p",
    });
    expect(withFileSwitched(character, "sir", "lady")).toMatchObject({
      image: "lady",
      voice: "hail",
    });
  });

  it("switches a mention: a narration's sound, a poster, a voice", () => {
    expect(withFileSwitched(narrated, "voice", "new")).toMatchObject({
      narration: { audio: "new", synthetic: false, timing: "timing/t.json" },
    });
    expect(withFileSwitched(video, "still", "new")).toMatchObject({
      video: "clip",
      poster: "new",
    });
    expect(withFileSwitched(character, "hail", "new")).toMatchObject({
      image: "sir",
      voice: "new",
    });
  });

  it("switches a picture a long text shows inside its words", () => {
    const switched = withFileSwitched(narrated, "gate", "arch");
    expect(switched?.body).toBe("Before.\n\n![The gate](asset:arch)\n\nAfter.");
    expect(tourBlockRefs(switched ?? {}).map((r) => r.id)).toEqual([
      "arch",
      "voice",
    ]);
  });

  it("never touches an id that only starts like the file's", () => {
    const two = { ...narrated, body: "![a](asset:gate)\n\n![b](asset:gate2)" };
    expect(withFileSwitched(two, "gate", "arch")?.body).toBe(
      "![a](asset:arch)\n\n![b](asset:gate2)",
    );
  });

  it("is null for a block that does not name the file", () => {
    expect(withFileSwitched(picture, "other", "arch")).toBeNull();
  });

  it("never changes a captured photo's own id", () => {
    const photo = { ...picture, id: "gate" };
    expect(withFileSwitched(photo, "gate", "arch")).toMatchObject({
      id: "gate",
      image: "arch",
    });
  });
});
