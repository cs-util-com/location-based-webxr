/**
 * Tests for getting the recorder's export off a phone (globe zoom
 * frame-hitch plan 2026-10-03-2017 §4.1, DEC-PERF-1).
 *
 * Why this file matters: the sweep runs on a phone and its export is
 * pasted into a chat. iOS Safari refuses the clipboard outside a tap, an
 * old Android browser may lack it, and a download may be blocked; whatever
 * refuses, the text must still reach the screen in a box the tester can
 * select. So each path is tried in turn and the box is the last resort,
 * never an error.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  copyExport,
  downloadExport,
  exportFileName,
} from "./globe-perf-share.js";

describe("copyExport", () => {
  it("writes to the clipboard when the browser allows it", async () => {
    const written = [];
    const shown = [];
    const how = await copyExport("{}", {
      clipboard: { writeText: async (t) => written.push(t) },
      showText: (t) => shown.push(t),
    });
    assert.equal(how, "clipboard");
    assert.deepEqual(written, ["{}"]);
    assert.deepEqual(shown, []);
  });

  it("shows the text to select when the clipboard refuses or is missing", async () => {
    const shown = [];
    const refused = await copyExport("{a}", {
      clipboard: {
        writeText: async () => {
          throw new Error("NotAllowedError");
        },
      },
      showText: (t) => shown.push(t),
    });
    const missing = await copyExport("{b}", {
      clipboard: undefined,
      showText: (t) => shown.push(t),
    });
    assert.equal(refused, "shown");
    assert.equal(missing, "shown");
    assert.deepEqual(shown, ["{a}", "{b}"]);
  });
});

describe("downloadExport", () => {
  it("saves the text as a .json file through a link", () => {
    const clicked = [];
    const how = downloadExport("{}", "perf.json", {
      makeUrl: (blobText) => `blob:${blobText.length}`,
      revokeUrl: () => {},
      clickLink: (href, name) => clicked.push([href, name]),
      showText: () => assert.fail("not shown"),
    });
    assert.equal(how, "download");
    assert.deepEqual(clicked, [["blob:2", "perf.json"]]);
  });

  it("shows the text when the download cannot start", () => {
    const shown = [];
    const how = downloadExport("{x}", "perf.json", {
      makeUrl: () => {
        throw new Error("no Blob URLs");
      },
      revokeUrl: () => {},
      clickLink: () => assert.fail("no link"),
      showText: (t) => shown.push(t),
    });
    assert.equal(how, "shown");
    assert.deepEqual(shown, ["{x}"]);
  });
});

describe("exportFileName", () => {
  it("names the file by the sweep and the time, filesystem-safe", () => {
    const name = exportFileName("quick", Date.parse("2026-10-03T21:05:09Z"));
    assert.equal(name, "globe-perf-quick-2026-10-03T21-05-09Z.json");
  });
});
