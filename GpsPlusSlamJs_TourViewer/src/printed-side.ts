/**
 * The printed side length's field (`#author-size`), in centimetres
 * (polish round M0b, A15). Every reader works in metres - the pose solve's
 * unit - so the field's text is read and written here and nowhere else.
 *
 * @see printed-side.ts.md
 */

interface SideField {
  value: string;
}

/** The field's size in metres, or NaN when it holds no positive number. */
export function readSideM(field: SideField): number {
  const text = field.value.trim();
  if (text === "") return Number.NaN;
  const cm = Number(text);
  return Number.isFinite(cm) && cm > 0 ? cm / 100 : Number.NaN;
}

/** Show `sizeM` in the field, in centimetres to a tenth. */
export function writeSideM(field: SideField, sizeM: number): void {
  field.value = String(Math.round(sizeM * 1000) / 10);
}
