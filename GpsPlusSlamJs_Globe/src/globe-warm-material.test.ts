/**
 * Why this test matters (frame-hitch review 2026-10-03-2017 H4 with H2):
 * three deletes a shader program when the last material using it is
 * disposed. A carrier released at the band's edge disposes every tile's
 * material, so each return into the band compiled the relief's (or the
 * globe's) program again: a visible hitch on a phone. The retirer keeps the
 * most recently retired material undisposed, so the program outlives its
 * tiles, and frees it only when a newer one replaces it or at the end.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { createMaterialRetirer } from "./globe-warm-material.js";

describe("createMaterialRetirer", () => {
  it("keeps the latest retired material alive and frees the one before", () => {
    const retirer = createMaterialRetirer();
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    const freeA = vi.spyOn(a, "dispose");
    const freeB = vi.spyOn(b, "dispose");
    retirer.retire(a);
    expect(freeA).not.toHaveBeenCalled();
    expect(retirer.kept()).toBe(a);
    retirer.retire(b);
    expect(freeA).toHaveBeenCalledTimes(1);
    expect(freeB).not.toHaveBeenCalled();
    expect(retirer.kept()).toBe(b);
    retirer.dispose();
    expect(freeB).toHaveBeenCalledTimes(1);
    expect(retirer.kept()).toBeNull();
  });

  it("retiring the kept material again does not free it", () => {
    const retirer = createMaterialRetirer();
    const a = new THREE.MeshStandardMaterial();
    const free = vi.spyOn(a, "dispose");
    retirer.retire(a);
    retirer.retire(a);
    expect(free).not.toHaveBeenCalled();
    retirer.dispose();
    retirer.dispose();
    expect(free).toHaveBeenCalledTimes(1);
  });
});
