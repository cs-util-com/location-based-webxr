import { describe, expect, it } from "vitest";
import { TourIntegrityError } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  ArchiveLimitError,
  OpenRemoteArchiveError,
} from "gps-plus-slam-app-framework/storage";

import {
  describeOpenError,
  isDriveUrl,
  OPEN_FILE_ADVICE_LABEL,
  offersFileOpen,
} from "./open-errors.js";

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

  // Why (tour kit plan K0, K-D1): a host that blocks browsers and a dead
  // network fail the same way in a browser, and only the first is helped by
  // "download the file and open it here". The framework splits off
  // `offline` when the browser knows it is offline (after any saved copy
  // was tried); the page must word the two apart.
  it("advises downloading the file for a host that blocks browsers, naming the button", () => {
    const text = describeOpenError(new OpenRemoteArchiveError("x", "cors"));
    expect(text).toContain("Download the file");
    expect(text).toContain(`"${OPEN_FILE_ADVICE_LABEL}"`);
  });

  it("tells an offline phone it is offline, without the download advice", () => {
    const text = describeOpenError(new OpenRemoteArchiveError("x", "offline"));
    expect(text).toMatch(/offline/);
    expect(text).not.toContain("Download the file");
  });
});

describe("offersFileOpen", () => {
  it("offers the file button for a host that blocks browsers only", () => {
    expect(offersFileOpen("cors")).toBe(true);
    for (const cause of [
      "offline",
      "missing",
      "corrupt",
      "too-large",
      "unusable-link",
      "other",
    ]) {
      expect(offersFileOpen(cause), cause).toBe(false);
    }
  });
});

describe("describeOpenError (the rest)", () => {
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

  // Why (tour kit plan K0): a tour over the caps must say so in plain
  // words, not as the generic "cannot be opened" line - the creator's fix
  // (a smaller zip) is different from a broken link's.
  it("says a too-large archive is too large, with the cap's own message for the zip caps", () => {
    expect(
      describeOpenError(new OpenRemoteArchiveError("x", "too-large")),
    ).toMatch(/too large/i);
    // The transport's cap error, when carried, names the limit.
    const transport = new OpenRemoteArchiveError("x", "too-large", {
      cause: new ArchiveLimitError("archive-bytes", 1024 ** 3, 2e9),
    });
    expect(describeOpenError(transport)).toMatch(/limit is 1\.0 GB/);
    const capped = new ArchiveLimitError("entry-count", 20_000, 20_001);
    expect(describeOpenError(capped)).toBe(capped.message);
    expect(describeOpenError(capped)).toMatch(/too many files/);
  });

  it("calls a tour that does not match its own list modified, says not to trust it, and keeps the detail", () => {
    // Tour kit plan K1, §4.2: a hash or list mismatch is a hard "modified,
    // do not trust" failure, worded for a visitor; the technical detail
    // stays at the end for whoever reports it.
    const text = describeOpenError(
      new TourIntegrityError("hash-mismatch", '"content/a.jpg" does not match'),
    );
    expect(text).toMatch(/does not match its own list of contents/);
    expect(text).toMatch(/Do not trust this copy/);
    expect(text).toContain('"content/a.jpg" does not match');
  });

  it("tells a visitor to update the app for a list made by a newer one, not that it was modified", () => {
    const text = describeOpenError(
      new TourIntegrityError("newer-format", "format 2"),
    );
    expect(text).toMatch(/newer version of the app/);
    expect(text).not.toMatch(/Do not trust/);
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

  it("recognises the Drive API form a configured API key normalises to", () => {
    // Why (Drive replace milestone review #6): the finish step decides
    // "Drive: save, show the Drive steps" from this function, on the
    // NORMALISED url - with a `googleDriveApiKey` a Drive tour would
    // otherwise quietly get the share route and the generic text.
    expect(
      isDriveUrl(
        "https://www.googleapis.com/drive/v3/files/abc?alt=media&key=k",
      ),
    ).toBe(true);
    expect(isDriveUrl("https://www.googleapis.com/youtube/v3/x")).toBe(false);
  });
});
