import { describe, it, expect, beforeEach } from 'vitest';
import { IKmlDocument, IMarkerFeature, ILineFeature, IGroundOverlayFeature, IModelFeature } from '../src/contracts/document-model';
import { createKmlDocument } from '../src/document-model';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipReader, BlobReader, TextWriter, type FileEntry } from '@zip.js/zip.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/google-earth');

async function readKmzDocKml(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer]);
  const zipReader = new ZipReader(new BlobReader(blob));
  const entries = await zipReader.getEntries();
  const docEntry = entries.find((e: any) => e.filename === 'doc.kml');
  if (!docEntry) throw new Error('doc.kml not found in ' + filePath);
  if (docEntry.directory) throw new Error('doc.kml is a directory in ' + filePath);
  const fileEntry = docEntry as FileEntry;
  return await fileEntry.getData(new TextWriter());
}

describe('KML Document Model (Lossless & Typed Feature View)', () => {
  let doc: IKmlDocument;

  beforeEach(() => {
    // Assume createKmlDocument is exported from index.ts
    doc = createKmlDocument();
  });

  describe('Fixture Discovery & Survival (Parse)', () => {
    it('should parse dreieck.kml and find its features', () => {
      const kml = fs.readFileSync(path.join(fixturesDir, 'dreieck.kml'), 'utf-8');
      doc.parse(kml);

      const features = doc.getFeatures();
      expect(features.length).toBeGreaterThanOrEqual(4);
      // It contains 3 Points and 1 Polygon (path1)
      const points = features.filter(f => f.type === 'marker');
      expect(points.length).toBe(3);
    });

    it('should parse parkplatz.kmz and find its features', async () => {
      const kml = await readKmzDocKml(path.join(fixturesDir, 'parkplatz.kmz'));
      doc.parse(kml);

      const features = doc.getFeatures();
      expect(features.length).toBeGreaterThanOrEqual(6);

      const points = features.filter(f => f.type === 'marker');
      expect(points.length).toBe(4);

      const lines = features.filter(f => f.type === 'line');
      expect(lines.length).toBe(1);

      const overlays = features.filter(f => f.type === 'ground-overlay');
      expect(overlays.length).toBe(1);
    });

    it('should parse umriss.kmz and find its features', async () => {
      const kml = await readKmzDocKml(path.join(fixturesDir, 'umriss.kmz'));
      doc.parse(kml);

      const features = doc.getFeatures();
      expect(features.length).toBeGreaterThanOrEqual(7);

      const points = features.filter(f => f.type === 'marker');
      expect(points.length).toBe(5);
    });
  });

  describe('Identity (Byte-Faithfulness)', () => {
    it('should losslessly serialize dreieck.kml', () => {
      const kml = fs.readFileSync(path.join(fixturesDir, 'dreieck.kml'), 'utf-8');
      doc.parse(kml);
      expect(doc.serialize()).toBe(kml);
    });

    it('should losslessly serialize parkplatz.kmz doc.kml', async () => {
      const kml = await readKmzDocKml(path.join(fixturesDir, 'parkplatz.kmz'));
      doc.parse(kml);
      expect(doc.serialize()).toBe(kml);
    });

    it('should losslessly serialize umriss.kmz doc.kml', async () => {
      const kml = await readKmzDocKml(path.join(fixturesDir, 'umriss.kmz'));
      doc.parse(kml);
      expect(doc.serialize()).toBe(kml);
    });
  });

  describe('Surgical Edits', () => {
    it('should use the original KML id for feature views and reflect name changes in serialization', () => {
      const kml = fs.readFileSync(path.join(fixturesDir, 'dreieck.kml'), 'utf-8');
      doc.parse(kml);

      const features = doc.getFeatures();
      const feature = features.find((item) => item.name === 'busch_infozentrum');
      expect(feature).toBeDefined();
      expect(feature?.id).toBe('0DE3B1799F402F179797');

      feature!.name = 'Renamed Feature';

      const output = doc.serialize();
      expect(output).toContain('<name>Renamed Feature</name>');
      expect(output).toContain('0DE3B1799F402F179797');
    });

    it('should perform a surgical edit on a Point in dreieck.kml', () => {
      const kml = fs.readFileSync(path.join(fixturesDir, 'dreieck.kml'), 'utf-8');
      doc.parse(kml);

      // Find "busch_infozentrum" point
      const features = doc.getFeatures();
      const busch = features.find(f => f.name === 'busch_infozentrum') as IMarkerFeature;
      expect(busch).toBeDefined();
      expect(busch.type).toBe('marker');

      // Record original coordinates text
      const oldCoordsStr = '6.0607883942,50.7781543944,222.506341';
      expect(kml).toContain(oldCoordsStr);

      // Mutate
      busch.position = { lon: 6.1, lat: 50.8, alt: 220 };

      const output = doc.serialize();
      expect(output).not.toContain(oldCoordsStr);
      expect(output).toContain('6.1,50.8,220');

      // Ensure unchanged portions are strictly identical
      const diffLen = Math.abs(output.length - kml.length);
      expect(diffLen).toBeLessThan(100); // Only a small chunk changed
    });

    it('should parse altitudeMode for marker and line features with clampToGround fallback', () => {
      const kmlWithAltitude = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark id="pt-1">
      <name>Relative Marker</name>
      <Point>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>6.06,50.77,25.0</coordinates>
      </Point>
    </Placemark>
    <Placemark id="ln-1">
      <name>Absolute Line</name>
      <LineString>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>6.06,50.77,100 6.07,50.78,110</coordinates>
      </LineString>
    </Placemark>
    <Placemark id="pt-default">
      <name>Default Clamped Marker</name>
      <Point>
        <coordinates>6.06,50.77,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
      doc.parse(kmlWithAltitude);
      const features = doc.getFeatures();

      const relMarker = features.find(f => f.id === 'pt-1') as IMarkerFeature;
      expect(relMarker).toBeDefined();
      expect(relMarker.altitudeMode).toBe('relativeToGround');

      const absLine = features.find(f => f.id === 'ln-1') as ILineFeature;
      expect(absLine).toBeDefined();
      expect(absLine.altitudeMode).toBe('absolute');

      const defaultMarker = features.find(f => f.id === 'pt-default') as IMarkerFeature;
      expect(defaultMarker).toBeDefined();
      expect(defaultMarker.altitudeMode).toBe('clampToGround');
    });
  });

  describe('Demo script output', () => {
    it('prints a typed feature list and shows minimal diff', () => {
      const kml = fs.readFileSync(path.join(fixturesDir, 'dreieck.kml'), 'utf-8');
      doc.parse(kml);
      const features = doc.getFeatures();

      const list = features.map(f => ({
        id: f.id,
        type: f.type,
        name: f.name
      }));

      // Demo output for user
      console.log('--- DEMO: Typed Feature List ---');
      console.table(list);

      const marker = features.find(f => f.type === 'marker') as IMarkerFeature;
      if (marker) {
        marker.position = { lon: 1, lat: 2, alt: 3 };
        const out = doc.serialize();
        console.log('--- DEMO: Edit applied. Diff size:', Math.abs(out.length - kml.length), 'bytes ---');
      }
    });
  });
});
