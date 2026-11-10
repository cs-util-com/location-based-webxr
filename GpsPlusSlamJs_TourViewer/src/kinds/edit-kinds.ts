/**
 * The editor's list of kinds: one row per kind of the format
 * (`TOUR_KINDS`), saying everything the creator pages and the desktop
 * editor know of it - its words, its look (the icon and the style the
 * pages draw it with), the words a search finds it by, its text fields,
 * and whether and how it is added. Whether and how a block stands in the
 * world is its view's, not its kind's (`placement/placement-rows.ts`).
 * Keyed by the format's kind type, so a kind the format gains and this
 * list lacks is a compile error here. Pure data; the pages derive their
 * menus, rows and words from it.
 *
 * @see edit-kinds.ts.md
 */
import {
  TOUR_AUDIO_MAX_RADIUS_M,
  TOUR_AUDIO_MAX_REACH_M,
  TOUR_AUDIO_MIN_RADIUS_M,
  TOUR_AUDIO_MIN_REACH_M,
  type TourBlockKind,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";

/** A number a field takes: the format's bounds, its unit, and whether the
 *  views it shows in need it. */
interface NumberSpec {
  readonly min: number;
  readonly max: number;
  /** Shown beside the box ("m"; "" for none). */
  readonly unit: string;
  readonly required: boolean;
}

/** One field of a kind, as the inspector draws it. */
export interface FieldSpec {
  /** The block's own field (`data-field` in the inspector). */
  readonly name: string;
  readonly label: string;
  /** Prose: a text area that keeps its lines, else one line. */
  readonly prose: boolean;
  /** A number, not a text (`block-fields.ts` reads the typed decimal). */
  readonly number?: NumberSpec;
  /** Only in these views (the ones that read it); none: in every view. */
  readonly views?: readonly string[];
}

/** How a kind is added from nothing: its line in the tree's type menu (and,
 *  addable, in the Ctrl+K palette). */
interface KindAdd {
  readonly label: string;
  /** What it is, or for one that is off, why. */
  readonly hint: string;
  /** The words a search for it matches (its label among them). */
  readonly words: string;
  /** Off: listed, said why, and adds nothing. */
  readonly addable: boolean;
  /** Made from a file of this kind: the add opens the file picker, and
   *  the file goes onto the asset shelf (`add-file-item.ts`). */
  readonly file?: TourAssetKind;
  /** Added to a story only, and why (shown on a station's menu, where it
   *  is off): no free host draws it. */
  readonly storyOnly?: string;
}

/** What the editor knows of one kind. */
export interface KindEditRow {
  /** The one word every creator page uses for it: what a block without a
   *  text of its own is called, the inspector's kind line, the lists' and
   *  the rail's second line. */
  readonly label: string;
  /** The article its word takes in a sentence ("an audio"). */
  readonly article: "a" | "an";
  /** What a sentence calls one that has no text of its own ("The reading
   *  stand left its station's circle"), lower case. */
  readonly thing: string;
  /** Its look: the shell icon, the style class and the tree row's kind,
   *  one word per kind. */
  readonly look: string;
  /** The words the tree's search finds it by besides its name. */
  readonly searchWords: string;
  /** Its text fields in the inspector's order, besides a short text's
   *  caption, which the head types (`block-fields.ts`). */
  readonly fields: readonly FieldSpec[];
  /** Listed in the add menu; none: not offered at all. */
  readonly add?: KindAdd;
}

const TITLE = { name: "title", label: "Title", prose: false } as const;
const TRANSCRIPT = {
  name: "transcript",
  label: "Transcript",
  prose: true,
} as const;

/** A sound's world fields, each in the view that reads it, bounded as
 *  the format bounds them (`tour-kinds.ts` `audioWorld`). */
const AUDIO_WORLD: readonly FieldSpec[] = [
  {
    name: "radiusM",
    label: "Radius",
    prose: false,
    views: ["spot"],
    number: {
      min: TOUR_AUDIO_MIN_RADIUS_M,
      max: TOUR_AUDIO_MAX_RADIUS_M,
      unit: "m",
      required: true,
    },
  },
  {
    name: "maxM",
    label: "Reach",
    prose: false,
    views: ["zone"],
    number: {
      min: TOUR_AUDIO_MIN_REACH_M,
      max: TOUR_AUDIO_MAX_REACH_M,
      unit: "m",
      required: true,
    },
  },
  {
    name: "minM",
    label: "Full volume within",
    prose: false,
    views: ["zone"],
    number: {
      min: TOUR_AUDIO_MIN_REACH_M,
      max: TOUR_AUDIO_MAX_REACH_M,
      unit: "m",
      required: false,
    },
  },
  {
    name: "volume",
    label: "Volume",
    prose: false,
    views: ["zone"],
    number: { min: 0, max: 1, unit: "", required: true },
  },
];

/** THE list. Key order is the order of every derived menu. */
export const KIND_EDIT = {
  shortText: {
    label: "Pin",
    article: "a",
    thing: "pin",
    look: "pin",
    searchWords: "pin note short text",
    fields: [{ name: "description", label: "Description", prose: true }],
    add: {
      label: "Short text",
      hint: "A pin with a caption",
      words: "short text pin caption label note",
      addable: true,
    },
  },
  longText: {
    label: "Long text",
    article: "a",
    thing: "reading stand",
    look: "text",
    searchWords: "long text reading sign",
    fields: [TITLE, { name: "body", label: "Body", prose: true }],
    add: {
      label: "Long text",
      hint: "A reading sign: a title and its text",
      words: "long text reading sign article body",
      addable: true,
    },
  },
  picture: {
    label: "Photo",
    article: "a",
    thing: "photo",
    look: "photo",
    searchWords: "photo note picture",
    fields: [
      TITLE,
      { name: "caption", label: "Caption", prose: true },
      { name: "alt", label: "Alt text", prose: true },
    ],
    add: {
      label: "Picture",
      hint: "A picture file, shown as a plane",
      words: "picture photo image",
      addable: true,
      file: "image",
    },
  },
  video: {
    label: "Video",
    article: "a",
    thing: "video",
    look: "video",
    searchWords: "video film",
    fields: [TITLE, TRANSCRIPT],
    add: {
      label: "Video",
      hint: "A video file, played in a story",
      words: "video film clip movie",
      addable: true,
      file: "video",
      storyOnly: "A video plays in a story: add it to one",
    },
  },
  audio: {
    label: "Audio",
    article: "an",
    thing: "sound",
    look: "audio",
    searchWords: "audio sound",
    fields: [TITLE, TRANSCRIPT, ...AUDIO_WORLD],
    add: {
      label: "Sound",
      hint: "A sound file, heard in a circle",
      words: "sound audio voice music narration",
      addable: true,
      file: "audio",
    },
  },
  model: {
    label: "3D model",
    article: "a",
    thing: "3D model",
    look: "model",
    searchWords: "3d model",
    fields: [TITLE],
    add: {
      label: "3D model",
      hint: "A .glb file, placed at 2 m",
      words: "3d model glb object",
      addable: true,
      file: "model",
    },
  },
  character: {
    label: "Character",
    article: "a",
    thing: "character",
    look: "character",
    searchWords: "character figure guide",
    fields: [
      { name: "name", label: "Name", prose: false },
      { name: "caption", label: "Caption", prose: true },
    ],
  },
} as const satisfies { readonly [K in TourBlockKind]: KindEditRow };

type Rows = typeof KIND_EDIT;

/** A kind's look ({@link KindEditRow.look}). */
export type KindLook = Rows[TourBlockKind]["look"];

/** The kinds the editor can make from nothing. */
export type AddKind = {
  [K in TourBlockKind]: Rows[K] extends {
    readonly add: { readonly addable: true };
  }
    ? K
    : never;
}[TourBlockKind];

/** The addable kinds made from a file (`KindAdd.file`). */
export type FileAddKind = {
  [K in AddKind]: Rows[K] extends { readonly add: { readonly file: string } }
    ? K
    : never;
}[AddKind];

/** The addable kinds made from nothing but words: a short or long text. */
export type TextAddKind = Exclude<AddKind, FileAddKind>;

/** Whether `kind` is made from a file. */
export function isFileAddKind(kind: AddKind): kind is FileAddKind {
  const add: KindAdd = KIND_EDIT[kind].add;
  return add.file !== undefined;
}

/** Why `kind` is added to a story only (`KindAdd.storyOnly`), or
 *  undefined for a kind that also stands at a station. */
export function storyOnlyReason(kind: TourBlockKind): string | undefined {
  const row: KindEditRow = KIND_EDIT[kind];
  return row.add?.storyOnly;
}

/** Whether `kind` is added to a story only (`KindAdd.storyOnly`). */
export function isStoryOnly(kind: TourBlockKind): boolean {
  return storyOnlyReason(kind) !== undefined;
}

/** A kind's word inside a sentence ("the delete of the long text"): its
 *  label with the first letter lower-cased ("3D" kept). */
export function kindNoun(kind: TourBlockKind): string {
  const label: string = KIND_EDIT[kind].label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Its word with its article: "a pin", "an audio". */
export function kindWithArticle(kind: TourBlockKind): string {
  return `${KIND_EDIT[kind].article} ${kindNoun(kind)}`;
}

/** One line of the add menu: a kind its row lists. */
export interface AddChoice extends KindAdd {
  readonly kind: TourBlockKind;
  readonly look: KindLook;
}

/** The add menu's kinds, in the list's order: every row with an `add`. */
export const ADD_CHOICES: readonly AddChoice[] = (
  Object.keys(KIND_EDIT) as TourBlockKind[]
).flatMap((kind) => {
  const row: KindEditRow = KIND_EDIT[kind];
  return row.add === undefined
    ? []
    : [{ ...row.add, kind, look: KIND_EDIT[kind].look }];
});

/** Whether `choice` adds (a kind the editor can make from nothing). */
export function isAddable(
  choice: AddChoice,
): choice is AddChoice & { readonly kind: AddKind } {
  return choice.addable;
}
