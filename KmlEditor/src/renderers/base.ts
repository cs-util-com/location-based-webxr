import { IFeatureRenderer } from '../contracts/renderer';
import { IFeatureView } from '../contracts/document-model';
import { FeatureId } from '../contracts/type';
import { IAssetProvider } from '../contracts/kmz-container';
import { IGeoBridge } from '../contracts/geo-bridge';
import * as THREE from 'three';

export abstract class BaseFeatureRenderer<T extends IFeatureView> implements IFeatureRenderer<T, THREE.Object3D> {
    private _featureId: FeatureId = '' as any;
    protected container: THREE.Group;
    protected currentAssetUrls = new Map<string, string>(); // Maps raw href to resolved Blob URL

    constructor() {
        this.container = new THREE.Group();
    }

    public get featureId(): FeatureId {
        return this._featureId;
    }

    protected setFeatureId(id: FeatureId): void {
        this._featureId = id;
        this.container.userData = { featureId: id };
    }

    public abstract update(feature: T, assetProvider: IAssetProvider, geoBridge: IGeoBridge): Promise<void>;

    public getNativeObject(): THREE.Object3D {
        return this.container;
    }

    public dispose(): void {
        this.cleanupWebGLResources(this.container);
        this.revokeBlobUrls();
    }

    protected revokeBlobUrls(): void {
        for (const [_, blobUrl] of this.currentAssetUrls) {
            if (blobUrl && blobUrl.startsWith('blob:')) {
                try {
                    URL.revokeObjectURL(blobUrl);
                } catch (e) {
                    // Suppress error in environments without URL.revokeObjectURL
                }
            }
        }
        this.currentAssetUrls.clear();
    }

    protected cleanupWebGLResources(object: THREE.Object3D): void {
        object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach((mat) => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            } else if (child instanceof THREE.Sprite) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            }
        });
    }
}
