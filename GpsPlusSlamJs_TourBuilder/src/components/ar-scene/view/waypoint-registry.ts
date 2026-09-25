/**
 * The `WaypointNode` map — each waypoint's anchored root group plus whatever
 * views (visual/text/audio/transport panel) currently hang off it. Owns only
 * creation, anchoring and teardown; the fields are read and written directly
 * by the sibling view modules (`visual-instances.ts`, `transcript.ts`,
 * `audio-transport.ts`) rather than through an accessor API, since they are
 * all just per-waypoint view state with no invariants between them.
 */

import type { Object3D } from "three";
import { Group, Vector3 } from "three";

import type { TourCoord } from "../../../store/types.js";
import type { AudioPlayer } from "../../billboard/view/audio-player.js";
import type { TransportPanel } from "../../billboard/view/transport-panel-view.js";
import type { InWorldText } from "../../in-world-text/view/in-world-text.js";
import type { WaypointHandle } from "../runtime/scene-adapter.js";
import type { OrbAnchor } from "./breadcrumb-orbs.js";

/** What this adapter needs from a GPS anchor (the framework's `GpsAnchor`). */
export interface SceneAnchor extends OrbAnchor {
  readonly isFullyAnchored: boolean;
}

export type AnchorFactory = (
  object3D: Object3D,
  coord: TourCoord,
) => SceneAnchor;

export interface WaypointNode {
  readonly waypointId: string;
  readonly group: Group;
  readonly anchor: SceneAnchor;
  visual: Object3D | null;
  text: InWorldText | null;
  audio: AudioPlayer | null;
  audioElement: HTMLAudioElement | null;
  /** Always visible alongside the visual, not gated by tap/play state. */
  transportPanel: TransportPanel | null;
  transportPlaying: boolean;
  transportPositionSec: number;
  transportDurationSec: number;
}

export function createWaypointRegistry(
  parent: Object3D,
  createAnchor: AnchorFactory,
) {
  const nodes = new Map<string, WaypointNode>();

  return {
    create(id: string, coord: TourCoord): WaypointHandle {
      const group = new Group();
      group.name = `waypoint-${id}`;
      parent.add(group);
      const anchor = createAnchor(group, coord);
      nodes.set(id, {
        waypointId: id,
        group,
        anchor,
        visual: null,
        text: null,
        audio: null,
        audioElement: null,
        transportPanel: null,
        transportPlaying: false,
        transportPositionSec: 0,
        transportDurationSec: 0,
      });
      return { waypointId: id };
    },

    destroy(handle: WaypointHandle): void {
      const node = nodes.get(handle.waypointId);
      if (node === undefined) return;
      node.text?.dispose();
      node.audio?.dispose();
      node.transportPanel?.dispose();
      node.anchor.dispose();
      node.group.removeFromParent();
      nodes.delete(handle.waypointId);
    },

    get(id: string): WaypointNode | undefined {
      return nodes.get(id);
    },

    values(): IterableIterator<WaypointNode> {
      return nodes.values();
    },

    isAnchored(handle: WaypointHandle): boolean {
      return nodes.get(handle.waypointId)?.anchor.isFullyAnchored ?? false;
    },

    getWorldPosition(handle: WaypointHandle): Vector3 | null {
      const node = nodes.get(handle.waypointId);
      if (node === undefined) return null;
      return node.group.getWorldPosition(new Vector3());
    },

    clear(): void {
      nodes.clear();
    },
  };
}
