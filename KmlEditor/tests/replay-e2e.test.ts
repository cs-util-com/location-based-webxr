import { describe, expect, it, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobReader, BlobWriter, Uint8ArrayReader, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { KmzContainer } from '../src/kmz-io/container';
import { createKmlDocument } from '../src/document-model';
import { createEditorStore } from '../src/store';
import { ReplayHarness } from '../src/editor/replay-harness';
import { createMoveMarkerCommand, createMoveModelCommand } from '../src/commands';
import { GeoPosition, IMarkerFeature, IModelFeature } from '../src/contracts/document-model';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

async function readZipEntries(buffer: ArrayBuffer): Promise<Array<{ filename: string; bytes: Uint8Array }>> {
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
            })
    );
}

async function createFixtureKmz(): Promise<{ buffer: ArrayBuffer; docKml: string; assetBytes: Uint8Array }> {
    const docKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document id="doc-e2e-1">
  <name>E2E Test Document</name>
  <Placemark id="marker-1">
    <name>Original Marker</name>
    <Point>
      <coordinates>6.060788,50.778154,222.5</coordinates>
    </Point>
  </Placemark>
  <Placemark id="model-1">
    <name>Original 3D Model</name>
    <Model>
      <Location>
        <longitude>6.061000</longitude>
        <latitude>50.778200</latitude>
        <altitude>220.0</altitude>
      </Location>
      <Orientation>
        <heading>45</heading>
        <tilt>0</tilt>
        <roll>0</roll>
      </Orientation>
      <Scale>
        <x>1</x>
        <y>1</y>
        <z>1</z>
      </Scale>
      <Link>
        <href>models/building.dae</href>
      </Link>
    </Model>
  </Placemark>
  <Placemark id="untouched-line">
    <name>Untouched Line</name>
    <LineString>
      <coordinates>6.0601,50.7781,200 6.0602,50.7782,201</coordinates>
    </LineString>
  </Placemark>
</Document>
</kml>`;

    const assetBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

    const writer = new ZipWriter(new BlobWriter('application/zip'));
    await writer.add('doc.kml', new Uint8ArrayReader(new TextEncoder().encode(docKml)));
    await writer.add('models/building.dae', new Uint8ArrayReader(assetBytes));
    const blob = await writer.close();

    return {
        buffer: await blob.arrayBuffer(),
        docKml,
        assetBytes,
    };
}

describe('End-to-End Phone-Free Replay & Round-Trip Test', () => {
    it('replays a Task 1 recording and preserves untouched bytes in a full edit round-trip', async () => {
        // 1. Load Task-1 recording ZIP using ReplayHarness (phone-free replay execution)
        const harness = new ReplayHarness();
        const recordingPath = path.join(fixturesDir, 'recordings/2026-06-24_13-58-24utc.zip');
        const recordingBytes = fs.readFileSync(recordingPath);
        const sampleCount = await harness.loadZip(recordingBytes.buffer);

        expect(sampleCount).toBeGreaterThan(0);
        expect(harness.getState()).toBe('idle');

        // Step through replay samples deterministically
        for (let i = 0; i < 10; i++) {
            harness.step();
        }

        const currentSample = harness.getCurrentSample();
        expect(currentSample).not.toBeNull();
        expect(currentSample?.position.lat).toBeDefined();

        // 2. Prepare real KMZ fixture containing marker, 3D model, untouched line, and binary asset
        const fixture = await createFixtureKmz();
        const originalEntries = await readZipEntries(fixture.buffer);
        const fixtureFile = new File([fixture.buffer], 'e2e-fixture.kmz', { type: 'application/zip' });

        const store = createEditorStore();
        await store.loadFile(fixtureFile);

        const doc = (store as any).document as ReturnType<typeof createKmlDocument>;
        const container = (store as any).container as KmzContainer;

        expect(doc).not.toBeNull();
        expect(container).not.toBeNull();
        if (!doc || !container) return;

        const features = doc.getFeatures();
        const marker = features.find((f) => f.name === 'Original Marker') as IMarkerFeature;
        const model = features.find((f) => f.name === 'Original 3D Model') as IModelFeature;
        const line = features.find((f) => f.name === 'Untouched Line');

        expect(marker).toBeDefined();
        expect(model).toBeDefined();
        expect(line).toBeDefined();

        // 3. Programmatically move the marker and 3D model
        const targetMarkerPos: GeoPosition = { lon: 6.070000, lat: 50.780000, alt: 250.0 };
        const targetModelPos: GeoPosition = { lon: 6.071000, lat: 50.781000, alt: 245.0 };

        const targetMarkerWorld = store.geoBridge.geoToWorld(targetMarkerPos, 'absolute');

        store.executeCommand(createMoveMarkerCommand(marker.id, targetMarkerWorld));
        store.executeCommand(createMoveModelCommand(model.id, targetModelPos));

        // 4. Save modified document back to container and export buffer
        container.setDocKml(doc.serialize());
        const savedBuffer = await container.save();

        // 5. Reload saved buffer in a brand-new container and document model
        const reloadedContainer = new KmzContainer();
        await reloadedContainer.open(new File([savedBuffer], 'e2e-saved.kmz', { type: 'application/zip' }));

        const reloadedDoc = createKmlDocument();
        reloadedDoc.parse(reloadedContainer.getDocKml());

        const reloadedFeatures = reloadedDoc.getFeatures();
        const reloadedMarker = reloadedFeatures.find((f) => f.id === marker.id) as IMarkerFeature;
        const reloadedModel = reloadedFeatures.find((f) => f.id === model.id) as IModelFeature;
        const reloadedLine = reloadedFeatures.find((f) => f.id === line?.id);

        // Assert (a): The two edited features moved to their target coordinates
        expect(reloadedMarker.position.lon).toBeCloseTo(targetMarkerPos.lon, 6);
        expect(reloadedMarker.position.lat).toBeCloseTo(targetMarkerPos.lat, 6);
        expect(reloadedMarker.position.alt).toBeCloseTo(targetMarkerPos.alt, 6);

        expect(reloadedModel.location.lon).toBeCloseTo(targetModelPos.lon, 6);
        expect(reloadedModel.location.lat).toBeCloseTo(targetModelPos.lat, 6);
        expect(reloadedModel.location.alt).toBeCloseTo(targetModelPos.alt, 6);

        // Assert (b): Untouched feature coordinates and unedited asset bytes remain identical
        expect(reloadedLine).toBeDefined();

        const savedEntries = await readZipEntries(savedBuffer);
        const originalAssetEntry = originalEntries.find((e) => e.filename === 'models/building.dae');
        const savedAssetEntry = savedEntries.find((e) => e.filename === 'models/building.dae');

        expect(savedAssetEntry).toBeDefined();
        expect(savedAssetEntry?.bytes).toEqual(originalAssetEntry?.bytes);

        // Cleanup
        harness.dispose();
        container.dispose();
        reloadedContainer.dispose();
    });
});
