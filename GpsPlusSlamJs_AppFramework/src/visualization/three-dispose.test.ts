/**
 * Three.js Dispose Utility Tests
 *
 * Why this test matters: R7 — identical mesh dispose loops existed 5 times
 * across gps-event-markers.ts and reference-points.ts. This utility
 * replaces them all. Tests verify correct removal, geometry/material
 * disposal, and array clearing.
 *
 * disposeObject3D tests cover the generic tree-traversal cleanup
 * that handles Meshes, Sprites, their materials, and material textures.
 */

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { disposeMeshArray, disposeObject3D } from './three-dispose';

// ---- disposeObject3D ----

describe('disposeObject3D', () => {
  // Why: core contract — traverse a single mesh and dispose geometry + material.
  it('disposes geometry and material of a single Mesh', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geo, mat);

    const geoSpy = vi.spyOn(geo, 'dispose');
    const matSpy = vi.spyOn(mat, 'dispose');

    disposeObject3D(mesh);

    expect(geoSpy).toHaveBeenCalledOnce();
    expect(matSpy).toHaveBeenCalledOnce();
  });

  // Why: sprites have SpriteMaterial with a texture map that must also be freed.
  it('disposes SpriteMaterial and its map texture', () => {
    const texture = new THREE.Texture();
    const mat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(mat);

    const texSpy = vi.spyOn(texture, 'dispose');
    const matSpy = vi.spyOn(mat, 'dispose');

    disposeObject3D(sprite);

    expect(texSpy).toHaveBeenCalledOnce();
    expect(matSpy).toHaveBeenCalledOnce();
  });

  // Why: compass-cubes pattern — group with meshes + nested sprites.
  it('traverses a Group tree and disposes all descendants', () => {
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const meshMat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geo, meshMat);

    const tex = new THREE.Texture();
    const spriteMat = new THREE.SpriteMaterial({ map: tex });
    const sprite = new THREE.Sprite(spriteMat);
    mesh.add(sprite);
    group.add(mesh);

    const geoSpy = vi.spyOn(geo, 'dispose');
    const meshMatSpy = vi.spyOn(meshMat, 'dispose');
    const texSpy = vi.spyOn(tex, 'dispose');
    const spriteMatSpy = vi.spyOn(spriteMat, 'dispose');

    disposeObject3D(group);

    expect(geoSpy).toHaveBeenCalledOnce();
    expect(meshMatSpy).toHaveBeenCalledOnce();
    expect(texSpy).toHaveBeenCalledOnce();
    expect(spriteMatSpy).toHaveBeenCalledOnce();
  });

  // Why: reference-points pattern — shared geometry managed externally.
  it('skips geometry disposal when skipGeometry is true', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geo, mat);

    const geoSpy = vi.spyOn(geo, 'dispose');
    const matSpy = vi.spyOn(mat, 'dispose');

    disposeObject3D(mesh, { skipGeometry: true });

    expect(geoSpy).not.toHaveBeenCalled();
    expect(matSpy).toHaveBeenCalledOnce();
  });

  // Why: compass-cubes has 5 meshes sharing one BoxGeometry. The function
  // should handle this gracefully (shared geometry disposed only once).
  it('disposes shared geometry only once across multiple meshes', () => {
    const group = new THREE.Group();
    const sharedGeo = new THREE.BoxGeometry(1, 1, 1);
    const mesh1 = new THREE.Mesh(sharedGeo, new THREE.MeshBasicMaterial());
    const mesh2 = new THREE.Mesh(sharedGeo, new THREE.MeshBasicMaterial());
    group.add(mesh1, mesh2);

    const geoSpy = vi.spyOn(sharedGeo, 'dispose');

    disposeObject3D(group);

    expect(geoSpy).toHaveBeenCalledOnce();
  });

  // Why (tour kit K4 review R12): a loaded GLB's materials carry normal,
  // roughness, emissive and other maps besides `map`; freeing only `map`
  // leaked every other texture of every model a story showed.
  it('disposes every texture slot of a material, each shared texture once', () => {
    const textures = {
      map: new THREE.Texture(),
      normalMap: new THREE.Texture(),
      roughnessMap: new THREE.Texture(),
      metalnessMap: new THREE.Texture(),
      emissiveMap: new THREE.Texture(),
      alphaMap: new THREE.Texture(),
    };
    const mat = new THREE.MeshStandardMaterial(textures);
    // The same texture in two slots (a packed occlusion-roughness map).
    mat.aoMap = textures.roughnessMap;
    const spies = Object.values(textures).map((t) => vi.spyOn(t, 'dispose'));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);

    disposeObject3D(mesh);

    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });

  // Why: a ShaderMaterial's uniform often holds a texture another object
  // owns (the camera blit's camera texture); it is not the material's to free.
  it('leaves a ShaderMaterial uniform texture alone', () => {
    const camera = new THREE.Texture();
    const spy = vi.spyOn(camera, 'dispose');
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: camera } } })
    );

    disposeObject3D(mesh);

    expect(spy).not.toHaveBeenCalled();
  });

  // Why: materials without a map should not cause errors.
  it('handles materials without a map property gracefully', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const mesh = new THREE.Mesh(geo, mat);

    expect(() => disposeObject3D(mesh)).not.toThrow();
  });

  // Why: an empty group should not cause errors.
  it('handles empty Group gracefully', () => {
    const group = new THREE.Group();
    expect(() => disposeObject3D(group)).not.toThrow();
  });

  // Why: the function must not remove root from its parent — that is the caller's responsibility.
  it('does NOT remove root from its parent', () => {
    const parent = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    );
    parent.add(mesh);

    disposeObject3D(mesh);

    expect(parent.children).toContain(mesh);
  });
});

// ---- disposeMeshArray ----

describe('disposeMeshArray', () => {
  function createTestMesh(name: string): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(0.1, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    return mesh;
  }

  it('removes meshes from parent, disposes geometry and material, and empties the array', () => {
    const parent = new THREE.Group();
    const meshes = [createTestMesh('a'), createTestMesh('b')];
    parent.add(meshes[0], meshes[1]);
    expect(parent.children).toHaveLength(2);

    const geoDisposeSpy0 = vi.spyOn(meshes[0].geometry, 'dispose');
    const matDisposeSpy0 = vi.spyOn(
      meshes[0].material as THREE.Material,
      'dispose'
    );
    const geoDisposeSpy1 = vi.spyOn(meshes[1].geometry, 'dispose');
    const matDisposeSpy1 = vi.spyOn(
      meshes[1].material as THREE.Material,
      'dispose'
    );

    disposeMeshArray(meshes, parent);

    expect(parent.children).toHaveLength(0);
    expect(meshes).toHaveLength(0);
    expect(geoDisposeSpy0).toHaveBeenCalledOnce();
    expect(matDisposeSpy0).toHaveBeenCalledOnce();
    expect(geoDisposeSpy1).toHaveBeenCalledOnce();
    expect(matDisposeSpy1).toHaveBeenCalledOnce();
  });

  it('disposes without parent (null)', () => {
    const meshes = [createTestMesh('a')];
    const geoSpy = vi.spyOn(meshes[0].geometry, 'dispose');

    disposeMeshArray(meshes, null);

    expect(geoSpy).toHaveBeenCalledOnce();
    expect(meshes).toHaveLength(0);
  });

  it('handles empty array gracefully', () => {
    const meshes: THREE.Mesh[] = [];
    disposeMeshArray(meshes, null);
    expect(meshes).toHaveLength(0);
  });

  it('skips geometry disposal when skipGeometry is true (shared geometry)', () => {
    const sharedGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    const material1 = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const material2 = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const mesh1 = new THREE.Mesh(sharedGeometry, material1);
    const mesh2 = new THREE.Mesh(sharedGeometry, material2);
    const meshes = [mesh1, mesh2];

    const geoSpy = vi.spyOn(sharedGeometry, 'dispose');
    const mat1Spy = vi.spyOn(material1, 'dispose');
    const mat2Spy = vi.spyOn(material2, 'dispose');

    disposeMeshArray(meshes, null, { skipGeometry: true });

    expect(geoSpy).not.toHaveBeenCalled();
    expect(mat1Spy).toHaveBeenCalledOnce();
    expect(mat2Spy).toHaveBeenCalledOnce();
    expect(meshes).toHaveLength(0);
  });

  // Why: prior-ref-points pattern — shared geometry AND material managed externally.
  // Both must be skipped so the caller can dispose them once.
  it('skips material disposal when skipMaterial is true (shared material)', () => {
    const sharedGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    const sharedMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const mesh1 = new THREE.Mesh(sharedGeometry, sharedMaterial);
    const mesh2 = new THREE.Mesh(sharedGeometry, sharedMaterial);
    const meshes = [mesh1, mesh2];

    const geoSpy = vi.spyOn(sharedGeometry, 'dispose');
    const matSpy = vi.spyOn(sharedMaterial, 'dispose');

    disposeMeshArray(meshes, null, {
      skipGeometry: true,
      skipMaterial: true,
    });

    expect(geoSpy).not.toHaveBeenCalled();
    expect(matSpy).not.toHaveBeenCalled();
    expect(meshes).toHaveLength(0);
  });
});

describe('disposeObject3D — skipMaterial', () => {
  // Why: when both geometry and material are shared (prior-ref-points),
  // callers need to skip material disposal so they can dispose it once.
  it('skips material disposal when skipMaterial is true', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geo, mat);

    const geoSpy = vi.spyOn(geo, 'dispose');
    const matSpy = vi.spyOn(mat, 'dispose');

    disposeObject3D(mesh, { skipMaterial: true });

    expect(geoSpy).toHaveBeenCalledOnce();
    expect(matSpy).not.toHaveBeenCalled();
  });

  // Why: texture map on material should also be skipped when skipMaterial is true.
  it('skips material map texture disposal when skipMaterial is true', () => {
    const texture = new THREE.Texture();
    const mat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(mat);

    const texSpy = vi.spyOn(texture, 'dispose');
    const matSpy = vi.spyOn(mat, 'dispose');

    disposeObject3D(sprite, { skipMaterial: true });

    expect(matSpy).not.toHaveBeenCalled();
    expect(texSpy).not.toHaveBeenCalled();
  });
});

describe('disposeObject3D — material arrays', () => {
  // Why: Three.js Mesh.material can be Material[] when geometry uses groups.
  // The utility must handle both single materials and arrays to be generic.
  it('disposes every material in a material array', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat1 = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mat2 = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const mesh = new THREE.Mesh(geo, [mat1, mat2]);

    const mat1Spy = vi.spyOn(mat1, 'dispose');
    const mat2Spy = vi.spyOn(mat2, 'dispose');

    disposeObject3D(mesh);

    expect(mat1Spy).toHaveBeenCalledOnce();
    expect(mat2Spy).toHaveBeenCalledOnce();
  });

  // Why: textures on individual materials in an array must also be freed.
  it('disposes map textures on each material in a material array', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const tex1 = new THREE.Texture();
    const tex2 = new THREE.Texture();
    const mat1 = new THREE.MeshBasicMaterial({ map: tex1 });
    const mat2 = new THREE.MeshBasicMaterial({ map: tex2 });
    const mesh = new THREE.Mesh(geo, [mat1, mat2]);

    const tex1Spy = vi.spyOn(tex1, 'dispose');
    const tex2Spy = vi.spyOn(tex2, 'dispose');

    disposeObject3D(mesh);

    expect(tex1Spy).toHaveBeenCalledOnce();
    expect(tex2Spy).toHaveBeenCalledOnce();
  });

  // Why: skipMaterial must still be respected for material arrays.
  it('skips material array disposal when skipMaterial is true', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat1 = new THREE.MeshBasicMaterial();
    const mat2 = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geo, [mat1, mat2]);

    const mat1Spy = vi.spyOn(mat1, 'dispose');
    const mat2Spy = vi.spyOn(mat2, 'dispose');

    disposeObject3D(mesh, { skipMaterial: true });

    expect(mat1Spy).not.toHaveBeenCalled();
    expect(mat2Spy).not.toHaveBeenCalled();
  });
});
