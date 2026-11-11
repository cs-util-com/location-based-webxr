import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { latLngToCell } from "h3-js";
import { manifestText } from "./manifest";
import { tileObjectKey } from "./tile-cell";
import { FakeBucket } from "./testing/fake-bindings";

// Why these tests matter: the manifest is the list the ODbL notice points to
// and the only way to see what the store holds. It used to be one file every
// fill rewrote, so a fill killed between storing the tile and appending its
// line lost the line for good, and each fill's CPU grew with the store. It is
// now read from the stored tiles themselves: a tile in R2 is in the manifest,
// with nothing to fall out of step, and a fill writes nothing extra.

const COLOGNE = latLngToCell(50.9384, 6.9598, 7);
const MEGGEN = latLngToCell(47.0468, 8.3745, 7);

async function storeTile(
  bucket: FakeBucket,
  cell: string,
  osmBase: string,
  bytes: number,
): Promise<void> {
  await bucket.put(tileObjectKey(cell), new Uint8Array(bytes), {
    customMetadata: { osmBase },
  });
}

describe("manifestText", () => {
  it("starts with the attribution and a header, then one line per stored tile", async () => {
    const bucket = new FakeBucket();
    await storeTile(bucket, COLOGNE, "2026-11-11T09:00:00Z", 7);
    await storeTile(bucket, MEGGEN, "2026-11-10T09:00:00Z", 5);
    const lines = (await manifestText(bucket)).split("\n");
    expect(lines[0]).toMatch(/^# .*OpenStreetMap contributors.*ODbL/);
    expect(lines[1]).toBe("# cell\tosm_base\tstored_bytes");
    expect(
      lines
        .slice(2)
        .filter((l) => l !== "")
        .sort(),
    ).toEqual(
      [
        `${COLOGNE}\t2026-11-11T09:00:00Z\t7`,
        `${MEGGEN}\t2026-11-10T09:00:00Z\t5`,
      ].sort(),
    );
  });

  it("lists only tiles: the old manifest object and other keys under the prefix are skipped", async () => {
    const bucket = new FakeBucket();
    await storeTile(bucket, COLOGNE, "2026-11-11T09:00:00Z", 7);
    await bucket.put("osm/v3/manifest.tsv", "stale\n");
    await bucket.put("osm/v3/not-a-cell.json.gz", "x");
    await bucket.put("state/daily/2026-11-11.json", "{}");
    const body = (await manifestText(bucket))
      .split("\n")
      .filter((l) => l !== "" && !l.startsWith("#"));
    expect(body).toEqual([`${COLOGNE}\t2026-11-11T09:00:00Z\t7`]);
  });

  it("asks R2 for the custom metadata (a listing omits it otherwise)", async () => {
    const bucket = new FakeBucket();
    await storeTile(bucket, COLOGNE, "2026-11-11T09:00:00Z", 7);
    await manifestText(bucket);
    expect(bucket.listCalls[0]?.include).toContain("customMetadata");
  });

  it("property: every stored tile appears exactly once, across listing pages", async () => {
    const cells = fc.uniqueArray(
      fc
        .tuple(
          fc.double({ min: -60, max: 60, noNaN: true }),
          fc.double({ min: -170, max: 170, noNaN: true }),
        )
        .map(([lat, lng]) => latLngToCell(lat, lng, 7)),
      { maxLength: 25 },
    );
    await fc.assert(
      fc.asyncProperty(
        cells,
        fc.integer({ min: 1, max: 7 }),
        async (all, page) => {
          const bucket = new FakeBucket();
          bucket.pageSize = page;
          for (const cell of all) {
            await storeTile(bucket, cell, "2026-11-11T09:00:00Z", 3);
          }
          const listed = (await manifestText(bucket))
            .split("\n")
            .filter((l) => l !== "" && !l.startsWith("#"))
            .map((l) => l.split("\t")[0]);
          expect([...listed].sort()).toEqual([...all].sort());
        },
      ),
    );
  });
});
