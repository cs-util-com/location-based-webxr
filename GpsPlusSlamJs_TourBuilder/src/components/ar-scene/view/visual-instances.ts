/**
 * Template lifecycle (parse/dispose) and per-waypoint clone lifecycle
 * (instantiate/fallback/release/visibility). `ensureTransportPanel` is
 * injected from `audio-transport.ts` rather than imported — the transport
 * panel's own lifecycle is that module's concern, this one just triggers it
 * the moment a waypoint gets a visual.
 */

import type { Object3D } from "three";
import { ConeGeometry, Mesh, MeshBasicMaterial } from "three";

import type {
  TemplateHandle,
  VisualHandle,
  WaypointHandle,
} from "../runtime/scene-adapter.js";
import {
  disposeTemplate,
  instantiateTemplate,
  releaseInstance,
  type ParsedTemplate,
  type parseTemplate,
} from "./gltf-loading.js";
import { stamp } from "./pick-classify.js";
import { VISUAL_GROUND_CLEARANCE_M } from "../config.js";
import type { WaypointNode } from "./waypoint-registry.js";

export function createVisualInstances(
  parse: typeof parseTemplate,
  ensureTransportPanel: (node: WaypointNode) => void,
) {
  const templates = new Map<string, ParsedTemplate>();
  const instances = new Map<string, { node: WaypointNode; object: Object3D }>();
  let nextTemplateId = 0;
  let nextVisualId = 0;

  return {
    async buildTemplate(
      kind: "model" | "sprite",
      url: string,
    ): Promise<TemplateHandle> {
      const parsed = await parse(kind, url);
      const templateId = `template-${nextTemplateId++}`;
      templates.set(templateId, parsed);
      return { templateId };
    },

    disposeTemplate(template: TemplateHandle): void {
      const parsed = templates.get(template.templateId);
      if (parsed === undefined) return;
      disposeTemplate(parsed);
      templates.delete(template.templateId);
    },

    instantiate(
      node: WaypointNode | undefined,
      handle: WaypointHandle,
      template: TemplateHandle,
      hasAudio = true,
    ): VisualHandle {
      const parsed = templates.get(template.templateId);
      if (node === undefined || parsed === undefined) {
        return { visualId: `void-${nextVisualId++}` };
      }
      const object = instantiateTemplate(parsed);
      stamp(object, handle.waypointId, "visual");
      node.group.add(object);
      node.visual = object;
      if (hasAudio) ensureTransportPanel(node);
      const visualId = `visual-${nextVisualId++}`;
      instances.set(visualId, { node, object });
      return { visualId };
    },

    buildFallbackVisual(
      node: WaypointNode | undefined,
      handle: WaypointHandle,
      hasAudio = true,
      showMarker = true,
    ): VisualHandle {
      if (node === undefined) return { visualId: `void-${nextVisualId++}` };
      // A plain marker cone: the visitor sees that SOMETHING is here and the
      // failure is diagnosable in the field instead of looking like empty space.
      // Built even when `showMarker` is false (a breadcrumb-only stop whose
      // transcript fills this slot instead) so release/dispose bookkeeping
      // stays uniform — it's just never added to the scene graph.
      const marker = new Mesh(
        new ConeGeometry(0.25, 1, 8),
        new MeshBasicMaterial({ color: 0xff8a5c, wireframe: true }),
      );
      // Same ground clearance as the real visual, so the transport panel has
      // room beneath a fallback marker too.
      marker.position.y = VISUAL_GROUND_CLEARANCE_M + 0.5;
      marker.visible = false;
      if (showMarker) {
        stamp(marker, handle.waypointId, "visual");
        node.group.add(marker);
        node.visual = marker;
      }
      if (hasAudio) ensureTransportPanel(node);
      const visualId = `fallback-${nextVisualId++}`;
      instances.set(visualId, { node, object: marker });
      return { visualId };
    },

    releaseVisual(visual: VisualHandle): void {
      const entry = instances.get(visual.visualId);
      if (entry === undefined) return;
      if (visual.visualId.startsWith("fallback-")) {
        // The fallback owns its own geometry/material — nothing shares them.
        const mesh = entry.object as Mesh;
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      }
      // Clones share the template's geometry/materials: detach only, NEVER a
      // recursive dispose (plan A10).
      releaseInstance(entry.object);
      if (entry.node.visual === entry.object) entry.node.visual = null;
      // The panel follows the visual's own lifecycle: released with it, rebuilt
      // by the next `instantiate`/`buildFallbackVisual` if the waypoint returns.
      entry.node.transportPanel?.mesh.removeFromParent();
      entry.node.transportPanel?.dispose();
      entry.node.transportPanel = null;
      instances.delete(visual.visualId);
    },

    setVisible(visual: VisualHandle, isVisible: boolean): void {
      const entry = instances.get(visual.visualId);
      if (entry === undefined) return;
      entry.object.visible = isVisible;
      // Always shown alongside the visual — discoverability, not gated by tap.
      if (entry.node.transportPanel !== null) {
        entry.node.transportPanel.mesh.visible = isVisible;
      }
    },

    disposeAllTemplates(): void {
      for (const parsed of templates.values()) disposeTemplate(parsed);
      templates.clear();
      instances.clear();
    },
  };
}
