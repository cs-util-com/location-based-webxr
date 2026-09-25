/**
 * Pointer picking for the demo (view layer).
 *
 * Raycasts the label planes on a click and reports the hit label id + the local
 * UV, which the label turns into a Prev/Next intent via its own `hitTest`. The
 * tap-vs-drag guard and raycast mechanics live in `createPointerTapPicker`
 * (shared with component 1); this module owns only the label `userData`
 * interpretation.
 */
import {
  createPointerTapPicker,
  type PointerTapPickerTargetOptions,
} from "../../shared/pointer-tap-picker.js";
import type { TextLabelUserData } from "./in-world-text.js";

export function createTextInteraction(
  options: PointerTapPickerTargetOptions & {
    readonly onHit: (id: string, uv: { u: number; v: number }) => void;
  },
): { dispose(): void } {
  return createPointerTapPicker({
    ...options,
    onTap: (hit) => {
      if (hit.uv === undefined) {
        return;
      }
      const data = hit.object.userData as Partial<TextLabelUserData>;
      if (data.textLabelId !== undefined) {
        options.onHit(data.textLabelId, { u: hit.uv.x, v: hit.uv.y });
      }
    },
  });
}
