/**
 * Why these tests matter (M4a review #8): the setup page's line about the
 * editor and the editor's own fine print both say what Save does here,
 * and that turns on one question - does this browser have the file
 * picker? Two copies of the check could disagree; this is the one.
 */
import { describe, expect, it } from "vitest";

import { hasFilePicker } from "./file-picker.js";

describe("hasFilePicker", () => {
  it("is true only where showOpenFilePicker is a function", () => {
    expect(hasFilePicker({ showOpenFilePicker: () => undefined })).toBe(true);
    expect(hasFilePicker({})).toBe(false);
    expect(hasFilePicker({ showOpenFilePicker: "yes" })).toBe(false);
  });
});
