import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { IFeatureView, IKmlDocument } from '../src/contracts/document-model';
import type { IGeoBridge } from '../src/contracts/geo-bridge';
import type { IAssetProvider, IKmzContainer } from '../src/contracts/kmz-container';
import type { IFeatureRenderer, IRendererFactory } from '../src/contracts/renderer';
import type { IPersistenceService } from '../src/contracts/persistence';
import type { FeatureId, WorldPosition } from '../src/contracts/type';
import { FeatureSceneRegistry } from '../src/editor/feature-scene-registry';
import { PersistenceCoordinator } from '../src/editor/persistence-coordinator';
import { dragExceededThreshold, intersectRayWithHorizontalPlane } from '../src/editor/interaction';

const id = (value: string) => value as FeatureId;
const marker = (value: string, lon = 1): IFeatureView => ({
  id: id(value), type: 'marker', name: value, description: '', position: { lon, lat: 2, alt: 3 }, iconHref: null, iconScale: 1,
} as IFeatureView);

const bridge: IGeoBridge = {
  setAnchor: vi.fn(), geoToWorld: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
  worldToGeo: vi.fn(), formatCoordinate: vi.fn((value: number) => String(value)),
};
const assets: IAssetProvider = { getAssetUrl: vi.fn(), getAssetBytes: vi.fn(), hasAsset: vi.fn(), dispose: vi.fn() };

class FakeRenderer implements IFeatureRenderer<IFeatureView, THREE.Object3D> {
  featureId = '' as FeatureId;
  readonly object = new THREE.Group();
  readonly update = vi.fn(async (feature: IFeatureView) => { this.featureId = feature.id; this.object.userData.featureId = feature.id; });
  readonly dispose = vi.fn();
  getNativeObject(): THREE.Object3D { return this.object; }
}

describe('FeatureSceneRegistry', () => {
  it('reuses unchanged feature renderers and disposes entries removed from the document', async () => {
    const created: FakeRenderer[] = [];
    const factory: IRendererFactory<THREE.Object3D> = { createRenderer: vi.fn(() => { const renderer = new FakeRenderer(); created.push(renderer); return renderer; }) };
    const root = new THREE.Group();
    const registry = new FeatureSceneRegistry(root, factory);

    await registry.reconcile([marker('a'), marker('b')], assets, bridge);
    await registry.reconcile([marker('b', 9)], assets, bridge);

    expect(created).toHaveLength(2);
    expect(created[0].dispose).toHaveBeenCalledOnce();
    expect(created[1].update).toHaveBeenCalledTimes(2);
    expect(root.children).toEqual([created[1].object]);
    expect(registry.findFeatureId(created[1].object)).toBe(id('b'));
  });

  it('does not attach an async result after its entry is removed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const renderer = new FakeRenderer();
    renderer.update.mockImplementationOnce(async () => { await gate; });
    const factory: IRendererFactory<THREE.Object3D> = { createRenderer: vi.fn(() => renderer) };
    const root = new THREE.Group();
    const registry = new FeatureSceneRegistry(root, factory);

    const pending = registry.reconcile([marker('a')], assets, bridge);
    await registry.reconcile([], assets, bridge);
    release();
    await pending;

    expect(root.children).toHaveLength(0);
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});

describe('PersistenceCoordinator', () => {
  it('writes serialized KML to the matching container and schedules persistence only after a mutation', () => {
    const document = { getFeatures: () => [marker('a')], serialize: vi.fn(() => '<kml/>') } as unknown as IKmlDocument;
    const container = { setDocKml: vi.fn() } as unknown as IKmzContainer;
    const persistence = { notifyChange: vi.fn() } as unknown as IPersistenceService;
    const coordinator = new PersistenceCoordinator(persistence);

    coordinator.observe(document, container); // establishes baseline; load must not save
    coordinator.observe(document, container);
    expect(persistence.notifyChange).not.toHaveBeenCalled();

    (document.getFeatures as any) = () => [marker('a', 7)];
    coordinator.observe(document, container);

    expect(container.setDocKml).toHaveBeenCalledWith('<kml/>');
    expect(persistence.notifyChange).toHaveBeenCalledOnce();
  });

  it('does not notify persistence when serialization fails', () => {
    const document = { getFeatures: () => [marker('a')], serialize: vi.fn(() => { throw new Error('bad XML'); }) } as unknown as IKmlDocument;
    const container = { setDocKml: vi.fn() } as unknown as IKmzContainer;
    const persistence = { notifyChange: vi.fn() } as unknown as IPersistenceService;
    const coordinator = new PersistenceCoordinator(persistence);
    coordinator.observe(document, container);
    (document.getFeatures as any) = () => [marker('a', 8)];

    expect(() => coordinator.observe(document, container)).toThrow('bad XML');
    expect(persistence.notifyChange).not.toHaveBeenCalled();
  });
});

describe('desktop interaction helpers', () => {
  it('uses a squared pointer threshold and returns finite horizontal-plane intersections only', () => {
    expect(dragExceededThreshold({ x: 10, y: 10 }, { x: 15, y: 13 })).toBe(false);
    expect(dragExceededThreshold({ x: 10, y: 10 }, { x: 17, y: 10 })).toBe(true);

    const point = intersectRayWithHorizontalPlane(
      { origin: { x: 0, y: 10, z: 0 }, direction: { x: 0, y: -1, z: 0 } }, 2,
    );
    expect(point).toEqual({ x: 0, y: 2, z: 0 } satisfies WorldPosition);
    expect(intersectRayWithHorizontalPlane({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, 2)).toBeNull();
  });
});
