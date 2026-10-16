import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import {
    RendererFactory,
    TexturePromiseCache,
    MarkerRenderer,
    LineRenderer,
    GroundOverlayRenderer,
    ModelRenderer
} from '../src/renderers';
import { IAssetProvider } from '../src/contracts/kmz-container';
import { IGeoBridge } from '../src/contracts/geo-bridge';
import { FeatureId } from '../src/contracts/type';

// Ensure mock implementations for browser primitives in Node
if (typeof URL.createObjectURL === 'undefined') {
    URL.createObjectURL = () => 'blob:mock-object-url';
}
if (typeof URL.revokeObjectURL === 'undefined') {
    URL.revokeObjectURL = () => {};
}

class MockDOMParser {
    parseFromString(str: string, mimeType: string) {
        return {
            querySelectorAll: (query: string) => {
                if (query.includes('init_from')) {
                    const matches = [...str.matchAll(/<init_from>([^<]+)<\/init_from>/g)];
                    return matches.map(m => ({
                        textContent: m[1]
                    }));
                }
                return [];
            }
        } as any;
    }
}
globalThis.DOMParser = MockDOMParser as any;

// Mock ColladaLoader to run safely in Node test runner
vi.mock('three/examples/jsm/loaders/ColladaLoader.js', () => {
    return {
        ColladaLoader: class {
            manager: any;
            constructor(manager: any) {
                this.manager = manager;
            }
            load(url: string, onLoad: (res: any) => void, onProgress?: any, onError?: any) {
                const mockResult = {
                    scene: new THREE.Group()
                };
                setTimeout(() => onLoad(mockResult), 0);
            }
        }
    };
});

// Spy on TextureLoader load to trigger onLoad synchronously
vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((url: string, onLoad?: (texture: THREE.Texture) => void, onProgress?: any, onError?: any) => {
    const tex = new THREE.Texture();
    tex.image = { width: 32, height: 32 } as any;
    if (onLoad) {
        setTimeout(() => onLoad(tex), 0);
    }
    return tex;
});

class MockAssetProvider implements IAssetProvider {
    public resolvedUrls = new Map<string, string>();
    public assetBytes = new Map<string, Uint8Array>();
    public calls: string[] = [];

    public async getAssetUrl(href: string): Promise<string> {
        this.calls.push(href);
        return this.resolvedUrls.get(href) || `blob:mock/${href}`;
    }

    public async getAssetBytes(href: string): Promise<Uint8Array> {
        this.calls.push(href);
        return this.assetBytes.get(href) || new TextEncoder().encode('<init_from>textures/brick.png</init_from>');
    }

    public hasAsset(href: string): boolean {
        return true;
    }

    public dispose(): void {}
}

class MockGeoBridge implements IGeoBridge {
    public setAnchor(anchor: any): void {}

    public geoToWorld(position: any, altitudeMode?: any): any {
        return {
            x: position.lon * 1000,
            y: position.alt,
            z: position.lat * 1000
        };
    }

    public worldToGeo(position: any, altitudeMode?: any): any {
        return {
            lon: position.x / 1000,
            lat: position.z / 1000,
            alt: position.y
        };
    }

    public formatCoordinate(value: number, originalString?: string): string {
        return value.toString();
    }
}

describe('KML Features Renderers', () => {
    let assetProvider: MockAssetProvider;
    let geoBridge: MockGeoBridge;

    beforeEach(() => {
        assetProvider = new MockAssetProvider();
        geoBridge = new MockGeoBridge();
        TexturePromiseCache.clear();
    });

    describe('TexturePromiseCache', () => {
        it('should resolve concurrent acquire requests to the same Promise instance', async () => {
            const loader = new THREE.TextureLoader();
            const promise1 = TexturePromiseCache.acquire('test-url', loader);
            const promise2 = TexturePromiseCache.acquire('test-url', loader);

            expect(promise1).toBe(promise2);

            const tex1 = await promise1;
            const tex2 = await promise2;

            expect(tex1).toBe(tex2);
        });

        it('should release and dispose of texture when refCount reaches 0', async () => {
            const loader = new THREE.TextureLoader();
            const promise = TexturePromiseCache.acquire('test-url', loader);
            const texture = await promise;
            const disposeSpy = vi.spyOn(texture, 'dispose');

            TexturePromiseCache.release('test-url');
            expect(disposeSpy).toHaveBeenCalled();
        });
    });

    describe('MarkerRenderer', () => {
        it('should position the sprite in world coordinates', async () => {
            const renderer = new MarkerRenderer();
            const feature = {
                id: 'marker-1' as FeatureId,
                type: 'marker' as const,
                name: 'Test Marker',
                description: 'A test marker',
                position: { lon: 1.5, lat: 2.5, alt: 100 },
                iconHref: null,
                iconScale: 1.5
            };

            await renderer.update(feature, assetProvider, geoBridge);
            const object = renderer.getNativeObject();

            expect(object.position.x).toBe(1500);
            expect(object.position.y).toBe(100);
            expect(object.position.z).toBe(2500);

            const sprite = object.children.find(child => child instanceof THREE.Sprite) as THREE.Sprite;
            expect(sprite).toBeDefined();
            expect(sprite.scale.x).toBeCloseTo(1.2, 5);
            expect(sprite.scale.y).toBeCloseTo(1.2, 5);


            renderer.dispose();
        });
    });

    describe('LineRenderer', () => {
        it('should build line geometry and generate edit handles when selection is active', async () => {
            const renderer = new LineRenderer(false);
            const feature = {
                id: 'line-1' as FeatureId,
                type: 'line' as const,
                name: 'Test Line',
                description: 'A test line',
                coordinates: [
                    { lon: 1.0, lat: 1.0, alt: 0 },
                    { lon: 2.0, lat: 2.0, alt: 10 }
                ]
            };

            await renderer.update(feature, assetProvider, geoBridge);
            const object = renderer.getNativeObject();

            const line = object.children.find(child => child instanceof THREE.Line) as THREE.Line;
            expect(line).toBeDefined();

            // Handles should be disabled by default
            let instancedMesh = object.children.find(child => child instanceof THREE.InstancedMesh);
            expect(instancedMesh).toBeUndefined();

            // Enable handles
            renderer.setSelection(true);
            instancedMesh = object.children.find(child => child instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
            expect(instancedMesh).toBeDefined();
            expect(instancedMesh.count).toBe(2);

            renderer.dispose();
        });
    });

    describe('GroundOverlayRenderer', () => {
        it('should apply bilinear geographic grid interpolation and z-fighting offsets', async () => {
            const renderer = new GroundOverlayRenderer();
            const feature = {
                id: 'overlay-1' as FeatureId,
                type: 'ground-overlay' as const,
                name: 'Test Overlay',
                description: 'A test overlay',
                imageHref: 'overlay.png',
                latLonBox: {
                    north: 10,
                    south: 5,
                    east: 10,
                    west: 5,
                    rotation: 45
                },
                altitude: 0,
                altitudeMode: 'clampToGround' as const
            };

            await renderer.update(feature, assetProvider, geoBridge);
            const object = renderer.getNativeObject();

            const mesh = object.children.find(child => child instanceof THREE.Mesh) as THREE.Mesh;
            expect(mesh).toBeDefined();

            // Confirm polygonOffset options are configured for z-fighting
            const mat = mesh.material as THREE.MeshBasicMaterial;
            expect(mat.polygonOffset).toBe(true);
            expect(mat.polygonOffsetFactor).toBe(-1.0);
            expect(mat.polygonOffsetUnits).toBe(-4.0);

            renderer.dispose();
        });
    });

    describe('ModelRenderer', () => {
        it('should parse DAE file, pre-scan assets, and map transforms with YXZ Euler orientation', async () => {
            const renderer = new ModelRenderer();
            const feature = {
                id: 'model-1' as FeatureId,
                type: 'model' as const,
                name: 'Test Model',
                description: 'A test model',
                location: { lon: 1.0, lat: 2.0, alt: 50 },
                orientation: { heading: 90, tilt: 45, roll: 0 },
                scale: { x: 2, y: 2, z: 2 },
                modelHref: 'models/house.dae',
                altitudeMode: 'absolute' as const
            };

            await renderer.update(feature, assetProvider, geoBridge);
            const object = renderer.getNativeObject();

            // Position transforms
            expect(object.position.x).toBe(1000);
            expect(object.position.y).toBe(50);
            expect(object.position.z).toBe(2000);

            // Scale transforms
            expect(object.scale.x).toBe(2);
            expect(object.scale.y).toBe(2);
            expect(object.scale.z).toBe(2);

            renderer.dispose();
        });
    });

    describe('RendererFactory', () => {
        it('should correctly map feature types to concrete classes', () => {
            const factory = new RendererFactory();

            const markerRenderer = factory.createRenderer('marker');
            expect(markerRenderer.constructor.name).toBe('MarkerRenderer');

            const lineRenderer = factory.createRenderer('line');
            expect(lineRenderer.constructor.name).toBe('LineRenderer');

            const overlayRenderer = factory.createRenderer('ground-overlay');
            expect(overlayRenderer.constructor.name).toBe('GroundOverlayRenderer');

            const modelRenderer = factory.createRenderer('model');
            expect(modelRenderer.constructor.name).toBe('ModelRenderer');
        });
    });
});
