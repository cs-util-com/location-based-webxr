/**
 * Pointer picking for the demo (view layer).
 *
 * Raycasts the billboards' sprite + panel meshes on a click and reports a
 * classified hit: a sprite hit (by id) or a panel hit (by id + the local UV,
 * which panel-layout.ts turns into a toggle/seek intent). The tap-vs-drag guard
 * and raycast mechanics live in `createPointerTapPicker` (shared with
 * component 2); this module owns only the billboard `userData` interpretation.
 */
import {
  createPointerTapPicker,
  type PointerTapPickerTargetOptions,
} from './pointer-tap-picker.js';
import type { BillboardUserData } from './clickable-billboard.js';

export function createBillboardInteraction(
  options: PointerTapPickerTargetOptions & {
    readonly onSpriteClick: (id: string) => void;
    readonly onPanelHit: (id: string, uv: { u: number; v: number }) => void;
  }
): { dispose(): void } {
  return createPointerTapPicker({
    ...options,
    onTap: (hit) => {
      const data = hit.object.userData as Partial<BillboardUserData>;
      if (data.billboardId === undefined) {
        return;
      }
      if (data.role === 'sprite') {
        options.onSpriteClick(data.billboardId);
      } else if (data.role === 'panel' && hit.uv) {
        options.onPanelHit(data.billboardId, { u: hit.uv.x, v: hit.uv.y });
      }
    },
  });
}
