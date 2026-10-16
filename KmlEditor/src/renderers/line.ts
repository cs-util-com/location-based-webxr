import { BaseFeatureRenderer } from './base';
import { ILineFeature } from '../contracts/document-model';
import { IAssetProvider } from '../contracts/kmz-container';
import { IGeoBridge } from '../contracts/geo-bridge';
import * as THREE from 'three';

export class LineRenderer extends BaseFeatureRenderer<ILineFeature> {
    private line: THREE.Line | null = null;
    private handles: THREE.InstancedMesh | null = null;
    private showHandles: boolean = false;

    constructor(showHandles: boolean = false) {
        super();
        this.showHandles = showHandles;
    }

    public async update(feature: ILineFeature, assetProvider: IAssetProvider, geoBridge: IGeoBridge): Promise<void> {
        this.setFeatureId(feature.id);
        const altitudeMode = feature.altitudeMode ?? 'clampToGround';
        const positions: number[] = [];
        feature.coordinates.forEach((coord) => {
            const worldPos = geoBridge.geoToWorld(coord, altitudeMode);
            positions.push(worldPos.x, worldPos.y, worldPos.z);
        });

        if (positions.length === 0) {
            this.clearLine();
            this.updateHandles([]);
            return;
        }

        if (!this.line) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            const material = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
            this.line = new THREE.Line(geometry, material);
            this.line.userData = { featureId: this.featureId };
            this.container.add(this.line);
        } else {
            const posAttr = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
            if (posAttr && posAttr.array.length === positions.length) {
                posAttr.copyArray(positions);
                posAttr.needsUpdate = true;
                this.line.geometry.computeBoundingBox();
                this.line.geometry.computeBoundingSphere();
            } else {
                this.line.geometry.dispose();
                this.line.geometry = new THREE.BufferGeometry();
                this.line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            }
        }

        this.updateHandles(positions);
    }

    private clearLine(): void {
        if (this.line) {
            this.container.remove(this.line);
            this.line.geometry.dispose();
            if (Array.isArray(this.line.material)) {
                this.line.material.forEach((m) => m.dispose());
            } else {
                this.line.material.dispose();
            }
            this.line = null;
        }
    }

    private updateHandles(positions: number[]): void {
        const vertexCount = positions.length / 3;

        if (!this.showHandles || vertexCount === 0) {
            this.clearHandles();
            return;
        }

        const sphereGeometry = new THREE.SphereGeometry(1.5, 8, 8);

        const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });

        if (!this.handles || this.handles.count !== vertexCount) {
            this.clearHandles();
            this.handles = new THREE.InstancedMesh(sphereGeometry, sphereMaterial, vertexCount);
            this.handles.userData = { featureId: this.featureId };
            this.container.add(this.handles);
        } else {
            // Geometries for internal instance creation are handled, we just dispose the local variables to free memory
            sphereGeometry.dispose();
            sphereMaterial.dispose();
        }

        const tempObject = new THREE.Object3D();
        for (let i = 0; i < vertexCount; i++) {
            tempObject.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
            tempObject.updateMatrix();
            this.handles.setMatrixAt(i, tempObject.matrix);
        }
        this.handles.instanceMatrix.needsUpdate = true;
    }

    private clearHandles(): void {
        if (this.handles) {
            this.container.remove(this.handles);
            this.handles.geometry.dispose();
            if (Array.isArray(this.handles.material)) {
                this.handles.material.forEach((m) => m.dispose());
            } else {
                this.handles.material.dispose();
            }
            this.handles = null;
        }
    }

    public setSelection(selected: boolean): void {
        if (this.showHandles !== selected) {
            this.showHandles = selected;
            if (this.line) {
                const posAttr = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
                if (posAttr) {
                    const posArray = Array.from(posAttr.array);
                    this.updateHandles(posArray);
                }
            }
        }
    }

    public dispose(): void {
        this.clearLine();
        this.clearHandles();
        super.dispose();
    }
}
