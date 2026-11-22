/**
 * Why this test matters: a zip's directory can understate an entry's
 * size, so each read is capped at what the bundle has left. When that cap
 * stops a read, the creator must read the model's size against the
 * bundle's own cap, not against the few bytes the bundle had left. A real
 * zip.js refuses most such lies itself before the cap is reached, so the
 * directory is faked here to reach the cap's words at all.
 */
import { describe, expect, it, vi } from "vitest";
import { ArchiveLimitError } from "gps-plus-slam-app-framework/storage";

import { refusal } from "./model-import-words.js";

vi.mock("../../zip-blob.js", () => ({
  withZipBlobDirectory: async <T>(
    _blob: Blob,
    use: (dir: unknown) => Promise<T>,
  ): Promise<T> =>
    use({
      names: ["m.glb"],
      sizeOf: () => 10,
      read: (_name: string, cap: number) =>
        Promise.reject(new ArchiveLimitError("entry-bytes", cap, cap + 5)),
    }),
}));

const { readZipBundle } = await import("./zip-bundle.js");

describe("readZipBundle, an entry past the read cap", () => {
  it("says the model is too large against the bundle's cap", async () => {
    expect(
      await readZipBundle(new Blob(["zip"]), "m.zip", { maxBytes: 100 }),
    ).toEqual({
      ok: false,
      reason: refusal.tooLarge("m.zip", 105, 100),
    });
  });
});
