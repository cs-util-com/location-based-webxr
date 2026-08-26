import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { handleDriveProxy, type FetchLike } from "./drive-proxy";

/**
 * Why this test matters (drive-proxy plan Rev 2): the id validator is
 * deliberately LOOSE (ids are opaque values, PR #357 review), so the
 * injection guard is encodeURIComponent alone. This property proves, for
 * arbitrary ids, that the guard holds: whatever the id contains, the
 * upstream URL either was never fetched (a 400) or carries the id as ONE
 * percent-encoded query value — no raw `&`, `=`, `/` or `#` from the id
 * ever reaches the upstream query structure, and the fixed
 * `export=download&confirm=t` suffix is intact.
 */

describe("handleDriveProxy id-encoding property", () => {
  it("any accepted id reaches upstream as exactly one encoded value", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }),
        async (id) => {
          const calls: string[] = [];
          const fetchImpl: FetchLike = (url) => {
            calls.push(url);
            return Promise.resolve(new Response("bytes", { status: 200 }));
          };
          const request = new Request(
            `https://gps.csutil.com/api/drive-proxy?id=${encodeURIComponent(id)}`,
          );
          const response = await handleDriveProxy(request, { fetchImpl });

          if (response.status === 400) {
            // Rejected ids must never have touched upstream.
            expect(calls.length).toBe(0);
            return;
          }
          expect(calls.length).toBe(1);
          expect(calls[0]).toBe(
            `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`,
          );
          // The round-trip is lossless: parsing the upstream URL back yields
          // the original id and exactly the three expected parameters.
          const upstream = new URL(calls[0] ?? "");
          expect(upstream.searchParams.get("id")).toBe(id);
          expect([...upstream.searchParams.keys()].sort()).toEqual([
            "confirm",
            "export",
            "id",
          ]);
        },
      ),
    );
  });
});
