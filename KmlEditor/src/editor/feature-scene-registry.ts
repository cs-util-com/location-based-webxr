import * as THREE from 'three';
import { IFeatureView } from '../contracts/document-model';
import { IGeoBridge } from '../contracts/geo-bridge';
import { IAssetProvider } from '../contracts/kmz-container';
import { IFeatureRenderer, IRendererFactory } from '../contracts/renderer';
import { FeatureId } from '../contracts/type';

interface Entry { renderer: IFeatureRenderer<IFeatureView, THREE.Object3D>; updateGeneration: number; }

/** Reconciles contract feature views to native Three.js objects without owning renderer resources. */
export class FeatureSceneRegistry {
    private readonly entries = new Map<FeatureId, Entry>();
    private generation = 0;

    public constructor(private readonly root: THREE.Group, private readonly factory: IRendererFactory<THREE.Object3D>) {}

    public async reconcile(features: readonly IFeatureView[], assets: IAssetProvider, bridge: IGeoBridge): Promise<void> {
        const generation = ++this.generation;
        const next = new Map<FeatureId, IFeatureView>();
        for (const feature of features) {
            if (next.has(feature.id)) throw new Error(`Duplicate feature id: ${String(feature.id)}`);
            next.set(feature.id, feature);
        }
        for (const [featureId, entry] of this.entries) {
            if (!next.has(featureId)) this.remove(featureId, entry);
        }
        await Promise.all([...next.values()].map(async (feature) => {
            let entry = this.entries.get(feature.id);
            if (!entry) {
                entry = { renderer: this.factory.createRenderer(feature.type), updateGeneration: 0 };
                this.entries.set(feature.id, entry);
            }
            const updateGeneration = ++entry.updateGeneration;
            await entry.renderer.update(feature, assets, bridge);
            if (this.generation !== generation || this.entries.get(feature.id) !== entry || entry.updateGeneration !== updateGeneration) return;
            const object = entry.renderer.getNativeObject();
            if (object.parent !== this.root) this.root.add(object);
        }));
    }

    public getObject(featureId: FeatureId): THREE.Object3D | null {
        const entry = this.entries.get(featureId);
        return entry ? entry.renderer.getNativeObject() : null;
    }

    public findFeatureId(object: THREE.Object3D): FeatureId | null {
        let current: THREE.Object3D | null = object;
        while (current) {
            const candidate = current.userData?.featureId as FeatureId | undefined;
            if (candidate && this.entries.has(candidate)) return candidate;
            current = current.parent;
        }
        return null;
    }

    public dispose(): void {
        this.generation++;
        for (const [featureId, entry] of this.entries) this.remove(featureId, entry);
    }

    private remove(featureId: FeatureId, entry: Entry): void {
        if (this.entries.get(featureId) !== entry) return;
        this.entries.delete(featureId);
        entry.renderer.getNativeObject().removeFromParent();
        entry.renderer.dispose();
    }
}
