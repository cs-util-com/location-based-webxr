import { BaseFeatureRenderer } from './base';
import { IModelFeature } from '../contracts/document-model';
import { IAssetProvider } from '../contracts/kmz-container';
import { IGeoBridge } from '../contracts/geo-bridge';
import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';

export class ModelRenderer extends BaseFeatureRenderer<IModelFeature> {
    private loadedModel: THREE.Group | null = null;
    private placeholderMesh: THREE.Mesh | null = null;
    private abortController: AbortController | null = null;

    public async update(feature: IModelFeature, assetProvider: IAssetProvider, geoBridge: IGeoBridge): Promise<void> {
        this.setFeatureId(feature.id);
        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const worldPos = geoBridge.geoToWorld(feature.location, feature.altitudeMode);
        this.container.position.copy(worldPos);

        const heading = feature.orientation?.heading ?? 0;
        const tilt = feature.orientation?.tilt ?? 0;
        const roll = feature.orientation?.roll ?? 0;

        const euler = new THREE.Euler(
            tilt * Math.PI / 180,
            -heading * Math.PI / 180,
            -roll * Math.PI / 180,
            'YXZ'
        );
        this.container.quaternion.setFromEuler(euler);

        const scale = feature.scale || { x: 1, y: 1, z: 1 };
        this.container.scale.set(scale.x, scale.y, scale.z);

        const modelHref = feature.modelHref;
        if (!modelHref) {
            this.showPlaceholder();
            return;
        }

        try {
            const daeBytes = await assetProvider.getAssetBytes(modelHref);
            if (signal.aborted) return;

            const textDecoder = new TextDecoder();
            const rawDaeText = textDecoder.decode(daeBytes);

            // Strip DOCTYPE to prevent XXE
            const sanitizedDaeText = rawDaeText.replace(/<!DOCTYPE[^>]*>/gi, '');
            // Strip XML comments to prevent injection
            const commentlessDaeText = sanitizedDaeText.replace(/<!--[\s\S]*?-->/g, '');

            const relativePaths: string[] = [];
            const regex = /<(?:[a-zA-Z0-9_]+:)?init_from>\s*([^<]+)\s*<\/(?:[a-zA-Z0-9_]+:)?init_from>/gi;
            let match;
            while ((match = regex.exec(commentlessDaeText)) !== null) {
                relativePaths.push(match[1].trim());
            }

            const parentDir = modelHref.substring(0, modelHref.lastIndexOf('/') + 1);
            const cacheMap = new Map<string, string>();

            for (const relPath of relativePaths) {
                if (signal.aborted) return;
                let cleanRelPath = decodeURIComponent(relPath).replace(/\\/g, '/');
                if (cleanRelPath.startsWith('file:///')) {
                    cleanRelPath = cleanRelPath.replace('file:///', '');
                } else if (cleanRelPath.startsWith('file://')) {
                    cleanRelPath = cleanRelPath.replace('file://', '');
                }

                const resolvedPath = this.resolveRelativePath(parentDir, cleanRelPath);
                if (assetProvider.hasAsset(resolvedPath)) {
                    try {
                        const blobUrl = await assetProvider.getAssetUrl(resolvedPath);
                        cacheMap.set(resolvedPath, blobUrl);
                        this.currentAssetUrls.set(resolvedPath, blobUrl);
                    } catch (e) {
                        console.warn(`Failed to resolve texture asset: ${resolvedPath}`, e);
                    }
                }
            }

            if (signal.aborted) return;

            const manager = new THREE.LoadingManager();
            manager.setURLModifier((url) => {
                let cleanUrl = decodeURIComponent(url).replace(/\\/g, '/');
                cleanUrl = cleanUrl.replace(/^(blob:)?https?:\/\/[^\/]+\//, '');
                
                const resolvedPath = this.resolveRelativePath(parentDir, cleanUrl);
                const cachedUrl = cacheMap.get(resolvedPath);
                return cachedUrl || url;
            });

            const daeBlob = new Blob([sanitizedDaeText], { type: 'application/xml' });
            const daeBlobUrl = URL.createObjectURL(daeBlob);
            this.currentAssetUrls.set('__model_dae__', daeBlobUrl);

            const loader = new ColladaLoader(manager);
            const collada = await new Promise<any>((resolve, reject) => {
                loader.load(
                    daeBlobUrl,
                    (result) => resolve(result),
                    undefined,
                    (err) => reject(err)
                );
            });

            if (signal.aborted) {
                if (collada && collada.scene) {
                    this.cleanupWebGLResources(collada.scene);
                }
                return;
            }

            this.removePlaceholder();
            if (this.loadedModel) {
                this.container.remove(this.loadedModel);
                this.cleanupWebGLResources(this.loadedModel);
            }

            this.loadedModel = collada.scene;
            if (this.loadedModel) {
                this.loadedModel.userData = { featureId: this.featureId };
                this.container.add(this.loadedModel);
            }

        } catch (err) {
            console.error(`Failed to load COLLADA model: ${modelHref}`, err);
            this.showPlaceholder();
        }
    }

    private resolveRelativePath(parentDir: string, relativePath: string): string {
        if (relativePath.startsWith('/') || relativePath.includes(':/')) {
            return relativePath.replace(/^\//, '');
        }
        const parts = (parentDir + relativePath).split('/');
        const stack: string[] = [];
        for (const part of parts) {
            if (part === '.' || part === '') continue;
            if (part === '..') {
                if (stack.length > 0) stack.pop();
            } else {
                stack.push(part);
            }
        }
        return stack.join('/');
    }

    private showPlaceholder(): void {
        this.removePlaceholder();
        if (this.loadedModel) {
            this.container.remove(this.loadedModel);
            this.cleanupWebGLResources(this.loadedModel);
            this.loadedModel = null;
        }

        const geometry = new THREE.BoxGeometry(2, 2, 2);
        const material = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
        this.placeholderMesh = new THREE.Mesh(geometry, material);
        this.placeholderMesh.userData = { featureId: this.featureId };
        this.container.add(this.placeholderMesh);
    }

    private removePlaceholder(): void {
        if (this.placeholderMesh) {
            this.container.remove(this.placeholderMesh);
            this.placeholderMesh.geometry.dispose();
            if (Array.isArray(this.placeholderMesh.material)) {
                this.placeholderMesh.material.forEach((m) => m.dispose());
            } else {
                this.placeholderMesh.material.dispose();
            }
            this.placeholderMesh = null;
        }
    }

    public dispose(): void {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.removePlaceholder();
        super.dispose();
    }
}
