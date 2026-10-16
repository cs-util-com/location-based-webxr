import { BaseFeatureRenderer } from './base';
import { IMarkerFeature } from '../contracts/document-model';
import { IAssetProvider } from '../contracts/kmz-container';
import { IGeoBridge } from '../contracts/geo-bridge';
import { TexturePromiseCache } from './cache';
import * as THREE from 'three';

export class MarkerRenderer extends BaseFeatureRenderer<IMarkerFeature> {
    private sprite: THREE.Sprite | null = null;
    private currentTextureUrl: string | null = null;
    private textureLoader = new THREE.TextureLoader();

    public async update(feature: IMarkerFeature, assetProvider: IAssetProvider, geoBridge: IGeoBridge): Promise<void> {
        this.setFeatureId(feature.id);
        const altitudeMode = feature.altitudeMode ?? 'clampToGround';
        const worldPos = geoBridge.geoToWorld(feature.position, altitudeMode);
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
                    console.warn(`Failed to load marker texture: ${iconHref}`, e);
                    textureToUse = this.createFallbackTexture();
                    this.currentTextureUrl = null;
                }
            } else {
                // Keep using the current active texture (it must have been resolved already)
                // Retrieve it from promise chain or active cache
                try {
                    textureToUse = await TexturePromiseCache.acquire(resolvedUrl, this.textureLoader);
                    TexturePromiseCache.release(resolvedUrl); // Balance the reference count increment of acquire
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

        if (!this.sprite) {
            const material = new THREE.SpriteMaterial({ map: textureToUse || undefined });
            this.sprite = new THREE.Sprite(material);
            this.sprite.center.set(0.5, 0.0);
            this.sprite.userData = { featureId: this.featureId };
            this.container.add(this.sprite);
        } else if (textureToUse) {
            this.sprite.material.map = textureToUse;
            this.sprite.material.needsUpdate = true;
            this.sprite.center.set(0.5, 0.0);
        }

        const scale = (feature.iconScale || 1.0) * 0.8;
        this.sprite.scale.set(scale, scale, 1);

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
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(16, 16, 12, 0, Math.PI * 2);
            ctx.fill();
        }
        const texture = new THREE.CanvasTexture(canvas);
        return texture;
    }

    public dispose(): void {
        if (this.currentTextureUrl) {
            TexturePromiseCache.release(this.currentTextureUrl);
        }
        super.dispose();
    }
}
