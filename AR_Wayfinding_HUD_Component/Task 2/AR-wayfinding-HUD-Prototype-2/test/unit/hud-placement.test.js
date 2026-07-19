import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
    computeTargetPlacement,
    formatDistanceLabel,
    getEvaluationCamera,
    getHudFrustumExtents,
} from '../../src/hud-placement.js';

function makeCamera() {
    const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);
    return camera;
}

test('formatDistanceLabel rounds to one decimal place', () => {
    assert.equal(formatDistanceLabel(12.34), '12.3 m');
    assert.equal(formatDistanceLabel(12.96), '13.0 m');
});

test('getHudFrustumExtents uses perspective camera fov and aspect', () => {
    const camera = makeCamera();
    const { width, height } = getHudFrustumExtents(camera, 2, false);

    assert.ok(Math.abs(height - 2.309401076758503) < 1e-12);
    assert.ok(Math.abs(width - 4.618802153517006) < 1e-12);
});

test('getHudFrustumExtents reads XR frustum scale from the projection matrix', () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.projectionMatrix.elements[0] = 2;
    camera.projectionMatrix.elements[5] = 4;

    const { width, height } = getHudFrustumExtents(camera, 3, true);

    assert.equal(width, 3);
    assert.equal(height, 1.5);
});

test('computeTargetPlacement returns the expected state for close, far, and off-screen targets', () => {
    const camera = makeCamera();

    const closeTarget = new THREE.Vector3(0, 0, -0.5);
    const closePlacement = computeTargetPlacement({
        targetWorldPos: closeTarget,
        camera,
        hudDistance: 2.5,
        distanceMin: 1.5,
        distanceMax: 3.0,
    });

    assert.equal(closePlacement.state, 'hidden');
    assert.equal(closePlacement.distanceLabel, '0.5 m');

    const farTarget = new THREE.Vector3(0, 0, -5);
    const farPlacement = computeTargetPlacement({
        targetWorldPos: farTarget,
        camera,
        hudDistance: 2.5,
        distanceMin: 1.5,
        distanceMax: 3.0,
    });

    assert.equal(farPlacement.state, 'circle');
    assert.equal(farPlacement.circlePosition.z, -2.5);
    assert.equal(farPlacement.labelPosition.z, -2.5);

    const offScreenTarget = new THREE.Vector3(10, 0, -5);
    const offScreenPlacement = computeTargetPlacement({
        targetWorldPos: offScreenTarget,
        camera,
        hudDistance: 2.5,
        distanceMin: 1.5,
        distanceMax: 3.0,
    });

    assert.equal(offScreenPlacement.state, 'arrow');
    assert.ok(offScreenPlacement.arrowPosition.x > 0);
    assert.ok(Math.abs(offScreenPlacement.arrowRotationZ + Math.PI / 2) < 1e-12);
});

// Why this test matters: distanceMin/distanceMax form a hysteresis deadband
// (see 2026-07-08-PLAN_Prototype-2.md "HUD config"). A hidden target must not
// reactivate until it is at least distanceMax away, while an already-visible
// target (circle or arrow) stays visible all the way down to distanceMin.
// Without this, distanceMax is silently ignored and indicators flicker at the
// distanceMin boundary.
test('computeTargetPlacement applies distanceMin/distanceMax hysteresis for on-screen targets', () => {
    const camera = makeCamera();
    const betweenThresholds = new THREE.Vector3(0, 0, -2); // 2 m: between 1.5 and 3.0
    const base = {
        targetWorldPos: betweenThresholds,
        camera,
        hudDistance: 2.5,
        distanceMin: 1.5,
        distanceMax: 3.0,
    };

    // A hidden target between the thresholds must stay hidden…
    const stillHidden = computeTargetPlacement({ ...base, previousState: 'hidden' });
    assert.equal(stillHidden.state, 'hidden');

    // …until it reaches distanceMax.
    const activated = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, -3),
        previousState: 'hidden',
    });
    assert.equal(activated.state, 'circle');

    // An active circle keeps showing inside the deadband (no flicker)…
    const stillCircle = computeTargetPlacement({ ...base, previousState: 'circle' });
    assert.equal(stillCircle.state, 'circle');

    // …and only hides once the user is closer than distanceMin ("arrived").
    const arrived = computeTargetPlacement({
        ...base,
        targetWorldPos: new THREE.Vector3(0, 0, -1),
        previousState: 'circle',
    });
    assert.equal(arrived.state, 'hidden');

    // A target the arrow was just pointing at must not vanish when the user
    // turns toward it: visible states convert to circle inside the deadband.
    const fromArrow = computeTargetPlacement({ ...base, previousState: 'arrow' });
    assert.equal(fromArrow.state, 'circle');
});

test('computeTargetPlacement flips the arrow direction for targets behind the camera', () => {
    const camera = makeCamera();

    const behindTarget = new THREE.Vector3(2, 0, 5);
    const placement = computeTargetPlacement({
        targetWorldPos: behindTarget,
        camera,
        hudDistance: 2.5,
        distanceMin: 1.5,
        distanceMax: 3.0,
    });

    assert.equal(placement.state, 'arrow');
    assert.equal(placement.isBehind, true);
    assert.ok(placement.arrowPosition instanceof THREE.Vector3);
    // The target sits behind and to the RIGHT; the flip must point the arrow
    // right (positive x, rotation -π/2 relative to "up"), not mirror it left.
    assert.ok(placement.arrowPosition.x > 0);
    assert.ok(Math.abs(placement.arrowRotationZ + Math.PI / 2) < 1e-12);
    assert.match(formatDistanceLabel(placement.distance), /^\d+\.\d m$/);
});

test('getEvaluationCamera prefers the XR sub-camera when presenting', () => {
    const fallbackCamera = makeCamera();
    const xrCamera = makeCamera();
    const renderer = {
        xr: {
            isPresenting: true,
            getCamera() {
                return { cameras: [xrCamera] };
            },
        },
    };

    assert.equal(getEvaluationCamera(renderer, fallbackCamera), xrCamera);
});
