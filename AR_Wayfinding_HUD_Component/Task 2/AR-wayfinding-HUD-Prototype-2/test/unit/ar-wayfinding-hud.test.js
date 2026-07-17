import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// DistanceLabel renders text through an off-screen canvas. Node has no DOM, so
// install a minimal document/canvas stub BEFORE importing the HUD. The stub only
// needs the 2D-context methods DistanceLabel actually calls.
const context2dStub = {
    clearRect() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    fillText() {},
};
globalThis.document = {
    createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => context2dStub,
    }),
};

const { ARWayfindingHUD } = await import('../../src/ARWayfindingHUD.js');

function makeHud() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);
    // Procedural indicators only (no sprite URLs) — TextureLoader needs a DOM.
    const renderer = { xr: { isPresenting: false } };
    const hud = new ARWayfindingHUD(scene, camera, renderer, {
        distanceMin: 1.5,
        distanceMax: 3.0,
        hudDistance: 2.5,
    });
    return { hud, camera };
}

function stateMeshes(state) {
    return [state.arrowMesh, state.circleMesh, state.distanceLabel.getMesh()];
}

test('constructor rejects a missing distanceMin/distanceMax config', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    assert.throws(() => new ARWayfindingHUD(scene, camera, {}, {}), /distanceMin/);
});

// Why this test matters: targetStates is indexed by waypoint. If removeWaypoint
// only mutates _waypoints, every waypoint after the removed index inherits a
// NEIGHBOR's hysteresis state and smoothed circle position, and the orphaned
// last state keeps its meshes attached to the camera forever.
test('removeWaypoint splices the matching target state and detaches its HUD objects', () => {
    const { hud, camera } = makeHud();
    hud.setWaypoints([
        new THREE.Vector3(0, 0, -5), // on-screen, far -> circle
        new THREE.Vector3(10, 0, -5), // off-screen -> arrow
    ]);
    hud.update();

    assert.equal(hud.targetStates.length, 2);
    const [removedState, survivingState] = hud.targetStates;
    assert.equal(removedState.currentState, 'circle');
    assert.equal(survivingState.currentState, 'arrow');

    hud.removeWaypoint(0);

    // The surviving waypoint must keep ITS OWN state object (index realigned).
    assert.equal(hud.targetStates.length, 1);
    assert.equal(hud.targetStates[0], survivingState);

    // The removed waypoint's meshes must no longer hang off the camera.
    for (const mesh of stateMeshes(removedState)) {
        assert.equal(camera.children.includes(mesh), false);
    }
    for (const mesh of stateMeshes(survivingState)) {
        assert.equal(camera.children.includes(mesh), true);
    }
});

// Why this test matters: setWaypoints replaces waypoint identities wholesale.
// Reusing old per-target state would leak the previous waypoints' hysteresis
// and smoothed positions into unrelated new targets.
test('setWaypoints discards stale target states and their HUD objects', () => {
    const { hud, camera } = makeHud();
    hud.setWaypoints([new THREE.Vector3(0, 0, -5)]);
    hud.update();
    const staleState = hud.targetStates[0];
    assert.equal(staleState.currentState, 'circle');

    hud.setWaypoints([new THREE.Vector3(10, 0, -5)]);

    assert.equal(hud.targetStates.length, 0);
    for (const mesh of stateMeshes(staleState)) {
        assert.equal(camera.children.includes(mesh), false);
    }

    // The replacement waypoint starts from a clean 'hidden' state.
    hud.update();
    assert.notEqual(hud.targetStates[0], staleState);
    assert.equal(hud.targetStates[0].currentState, 'arrow');
});

// Why this test matters: smoothedCirclePos starts at (0,0,0). If the first
// circle placement is lerped instead of copied, a newly visible circle renders
// near the screen center and visibly slides outward over the next frames.
test('circle indicator snaps to its placement on the first visible frame, then damps', () => {
    const { hud, camera } = makeHud();
    // Off-center so the circle position is clearly non-zero in x.
    hud.setWaypoints([new THREE.Vector3(2, 0, -5)]);
    hud.update();

    const state = hud.targetStates[0];
    assert.equal(state.currentState, 'circle');
    // First visible frame: exactly on the HUD plane at the projected position.
    assert.equal(state.circleMesh.position.z, -2.5);
    assert.ok(state.circleMesh.position.x > 0.5);
    const firstFramePos = state.circleMesh.position.clone();

    // Subsequent frames damp toward the new placement instead of snapping.
    camera.position.set(0.5, 0, 0);
    camera.updateMatrixWorld(true);
    hud.update();
    const secondFramePos = state.circleMesh.position.clone();
    assert.equal(state.currentState, 'circle');
    assert.notDeepEqual(secondFramePos, firstFramePos);

    // Damped: after one frame the mesh must NOT have fully reached the new
    // placement (repeat updates keep moving it in the same direction).
    hud.update();
    assert.notDeepEqual(state.circleMesh.position.clone(), secondFramePos);
});

// Why this test matters: removing a target mid-session must not dispose the
// geometry/material SHARED by the remaining procedural indicators — only the
// per-target resources (the label's canvas texture and sprite material).
test('removeWaypoint keeps shared procedural resources usable for remaining targets', () => {
    const { hud } = makeHud();
    hud.setWaypoints([
        new THREE.Vector3(0, 0, -5),
        new THREE.Vector3(10, 0, -5),
    ]);
    hud.update();

    const survivor = hud.targetStates[1];
    hud.removeWaypoint(0);
    hud.update();

    // Shared geometry/material must still be the ones the survivor references.
    assert.equal(survivor.arrowMesh.geometry, hud._arrowGeometry);
    assert.equal(survivor.circleMesh.geometry, hud._circleGeometry);
    assert.equal(survivor.arrowMesh.material, hud._hudMaterial);
});
