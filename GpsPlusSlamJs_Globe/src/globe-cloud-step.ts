/**
 * The globe's clouds, frame by frame (editor-on-the-full-globe plan,
 * clouds part b): who draws the clouds at the camera's altitude (the flat
 * layer, the slab, the spherical volume), the two volumes' per-frame
 * update, and their drawing after the Earth. Moved out of the globe lab as
 * a pure refactor: the calls, their order and their conditions are the
 * lab's. The lab still owns the globe's own writes (the shell's share, the
 * map's shadow) and passes what it measures.
 *
 * @see globe-cloud-step.ts.md
 */
import type * as THREE from "three";

import type { CloudNoiseMode } from "gps-plus-slam-app-framework/visualization/atmosphere/cloud-live-noise";

import { flatCloudShare } from "./globe-cloud-flat-fade.js";
import type { GlobeCloudShell } from "./globe-cloud-shell.js";
import {
  type CloudShellNoiseCascade,
  type CloudShellStation,
  type CloudShellVolumeShares,
  cloudShellNoiseCascade,
  cloudShellShadowStrengths,
  cloudShellStationsFor,
  cloudShellVolumeShares,
} from "./globe-cloud-shell-volume.js";
import type {
  CloudShellSlabDisc,
  GlobeCloudShellVolume,
} from "./globe-cloud-shell-volume-pass.js";
import { CLOUD_VOLUME } from "./globe-cloud-volume.js";
import type { GlobeCloudVolume } from "./globe-cloud-volume-pass.js";
import type { LatLng } from "./globe-target.js";

/** The shell law's knobs (the lab's hash names). */
export interface CloudShellLawKnobs {
  readonly cloudShellTopKm: number;
  readonly cloudShellMidKm: number;
  readonly cloudShellCell: number;
  readonly cloudShellThick: number;
  readonly cloudShellNoise: number;
  readonly cloudShellBandKm: number;
  readonly cloudShellFields: number;
  readonly cloudVolumeCeilingKm: number;
}

/** Every knob the step reads (the lab's hash names). */
export interface GlobeCloudKnobs extends CloudShellLawKnobs {
  /** 0 off, 1 the slab on the camera, 2 the slab ahead along the view. */
  readonly cloudVolume: number;
  readonly cloudVolumeKm: number;
  readonly cloudVolumeFadeKm: number;
  readonly cloudVolumeCover: number;
  readonly cloudShadowFrom: number;
  readonly cloudNoise: CloudNoiseMode;
  readonly cloudFineGain: number;
  readonly cloudShellVolume: number;
  readonly cloudShellRes: number;
  readonly cloudShellShadow: number;
  readonly cloudFlat: number;
  readonly cloudFlatTopKm: number;
  readonly cloudFlatWeak: number;
  readonly cloudFlatOutToKm: number;
  readonly cloudFlatOutFromKm: number;
  readonly cloudHigh: number;
  readonly cloudHighKm: number;
  readonly cloudHighCell: number;
  readonly cloudHighCover: number;
  readonly cloudHighShare: number;
}

/**
 * The spherical cloud volume's law from the knobs (round-4 plan R4d): the
 * module's `cloudShellStationsFor`, the bottom station (the slab's own
 * set) at the slab's ceiling or above it (R4d review, findings 9 and 11).
 *
 * @throws RangeError for a knob `cloudShellStationsFor` refuses.
 */
export function cloudShellStationsFromKnobs(
  p: CloudShellLawKnobs,
): CloudShellStation[] {
  return cloudShellStationsFor({
    topKm: p.cloudShellTopKm,
    midKm: p.cloudShellMidKm,
    cellScale: p.cloudShellCell,
    thicknessScale: p.cloudShellThick,
    noiseShare: p.cloudShellNoise,
    ceilingKm: p.cloudVolumeCeilingKm,
  });
}

/**
 * The noise's cascade at `altitudeKm` (round-5 plan 2026-10-12-0612 C2):
 * from the top of the shell's fade-in down to its bottom station (the
 * slab's set at the slab's ceiling), `cloudShellFields` morphs, the top
 * field at `cloudShellCell`.
 *
 * @throws RangeError for knobs the stations or the cascade refuse.
 */
export function cloudShellCascadeFromKnobs(
  altitudeKm: number,
  p: CloudShellLawKnobs,
): CloudShellNoiseCascade {
  const stations = cloudShellStationsFromKnobs(p);
  const top = stations[0];
  const bottom = stations.at(-1);
  if (top === undefined || bottom === undefined) {
    throw new RangeError("the shell's law has no station");
  }
  return cloudShellNoiseCascade(altitudeKm, {
    topKm: top.altitudeKm + p.cloudShellBandKm,
    bottomKm: bottom.altitudeKm,
    fields: Math.round(p.cloudShellFields),
    topScale: p.cloudShellCell,
  });
}

/** Who draws the clouds this frame (`GlobeCloudStep.plan`). */
interface GlobeCloudPlan {
  /** The spherical volume draws (live noise, a frame, the slab on). */
  readonly shellOn: boolean;
  /** The flat layer's share as a drawer (1: whole). */
  readonly flat: number;
  /** The flat layer's share without the shell, for the map's shadow. */
  readonly flatShadow: number;
  /** The drawers' shares, or null when the shell does not draw. */
  readonly shares: CloudShellVolumeShares | null;
  /** The shadows' strengths (`cloudShellShadowStrengths`). */
  readonly shadow: { readonly shell: number; readonly mapFactor: number };
}

/** The flat layer's own band with the shell (C5), or null without it. */
function flatOutBand(
  p: GlobeCloudKnobs,
  shellOn: boolean,
): { fromKm: number; toKm: number } | null {
  if (!shellOn) return null;
  // Kept above the slab's ceiling and falling, whatever the knobs say.
  const toKm = Math.max(p.cloudFlatOutToKm, p.cloudVolumeCeilingKm + 1);
  return { fromKm: Math.max(p.cloudFlatOutFromKm, toKm + 1), toKm };
}

/**
 * Whether the knobs ask for the spherical volume (R4d), which takes the
 * clouds over from its top down. It reads the live field only, and meets
 * the slab without a seam only where the slab reads it too (R4d review):
 * with the tile or hex noise the old layers draw, as before.
 */
const shellWanted = (p: GlobeCloudKnobs, framed: boolean) =>
  p.cloudShellVolume === 1 && p.cloudNoise === "live" && framed;

/** The shell's and the slab's shares at the camera (null: no height). */
const sharesAt = (
  p: GlobeCloudKnobs,
  cameraAltM: number,
  topKm: number,
): CloudShellVolumeShares | null =>
  Number.isFinite(cameraAltM)
    ? cloudShellVolumeShares(Math.max(0, cameraAltM) / 1000, {
        topKm,
        bandKm: p.cloudShellBandKm,
        ceilingKm: p.cloudVolumeCeilingKm,
        fadeKm: p.cloudVolumeFadeKm,
      })
    : null;

/**
 * The flat layer's share by the camera's altitude now and its shadow's
 * share: it hands over to the volume where one is drawn, else it only
 * weakens; 1 and 1 with the flat layer off or no altitude.
 */
function flatShares(
  p: GlobeCloudKnobs,
  cameraAltM: number,
  volumeOn: boolean,
  shellOn: boolean,
  shellTopKm: number,
): { flat: number; flatShadow: number } {
  const flatOn = p.cloudFlat === 1 && Number.isFinite(cameraAltM);
  if (!flatOn) return { flat: 1, flatShadow: 1 };
  const options = {
    ceilingKm: volumeOn ? p.cloudVolumeCeilingKm : 0,
    fadeKm: volumeOn ? p.cloudVolumeFadeKm : 1,
    topM: p.cloudFlatTopKm * 1000,
    weakShare: p.cloudFlatWeak,
  };
  const altitudeM = Math.max(0, cameraAltM);
  return {
    flat: flatCloudShare(altitudeM, {
      ...options,
      shellTopKm,
      shellBandKm: p.cloudShellBandKm,
      flatOut: flatOutBand(p, shellOn),
    }),
    flatShadow: flatCloudShare(altitudeM, options),
  };
}

/** The deck the slab lifts to and the hole it cuts (the globe's shell). */
type CloudDeck = Pick<GlobeCloudShell, "heightM" | "setHole">;

/** What the volumes' update is told (`GlobeCloudStep.updateVolumes`). */
export interface GlobeCloudVolumesFrame {
  /** The observer's height over the ellipsoid (km; the sky's). */
  readonly observerKm: number;
  /** The camera's altitude the plan was made at (m; NaN: unknown). */
  readonly cameraAltM: number;
  /** The frame's target (degrees), or null. */
  readonly target: LatLng | null;
  /** The camera's world position and view direction. */
  readonly view: {
    readonly position: readonly [number, number, number];
    readonly direction: readonly [number, number, number];
  };
  /** The globe's cloud shell. */
  readonly deck: CloudDeck;
}

/** What the drawing after the Earth is told (`GlobeCloudStep.render`). */
interface GlobeCloudRenderFrame {
  /** The relief, whose depth ends the march. */
  readonly relief: THREE.Object3D;
  /** Further depth casters (the city). */
  readonly extra: readonly THREE.Object3D[];
  readonly worldFromEcef: THREE.Matrix4;
  readonly sunEcef: THREE.Vector3;
  readonly sunIntensity: number;
  /** The space pass's weight, which the relief's depth ends the rays by. */
  readonly sceneDepthWeight: number;
  /** How much of the slab's flat deck the shell takes (`cloudShellFlat`). */
  readonly flatten: number;
}

/** The shell's and the slab's alpha on one grid (debug hooks). */
interface GlobeCloudAlphaGrid {
  weight: number;
  slabWeight: number;
  shell: number[] | null;
  high: number[] | null;
  shadow: number[] | null;
  slab: number[] | null;
}

export interface GlobeCloudStep {
  /**
   * Who draws the clouds this frame, from the knobs, the camera's altitude
   * (m above the ellipsoid; NaN unknown) and whether a frame is set; kept
   * for the volumes' update and the drawing.
   */
  plan(
    p: GlobeCloudKnobs,
    input: { readonly cameraAltM: number; readonly framed: boolean },
  ): GlobeCloudPlan;
  /** The slab's and the shell's update, after the sky's step. */
  updateVolumes(p: GlobeCloudKnobs, frame: GlobeCloudVolumesFrame): void;
  /**
   * The slab over the Earth, and with the shell drawing, the two mixed in
   * one composite. Nothing without the slab.
   */
  render(camera: THREE.PerspectiveCamera, frame: GlobeCloudRenderFrame): void;
  /** The last plan's shares, or null. */
  readonly shares: CloudShellVolumeShares | null;
  /** The last plan's shadow strengths. */
  readonly shadow: { readonly shell: number; readonly mapFactor: number };
  /**
   * The slab's disc as the shell weighs it per pixel: its centre (world x,
   * z; null on the camera), the deck's height and its radius (m); null
   * without the slab.
   */
  slabDisc(): CloudShellSlabDisc | null;
  /** The shell's last target by bands (debug); null without one. */
  readBack(bands?: number): { meanAlpha: number; over: number }[] | null;
  /** The shell's, its high layer's, its shadow's and the slab's alpha. */
  alphaGrid(nx: number, ny: number): GlobeCloudAlphaGrid | null;
  /**
   * The shell's own drawing and the slab's alpha after one `frame()`;
   * null where either does not draw.
   */
  seamGrid(
    nx: number,
    ny: number,
    frame: () => void,
  ): {
    shell: number[] | null;
    slab: number[] | null;
    slabShare: number;
  } | null;
}

/** The volumes the step drives (null where the page has none). */
interface GlobeCloudStepOptions {
  readonly cloudVolume: GlobeCloudVolume | null;
  readonly shellVolume: GlobeCloudShellVolume | null;
}

/** The shell's frame (`GlobeCloudShellVolume.update`) from the knobs. */
function shellFrame(
  p: GlobeCloudKnobs,
  frame: GlobeCloudVolumesFrame,
  shares: CloudShellVolumeShares | null,
  shadow: number,
): Parameters<GlobeCloudShellVolume["update"]>[0] {
  const altitudeKm = Number.isFinite(frame.cameraAltM)
    ? Math.max(0, frame.cameraAltM / 1000)
    : 0;
  return {
    altitudeKm,
    shares: shares ?? { shellIn: 0, shell: 0, slab: 0 },
    stations: cloudShellStationsFromKnobs(p),
    target: frame.target,
    deckKm: frame.deck.heightM() / 1000,
    cover: p.cloudVolumeCover,
    cascade: cloudShellCascadeFromKnobs(altitudeKm, p),
    highLayer: {
      on: p.cloudHigh === 1,
      altitudeKm: p.cloudHighKm,
      cellScale: p.cloudHighCell,
      cover: p.cloudHighCover,
      noiseShare: p.cloudHighShare,
      shadow: p.cloudShellShadow,
    },
    shadow,
  };
}

/** The step over `cloudVolume` and `shellVolume`. */
export function createGlobeCloudStep({
  cloudVolume,
  shellVolume,
}: GlobeCloudStepOptions): GlobeCloudStep {
  /** This frame's drawers of the clouds (`cloudShellVolumeShares`). */
  let shares: CloudShellVolumeShares | null = null;
  /** The shadows' strengths this frame (`cloudShellShadowStrengths`). */
  let shadow = { shell: 0, mapFactor: 1 };

  const slabDisc = (): CloudShellSlabDisc | null => {
    if (!cloudVolume) return null;
    const s = cloudVolume.state();
    return { centre: s.discCentre, deckY: s.deckY, radiusM: s.radiusM };
  };

  /** The slab's share, its disc and the shell's hole of the same size. */
  const updateSlab = (
    volume: GlobeCloudVolume,
    p: GlobeCloudKnobs,
    frame: GlobeCloudVolumesFrame,
  ) => {
    volume.setEnabled(p.cloudVolume > 0);
    volume.setShadow(p.cloudShadowFrom === 1);
    volume.setNoise(p.cloudNoise);
    volume.setFineGain(p.cloudFineGain);
    const { radiusM } = volume.update({
      altitudeKm: Math.max(0, frame.observerKm),
      target: frame.target,
      radiusKm: p.cloudVolumeKm,
      ceilingKm: p.cloudVolumeCeilingKm,
      fadeKm: p.cloudVolumeFadeKm,
      cover: p.cloudVolumeCover,
      shellHeightM: frame.deck.heightM(),
      // The disc where the view meets the deck (§15); variant 1 keeps it
      // on the camera, where the shell's hole is.
      view: frame.view,
      maxAheadM: p.cloudVolume === 1 ? 0 : CLOUD_VOLUME.maxAheadKm * 1000,
      mixed: shares !== null,
    });
    frame.deck.setHole(
      p.cloudVolume === 1 && radiusM > 0
        ? {
            radiusM,
            aboveCameraM: frame.deck.heightM() - frame.observerKm * 1000,
          }
        : null,
    );
  };

  return {
    plan(p, { cameraAltM, framed }) {
      const volumeOn = Boolean(cloudVolume) && p.cloudVolume > 0;
      const shellOn =
        volumeOn && shellVolume !== null && shellWanted(p, framed);
      // The top as the stations keep it, so the shares never refuse the
      // knobs (R4d review, finding 11).
      const topKm = shellOn
        ? (cloudShellStationsFromKnobs(p)[0]?.altitudeKm ?? 0)
        : 0;
      const { flat, flatShadow } = flatShares(
        p,
        cameraAltM,
        volumeOn,
        shellOn,
        topKm,
      );
      shares = shellOn ? sharesAt(p, cameraAltM, topKm) : null;
      shadow = cloudShellShadowStrengths({
        strength: p.cloudShellShadow,
        shellIn: shares?.shellIn ?? 0,
      });
      return { shellOn, flat, flatShadow, shares, shadow };
    },
    updateVolumes(p, frame) {
      if (cloudVolume) updateSlab(cloudVolume, p, frame);
      // The spherical volume's law and weights this frame (R4d).
      if (shellVolume) {
        shellVolume.setEnabled(shares !== null);
        shellVolume.setResolution(p.cloudShellRes);
        shellVolume.update(shellFrame(p, frame, shares, shadow.shell));
      }
    },
    render(camera, frame) {
      if (!cloudVolume) return;
      const mixing = shares !== null;
      const slabDrawn = cloudVolume.render(camera, frame.relief, frame.extra, {
        composite: !mixing,
      });
      // The spherical volume and the slab mixed in one composite (R4d).
      if (mixing && shellVolume) {
        shellVolume.render(camera, {
          worldFromEcef: frame.worldFromEcef,
          sunEcef: frame.sunEcef,
          sunIntensity: frame.sunIntensity,
          slabTexture: slabDrawn ? cloudVolume.texture : null,
          sceneDepthWeight: frame.sceneDepthWeight,
          disc: slabDisc(),
          flatten: frame.flatten,
        });
      }
    },
    get shares() {
      return shares;
    },
    get shadow() {
      return shadow;
    },
    slabDisc,
    readBack(bands = 1) {
      return shellVolume?.readBack(bands) ?? null;
    },
    alphaGrid(nx, ny) {
      const s = shellVolume?.state();
      if (!s || !shellVolume) return null;
      // The shell's composite weight is its fade-in alone: its grid is
      // already weighted per pixel by the slab's disc (R4d review, finding 1).
      return {
        weight: s.share,
        slabWeight: s.slabWeight,
        shell: s.share > 0 ? shellVolume.alphaGrid(nx, ny) : null,
        // The high layer's own drawing (round-5 plan §11, A).
        high: s.high ? shellVolume.alphaGrid(nx, ny, "high") : null,
        // The shell's ground shadow, drawn on its own (cloud-shadows M1).
        shadow: s.share > 0 ? shellVolume.alphaGrid(nx, ny, "shadow") : null,
        slab:
          s.slabWeight > 0 && cloudVolume && cloudVolume.state().share > 0
            ? cloudVolume.alphaGrid(nx, ny)
            : null,
      };
    },
    seamGrid(nx, ny, frame) {
      if (!shellVolume || shares === null || !cloudVolume) return null;
      if (cloudVolume.state().share <= 0) return null;
      frame();
      // The shell's target is its own drawing (the composite weighs it).
      return {
        shell: shellVolume.alphaGrid(nx, ny),
        slab: cloudVolume.alphaGrid(nx, ny),
        slabShare: cloudVolume.state().share,
      };
    },
  };
}
