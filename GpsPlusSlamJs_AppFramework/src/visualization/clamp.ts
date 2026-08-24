/** Clamp a value into the inclusive [0, 1] range. Shared across components:
 * the panel-layout seek mapping and the transport reducer's `seek` action
 * (component 1), and the in-world-text sizing math (component 2). */
export function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
