/**
 * A pin's label as every view of a tour draws it: the framework's text
 * sprite on a pill, one recipe for the phone's AR (through `seams.ts`) and
 * the desktop editor's 3D view, so a pin reads the same in both.
 *
 * A canvas wide enough for a short label at a readable size, the sprite
 * scaled to the same 2:1 aspect (the wayfinding HUD's recipe); the text
 * sprite's defaults (a 64 px square, a 48 px glyph) are for single
 * characters and clipped every word. Transparent, no depth write: the
 * pill's surround must not paint a black square over the camera.
 *
 * @see pin-label.ts.md
 */
import type { Object3D } from "three";

import { createTextSprite } from "gps-plus-slam-app-framework/visualization/text-sprite";

/** The label's object and how to free it. */
export function createPinLabel(text: string): {
  object: Object3D;
  dispose(): void;
} {
  const sprite = createTextSprite({
    text,
    background: "pill",
    canvasWidth: 512,
    canvasHeight: 256,
    font: "bold 56px sans-serif",
    transparent: true,
    depthWrite: false,
    scale: { x: 0.6, y: 0.3, z: 1 },
  });
  return { object: sprite.sprite, dispose: () => sprite.dispose() };
}
