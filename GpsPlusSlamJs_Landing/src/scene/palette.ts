import { Group, Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { Theme } from "../theme";

/**
 * Dual scene palettes for the light/dark theme toggle.
 *
 * Every mesh in the scene carries a `userData.paletteRole`; applying a
 * palette re-colors the whole scene graph in one traversal, which is what
 * makes the theme toggle (and its animated cross-fade) cheap. The plan's
 * visual decision is encoded here: light = white/matte clay world, dark =
 * night world with glowing anchors (emissive accents). The fused-anchor
 * accent stays the brand red #ef4444 in both themes, matching the page
 * chrome's `--accent`.
 */

export const PALETTE_ROLES = [
  "ground",
  "path",
  "hill",
  "foliage",
  "trunk",
  "rock",
  "sign",
  "signPanel",
  "statue",
  "person",
  "markerRaw",
  "markerFused",
  "snapRing",
  "qrModule",
  "poi",
  "phone",
  "screen",
  "arrow",
  "label",
  "skyline",
  "grass",
  "tent",
  "ruin",
  "ghost",
  "satellite",
  "portal",
  "portalMoss",
  "parkour",
] as const;

export type PaletteRole = (typeof PALETTE_ROLES)[number];

interface RoleStyle {
  readonly color: number;
  /** Emissive color; defaults to `color` when only intensity is set. */
  readonly emissive?: number;
  /** 0 (matte) unless the theme wants the part to glow. */
  readonly emissiveIntensity?: number;
}

// Which celestial accent set a palette's sky shows (v3 F3). Consumers
// reference it via `ScenePalette['sky']['accents']`; keep the alias
// module-private until an importer needs it by name (knip enforces this).
type SkyAccents = "moon-stars" | "sun" | "star-grid" | "none";

export interface ScenePalette {
  readonly background: number;
  readonly fog: {
    readonly color: number;
    readonly near: number;
    readonly far: number;
  };
  readonly hemisphere: {
    readonly sky: number;
    readonly ground: number;
    readonly intensity: number;
  };
  readonly directional: {
    readonly color: number;
    readonly intensity: number;
    /**
     * Optional per-palette sun position (golden-hour restyle): dusk
     * moves the light low and to the LEFT for long sunset shadows.
     * Absent = the controller's shared default position.
     */
    readonly position?: {
      readonly x: number;
      readonly y: number;
      readonly z: number;
    };
  };
  /**
   * Sky dome gradient + celestial accents (v3 F3); consumed by
   * `sky-dome.ts`, not by the role traversal (the dome is unlit).
   */
  readonly sky: {
    readonly zenith: number;
    readonly horizon: number;
    readonly accents: SkyAccents;
    readonly accentColor: number;
    /** Cloud-blob tint for the "sun" accent set (golden-hour restyle);
     * falls back to `accentColor` when omitted. */
    readonly cloudColor?: number;
  };
  /**
   * The rebuilt portal's "other world" (golden-hour restyle): a
   * vertex-colored gradient plane inside the frame, brighter than the
   * scene because it is unlit. Cannot ride the role traversal (vertex
   * colors, not a flat material color) — `applyPortalPalette` in
   * portal.ts consumes this block directly.
   */
  readonly portalInterior: {
    readonly top: number;
    readonly bottom: number;
    readonly clouds: number;
  };
  /**
   * Ambient particle field (v3 F2); consumed by `particles.ts`. Style
   * picks the motion/appearance tuning (fireflies bob, dust drifts).
   */
  readonly particles: {
    readonly color: number;
    readonly style: "fireflies" | "dust" | "motes";
  };
  readonly roles: Readonly<Record<PaletteRole, RoleStyle>>;
}

const ACCENT = 0xef4444;
// Golden-hour restyle (2026-07-19): DUSK retunes the anchor red within
// the red family — a deeper crimson that harmonizes with the copper/teal
// grade. Every other palette keeps the brand ACCENT (test-pinned map).
const DUSK_ACCENT = 0xe0483c;

const LIGHT: ScenePalette = {
  background: 0xf2f1ed,
  fog: { color: 0xf2f1ed, near: 40, far: 90 },
  hemisphere: { sky: 0xffffff, ground: 0xd8d4cc, intensity: 1.15 },
  directional: { color: 0xffffff, intensity: 1.6 },
  // Soft blue zenith fading into the page background at the horizon.
  sky: {
    zenith: 0xcfe4f7,
    horizon: 0xf2f1ed,
    accents: "none",
    accentColor: 0xffffff,
  },
  portalInterior: { top: 0xbfe6e0, bottom: 0xffd9b0, clouds: 0xfff1dd },
  particles: { color: 0xffffff, style: "motes" },
  roles: {
    ground: { color: 0xe9e6df },
    path: { color: 0xd8d2c6 },
    hill: { color: 0xe2ded4 },
    foliage: { color: 0xa7c49a },
    trunk: { color: 0xb59a7a },
    rock: { color: 0xcfccc5 },
    sign: { color: 0xb59a7a },
    signPanel: { color: 0xffffff },
    statue: { color: 0xd8d5cf },
    // The "user color" (round-2 R6b): teal/petrol, distinct from amber
    // (GPS), red (anchors) and blue (AR overlays) in EVERY palette.
    person: { color: 0x0f766e },
    markerRaw: { color: 0xeab308 },
    markerFused: { color: ACCENT, emissiveIntensity: 0 },
    snapRing: { color: ACCENT },
    qrModule: { color: 0xb45309 },
    poi: { color: ACCENT },
    phone: { color: 0x2a2a30 },
    screen: { color: 0xffffff },
    arrow: { color: 0x3b82f6 },
    // Round-14 R14-6: the AR "hinted text" label bars use a distinct
    // VIOLET (story/label content) so they read differently from the
    // blue navigation arrows; the copy word "stories" fades to match.
    label: { color: 0x7c3aed },
    skyline: { color: 0xbdbab2 },
    grass: { color: 0x94b984 },
    tent: { color: 0xcfa15e },
    ruin: { color: 0xc9c4b8 },
    // Ghost = AR-blue family (the color-coding invariant: blue = AR
    // overlay content); the mesh itself is translucent (builder-set).
    ghost: { color: 0x60a5fa },
    // Satellites (№0): blue family — tech content per the color coding.
    satellite: { color: 0x5b7fd4 },
    // Portal monument frame (golden-hour rebuild): weathered stone-green;
    // the bright interior gradient carries the "magic", not the frame.
    portal: { color: 0x8a9078 },
    portalMoss: { color: 0x6d7d5a },
    // Parkour blocks (round-14 R14-12): a fresh green, a new coding
    // color for the "jump-and-run parkour" park course.
    parkour: { color: 0x16a34a },
  },
};

// Brightened after round-1 feedback ("dark theme too dark, needs a tick
// more contrast") and AGAIN after round-4 V3 ("path/statue/skyline barely
// recognizable"): object grays lifted one visible step — floors are
// test-pinned as WCAG contrast over the background — while background,
// fog and the glow accents keep the night mood.
const DARK: ScenePalette = {
  background: 0x0b0b0d,
  fog: { color: 0x0b0b0d, near: 40, far: 90 },
  hemisphere: { sky: 0x565f80, ground: 0x23232c, intensity: 1.15 },
  directional: { color: 0xbfd0ff, intensity: 1.1 },
  // Night sky: near-black zenith, faintly lifted horizon, moon + stars.
  sky: {
    zenith: 0x06060c,
    horizon: 0x181822,
    accents: "moon-stars",
    accentColor: 0xdde3ff,
  },
  // A glowing dawn in the night — the unlit interior plane blooms
  // naturally over the dark world.
  portalInterior: { top: 0x7fd4d8, bottom: 0xffc490, clouds: 0xffe0bf },
  particles: { color: 0xffe9a8, style: "fireflies" },
  roles: {
    ground: { color: 0x2a2a34 },
    path: { color: 0x50505e },
    hill: { color: 0x32323c },
    foliage: { color: 0x2e5240 },
    trunk: { color: 0x4d4136 },
    rock: { color: 0x484852 },
    sign: { color: 0x4d4136 },
    signPanel: { color: 0xd9d9e0, emissiveIntensity: 0.25 },
    // Emissive floor: the statue often sits in the directional light's
    // shadow, so a brighter base color alone stays invisible (round-4 V3).
    statue: { color: 0x6a6a78, emissiveIntensity: 0.15 },
    person: { color: 0x2dd4bf, emissiveIntensity: 0.5 },
    markerRaw: { color: 0xfacc15, emissiveIntensity: 0.6 },
    markerFused: { color: ACCENT, emissiveIntensity: 0.9 },
    snapRing: { color: ACCENT, emissiveIntensity: 0.9 },
    qrModule: { color: 0xfbbf24, emissiveIntensity: 0.5 },
    poi: { color: ACCENT, emissiveIntensity: 0.8 },
    // Blue family + glow (round-5 W4): near-black-on-near-black made the
    // frame invisible; blue groups it with the AR overlays it frames.
    phone: { color: 0x3b5b9e, emissiveIntensity: 0.35 },
    screen: { color: 0x2c3550, emissiveIntensity: 0.5 },
    arrow: { color: 0x60a5fa, emissiveIntensity: 0.7 },
    label: { color: 0xc084fc, emissiveIntensity: 0.7 },
    // Emissive floor keeps the horizon city visible through the fog at
    // ~48 units (round-4 V3).
    skyline: { color: 0x4b4b60, emissiveIntensity: 0.18 },
    grass: { color: 0x28483a },
    tent: { color: 0x7a5f3c, emissiveIntensity: 0.12 },
    ruin: { color: 0x555562, emissiveIntensity: 0.12 },
    ghost: { color: 0x7fb2ff, emissiveIntensity: 0.7 },
    // Emissive: at ~40 units up the night satellites must self-glow to
    // read at all (same reasoning as the skyline floor).
    satellite: { color: 0x7fa8ff, emissiveIntensity: 0.5 },
    // Frame reads at night via a small emissive floor (skyline reasoning).
    portal: { color: 0x2c3a34, emissiveIntensity: 0.12 },
    portalMoss: { color: 0x33513f, emissiveIntensity: 0.12 },
    parkour: { color: 0x22c55e, emissiveIntensity: 0.4 },
  },
};

// NEON (cyberpunk): near-black blue world, glowing cyan/teal accents.
const NEON: ScenePalette = {
  background: 0x05060e,
  fog: { color: 0x05060e, near: 40, far: 90 },
  hemisphere: { sky: 0x2b2f6e, ground: 0x0a0a14, intensity: 1.15 },
  directional: { color: 0x7f8cff, intensity: 1.0 },
  // Cyber sky: deep blue-black with a synthwave star grid in cyan.
  sky: {
    zenith: 0x030410,
    horizon: 0x131a3a,
    accents: "star-grid",
    accentColor: 0x22d3ee,
  },
  portalInterior: { top: 0x22d3ee, bottom: 0xe879f9, clouds: 0x9ff2ff },
  particles: { color: 0x67e8f9, style: "dust" },
  roles: {
    ground: { color: 0x11162b },
    path: { color: 0x1c2340 },
    hill: { color: 0x151a30 },
    foliage: { color: 0x123a3a },
    trunk: { color: 0x232848 },
    rock: { color: 0x1c2033 },
    sign: { color: 0x232848 },
    signPanel: { color: 0xd7e0ff, emissiveIntensity: 0.35 },
    statue: { color: 0x2b3050 },
    person: { color: 0x2dd4bf, emissiveIntensity: 0.7 },
    markerRaw: { color: 0xfacc15, emissiveIntensity: 0.8 },
    markerFused: { color: ACCENT, emissiveIntensity: 1.0 },
    snapRing: { color: ACCENT, emissiveIntensity: 1.0 },
    qrModule: { color: 0xfbbf24, emissiveIntensity: 0.7 },
    poi: { color: ACCENT, emissiveIntensity: 0.9 },
    phone: { color: 0x0c0f1c },
    screen: { color: 0x3b4a8a, emissiveIntensity: 0.6 },
    arrow: { color: 0x22d3ee, emissiveIntensity: 0.9 },
    label: { color: 0xe879f9, emissiveIntensity: 0.8 },
    skyline: { color: 0x0f1326, emissiveIntensity: 0.15 },
    grass: { color: 0x0f3336 },
    tent: { color: 0x394a76, emissiveIntensity: 0.2 },
    ruin: { color: 0x232a48, emissiveIntensity: 0.12 },
    ghost: { color: 0x22d3ee, emissiveIntensity: 0.9 },
    satellite: { color: 0x67e8f9, emissiveIntensity: 0.7 },
    portal: { color: 0x1c2340, emissiveIntensity: 0.15 },
    portalMoss: { color: 0x1d4a44, emissiveIntensity: 0.15 },
    parkour: { color: 0x4ade80, emissiveIntensity: 0.6 },
  },
};

// DUSK (golden hour, restyled 2026-07-19): the cinematic teal-and-orange
// grade — deep teal-green base under a turquoise→peach sunset sky, warm
// copper light from a low left sun, dry-orange terrain, teal vegetation
// and shadows, restrained emissives ("restrained bloom, not neon"). The
// fog is a golden haze deliberately WARMER than the background so distant
// objects melt toward the peach horizon instead of into the ground color.
const DUSK: ScenePalette = {
  background: 0x142a27,
  // near 40 / far 110 (not the shared 40/90): the works-anywhere camera
  // sits far out — at far 88 the whole world melted into the haze
  // (screenshot round 1); 110 keeps the golden wash at the horizon while
  // the mid-ground stays readable.
  fog: { color: 0xc59f78, near: 40, far: 110 },
  // Warm sky fill + teal ground bounce: this pairing is what makes the
  // shadow sides read teal-green while lit faces go copper.
  hemisphere: { sky: 0xffc9a0, ground: 0x24443c, intensity: 1.1 },
  // Low golden-hour sun from the LEFT → long soft shadows (the only
  // palette with an explicit light position).
  directional: {
    color: 0xffb27a,
    intensity: 1.35,
    position: { x: -26, y: 12, z: 6 },
  },
  // Sunset sky: pale turquoise zenith melting into a peach horizon + low
  // fat sun with clouds (sky-dome.ts places them around the sun).
  sky: {
    zenith: 0x8fc5c0,
    horizon: 0xffc493,
    accents: "sun",
    accentColor: 0xffd9a8,
    cloudColor: 0xffddb8,
  },
  portalInterior: { top: 0x9fd8cf, bottom: 0xffc9a0, clouds: 0xffddb8 },
  particles: { color: 0xffd9a0, style: "fireflies" },
  roles: {
    ground: { color: 0x8f5e39 },
    path: { color: 0xb08655 },
    hill: { color: 0x7d5233 },
    foliage: { color: 0x1e5148 },
    trunk: { color: 0x54402f },
    rock: { color: 0x6e5a45 },
    sign: { color: 0x54402f },
    signPanel: { color: 0xffe9d2, emissiveIntensity: 0.15 },
    statue: { color: 0x8a6f52 },
    person: { color: 0x2dd4bf, emissiveIntensity: 0.4 },
    markerRaw: { color: 0xf0a832, emissiveIntensity: 0.5 },
    markerFused: { color: DUSK_ACCENT, emissiveIntensity: 0.6 },
    snapRing: { color: DUSK_ACCENT, emissiveIntensity: 0.6 },
    qrModule: { color: 0xd98a2b, emissiveIntensity: 0.4 },
    poi: { color: DUSK_ACCENT, emissiveIntensity: 0.6 },
    phone: { color: 0x4a6ea8 },
    screen: { color: 0x8aa3c8, emissiveIntensity: 0.35 },
    arrow: { color: 0x5b9bd8, emissiveIntensity: 0.5 },
    label: { color: 0xc9a3e8, emissiveIntensity: 0.5 },
    // Dark-mesa silhouettes, but with a readability floor over the teal
    // background (test-pinned, same lesson as the dark theme).
    skyline: { color: 0x40605a, emissiveIntensity: 0.08 },
    // The instanced world-detail grass covers the whole field: this one
    // value is most of the "dry reddish-orange grass" look.
    grass: { color: 0xa06b3d },
    tent: { color: 0xb5763f, emissiveIntensity: 0.12 },
    ruin: { color: 0x63503f, emissiveIntensity: 0.08 },
    ghost: { color: 0x8fb8e8, emissiveIntensity: 0.5 },
    satellite: { color: 0x9fb8e0, emissiveIntensity: 0.35 },
    // The portal role is the monument FRAME since the golden-hour
    // rebuild: near-black green stone, matte — brightness comes from the
    // interior gradient, never from a glowing frame.
    portal: { color: 0x18251c },
    portalMoss: { color: 0x2e4a2a },
    parkour: { color: 0x3fae7a, emissiveIntensity: 0.3 },
  },
};

// MONO (ink/paper): high-contrast grayscale world — ONLY the coded colors
// (amber GPS, red anchors, blue AR, teal user) pop. The strongest
// storytelling palette.
const MONO: ScenePalette = {
  background: 0xf5f5f2,
  fog: { color: 0xf5f5f2, near: 40, far: 90 },
  hemisphere: { sky: 0xffffff, ground: 0xd9d9d4, intensity: 1.15 },
  directional: { color: 0xffffff, intensity: 1.5 },
  // Ink/paper: the sky stays a barely-there gray wash — no accents.
  sky: {
    zenith: 0xe6e6e1,
    horizon: 0xf5f5f2,
    accents: "none",
    accentColor: 0xffffff,
  },
  portalInterior: { top: 0xe8f4f2, bottom: 0xffffff, clouds: 0xffffff },
  particles: { color: 0x8a8a84, style: "motes" },
  roles: {
    ground: { color: 0xe8e8e4 },
    path: { color: 0xd2d2cc },
    hill: { color: 0xdfdfda },
    foliage: { color: 0xb9b9b2 },
    trunk: { color: 0xa5a59e },
    rock: { color: 0xc9c9c2 },
    sign: { color: 0xa5a59e },
    signPanel: { color: 0xffffff },
    statue: { color: 0xcfcfc8 },
    person: { color: 0x0f766e },
    markerRaw: { color: 0xca8a04 },
    markerFused: { color: ACCENT, emissiveIntensity: 0 },
    snapRing: { color: ACCENT },
    qrModule: { color: 0xb45309 },
    poi: { color: ACCENT },
    phone: { color: 0x2a2a28 },
    screen: { color: 0xffffff },
    arrow: { color: 0x2563eb },
    label: { color: 0x6d28d9 },
    skyline: { color: 0xb5b5ae },
    grass: { color: 0xacaca4 },
    tent: { color: 0xb8b8b0 },
    ruin: { color: 0xc4c4bd },
    ghost: { color: 0x2563eb },
    satellite: { color: 0x2563eb },
    portal: { color: 0x9a9a92 },
    portalMoss: { color: 0x83837a },
    parkour: { color: 0x15803d },
  },
};

// TERMINAL (easter-egg catalog №4, the hidden 6th palette): near-black
// world with phosphor-green everything EXCEPT the coding colors (amber
// GPS, red anchors, blue AR, teal user) — a retro CRT. Unlocked by
// rapid palette cycling (see secret-palette.ts); never in the normal
// cycle.
const PHOSPHOR = 0x33ff66;
const TERMINAL: ScenePalette = {
  background: 0x030904,
  fog: { color: 0x030904, near: 40, far: 90 },
  hemisphere: { sky: 0x0c3d1c, ground: 0x03150a, intensity: 1.15 },
  directional: { color: 0x3dff77, intensity: 1.0 },
  sky: {
    zenith: 0x020703,
    horizon: 0x08160c,
    accents: "star-grid",
    accentColor: PHOSPHOR,
  },
  portalInterior: { top: PHOSPHOR, bottom: 0x0d2414, clouds: 0x1c4028 },
  particles: { color: PHOSPHOR, style: "dust" },
  roles: {
    ground: { color: 0x0a1c10 },
    path: { color: 0x112c1a },
    hill: { color: 0x0d2414 },
    foliage: { color: 0x123a20 },
    trunk: { color: 0x1a3a24 },
    rock: { color: 0x142c1c },
    sign: { color: 0x1a3a24 },
    signPanel: { color: PHOSPHOR, emissiveIntensity: 0.4 },
    statue: { color: 0x1c4028 },
    person: { color: 0x2dd4bf, emissiveIntensity: 0.7 },
    markerRaw: { color: 0xfacc15, emissiveIntensity: 0.8 },
    markerFused: { color: ACCENT, emissiveIntensity: 1.0 },
    snapRing: { color: ACCENT, emissiveIntensity: 1.0 },
    qrModule: { color: 0xfbbf24, emissiveIntensity: 0.7 },
    poi: { color: ACCENT, emissiveIntensity: 0.9 },
    phone: { color: 0x0a1c10 },
    screen: { color: 0x1c4028, emissiveIntensity: 0.6 },
    arrow: { color: 0x60a5fa, emissiveIntensity: 0.9 },
    label: { color: 0xc084fc, emissiveIntensity: 0.8 },
    skyline: { color: 0x0f2a18, emissiveIntensity: 0.35 },
    grass: { color: 0x123a20 },
    tent: { color: 0x1c4028, emissiveIntensity: 0.3 },
    ruin: { color: 0x184026, emissiveIntensity: 0.3 },
    ghost: { color: 0x60a5fa, emissiveIntensity: 0.9 },
    satellite: { color: PHOSPHOR, emissiveIntensity: 0.7 },
    portal: { color: 0x0d2414, emissiveIntensity: 0.3 },
    portalMoss: { color: 0x123a20, emissiveIntensity: 0.3 },
    parkour: { color: 0x4ade80, emissiveIntensity: 0.5 },
  },
};

// The five cycle palettes + the hidden terminal. Sky blocks (v3 F3) are
// consumed by sky-dome.ts.
const PALETTES: Readonly<Record<Theme, ScenePalette>> = {
  light: LIGHT,
  dark: DARK,
  neon: NEON,
  dusk: DUSK,
  mono: MONO,
  terminal: TERMINAL,
};

export function getPalette(theme: Theme): ScenePalette {
  return PALETTES[theme];
}

function isPaletteRole(value: unknown): value is PaletteRole {
  return (
    typeof value === "string" &&
    (PALETTE_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Recolor every role-tagged mesh under `root` with the given palette.
 * Meshes without a (known) role and non-standard materials are left
 * untouched — bad tags degrade to "keeps previous color", never a crash.
 */
export function applyPaletteToScene(
  root: Object3D,
  palette: ScenePalette,
): void {
  root.traverse((obj) => {
    const role: unknown = obj.userData.paletteRole;
    if (!isPaletteRole(role) || !(obj as Mesh).isMesh) {
      return;
    }
    const material = (obj as Mesh).material;
    if (!(material instanceof MeshStandardMaterial)) {
      return;
    }
    const style = palette.roles[role];
    material.color.setHex(style.color);
    material.emissive.setHex(style.emissive ?? style.color);
    material.emissiveIntensity = style.emissiveIntensity ?? 0;
  });
}

/**
 * Standard factory for a role-tagged clay mesh: flat-shaded standard
 * material (own instance per mesh so palette applies stay independent),
 * shadows on by default.
 */
export function clayMesh(
  geometry: Mesh["geometry"],
  role: PaletteRole,
  name = "",
): Mesh {
  const material = new MeshStandardMaterial({
    roughness: 0.9,
    flatShading: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.userData.paletteRole = role;
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Convenience for a named group (keeps scene-building code terse). */
export function namedGroup(name: string): Group {
  const group = new Group();
  group.name = name;
  return group;
}
