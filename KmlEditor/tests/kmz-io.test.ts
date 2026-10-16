import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BlobReader,
  BlobWriter,
  Uint8ArrayReader,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { KmzContainer } from "../src/kmz-io/index";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/google-earth",
);

async function readZipEntries(
  buffer: ArrayBuffer,
): Promise<Array<{ filename: string; bytes: Uint8Array }>> {
  // Read the KMZ as entries so tests compare structure/content, not ZIP headers.
  const reader = new ZipReader(new BlobReader(new Blob([buffer])));
  const entries = await reader.getEntries();

  return Promise.all(
    entries
      .filter((entry) => !entry.directory)
      .map(async (entry) => {
        const blob = await entry.getData(new BlobWriter());
        return {
          filename: entry.filename,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        };
      }),
  );
}

async function writeZipEntries(
  entries: Array<{ filename: string; bytes: Uint8Array }>,
): Promise<ArrayBuffer> {
  // Build small synthetic KMZ files for edge cases the fixtures do not cover.
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const entry of entries) {
    await writer.add(entry.filename, new Uint8ArrayReader(entry.bytes));
  }
  const blob = await writer.close();
  return blob.arrayBuffer();
}

describe("KmzContainer", () => {
  const containers: KmzContainer[] = [];

  afterEach(() => {
    for (const container of containers) {
      container.dispose();
    }
    containers.length = 0;
  });

  async function openFixture(name: string): Promise<KmzContainer> {
    const fixturePath = path.join(fixturesDir, name);
    const bytes = fs.readFileSync(fixturePath);
    const container = new KmzContainer();
    containers.push(container);
    await container.open(new File([bytes], name, { type: "application/zip" }));
    return container;
  }

  it("round-trips a KMZ fixture without changing doc.kml or asset bytes", async () => {
    const originalPath = path.join(fixturesDir, "parkplatz.kmz");
    const originalBytes = fs.readFileSync(originalPath);
    const originalBuffer = new Uint8Array(originalBytes).buffer;
    const container = await openFixture("parkplatz.kmz");

    const originalDocKml = container.getDocKml();
    const originalAssets = container.listAssets();
    const originalEntries = await readZipEntries(originalBuffer);

    const savedBuffer = await container.save();
    const savedEntries = await readZipEntries(savedBuffer);

    // doc.kml must survive the open -> save round trip unchanged.
    const savedDocKml = savedEntries.find(
      (entry) => entry.filename === "doc.kml",
    )?.bytes;
    expect(savedDocKml).toBeDefined();
    expect(new TextDecoder().decode(savedDocKml)).toBe(originalDocKml);

    const originalAssetEntries = originalEntries.filter(
      (entry) => entry.filename !== "doc.kml",
    );
    const savedAssetEntries = savedEntries.filter(
      (entry) => entry.filename !== "doc.kml",
    );

    // Asset paths reported by the archive and by the container must stay stable.
    expect(savedAssetEntries.map((entry) => entry.filename)).toEqual(
      originalAssetEntries.map((entry) => entry.filename),
    );
    expect(
      container.listAssets().map((asset: { path: string }) => asset.path),
    ).toEqual(originalAssets.map((asset: { path: string }) => asset.path));

    // Untouched assets must remain byte-identical after writing a new archive.
    for (const asset of originalAssetEntries) {
      const savedAsset = savedAssetEntries.find(
        (entry) => entry.filename === asset.filename,
      );
      expect(savedAsset).toBeDefined();
      expect(savedAsset?.bytes).toEqual(asset.bytes);
    }

    const provider = container.getAssetProvider();
    // If this fixture contains a local href, it should resolve to that asset.
    const localHref = container
      .getHrefReferences()
      .find((href) => provider.hasAsset(href));
    if (localHref) {
      const assetBytes = await provider.getAssetBytes(localHref);
      const matchingAsset = originalAssetEntries.find(
        (entry) => entry.filename === localHref,
      );
      expect(matchingAsset).toBeDefined();
      expect(Array.from(assetBytes)).toEqual(Array.from(matchingAsset?.bytes ?? []));
    }
    provider.dispose();
  });

  it("preserves the original doc.kml entry path when saving", async () => {
    const encoder = new TextEncoder();
    const docKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Point><coordinates>1,2,0</coordinates></Point></Placemark></Document></kml>`;
    const buffer = await writeZipEntries([
      { filename: "kml/doc.kml", bytes: encoder.encode(docKml) },
      { filename: "files/icon.png", bytes: new Uint8Array([1, 2, 3]) },
    ]);

    const container = new KmzContainer();
    containers.push(container);
    await container.open(new File([buffer], "nested-doc.kmz"));

    // A nested doc.kml path must not be flattened or duplicated on save.
    const savedEntries = await readZipEntries(await container.save());
    expect(savedEntries.map((entry) => entry.filename)).toEqual([
      "kml/doc.kml",
      "files/icon.png",
    ]);
    expect(
      savedEntries.filter((entry) => entry.filename.toLowerCase().endsWith(".kml")),
    ).toHaveLength(1);
  });

  it("resolves packaged asset hrefs and remote URLs through the asset provider", async () => {
    const encoder = new TextEncoder();
    const docKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <GroundOverlay><Icon><href>files/overlay.png</href></Icon></GroundOverlay>
    <Style><IconStyle><Icon><href>https://example.com/pin.png</href></Icon></IconStyle></Style>
  </Document>
</kml>`;
    const assetBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const buffer = await writeZipEntries([
      { filename: "doc.kml", bytes: encoder.encode(docKml) },
      { filename: "files/overlay.png", bytes: assetBytes },
    ]);

    const container = new KmzContainer();
    containers.push(container);
    await container.open(new File([buffer], "with-asset.kmz"));

    // Packaged hrefs resolve to bytes; remote hrefs stay as remote URLs.
    const provider = container.getAssetProvider();
    expect(provider.hasAsset("files/overlay.png")).toBe(true);
    expect(provider.hasAsset("./files/overlay.png")).toBe(true);
    expect(await provider.getAssetBytes("files/overlay.png")).toEqual(assetBytes);
    expect(await provider.getAssetUrl("https://example.com/pin.png")).toBe(
      "https://example.com/pin.png",
    );

    const savedEntries = await readZipEntries(await container.save());
    // The asset referenced from KML is still present with the same bytes.
    expect(
      savedEntries.find((entry) => entry.filename === "files/overlay.png")?.bytes,
    ).toEqual(assetBytes);
  });
});
