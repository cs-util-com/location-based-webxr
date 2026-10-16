import { BaseFeatureRenderer } from './base';
import { IMarkerFeature } from '../contracts/document-model';
import { IAssetProvider } from '../contracts/kmz-container';
import { IGeoBridge } from '../contracts/geo-bridge';
import { TexturePromiseCache } from './cache';
import * as THREE from 'three';

export class OrientedImageRenderer extends BaseFeatureRenderer<IMarkerFeature> {
    private mesh: THREE.Mesh | null = null;
    private currentTextureUrl: string | null = null;
    private textureLoader = new THREE.TextureLoader();

    public async update(feature: IMarkerFeature, assetProvider: IAssetProvider, geoBridge: IGeoBridge): Promise<void> {
        this.setFeatureId(feature.id);
        const worldPos = geoBridge.geoToWorld(feature.position, 'clampToGround');
        this.container.position.copy(worldPos);

        const iconHref = feature.iconHref;
        let textureToUse: THREE.Texture | null = null;

        if (iconHref) {
            let resolvedUrl = this.currentAssetUrls.get(iconHref);
            if (!resolvedUrl) {
                resolvedUrl = await assetProvider.getAssetUrl(iconHref);
                this.currentAssetUrls.set(iconHref, resolvedUrl);
            }

            if (this.currentTextureUrl !== resolvedUrl) {
                if (this.currentTextureUrl) {
                    TexturePromiseCache.release(this.currentTextureUrl);
                }
                try {
                    textureToUse = await TexturePromiseCache.acquire(resolvedUrl, this.textureLoader);
                    this.currentTextureUrl = resolvedUrl;
                } catch (e) {
                    console.warn(`Failed to load oriented image texture: ${iconHref}`, e);
                    textureToUse = this.createFallbackTexture();
                    this.currentTextureUrl = null;
                }
            } else {
                try {
                    textureToUse = await TexturePromiseCache.acquire(resolvedUrl, this.textureLoader);
                    TexturePromiseCache.release(resolvedUrl); // Balance reference count
                } catch (e) {
                    textureToUse = this.createFallbackTexture();
                }
            }
        } else {
            if (this.currentTextureUrl) {
                TexturePromiseCache.release(this.currentTextureUrl);
                this.currentTextureUrl = null;
            }
            textureToUse = this.createFallbackTexture();
        }

        if (!this.mesh) {
            const geometry = new THREE.PlaneGeometry(1, 1);
            const material = new THREE.MeshBasicMaterial({
                map: textureToUse || undefined,
                transparent: true,
                side: THREE.DoubleSide
            });
            this.mesh = new THREE.Mesh(geometry, material);
            this.mesh.userData = { featureId: this.featureId };
            this.container.add(this.mesh);
        } else if (textureToUse) {
            (this.mesh.material as THREE.MeshBasicMaterial).map = textureToUse;
            this.mesh.material.needsUpdate = true;
        }

        const scale = feature.iconScale || 1.0;
        this.mesh.scale.set(scale, scale, 1);
    }

    private createFallbackTexture(): THREE.Texture {
        if (typeof document === 'undefined') {
            return new THREE.Texture();
        }
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#0000ff';
            ctx.fillRect(0, 0, 32, 32);
        }
        return new THREE.CanvasTexture(canvas);
    }

    public dispose(): void {
        if (this.currentTextureUrl) {
            TexturePromiseCache.release(this.currentTextureUrl);
        }
        super.dispose();
    }
}
