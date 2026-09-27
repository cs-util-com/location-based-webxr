/**
 * The material catalog in the scene (W5 plan 2026-09-26-0549, M1): one
 * labelled sphere per entry, floating in a grid above the city, and the
 * CSS2D labels the label rule shows. On by default since the owner's
 * round 3 (plan 2026-09-27-0532, DEC-FB3-5; `catalog=0` in the page's hash
 * turns it off); the smoke boot pins it off, so the page's other tests
 * never compile its programs.
 *
 * @see catalog-view.js.md
 */

import * as THREE from "three";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";

import { LABEL_RULE, labelOpacities } from "./label-rule.js";

/**
 * Where the grid floats: the stand-in scene's float height (105 m), north
 * of the pond (+z), clear of the pond and of the shadow probes' points.
 * Rows of `perRow` spheres, `pitchM` apart, in catalog order. (The old
 * white and gold swatch rows floated at z 170 and 192 until round 3 folded
 * them in as a row, DEC-FB3-1.)
 */
export const CATALOG_LAYOUT = {
  origin: [-66, 105, 225],
  pitchM: 12,
  perRow: 12,
  radiusM: 4,
};

/** The material an entry describes (a custom shader builds its own). */
export function catalogMaterial(entry) {
  if (entry.make) {
    const material = entry.make(THREE);
    // three shares one program between materials whose onBeforeCompile
    // source is equal; the validator guarantees a distinct key per entry.
    material.customProgramCacheKey = () => entry.cacheKey;
    return material;
  }
  const Material = THREE[entry.material.type];
  return new Material(entry.material.params);
}

/**
 * The spheres: a group named "catalog", one mesh per entry (named by its
 * id, the entry on `userData.entry`), casting shadows (the owner's report:
 * a floating sphere without a shadow reads as a defect) and receiving them,
 * so a sphere's shadow lands on its neighbours (as the old swatches did).
 * Both flags only matter while the renderer's shadow maps are on.
 */
export function buildCatalog(entries, layout = CATALOG_LAYOUT) {
  const group = new THREE.Group();
  group.name = "catalog";
  const geometry = new THREE.SphereGeometry(layout.radiusM, 48, 24);
  const [x0, y0, z0] = layout.origin;
  entries.forEach((entry, i) => {
    const mesh = new THREE.Mesh(geometry, catalogMaterial(entry));
    mesh.name = entry.id;
    mesh.userData.entry = entry;
    mesh.position.set(
      x0 + (i % layout.perRow) * layout.pitchM,
      y0,
      z0 + Math.floor(i / layout.perRow) * layout.pitchM,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return {
    group,
    dispose() {
      geometry.dispose();
      for (const mesh of group.children) mesh.material.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * The labels: a CSS2DRenderer overlay inserted right AFTER `anchor` (the
 * canvas), so the panel, a later sibling, stays above it; pointer events
 * off on the overlay. One label per sphere, shown per frame by the rule.
 */
export function createCatalogLabels(anchor, group, rule = LABEL_RULE) {
  const renderer = new CSS2DRenderer();
  const overlay = renderer.domElement;
  overlay.className = "lookdev-catalog-labels";
  anchor.after(overlay);
  const labels = group.children.map((mesh) => {
    const el = document.createElement("span");
    el.className = "lookdev-catalog-label";
    el.textContent = mesh.userData.entry.label;
    el.title = mesh.userData.entry.name;
    const label = new CSS2DObject(el);
    label.position.set(0, CATALOG_LAYOUT.radiusM * 1.4, 0);
    mesh.add(label);
    return label;
  });
  const cameraPosition = new THREE.Vector3();
  const spherePosition = new THREE.Vector3();
  let visible = [];
  return {
    /** Per frame, after the scene render. */
    render(scene, camera) {
      camera.getWorldPosition(cameraPosition);
      const distances = group.children.map((mesh) =>
        mesh.getWorldPosition(spherePosition).distanceTo(cameraPosition),
      );
      const opacities = labelOpacities(distances, rule);
      visible = [];
      labels.forEach((label, i) => {
        label.visible = opacities[i] > 0;
        label.element.style.opacity = String(opacities[i]);
        if (label.visible) visible.push(group.children[i].name);
      });
      renderer.render(scene, camera);
    },
    setSize(width, height) {
      renderer.setSize(width, height);
    },
    /** The ids whose labels showed at the last render (tests). */
    visibleIds: () => [...visible],
    dispose() {
      for (const label of labels) label.removeFromParent();
      overlay.remove();
    },
  };
}
