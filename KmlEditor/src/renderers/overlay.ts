import { BaseFeatureRenderer } from './base';
import { IGroundOverlayFeature } from '../contracts/document-model';
import { IAssetProvider } from '../contracts/kmz-container';
import { IGeoBridge } from '../contracts/geo-bridge';
import { TexturePromiseCache } from './cache';
import * as THREE from 'three';

export class GroundOverlayRenderer extends BaseFeatureRenderer<IGroundOverlayFeature> {
    private mesh: THREE.Mesh | null = null;
    private currentTextureUrl: string | null = null;
    private textureLoader = new THREE.TextureLoader();

    public async update(feature: IGroundOverlayFeature, assetProvider: IAssetProvider, geoBridge: IGeoBridge): Promise<void> {
        this.setFeatureId(feature.id);
        const imageHref = feature.imageHref;
        let textureToUse: THREE.Texture | null = null;

        if (imageHref) {
            let resolvedUrl = this.currentAssetUrls.get(imageHref);
            if (!resolvedUrl) {
                resolvedUrl = await assetProvider.getAssetUrl(imageHref);
                this.currentAssetUrls.set(imageHref, resolvedUrl);
            }

            if (this.currentTextureUrl !== resolvedUrl) {
                if (this.currentTextureUrl) {
                    TexturePromiseCache.release(this.currentTextureUrl);
                }
                try {
                    textureToUse = await TexturePromiseCache.acquire(resolvedUrl, this.textureLoader);
                    this.currentTextureUrl = resolvedUrl;
                } catch (e) {
                    console.warn(`Failed to load overlay texture: ${imageHref}`, e);
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

        const gridSegments = 8;
        const vertexCount = (gridSegments + 1) * (gridSegments + 1);
        const positions = new Float32Array(vertexCount * 3);
        const uvs = new Float32Array(vertexCount * 2);
        const indices: number[] = [];

        const box = feature.latLonBox;
        const centerLon = (box.east + box.west) / 2;
        const centerLat = (box.north + box.south) / 2;
        const centerWorldPos = geoBridge.geoToWorld({ lon: centerLon, lat: centerLat, alt: feature.altitude }, feature.altitudeMode);

        const rotationRad = -box.rotation * Math.PI / 180; // Positive rotation in KML is counter-clockwise

        const cosR = Math.cos(rotationRad);
        const sinR = Math.sin(rotationRad);

        let vertexIdx = 0;
        for (let ySegment = 0; ySegment <= gridSegments; ySegment++) {
            const v = ySegment / gridSegments;
            for (let xSegment = 0; xSegment <= gridSegments; xSegment++) {
                const u = xSegment / gridSegments;

                // Bilinear interpolation in geographic coordinates (unrotated)
                const lon = box.west + u * (box.east - box.west);
                const lat = box.south + v * (box.north - box.south);

                // Project unrotated vertex to world space
                const geoPos = { lon, lat, alt: feature.altitude };
                const worldPos = geoBridge.geoToWorld(geoPos, feature.altitudeMode);

                // Calculate offset relative to center in world space
                const dx = worldPos.x - centerWorldPos.x;
                const dz = worldPos.z - centerWorldPos.z;

                // Rotate in world space (preserves rectangle shape, prevents shearing/distortion)
                const rotatedX = centerWorldPos.x + dx * cosR - dz * sinR;
                const rotatedZ = centerWorldPos.z + dx * sinR + dz * cosR;

                positions[vertexIdx * 3] = rotatedX;
                positions[vertexIdx * 3 + 1] = worldPos.y;
                positions[vertexIdx * 3 + 2] = rotatedZ;

                uvs[vertexIdx * 2] = u;
                uvs[vertexIdx * 2 + 1] = v;

                vertexIdx++;
            }
        }


        for (let y = 0; y < gridSegments; y++) {
            for (let x = 0; x < gridSegments; x++) {
                const row1 = y * (gridSegments + 1);
                const row2 = (y + 1) * (gridSegments + 1);

                indices.push(row1 + x, row1 + x + 1, row2 + x);
                indices.push(row1 + x + 1, row2 + x + 1, row2 + x);
            }
        }

        if (!this.mesh) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            geometry.setIndex(indices);
            geometry.computeVertexNormals();

            const material = new THREE.MeshBasicMaterial({
                map: textureToUse || undefined,
                transparent: true,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -1.0,
                polygonOffsetUnits: -4.0,
            });

            this.mesh = new THREE.Mesh(geometry, material);
            this.mesh.userData = { featureId: this.featureId };
            this.container.add(this.mesh);
        } else {
            this.mesh.geometry.dispose();
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            geometry.setIndex(indices);
            geometry.computeVertexNormals();
            this.mesh.geometry = geometry;

            if (textureToUse) {
                (this.mesh.material as THREE.MeshBasicMaterial).map = textureToUse;
                this.mesh.material.needsUpdate = true;
            }
        }
    }

    private createFallbackTexture(): THREE.Texture {
        if (typeof document === 'undefined') {
            return new THREE.Texture();
        }
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 64, 64);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 32, 32);
            ctx.fillRect(32, 32, 32, 32);
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
