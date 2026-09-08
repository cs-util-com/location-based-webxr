import { describe, expect, it } from "vitest";
import { OpenRemoteArchiveError } from "gps-plus-slam-app-framework/storage";

import { describeOpenError, isDriveUrl } from "./open-errors.js";

/**
 * Why these tests matter: the open error is the only thing a creator sees
 * when a pasted link fails, and the Drive-aware branch exists because a
 * refused Drive file used to read as the generic archive error and hide
 * the actual cause (drive-proxy plan Rev 2, review finding 12). Each cause
 * maps to one sentence; a cause that falls through to the generic line
 * again is a regression of that finding.
 */
describe("describeOpenError", () => {
  it("names each probe cause in plain language", () => {
    expect(
      describeOpenError(new OpenRemoteArchiveError("x", "missing")),
    ).toContain("does not exist");
    expect(
      describeOpenError(new OpenRemoteArchiveError("x", "corrupt")),
    ).toContain("not a readable archive");
    expect(
      describeOpenError(new OpenRemoteArchiveError("x", "cors")),
    ).toContain("refused the browser access");
  });

  it("explains a refused Drive link as Drive's, and any other host generically", () => {
    const refused = new OpenRemoteArchiveError("x", "unusable-link");
    expect(
      describeOpenError(refused, "https://drive.google.com/file/d/abc/view"),
    ).toContain("Google Drive refused");
    expect(
      describeOpenError(refused, "https://gps.csutil.com/api/drive-proxy?id=1"),
    ).toContain("Google Drive refused");
    expect(describeOpenError(refused, "https://example.com/tour.zip")).toBe(
      "That link cannot be opened as an archive.",
    );
    expect(describeOpenError(refused)).toBe(
      "That link cannot be opened as an archive.",
    );
  });

  it("passes any other error's message through", () => {
    expect(describeOpenError(new Error("boom"))).toBe("boom");
    expect(describeOpenError("plain")).toBe("plain");
  });
});

describe("isDriveUrl", () => {
  it("recognises the share page, the raw host and the proxy route; rejects garbage", () => {
    expect(isDriveUrl("https://drive.google.com/x")).toBe(true);
    expect(isDriveUrl("https://drive.usercontent.google.com/x")).toBe(true);
    expect(isDriveUrl("/api/drive-proxy?id=1", "https://gps.csutil.com/")).toBe(
      true,
    );
    expect(isDriveUrl("https://example.com/x")).toBe(false);
    expect(isDriveUrl("not a url", "not a base")).toBe(false);
  });
});
