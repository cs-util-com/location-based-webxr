/**
 * Audio playback (component 1's player) and the always-visible transport
 * panel that mirrors its state. The panel is built lazily the first time a
 * waypoint gets a visual (`ensureTransportPanel`, called from
 * `visual-instances.ts` — injected there rather than imported, to avoid a
 * cycle between the two modules) and torn down with it.
 */

import type { AudioListener } from "three";

import {
  createAudioPlayer,
  type AudioPlayer,
} from "../../billboard/view/audio-player.js";
import {
  createTransportPanel,
  type TransportPanel,
} from "../../billboard/view/transport-panel-view.js";
import type { TransportState } from "../../billboard/core/playback-transport.js";
import {
  TRANSPORT_PANEL_HEIGHT_M,
  TRANSPORT_PANEL_WIDTH_M,
  transportPanelOffset,
} from "../config.js";
import { createListenerSet } from "../core/listener-set.js";
import { stamp } from "./pick-classify.js";
import type { WaypointNode } from "./waypoint-registry.js";

export function createAudioTransport(audioListener: AudioListener) {
  const audioEndListeners = createListenerSet<[]>();
  /** The one story that may be playing (exclusivity is the runtime's rule). */
  let currentAudio: AudioPlayer | null = null;
  let currentAudioNode: WaypointNode | null = null;

  /** This node's own transport state, expressed as `TransportState` so it can
   *  drive component 1's panel drawing/isPlaying/progressFraction helpers. */
  function transportStateOf(node: WaypointNode): TransportState {
    return {
      activeId: node.waypointId,
      status: node.transportPlaying ? "playing" : "paused",
      positionSec: node.transportPositionSec,
      durationSec: node.transportDurationSec,
    };
  }

  function redrawTransportPanel(node: WaypointNode): void {
    node.transportPanel?.redraw(transportStateOf(node), node.waypointId);
  }

  /** Built once per waypoint, the first time it gets a visual (A9-style: cheap
   *  enough that it need not be pooled). Always visible whenever the visual
   *  is, per the "discoverable, not just on tap" requirement. */
  function ensureTransportPanel(node: WaypointNode): TransportPanel {
    if (node.transportPanel !== null) return node.transportPanel;
    const panel = createTransportPanel(
      TRANSPORT_PANEL_WIDTH_M,
      TRANSPORT_PANEL_HEIGHT_M,
    );
    const offset = transportPanelOffset();
    panel.mesh.position.set(offset.x, offset.y, 0);
    panel.mesh.visible = false; // synced to the visual's own visibility
    stamp(panel.mesh, node.waypointId, "transport");
    node.group.add(panel.mesh);
    node.transportPanel = panel;
    redrawTransportPanel(node);
    return panel;
  }

  return {
    ensureTransportPanel,
    redrawTransportPanel,

    playAudio(node: WaypointNode, url: string): void {
      if (node.audio === null) {
        const element = new Audio(url);
        element.crossOrigin = "anonymous";
        node.audioElement = element;
        node.audio = createAudioPlayer(element, audioListener, {
          onTick: (positionSec, durationSec) => {
            node.transportPositionSec = positionSec;
            node.transportDurationSec = durationSec;
            redrawTransportPanel(node);
          },
          onEnded: () => {
            node.transportPlaying = false;
            redrawTransportPanel(node);
            audioEndListeners.emit();
          },
        });
        // Spatialised from the waypoint's own position (component 1's tuning).
        node.group.add(node.audio.spatialNode);
      }
      currentAudio = node.audio;
      currentAudioNode = node;
      node.transportPlaying = true;
      node.audio.play();
      redrawTransportPanel(node);
    },

    pauseAudio(): void {
      currentAudio?.pause();
      if (currentAudioNode !== null) {
        currentAudioNode.transportPlaying = false;
        redrawTransportPanel(currentAudioNode);
      }
    },

    resumeAudio(): void {
      currentAudio?.play();
      if (currentAudioNode !== null) {
        currentAudioNode.transportPlaying = true;
        redrawTransportPanel(currentAudioNode);
      }
    },

    /** Scrubs the currently-playing node's own audio only — a `fraction` on
     *  some other (inactive) waypoint has no element to seek yet. */
    seekAudio(node: WaypointNode, fraction: number): void {
      if (node.audio === null || node !== currentAudioNode) return;
      const seconds = fraction * node.transportDurationSec;
      node.audio.seekToSeconds(seconds);
      // Immediate visual feedback; the element's own `timeupdate` will
      // confirm (or correct) this shortly after.
      node.transportPositionSec = seconds;
      redrawTransportPanel(node);
    },

    stopAudio(): void {
      if (currentAudio === null) return;
      currentAudio.pause();
      currentAudio.seekToSeconds(0);
      if (currentAudioNode !== null) {
        currentAudioNode.transportPlaying = false;
        currentAudioNode.transportPositionSec = 0;
        redrawTransportPanel(currentAudioNode);
      }
      currentAudio = null;
      currentAudioNode = null;
    },

    isAudioReady(): boolean {
      // A suspended context silently swallows playback, so the runtime asks
      // BEFORE starting a story and surfaces the failure (plan A16).
      return audioListener.context.state === "running";
    },

    onAudioEnded(listener: () => void): () => void {
      return audioEndListeners.add(listener);
    },

    dispose(): void {
      audioEndListeners.clear();
      currentAudio = null;
      currentAudioNode = null;
    },
  };
}
