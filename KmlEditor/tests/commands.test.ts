import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKmlDocument } from '../src/document-model';
import { createGeoBridge } from '../src/geo-bridge';
import { IKmlDocument, IFeatureView, ILineFeature, IMarkerFeature, IGroundOverlayFeature, IModelFeature } from '../src/contracts/document-model';
import { AltitudeMode, FeatureId, GeoPosition, LatLonBox, ModelOrientation, ModelScale } from '../src/contracts/type';
import {
    createAddLineVertexCommand,
    createCommandStack,
    createCreateFeatureCommand,
    createDeleteFeatureCommand,
    createMoveLineVertexCommand,
    createMoveMarkerCommand,
    createMoveModelCommand,
    createMoveOverlayCommand,
    createRemoveLineVertexCommand,
    createRotateModelCommand,
    createRotateOverlayCommand,
    createScaleModelCommand,
    createSetDescriptionCommand,
    createSetNameCommand,
} from '../src/commands';

const INITIAL_KML = `
<kml>
  <Document>
    <Placemark id="marker-1">
      <name>Marker</name>
      <description>Marker description</description>
      <Point>
        <coordinates>10,50,100</coordinates>
      </Point>
    </Placemark>
    <Placemark id="line-1">
      <name>Line</name>
      <description>Line description</description>
      <LineString>
        <coordinates>10,50,100
        10.001,50.001,101</coordinates>
      </LineString>
    </Placemark>
    <GroundOverlay id="overlay-1">
      <name>Overlay</name>
      <description>Overlay description</description>
      <Icon><href>overlay.png</href></Icon>
      <LatLonBox>
        <north>51</north>
        <south>49</south>
        <east>11</east>
        <west>9</west>
        <rotation>5</rotation>
      </LatLonBox>
      <altitude>20</altitude>
      <altitudeMode>relativeToGround</altitudeMode>
    </GroundOverlay>
    <Model id="model-1">
      <name>Model</name>
      <description>Model description</description>
      <Location>
        <longitude>10</longitude>
        <latitude>50</latitude>
        <altitude>100</altitude>
      </Location>
      <Orientation>
        <heading>0</heading>
        <tilt>0</tilt>
        <roll>0</roll>
      </Orientation>
      <Scale>
        <x>1</x>
        <y>1</y>
        <z>1</z>
      </Scale>
      <Link><href>model.dae</href></Link>
      <altitudeMode>absolute</altitudeMode>
    </Model>
  </Document>
</kml>
`;

function createFixtureDocument(): IKmlDocument {
    const document = createKmlDocument();
    document.parse(INITIAL_KML);
    return document;
}

function createFixtureBridge() {
    const bridge = createGeoBridge();
    bridge.setAnchor({ position: { lon: 10, lat: 50, alt: 100 }, heading: 0 });
    return bridge;
}

function getFeature<T extends IFeatureView>(document: IKmlDocument, type: T['type'], name: string): T {
    const feature = document.getFeatures().find((item) => item.type === type && item.name === name);
    if (!feature) {
        throw new Error(`Missing ${type} feature named ${name}`);
    }

    return feature as T;
}

function expectPositionsEqual(actual: GeoPosition, expected: GeoPosition): void {
  expect(actual.lon).toBeCloseTo(expected.lon, 8);
  expect(actual.lat).toBeCloseTo(expected.lat, 8);
    expect(actual.alt).toBeCloseTo(expected.alt, 9);
}

function expectLatLonBoxEqual(actual: LatLonBox, expected: LatLonBox): void {
    expect(actual.north).toBeCloseTo(expected.north, 9);
    expect(actual.south).toBeCloseTo(expected.south, 9);
    expect(actual.east).toBeCloseTo(expected.east, 9);
    expect(actual.west).toBeCloseTo(expected.west, 9);
    expect(actual.rotation).toBeCloseTo(expected.rotation, 9);
}

describe('commands', () => {
    let document: IKmlDocument;
    let bridge: ReturnType<typeof createFixtureBridge>;

    beforeEach(() => {
        document = createFixtureDocument();
        bridge = createFixtureBridge();
    });

    it('executes undo and redo with document-scoped history and change notifications', () => {
        const stack = createCommandStack(document, bridge);
        const listener = vi.fn();
        const removeListener = stack.onChange(listener);

        const marker = getFeature<IMarkerFeature>(document, 'marker', 'Marker');
        stack.execute(createSetNameCommand(marker.id, 'Renamed Marker'));

        expect(stack.canUndo()).toBe(true);
        expect(stack.canRedo()).toBe(false);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(marker.name).toBe('Renamed Marker');

        const undone = stack.undo();
        expect(undone?.type).toBe('set-name');
        expect(stack.canUndo()).toBe(false);
        expect(stack.canRedo()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(2);
        expect(marker.name).toBe('Marker');

        const redone = stack.redo();
        expect(redone?.type).toBe('set-name');
        expect(listener).toHaveBeenCalledTimes(3);
        expect(marker.name).toBe('Renamed Marker');

        stack.undo();
        stack.execute(createSetDescriptionCommand(marker.id, 'New description'));
        expect(stack.canRedo()).toBe(false);
        expect(listener).toHaveBeenCalledTimes(5);

        removeListener();
        stack.undo();
        expect(listener).toHaveBeenCalledTimes(5);
    });

    it('updates only the intended text fields and restores them on undo', () => {
        const stack = createCommandStack(document, bridge);
        const marker = getFeature<IMarkerFeature>(document, 'marker', 'Marker');

        stack.execute(createSetNameCommand(marker.id, 'Updated Name'));
        stack.execute(createSetDescriptionCommand(marker.id, 'Updated Description'));

        expect(marker.name).toBe('Updated Name');
        expect(marker.description).toBe('Updated Description');

        stack.undo();
        expect(marker.description).toBe('Marker description');
        expect(marker.name).toBe('Updated Name');

        stack.undo();
        expect(marker.name).toBe('Marker');
    });

    it('moves marker and line vertices through the geo bridge and restores their original coordinates', () => {
        const stack = createCommandStack(document, bridge);
        const marker = getFeature<IMarkerFeature>(document, 'marker', 'Marker');
        const line = getFeature<ILineFeature>(document, 'line', 'Line');

        const nextMarkerGeo: GeoPosition = { lon: 10.002, lat: 50.001, alt: 123 };
        const nextLineGeo: GeoPosition = { lon: 10.003, lat: 50.004, alt: 130 };

        stack.execute(createMoveMarkerCommand(marker.id, bridge.geoToWorld(nextMarkerGeo, 'absolute')));
        stack.execute(createMoveLineVertexCommand(line.id, 1, bridge.geoToWorld(nextLineGeo, 'absolute')));

        expectPositionsEqual(marker.position, nextMarkerGeo);
        expectPositionsEqual(line.coordinates[1], nextLineGeo);

        stack.undo();
        expectPositionsEqual(line.coordinates[1], { lon: 10.001, lat: 50.001, alt: 101 });

        stack.undo();
        expectPositionsEqual(marker.position, { lon: 10, lat: 50, alt: 100 });
    });

    it('adds and removes line vertices without disturbing the rest of the geometry', () => {
        const stack = createCommandStack(document, bridge);
        const line = getFeature<ILineFeature>(document, 'line', 'Line');
        const extraVertex: GeoPosition = { lon: 10.01, lat: 50.02, alt: 140 };

        stack.execute(createAddLineVertexCommand(line.id, 1, bridge.geoToWorld(extraVertex, 'absolute')));
        expect(line.coordinates).toHaveLength(3);
        expectPositionsEqual(line.coordinates[1], extraVertex);

        stack.undo();
        expect(line.coordinates).toHaveLength(2);
        expectPositionsEqual(line.coordinates[1], { lon: 10.001, lat: 50.001, alt: 101 });

        stack.execute(createRemoveLineVertexCommand(line.id, 0));
        expect(line.coordinates).toHaveLength(1);
        expectPositionsEqual(line.coordinates[0], { lon: 10.001, lat: 50.001, alt: 101 });
    });

    it('covers overlay and model transforms with undo restoration', () => {
        const stack = createCommandStack(document, bridge);
        const overlay = getFeature<IGroundOverlayFeature>(document, 'ground-overlay', 'Overlay');
        const model = getFeature<IModelFeature>(document, 'model', 'Model');

        const nextOverlayBox: LatLonBox = { north: 52, south: 48, east: 12, west: 8, rotation: 15 };
        const nextModelLocation: GeoPosition = { lon: 10.5, lat: 50.5, alt: 125 };
        const nextModelScale: ModelScale = { x: 2, y: 1.5, z: 0.5 };
        const nextModelOrientation: ModelOrientation = { heading: 45, tilt: 10, roll: 5 };

        stack.execute(createMoveOverlayCommand(overlay.id, nextOverlayBox, 30, 'absolute'));
        stack.execute(createRotateOverlayCommand(overlay.id, 25));
        stack.execute(createMoveModelCommand(model.id, nextModelLocation));
        stack.execute(createScaleModelCommand(model.id, nextModelScale));
        stack.execute(createRotateModelCommand(model.id, nextModelOrientation));

        expectLatLonBoxEqual(overlay.latLonBox, { ...nextOverlayBox, rotation: 25 });
        expect(overlay.altitude).toBe(30);
        expect(overlay.altitudeMode).toBe('absolute');
        expectPositionsEqual(model.location, nextModelLocation);
        expect(model.scale).toEqual(nextModelScale);
        expect(model.orientation).toEqual(nextModelOrientation);

        stack.undo();
        stack.undo();
        stack.undo();
        stack.undo();
        stack.undo();

        expectLatLonBoxEqual(overlay.latLonBox, { north: 51, south: 49, east: 11, west: 9, rotation: 5 });
        expect(overlay.altitude).toBe(20);
        expect(overlay.altitudeMode).toBe('relativeToGround');
        expectPositionsEqual(model.location, { lon: 10, lat: 50, alt: 100 });
        expect(model.scale).toEqual({ x: 1, y: 1, z: 1 });
        expect(model.orientation).toEqual({ heading: 0, tilt: 0, roll: 0 });
    });

    it('creates features with a post-execute id and deletes them with undo support', () => {
      const createdIds: string[] = [];
      const fakeDocument = {
        parse: vi.fn(),
        serialize: vi.fn(),
        getFeatures: vi.fn().mockReturnValue([]),
        getFeatureById: vi.fn(),
        insertFeature: vi.fn(() => {
          const nextId = `created-${createdIds.length + 1}` as FeatureId;
          createdIds.push(nextId);
          return nextId;
        }),
        removeFeature: vi.fn((id: FeatureId) => ({
          id,
          type: 'marker',
          kmlFragment: '<Placemark />',
          insertionIndex: 0,
        })),
        restoreFeature: vi.fn(),
      } satisfies IKmlDocument;
      const stack = createCommandStack(fakeDocument, bridge);
      const template = {
        type: 'marker' as const,
        name: 'Created Marker',
        position: { lon: 10.2, lat: 50.2, alt: 110 },
      };
      const createCommand = createCreateFeatureCommand(template);

      stack.execute(createCommand);
      const firstCreatedId = createCommand.featureId;

      expect(firstCreatedId).toBe('created-1');
      expect(fakeDocument.insertFeature).toHaveBeenCalledTimes(1);

      stack.undo();
      expect(fakeDocument.removeFeature).toHaveBeenCalledWith(firstCreatedId);

      stack.redo();
      expect(createCommand.featureId).toBe('created-2');
      expect(fakeDocument.insertFeature).toHaveBeenCalledTimes(2);

      const deleteCommand = createDeleteFeatureCommand(createCommand.featureId);
      stack.execute(deleteCommand);

      expect(fakeDocument.removeFeature).toHaveBeenCalledWith('created-2');

      stack.undo();
      expect(fakeDocument.restoreFeature).toHaveBeenCalledWith(expect.objectContaining({ id: 'created-2' }), undefined);
    });

    it('rejects invalid targets without changing the stack or notifying listeners', () => {
        const stack = createCommandStack(document, bridge);
        const listener = vi.fn();
        stack.onChange(listener);

        const marker = getFeature<IMarkerFeature>(document, 'marker', 'Marker');

        expect(() => stack.execute(createMoveMarkerCommand(marker.id, { x: Number.NaN, y: 0, z: 0 }))).toThrow();
        expect(() => stack.execute(createMoveLineVertexCommand(marker.id as FeatureId, 9, { x: 0, y: 0, z: 0 }))).toThrow();
        expect(() => stack.execute(createDeleteFeatureCommand('missing-id' as FeatureId))).toThrow();

        expect(stack.canUndo()).toBe(false);
        expect(stack.canRedo()).toBe(false);
        expect(listener).not.toHaveBeenCalled();
    });
});