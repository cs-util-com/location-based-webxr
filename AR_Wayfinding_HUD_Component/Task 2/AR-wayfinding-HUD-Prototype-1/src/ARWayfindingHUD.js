import * as THREE from 'three';
import { DistanceLabel } from './DistanceLabel.js';

/**
 * ARWayfindingHUD manages a per-target set of frustum-locked indicators.
 * Each target gets its own arrow/circle pair and distance label.
 */
export class ARWayfindingHUD {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.PerspectiveCamera} camera
     * @param {THREE.WebGLRenderer} renderer
     * @param {object} config
     * @param {number} config.distanceMin - Distance (m) below which the indicator is hidden.
     * @param {number} config.distanceMax - Distance (m) above which the circle indicator is shown.
     * @param {number} [config.hudDistance=2.5] - Distance (m) at which HUD elements are placed in front of the camera.
     * @param {string|THREE.Texture} [config.arrowSprite] - Optional custom texture for the directional arrow indicator.
     *   Accepts a URL string or a pre-built THREE.Texture. If omitted, a procedural ConeGeometry is used as fallback.
     *   IMPORTANT: The arrow asset must point UPWARD (12 o'clock) and be centered on the image canvas.
     *   The rotation logic uses atan2 with a -90° offset, so an upward-pointing sprite will correctly
     *   track the target direction at runtime.
     * @param {string|THREE.Texture} [config.circleSprite] - Optional custom texture for the on-screen ring indicator.
     *   Accepts a URL string or a pre-built THREE.Texture. If omitted, a procedural RingGeometry is used as fallback.
     */
    constructor(scene, camera, renderer, config) {
        if (!config || typeof config.distanceMin === 'undefined' || typeof config.distanceMax === 'undefined') {
            throw new Error(
                "ARWayfindingHUD initialization failed: A configuration object containing " +
                "'distanceMin' and 'distanceMax' is strictly required."
            );
        }

        this.camera = camera;
        this.renderer = renderer; 
        
        this.distanceMin = config.distanceMin;
        this.distanceMax = config.distanceMax;
        this.hudDistance = config.hudDistance !== undefined ? config.hudDistance : 2.5;

        this._arrowTexture = config.arrowSprite || null;
        this._circleTexture = config.circleSprite || null;
        this._useArrowSprite = !!this._arrowTexture;
        this._useCircleSprite = !!this._circleTexture;

        this.targetStates = [];
        scene.add(this.camera);
    }

    _createHudMaterial(colorHex) {
        return new THREE.MeshBasicMaterial({
            color: colorHex,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        });
    }

    _resolveTexture(source) {
        if (source instanceof THREE.Texture) {
            return source;
        }
        return new THREE.TextureLoader().load(source);
    }

    _createArrowSprite() {
        const texture = this._arrowTexture
            ? this._resolveTexture(this._arrowTexture)
            : null;
        const material = new THREE.SpriteMaterial({
            map: texture,
            color: texture ? 0xffffff : 0xff3b30,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        });
        const sprite = new THREE.Sprite(material);
        sprite.renderOrder = 999;
        sprite.scale.set(0.3, 0.3, 1);
        sprite.visible = false;
        return sprite;
    }

    _createCircleSprite() {
        const texture = this._circleTexture
            ? this._resolveTexture(this._circleTexture)
            : null;
        const material = new THREE.SpriteMaterial({
            map: texture,
            color: texture ? 0xffffff : 0xff3b30,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        });
        const sprite = new THREE.Sprite(material);
        sprite.renderOrder = 999;
        sprite.scale.set(0.3, 0.3, 1);
        sprite.visible = false;
        return sprite;
    }

    _createArrowMesh(colorHex = 0xff3b30) {
        const geo = new THREE.ConeGeometry(0.1, 0.3, 16);
        geo.translate(0, 0.15, 0);
        const mesh = new THREE.Mesh(geo, this._createHudMaterial(colorHex));
        mesh.renderOrder = 999;
        mesh.visible = false;
        return mesh;
    }

    _createCircleMesh(colorHex = 0xff3b30) {
        const geo = new THREE.RingGeometry(0.08, 0.12, 32);
        const mesh = new THREE.Mesh(geo, this._createHudMaterial(colorHex));
        mesh.renderOrder = 999;
        mesh.visible = false;
        return mesh;
    }

    _ensureTargetState(index) {
        if (this.targetStates[index]) {
            return this.targetStates[index];
        }

        const arrowMesh = this._useArrowSprite ? this._createArrowSprite() : this._createArrowMesh();
        const circleMesh = this._useCircleSprite ? this._createCircleSprite() : this._createCircleMesh();
        const distanceLabel = new DistanceLabel();

        this.camera.add(arrowMesh);
        this.camera.add(circleMesh);
        this.camera.add(distanceLabel.getMesh());

        const state = {
            currentState: 'hidden',
            arrowMesh,
            circleMesh,
            distanceLabel
        };

        this.targetStates[index] = state;
        return state;
    }

    _syncTargetCount(targetCount) {
        for (let i = this.targetStates.length; i < targetCount; i += 1) {
            this._ensureTargetState(i);
        }

        for (let i = targetCount; i < this.targetStates.length; i += 1) {
            const state = this.targetStates[i];
            if (!state) continue;
            state.arrowMesh.visible = false;
            state.circleMesh.visible = false;
            state.distanceLabel.getMesh().visible = false;
        }
    }

    _updateTargetState(targetWorldPos, state) {
        let evalCamera = this.camera;
        if (this.renderer.xr.isPresenting) {
            const xrCamera = this.renderer.xr.getCamera();
            if (xrCamera.cameras && xrCamera.cameras.length > 0) {
                evalCamera = xrCamera.cameras[0];
            }
        }

        const fovRad = THREE.MathUtils.degToRad(evalCamera.fov);
        const frustumHeight = 2.0 * this.hudDistance * Math.tan(fovRad / 2.0);
        const frustumWidth = frustumHeight * evalCamera.aspect;

        const ndc = targetWorldPos.clone().project(evalCamera);
        const localPos = targetWorldPos.clone().applyMatrix4(evalCamera.matrixWorldInverse);
        const isBehind = localPos.z > 0;
        const distance = evalCamera.position.distanceTo(targetWorldPos);
        
        // Format distance string
        const distanceString = distance.toFixed(1) + ' m';

        const VIEWPORT_INNER = 0.95; 
        const VIEWPORT_OUTER = 1.0; 

        let onScreen = false;
        
        if (!isBehind) {
            if (state.currentState === 'arrow') {
                onScreen = Math.abs(ndc.x) <= VIEWPORT_INNER && Math.abs(ndc.y) <= VIEWPORT_INNER;
            } else {
                onScreen = Math.abs(ndc.x) <= VIEWPORT_OUTER && Math.abs(ndc.y) <= VIEWPORT_OUTER;
            }
        }

        if (onScreen) {
            if (distance < this.distanceMin) {
                state.currentState = 'hidden';
            } else if (distance >= this.distanceMax) {
                state.currentState = 'circle';
            } else if (state.currentState === 'arrow') {
                state.currentState = 'circle';
            }

            if (state.currentState === 'hidden') {
                state.arrowMesh.visible = false;
                state.circleMesh.visible = false;
                state.distanceLabel.getMesh().visible = false;
            } else if (state.currentState === 'circle') {
                state.arrowMesh.visible = false;
                state.circleMesh.visible = true;
                
                const circleX = THREE.MathUtils.clamp(ndc.x, -1, 1) * (frustumWidth / 2);
                const circleY = THREE.MathUtils.clamp(ndc.y, -1, 1) * (frustumHeight / 2);
                
                state.circleMesh.position.set(circleX, circleY, -this.hudDistance);
                
                // Update and position label slightly below the circle
                state.distanceLabel.updateText(distanceString);
                state.distanceLabel.getMesh().position.set(circleX, circleY - 0.2, -this.hudDistance);
                state.distanceLabel.getMesh().visible = true;
            }

            return;
        }

        state.currentState = 'arrow';
        state.circleMesh.visible = false;
        state.arrowMesh.visible = true;

        if (isBehind) {
            ndc.x *= -1;
            ndc.y *= -1;
        }

        const physicalX = ndc.x * (frustumWidth / 2);
        const physicalY = ndc.y * (frustumHeight / 2);
        const angle = Math.atan2(physicalY, physicalX);

        const margin = 0.9;
        const maxAbsX = (frustumWidth / 2) * margin;
        const maxAbsY = (frustumHeight / 2) * margin;

        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        const tX = maxAbsX / Math.max(Math.abs(cosA), 0.0001);
        const tY = maxAbsY / Math.max(Math.abs(sinA), 0.0001);
        const t = Math.min(tX, tY);

        const arrowX = cosA * t;
        const arrowY = sinA * t;

        state.arrowMesh.position.set(arrowX, arrowY, -this.hudDistance);
        if (this._useArrowSprite) {
            state.arrowMesh.material.rotation = angle - Math.PI / 2;
        } else {
            state.arrowMesh.rotation.set(0, 0, angle - Math.PI / 2);
        }

        // Update and position label slightly offset from the edge towards the center
        // This prevents the label from rendering outside the camera frustum
        state.distanceLabel.updateText(distanceString);
        const labelOffsetX = arrowX - (cosA * 0.25);
        const labelOffsetY = arrowY - (sinA * 0.25);
        state.distanceLabel.getMesh().position.set(labelOffsetX, labelOffsetY, -this.hudDistance);
        state.distanceLabel.getMesh().visible = true;
    }

    update(targetWorldPositions = []) {
        this._syncTargetCount(targetWorldPositions.length);

        targetWorldPositions.forEach((targetWorldPos, index) => {
            const state = this._ensureTargetState(index);
            this._updateTargetState(targetWorldPos, state);
        });
    }
}