/**
 * Which file of one drop (or one pick) goes where: the model files the
 * editor converts, the parts each may use, the pictures held back until
 * the models are done, the files taken as they are, and the files refused
 * or unknown. Pure: it reads names only.
 *
 * @see import-plan.ts.md
 */
import { importRoleOf } from "./import-formats.js";
import { refusal } from "./model-import-words.js";

export interface PlannedImport {
  /** The index of the model file (a `.gltf`) or the zip. */
  readonly primary: number;
  readonly format: "gltf" | "zip";
  /** The indexes of the drop's loose parts and pictures the model may
   *  name; empty for a zip, which carries its own. */
  readonly parts: readonly number[];
}

export interface ImportPlan {
  readonly imports: readonly PlannedImport[];
  /** Files taken as they are (a `.glb`, a sound, a picture no loose model
   *  could name). */
  readonly plain: readonly number[];
  /** Pictures a loose model may name: added on their own only once every
   *  model of the drop is done and none used them. */
  readonly held: readonly number[];
  readonly refused: readonly {
    readonly index: number;
    readonly reason: string;
  }[];
  /** Files neither the import nor the tour knows. */
  readonly unknown: readonly number[];
}

/** The plan for the files `names` (in drop order; indexes refer to it). */
export function planImport(names: readonly string[]): ImportPlan {
  const roles = names.map((name) => importRoleOf(name));
  const gltf = roles.flatMap((role, i) => (role === "primary" ? [i] : []));
  const loose = gltf.length > 0;
  const parts = roles.flatMap((role, i) =>
    loose && (role === "companion" || role === "picture") ? [i] : [],
  );
  const imports: PlannedImport[] = [];
  const plain: number[] = [];
  const held: number[] = [];
  const refused: { index: number; reason: string }[] = [];
  const unknown: number[] = [];
  roles.forEach((role, i) => {
    const name = names[i]!;
    switch (role) {
      case "primary":
        imports.push({ primary: i, format: "gltf", parts });
        break;
      case "container":
        imports.push({ primary: i, format: "zip", parts: [] });
        break;
      case "companion":
        if (!loose) refused.push({ index: i, reason: loneReason(name) });
        break;
      case "picture":
        (loose ? held : plain).push(i);
        break;
      case "plain":
        plain.push(i);
        break;
      default:
        unknown.push(i);
    }
  });
  return { imports, plain, held, refused, unknown };
}

/** The words for a part dropped without a model that could use it. */
function loneReason(name: string): string {
  return /\.(tga|bmp)$/i.test(name)
    ? refusal.lonePictureKind(name)
    : refusal.loneModelPart(name);
}
