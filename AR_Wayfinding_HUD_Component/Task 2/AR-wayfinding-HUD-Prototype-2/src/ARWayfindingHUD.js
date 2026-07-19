import * as THREE from 'three';
import { DistanceLabel } from './DistanceLabel.js';
import {
    computeTargetPlacement,
    getEvaluationCamera,
} from './hud-placement.js';

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
     * @param {number} [config.indicatorScale=1.0] - Uniform scale multiplier for arrow and circle indicators.
     *   Use values < 1.0 (e.g. 0.5) to shrink indicators on mobile screens.
     * @param {number} [config.labelScale=1.0] - Uniform scale multiplier for distance labels.
     *   Use values < 1.0 (e.g. 0.5) to shrink labels on mobile screens.
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

        this._arrowTexture = config.arrowSprite ? this._resolveTexture(config.arrowSprite) : null;
        this._circleTexture = config.circleSprite ? this._resolveTexture(config.circleSprite) : null;
        this._useArrowSprite = !!this._arrowTexture;
        this._useCircleSprite = !!this._circleTexture;
        this._indicatorScale = config.indicatorScale !== undefined ? config.indicatorScale : 1.0;
        this._labelScale = config.labelScale !== undefined ? config.labelScale : 1.0;

        this.targetStates = [];
        this._waypoints = [];
        scene.add(this.camera);
    }

    /**
     * Replace the entire waypoint list.
     * All per-target states are discarded: waypoint identities change wholesale,
     * so no new waypoint may inherit a previous target's hysteresis state or
     * smoothed circle position.
     * @param {THREE.Vector3[]} positions
     */
    setWaypoints(positions) {
        this._waypoints = [...positions];
        this.targetStates.forEach((state) => this._disposeTargetState(state));
        this.targetStates = [];
    }

    /**
     * Append a single waypoint.
     * @param {THREE.Vector3} position
     */
    addWaypoint(position) {
        this._waypoints.push(position);
    }

    /**
     * Remove the waypoint at the given index.
     * The matching target state is spliced out too, so the states of all
     * following waypoints stay aligned with their own waypoint index.
     * @param {number} index
     */
    removeWaypoint(index) {
        this._waypoints.splice(index, 1);
        const [removedState] = this.targetStates.splice(index, 1);
        if (removedState) {
            this._disposeTargetState(removedState);
        }
    }

    /**
     * Creates a shared basic material for HUD procedural geometries.
     * @param {number|string} colorHex - The color for the material.
     * @returns {THREE.MeshBasicMaterial}
     */
    _createHudMaterial(colorHex) {
        return new THREE.MeshBasicMaterial({
            color: colorHex,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        });
    }

    /**
     * Resolves a texture source into a THREE.Texture instance.
     * @param {string|THREE.Texture} source - URL string or texture instance.
     * @returns {THREE.Texture}
     */
    _resolveTexture(source) {
        if (source instanceof THREE.Texture) {
            return source;
        }
        return new THREE.TextureLoader().load(source);
    }

    /**
     * Creates a sprite-based arrow indicator.
     * @returns {THREE.Sprite}
     */
    _createArrowSprite() {
        const texture = this._arrowTexture;
        const material = new THREE.SpriteMaterial({
            map: texture,
            color: texture ? 0xffffff : 0xff3b30,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        });
        const sprite = new THREE.Sprite(material);
        sprite.renderOrder = 999;
        sprite.scale.set(0.3 * this._indicatorScale, 0.3 * this._indicatorScale, 1);
        sprite.visible = false;
        return sprite;
    }

    /**
     * Creates a sprite-based circle indicator.
     * @returns {THREE.Sprite}
     */
    _createCircleSprite() {
        const texture = this._circleTexture;
        const material = new THREE.SpriteMaterial({
            map: texture,
            color: texture ? 0xffffff : 0xff3b30,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        });
        const sprite = new THREE.Sprite(material);
        sprite.renderOrder = 999;
        sprite.scale.set(0.3 * this._indicatorScale, 0.3 * this._indicatorScale, 1);
        sprite.visible = false;
        return sprite;
    }

    /**
     * Creates a procedural cone mesh for the arrow indicator.
     * @returns {THREE.Mesh}
     */
    _createArrowMesh() {
        if (!this._arrowGeometry) {
            const s = this._indicatorScale;
            this._arrowGeometry = new THREE.ConeGeometry(0.1 * s, 0.3 * s, 16);
            this._arrowGeometry.translate(0, 0.15 * s, 0);
        }
        if (!this._hudMaterial) {
            this._hudMaterial = this._createHudMaterial(0xff3b30);
        }
        const mesh = new THREE.Mesh(this._arrowGeometry, this._hudMaterial);
        mesh.renderOrder = 999;
        mesh.visible = false;
        return mesh;
    }

    /**
     * Creates a procedural ring mesh for the circle indicator.
     * @returns {THREE.Mesh}
     */
    _createCircleMesh() {
        if (!this._circleGeometry) {
            const s = this._indicatorScale;
            this._circleGeometry = new THREE.RingGeometry(0.08 * s, 0.12 * s, 32);
        }
        if (!this._hudMaterial) {
            this._hudMaterial = this._createHudMaterial(0xff3b30);
        }
        const mesh = new THREE.Mesh(this._circleGeometry, this._hudMaterial);
        mesh.renderOrder = 999;
        mesh.visible = false;
        return mesh;
    }

    /**
     * Ensures that the target state objects for a specific index are initialized.
     * @param {number} index - Index in the target states array.
     * @returns {object} The state object for the given target.
     */
    _ensureTargetState(index) {
        if (this.targetStates[index]) {
            return this.targetStates[index];
        }

        const arrowMesh = this._useArrowSprite ? this._createArrowSprite() : this._createArrowMesh();
        const circleMesh = this._useCircleSprite ? this._createCircleSprite() : this._createCircleMesh();
        const distanceLabel = new DistanceLabel(this.hudDistance * this._labelScale);

        this.camera.add(arrowMesh);
        this.camera.add(circleMesh);
        this.camera.add(distanceLabel.getMesh());

        const state = {
            currentState: 'hidden',
            arrowMesh,
            circleMesh,
            distanceLabel,
            smoothedCirclePos: new THREE.Vector3()
        };

        this.targetStates[index] = state;
        return state;
    }

    /**
     * Synchronizes the internal target states array length to match the current waypoints.
     * Hides extra indicators when fewer targets are active.
     * @param {number} targetCount - The number of currently active targets.
     */
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

    /**
     * Updates the transform and visibility of an individual target's state based on camera position.
     * @param {THREE.Vector3} targetWorldPos - The world position of the target waypoint.
     * @param {object} state - The indicator state object.
     */
    _updateTargetState(targetWorldPos, state) {
        const evalCamera = getEvaluationCamera(this.renderer, this.camera);
        const placement = computeTargetPlacement({
            targetWorldPos,
            camera: evalCamera,
            hudDistance: this.hudDistance,
            distanceMin: this.distanceMin,
            distanceMax: this.distanceMax,
            previousState: state.currentState,
            isXrSession: !!this.renderer?.xr?.isPresenting,
        });

        const previousState = state.currentState;
        state.currentState = placement.state;

        if (placement.state === 'hidden') {
            state.arrowMesh.visible = false;
            state.circleMesh.visible = false;
            state.distanceLabel.getMesh().visible = false;
            return;
        }

        state.distanceLabel.updateText(placement.distanceLabel);
        state.distanceLabel.getMesh().position.copy(placement.labelPosition);
        state.distanceLabel.getMesh().visible = true;

        if (placement.state === 'circle') {
            state.arrowMesh.visible = false;
            state.circleMesh.visible = true;

            // Snap to the placement on the frame the circle becomes visible;
            // damping only applies BETWEEN circle frames (smoothedCirclePos
            // would otherwise lerp in from its stale/zero value).
            const circleDamping = 0.15;
            if (previousState !== 'circle') {
                state.smoothedCirclePos.copy(placement.circlePosition);
            } else {
                state.smoothedCirclePos.lerp(placement.circlePosition, circleDamping);
            }
            state.circleMesh.position.copy(state.smoothedCirclePos);
            return;
        }

        state.circleMesh.visible = false;
        state.arrowMesh.visible = true;

        state.arrowMesh.position.copy(placement.arrowPosition);
        if (this._useArrowSprite) {
            state.arrowMesh.material.rotation = placement.arrowRotationZ;
        } else {
            state.arrowMesh.rotation.set(0, 0, placement.arrowRotationZ);
        }
    }

    /**
     * Main update loop for the AR Wayfinding HUD. Syncs target counts and updates visuals.
     */
    update() {
        const targetWorldPositions = this._waypoints;
        this._syncTargetCount(targetWorldPositions.length);

        targetWorldPositions.forEach((targetWorldPos, index) => {
            const state = this._ensureTargetState(index);
            this._updateTargetState(targetWorldPos, state);
        });
    }

    /**
     * Detaches a single target's HUD objects from the camera and disposes its
     * per-target resources. Geometries and materials shared across targets
     * (procedural indicator resources) are deliberately kept alive — they are
     * only released in destroy().
     * @param {object} state - The indicator state object to tear down.
     */
    _disposeTargetState(state) {
        this.camera.remove(state.arrowMesh);
        this.camera.remove(state.circleMesh);
        this.camera.remove(state.distanceLabel.getMesh());

        if (state.arrowMesh.geometry && state.arrowMesh.geometry !== this._arrowGeometry) {
            state.arrowMesh.geometry.dispose();
        }
        if (state.arrowMesh.material && state.arrowMesh.material !== this._hudMaterial) {
            state.arrowMesh.material.dispose();
        }

        if (state.circleMesh.geometry && state.circleMesh.geometry !== this._circleGeometry) {
            state.circleMesh.geometry.dispose();
        }
        if (state.circleMesh.material && state.circleMesh.material !== this._hudMaterial) {
            state.circleMesh.material.dispose();
        }

        state.distanceLabel.dispose();
    }

    /**
     * Cleans up all Three.js resources to prevent memory leaks when the AR session ends.
     */
    destroy() {
        this.targetStates.forEach((state) => this._disposeTargetState(state));

        if (this._arrowGeometry) this._arrowGeometry.dispose();
        if (this._circleGeometry) this._circleGeometry.dispose();
        if (this._hudMaterial) this._hudMaterial.dispose();

        if (this._arrowTexture instanceof THREE.Texture) {
            this._arrowTexture.dispose();
        }
        if (this._circleTexture instanceof THREE.Texture) {
            this._circleTexture.dispose();
        }

        this.targetStates = [];
        this._waypoints = [];
    }
}
