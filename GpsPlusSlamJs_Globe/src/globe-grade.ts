/**
 * The globe's colour grade as a named preset: the tone curve and the
 * exposure every pass of the view is graded with. One table, read once
 * when a view is made (a tone curve is compiled into every shader, so a
 * grade does not change under a running view). A page's link picks a name
 * (`?grade=<name>`); `resolveGlobeGrade` judges it.
 *
 * @see globe-grade.ts.md
 */
import * as THREE from "three";

export interface GlobeGrade {
  /** three's tone curve. */
  readonly toneMapping: THREE.ToneMapping;
  /** `renderer.toneMappingExposure`: three's ACES divides it by 0.6. */
  readonly exposure: number;
}

export const GLOBE_GRADES = Object.freeze({
  neutral: Object.freeze({
    toneMapping: THREE.NeutralToneMapping,
    exposure: 1,
  }),
  aces: Object.freeze({
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 0.47,
  }),
  "aces-bright": Object.freeze({
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 0.75,
  }),
  agx: Object.freeze({
    toneMapping: THREE.AgXToneMapping,
    exposure: 1,
  }),
} satisfies Record<string, GlobeGrade>);

export type GlobeGradeName = keyof typeof GLOBE_GRADES;

/** The look a view has when nothing names one. */
export const DEFAULT_GLOBE_GRADE: GlobeGradeName = "aces";

/** The link's parameter: `?grade=<name>`. */
export const GLOBE_GRADE_PARAM = "grade";

const isGradeName = (name: string): name is GlobeGradeName =>
  Object.hasOwn(GLOBE_GRADES, name);

/**
 * The preset a link's name asks for: null (no name in the link) is the
 * default; a name not in the table is the default too, with one warning,
 * so a mistyped link shows the plain globe rather than failing.
 */
export function resolveGlobeGrade(
  name: string | null,
  // eslint-disable-next-line no-console -- the one report of a mistyped link
  warn: (message: string) => void = console.warn,
): GlobeGradeName {
  if (name === null) return DEFAULT_GLOBE_GRADE;
  if (isGradeName(name)) return name;
  warn(
    `unknown globe grade "${name}", using "${DEFAULT_GLOBE_GRADE}" (known: ${Object.keys(GLOBE_GRADES).join(", ")})`,
  );
  return DEFAULT_GLOBE_GRADE;
}

/** Sets the preset on the renderer. RangeError for a name not in the table. */
export function applyGlobeGrade(
  renderer: Pick<THREE.WebGLRenderer, "toneMapping" | "toneMappingExposure">,
  name: GlobeGradeName,
): void {
  if (!isGradeName(name)) {
    throw new RangeError(`unknown globe grade: ${String(name)}`);
  }
  const grade = GLOBE_GRADES[name];
  renderer.toneMapping = grade.toneMapping;
  renderer.toneMappingExposure = grade.exposure;
}
