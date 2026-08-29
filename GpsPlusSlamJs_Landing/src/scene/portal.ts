import {
  BufferAttribute,
  Color,
  BoxGeometry,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  type Group,
  type Object3D,
  type Vector3,
} from "three";
import { clayMesh, namedGroup, type ScenePalette } from "./palette";
import { clamp01 } from "../clamp01.js";
import { smoothstep } from "../smoothstep.js";

/**
 * Forest portal monument (golden-hour rebuild 2026-07-19, replacing the
 * round-14 cyan disc): a weathered rectangular stone frame — near-black
 * green, moss-covered, deterministically jittered so it reads hand-hewn
 * — that STANDS PERMANENTLY between the trees near the tents. Inside it,
 * a brighter warm "other world": an UNLIT, fog-excluded vertex-gradient
 * plane (turquoise sky over a peach horizon) with drifting cloud wisps.
 * Being unlit is the whole trick — the interior is inherently brighter
 * than the lit, shadowed, fogged world, with zero bloom dependency and
 * no neon frame ("a portal that only opens at dawn").
 *
 * The OPEN/CLOSE is a scale pop of the INTERIOR subgroup only, driven by
 * the story timeline (the frame never moves). The interior life —
 * breathing gradient plane, drifting wisps — is TIME-driven only
 * (`updatePortalSpin`), a pure function of the clock: scrub-path
 * independence untouched, run by the continuous-render loop alongside
 * the particles/satellites.
 *
 * Palette: frame = `portal` role, moss = `portalMoss` role (both ride
 * the normal role traversal); the vertex-colored interior cannot, so
 * `applyPortalPalette` paints it from `palette.portalInterior`.
 */

export const PORTAL_NAME = "forest-portal";
export const PORTAL_INTERIOR_NAME = "portal-interior";

// Outer frame ≈ 3.6 × 5.4 world units (4–5× the dot-person, per the
// reference image's monumental scale), members ≈ 0.55 × 0.7 section.
const FRAME_WIDTH = 3.6;
const FRAME_HEIGHT = 5.4;
const MEMBER = 0.55;
const MEMBER_DEPTH = 0.7;

/** Deterministic LCG (same recipe as clay-world/sky-dome) — art, not crypto. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/**
 * The analytic interior gradient: elevation 0 (bottom) → warm
 * `portalInterior.bottom`, elevation 1 (top) → cool `.top`, smoothstep in
 * between (same shape as `domeGradientColorAt`). Exported so tests can
 * pin the paint without sampling vertex buffers.
 */
export function portalInteriorColorAt(
  elevation01: number,
  palette: ScenePalette,
): Color {
  const smooth = smoothstep(clamp01(elevation01));
  return new Color(palette.portalInterior.bottom).lerp(
    new Color(palette.portalInterior.top),
    smooth,
  );
}

/** Weathered frame member: a clay box with deterministic hand-hewn
 * jitter (±~5 % scale, slight tilt) from the shared LCG. */
function frameMember(
  rng: () => number,
  width: number,
  height: number,
  x: number,
  y: number,
): Mesh {
  const member = clayMesh(
    new BoxGeometry(width, height, MEMBER_DEPTH),
    "portal",
  );
  member.position.set(x, y, 0);
  member.scale.set(
    1 + (rng() - 0.5) * 0.1,
    1 + (rng() - 0.5) * 0.06,
    1 + (rng() - 0.5) * 0.12,
  );
  member.rotation.z = (rng() - 0.5) * 0.05;
  return member;
}

/** Moss clump: a squashed low-poly blob snapped to the frame. */
function mossClump(rng: () => number, x: number, y: number, z: number): Mesh {
  const clump = clayMesh(
    new IcosahedronGeometry(0.2 + rng() * 0.16, 0),
    "portalMoss",
  );
  clump.position.set(x, y, z);
  clump.scale.set(1, 0.55 + rng() * 0.2, 0.8);
  clump.rotation.y = rng() * Math.PI;
  return clump;
}

/** The bright other-world interior: gradient plane + drifting wisps,
 * grouped under PORTAL_INTERIOR_NAME and primed closed (scale ~0). */
function buildInterior(rng: () => number): Group {
  const interior = namedGroup(PORTAL_INTERIOR_NAME);

  const plane = new Mesh(
    new PlaneGeometry(
      FRAME_WIDTH - MEMBER * 1.6,
      FRAME_HEIGHT - MEMBER * 1.5,
      1,
      6,
    ),
    new MeshBasicMaterial({ vertexColors: true, fog: false }),
  );
  plane.userData.portalGradient = true;
  plane.userData.pulse = true; // gentle breathing (updatePortalSpin)
  plane.position.y = FRAME_HEIGHT / 2;
  interior.add(plane);

  // Two peach cloud wisps drifting inside the doorway (the reference
  // image's interior clouds, miniaturized).
  for (let i = 0; i < 2; i += 1) {
    const wisp = new Mesh(
      new SphereGeometry(1, 8, 6),
      new MeshBasicMaterial({ fog: false }),
    );
    const size = 0.4 + rng() * 0.25;
    wisp.scale.set(size, size * 0.26, size * 0.4);
    wisp.position.set(
      (rng() - 0.5) * 1.6,
      FRAME_HEIGHT * (0.55 + rng() * 0.25),
      0.12, // just in front of the plane
    );
    wisp.userData.drift = {
      baseX: wisp.position.x,
      amp: 0.2 + rng() * 0.15,
      speed: 0.25 + rng() * 0.2,
      phase: rng() * Math.PI * 2,
    };
    interior.add(wisp);
  }

  interior.scale.setScalar(0.001); // primed closed; the timeline opens it
  return interior;
}

/**
 * Build the portal monument at `anchor` (ground level), facing
 * `faceToward` (the doorway's normal points that way). The frame stands
 * at full scale from the start; only the interior is primed hidden.
 */
export function buildForestPortal(anchor: Vector3, faceToward: Vector3): Group {
  const portal = namedGroup(PORTAL_NAME);
  const rng = createRng(20260719);

  const postX = (FRAME_WIDTH - MEMBER) / 2;
  portal.add(
    // Posts rise from the ground; the lintel overhangs slightly and the
    // sill sits proud — a hand-stacked ancient doorway, not a machined
    // rectangle.
    frameMember(rng, MEMBER, FRAME_HEIGHT, -postX, FRAME_HEIGHT / 2),
    frameMember(rng, MEMBER, FRAME_HEIGHT, postX, FRAME_HEIGHT / 2),
    frameMember(
      rng,
      FRAME_WIDTH + 0.3,
      MEMBER * 1.1,
      0,
      FRAME_HEIGHT - MEMBER / 2,
    ),
    frameMember(rng, FRAME_WIDTH, MEMBER * 0.6, 0, MEMBER * 0.3),
  );

  // Moss: dense on the lintel, a few clumps on the upper posts.
  for (let i = 0; i < 5; i += 1) {
    portal.add(
      mossClump(
        rng,
        (rng() - 0.5) * (FRAME_WIDTH - 0.4),
        FRAME_HEIGHT - MEMBER * 0.2 + rng() * 0.12,
        (rng() - 0.5) * 0.3,
      ),
    );
  }
  for (const side of [-1, 1]) {
    portal.add(
      mossClump(
        rng,
        side * postX,
        FRAME_HEIGHT * (0.6 + rng() * 0.25),
        MEMBER_DEPTH * 0.35,
      ),
    );
  }

  portal.add(buildInterior(rng));

  portal.position.copy(anchor);
  // Face the doorway's +Z normal toward `faceToward` (the camera approach).
  const dir = faceToward.clone().sub(anchor).setY(0);
  portal.rotation.y = Math.atan2(dir.x, dir.z);
  return portal;
}

/**
 * Paint the interior from `palette.portalInterior`: the vertex-color
 * gradient on the plane (bottom→top smoothstep) and the wisp tint.
 * Frame + moss are NOT touched here — they ride the normal
 * `applyPaletteToScene` role traversal. Missing nodes degrade to no-ops.
 */
export function applyPortalPalette(
  portal: Object3D,
  palette: ScenePalette,
): void {
  const interior = portal.getObjectByName(PORTAL_INTERIOR_NAME);
  if (!interior) {
    return;
  }
  for (const child of interior.children) {
    const mesh = child as Mesh;
    if (mesh.userData.portalGradient === true) {
      const geometry = mesh.geometry;
      const positions = geometry.getAttribute("position");
      const box =
        geometry.boundingBox ??
        (geometry.computeBoundingBox(), geometry.boundingBox!);
      const height = Math.max(1e-6, box.max.y - box.min.y);
      const colors = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i += 1) {
        const elevation01 = (positions.getY(i) - box.min.y) / height;
        const color = portalInteriorColorAt(elevation01, palette);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      geometry.setAttribute("color", new BufferAttribute(colors, 3));
    } else if (mesh.userData.drift !== undefined) {
      const material = mesh.material;
      if (material instanceof MeshBasicMaterial) {
        material.color.setHex(palette.portalInterior.clouds);
      }
    }
  }
}

/**
 * Advance the interior's ambient life to the given clock time: a gentle
 * breathing of the gradient plane (0.97–1.03) and slow horizontal wisp
 * drift. Pure in `timeMs` (a permanent animation, independent of
 * scroll) and NEVER touches the interior group's own scale — that
 * belongs to the story timeline's open/close pop. Safe to call every
 * frame (a closed interior just animates invisibly).
 */
export function updatePortalSpin(portal: Object3D, timeMs: number): void {
  const interior = portal.getObjectByName(PORTAL_INTERIOR_NAME);
  if (!interior) {
    return;
  }
  const t = timeMs / 1000;
  for (const child of interior.children) {
    if (child.userData.pulse === true) {
      child.scale.setScalar(1 + Math.sin(t * 0.9) * 0.028);
    }
    const drift = child.userData.drift as
      | { baseX: number; amp: number; speed: number; phase: number }
      | undefined;
    if (drift) {
      child.position.x =
        drift.baseX + Math.sin(t * drift.speed + drift.phase) * drift.amp;
    }
  }
}
