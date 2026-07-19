import * as THREE from 'three';

/**
 * Formats a numeric distance into a readable label string.
 * @param {number} distance - Distance in meters.
 * @returns {string} Formatted distance string (e.g. "1.5 m").
 */
export function formatDistanceLabel(distance) {
    return `${distance.toFixed(1)} m`;
}

/**
 * Retrieves the evaluation camera, prioritizing the WebXR camera if currently presenting.
 * @param {THREE.WebGLRenderer} renderer - The active Three.js renderer.
 * @param {THREE.Camera} fallbackCamera - The default camera to use if XR is inactive.
 * @returns {THREE.Camera} The optimal camera for HUD placement calculations.
 */
export function getEvaluationCamera(renderer, fallbackCamera) {
    if (renderer?.xr?.isPresenting) {
        const xrCamera = renderer.xr.getCamera?.();
        if (xrCamera?.cameras?.length > 0) {
            return xrCamera.cameras[0];
        }

        if (xrCamera) {
            return xrCamera;
        }
    }

    return fallbackCamera;
}

/**
 * Calculates the physical width and height of the camera frustum at a specified distance.
 * @param {THREE.Camera} camera - The active camera.
 * @param {number} hudDistance - The distance from the camera to the HUD plane.
 * @param {boolean} [isXrSession=false] - Whether WebXR is currently active.
 * @returns {{width: number, height: number}} The dimensions of the frustum plane.
 */
export function getHudFrustumExtents(camera, hudDistance, isXrSession = false) {
    if (isXrSession) {
        const elements = camera.projectionMatrix.elements;
        const tanHalfFovY = 1.0 / elements[5];
        const tanHalfFovX = 1.0 / elements[0];

        return {
            width: 2.0 * hudDistance * tanHalfFovX,
            height: 2.0 * hudDistance * tanHalfFovY,
        };
    }

    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const height = 2.0 * hudDistance * Math.tan(fovRad / 2.0);

    return {
        width: height * camera.aspect,
        height,
    };
}

/**
 * Computes the optimal on-screen or off-screen placement details for a target waypoint.
 * @param {object} params - Configuration and state parameters.
 * @param {THREE.Vector3} params.targetWorldPos - The waypoint's world position.
 * @param {THREE.Camera} params.camera - The active evaluation camera.
 * @param {number} params.hudDistance - Z-distance for the HUD plane.
 * @param {number} params.distanceMin - Distance (m) below which a visible indicator hides ("arrived").
 * @param {number} params.distanceMax - Distance (m) a hidden target must reach before its
 *   indicator reactivates. Together with distanceMin this forms a hysteresis deadband that
 *   prevents flicker at the distanceMin boundary.
 * @param {string} [params.previousState='hidden'] - The target's state from the previous frame.
 * @param {boolean} [params.isXrSession=false] - WebXR active flag.
 * @param {number} [params.viewportInner=0.95] - Hysteresis threshold for arrow-to-circle transition.
 * @param {number} [params.viewportOuter=1.0] - Hysteresis threshold for circle-to-arrow transition.
 * @param {number} [params.edgeMargin=0.9] - Padding from screen edge for the arrow indicator.
 * @returns {object} The computed placement state and transforms.
 */
export function computeTargetPlacement({
    targetWorldPos,
    camera,
    hudDistance,
    distanceMin,
    distanceMax,
    previousState = 'hidden',
    isXrSession = false,
    viewportInner = 0.95,
    viewportOuter = 1.0,
    edgeMargin = 0.9,
}) {
    camera.updateMatrixWorld();

    const { width: frustumWidth, height: frustumHeight } = getHudFrustumExtents(
        camera,
        hudDistance,
        isXrSession
    );

    const ndc = targetWorldPos.clone().project(camera);
    const localPos = targetWorldPos.clone().applyMatrix4(camera.matrixWorldInverse);
    const isBehind = localPos.z > 0;
    const distance = camera.position.distanceTo(targetWorldPos);
    const distanceLabel = formatDistanceLabel(distance);

    const onScreenLimit = previousState === 'arrow' ? viewportInner : viewportOuter;
    const onScreen =
        !isBehind &&
        Math.abs(ndc.x) <= onScreenLimit &&
        Math.abs(ndc.y) <= onScreenLimit;

    if (onScreen) {
        // Distance hysteresis: a target that is already visible (circle, or an
        // arrow that just came on-screen) stays visible down to distanceMin;
        // a hidden target only reactivates once it is distanceMax away.
        const activationDistance =
            previousState === 'hidden' ? distanceMax : distanceMin;

        if (distance < activationDistance) {
            return {
                state: 'hidden',
                onScreen,
                isBehind,
                distance,
                distanceLabel,
                ndc,
                frustumWidth,
                frustumHeight,
            };
        }

        const circleX = THREE.MathUtils.clamp(ndc.x, -1, 1) * (frustumWidth / 2);
        const circleY = THREE.MathUtils.clamp(ndc.y, -1, 1) * (frustumHeight / 2);

        return {
            state: 'circle',
            onScreen,
            isBehind,
            distance,
            distanceLabel,
            ndc,
            frustumWidth,
            frustumHeight,
            circlePosition: new THREE.Vector3(circleX, circleY, -hudDistance),
            labelPosition: new THREE.Vector3(
                circleX,
                circleY - hudDistance * 0.08,
                -hudDistance
            ),
        };
    }

    let arrowNdcX = ndc.x;
    let arrowNdcY = ndc.y;
    if (isBehind) {
        arrowNdcX *= -1;
        arrowNdcY *= -1;
    }

    const physicalX = arrowNdcX * (frustumWidth / 2);
    const physicalY = arrowNdcY * (frustumHeight / 2);
    const angle = Math.atan2(physicalY, physicalX);

    const maxAbsX = (frustumWidth / 2) * edgeMargin;
    const maxAbsY = (frustumHeight / 2) * edgeMargin;

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const tX = maxAbsX / Math.max(Math.abs(cosA), 0.0001);
    const tY = maxAbsY / Math.max(Math.abs(sinA), 0.0001);
    const t = Math.min(tX, tY);

    const arrowX = cosA * t;
    const arrowY = sinA * t;

    return {
        state: 'arrow',
        onScreen,
        isBehind,
        distance,
        distanceLabel,
        ndc,
        frustumWidth,
        frustumHeight,
        arrowPosition: new THREE.Vector3(arrowX, arrowY, -hudDistance),
        arrowRotationZ: angle - Math.PI / 2,
        labelPosition: new THREE.Vector3(
            arrowX - cosA * hudDistance * 0.1,
            arrowY - sinA * hudDistance * 0.1,
            -hudDistance
        ),
    };
}
