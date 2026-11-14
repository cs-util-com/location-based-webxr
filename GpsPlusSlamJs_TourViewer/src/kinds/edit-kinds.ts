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
  TOUR_VIDEO_MAX_WITHIN_M,
  TOUR_VIDEO_MIN_WITHIN_M,
  type TourBlockKind,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  TOUR_GROUND_MAX_BEND_DEG,
  TOUR_SHORT_TEXT_MAX_READ_AT_M,
  TOUR_SHORT_TEXT_MIN_READ_AT_M,
} from "gps-plus-slam-app-framework/ar/tour-short-text";

/** A number a field takes: the format's bounds, its unit, and whether the
 *  views it shows in need it. */
interface NumberSpec {
  /** The bounds, in what the box shows. */
  readonly min: number;
  readonly max: number;
  /** Shown beside the box ("m"; "" for none). */
  readonly unit: string;
  readonly required: boolean;
  /** The box shows `scale` times what the file holds (a volume of 0.5 is
   *  50 %); none: as the file holds it. */
  readonly scale?: number;
  /** A slider beside the box over the values set by feel, in what the box
   *  shows; the box takes the rest of the bounds. */
  readonly slider?: {
    readonly min: number;
    readonly max: number;
    readonly step: number;
  };
  /** The field this slider shares its track with as the lower thumb: one
   *  track, two thumbs that never cross. */
  readonly low?: string;
  /** Drawn under it: the zone's loudness over distance. */
  readonly curve?: "loudness";
}

/** A short text's roles, as its panel offers them. */
const SHORT_TEXT_ROLES: readonly FieldChoice[] = [
  { value: "instruction", label: "Instruction" },
  { value: "label", label: "Label" },
  { value: "warning", label: "Warning" },
];

/** How a sign turns, as its panel offers it. */
const SHORT_TEXT_TURNS: readonly FieldChoice[] = [
  { value: "world", label: "Fixed" },
  { value: "upright", label: "Upright" },
  { value: "face", label: "Faces you" },
];

/** How a short text shows, by the words a creator reads (its views
 *  with a world look; the card has no chip). */
export const SHORT_TEXT_VIEWS: readonly FieldChoice[] = [
  { value: "pin", label: "Pin" },
  { value: "sign", label: "Sign" },
  { value: "edgeHint", label: "Edge hint" },
  { value: "ground", label: "Ground arrow" },
];

/** A ground arrow's styles, as its panel offers them. */
const GROUND_STYLES: readonly FieldChoice[] = [
  { value: "ribbon", label: "Ribbon" },
  { value: "vanes", label: "Vanes" },
  { value: "footprints", label: "Footprints" },
  { value: "lights", label: "Lights" },
  { value: "floor", label: "Floor arrow" },
];

/** How a floor arrow lies, as its panel offers it. */
const GROUND_FLOOR_PLACEMENTS: readonly FieldChoice[] = [
  { value: "lying", label: "Lying" },
  { value: "hovering", label: "Hovering" },
  { value: "upright", label: "Upright" },
];

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
  /** One of these values, chosen on the kind's panel's chips rather than
   *  typed (none: typed). */
  readonly choices?: readonly FieldChoice[];
  /** A switch on the kind's panel: written as true, or left out (its
   *  reader's default, off). */
  readonly flag?: true;
  /** A colour (`#rrggbb`) picked on the kind's panel, or left out (its
   *  reader's default). */
  readonly colour?: true;
  /** A value typed on one line that the format's look reader checks: a
   *  point as three numbers in metres, or a language tag. */
  readonly typed?: "point" | "tag";
  /** One of a few values, set by chips the kind's panel draws
   *  (`editor/kind-panels`), not a box the dock types: unlike `choices`,
   *  an absent field reads as its `fallback`, so the chip in use is
   *  always pressed and pressing it again writes nothing. */
  readonly choice?: ChoiceSpec;
  /** Only while another of the block's choices has this value (its
   *  fallback counted for an absent one): a setting that does nothing
   *  otherwise is not shown, and not written. */
  readonly when?: { readonly field: string; readonly value: string };
}

/** One value a choice field takes, and its chip's words. */
export interface FieldChoice {
  readonly value: string;
  readonly label: string;
}

/** The values a choice field takes, in the creator's words, and what an
 *  absent one means. */
export interface ChoiceSpec {
  readonly values: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  /** The value a block without the field has. */
  readonly fallback: string;
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

/** The reach's track, its two thumbs the full volume's edge and the
 *  reach (m). */
const REACH_SLIDER = { min: 1, max: 60, step: 1 } as const;

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
      slider: { min: 2, max: 15, step: 0.5 },
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
      slider: REACH_SLIDER,
      low: "minM",
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
    number: {
      min: 0,
      max: 100,
      unit: "%",
      required: true,
      scale: 100,
      slider: { min: 0, max: 100, step: 1 },
      curve: "loudness",
    },
  },
];

/** The views a free video stands in the world in. */
const VIDEO_WORLD_VIEWS = ["screen", "cutout", "porthole"];

/** What starts a video in the world (`TOUR_VIDEO_STARTS`); absent: on
 *  arrival, as the viewer reads it. */
const VIDEO_START: FieldSpec = {
  name: "start",
  label: "Starts",
  prose: false,
  views: VIDEO_WORLD_VIEWS,
  choice: {
    values: [
      { value: "enter", label: "On arrival" },
      { value: "near", label: "When near" },
      { value: "look", label: "When looked at" },
      { value: "tap", label: "On a tap" },
    ],
    fallback: "enter",
  },
};

/** Whether a video starts with its sound (`TOUR_VIDEO_SOUNDS`); the
 *  visitor's own choice wins over it. Absent: off. */
const VIDEO_SOUND: FieldSpec = {
  name: "sound",
  label: "Sound",
  prose: false,
  views: VIDEO_WORLD_VIEWS,
  choice: {
    values: [
      { value: "off", label: "Starts muted" },
      { value: "on", label: "Starts with sound" },
    ],
    fallback: "off",
  },
};

/** A cutout's clip: as filmed, or its matte stacked under the picture
 *  (`TOUR_VIDEO_ALPHAS`). Absent: as filmed. */
const VIDEO_ALPHA: FieldSpec = {
  name: "alpha",
  label: "Background",
  prose: false,
  views: ["cutout"],
  choice: {
    values: [
      { value: "none", label: "As filmed" },
      { value: "stacked", label: "Stacked alpha" },
    ],
    fallback: "none",
  },
};

/** A video's `near` start distance, in the views that stand it in the
 *  world, bounded as the format bounds it (`tour-kinds.ts`). */
const VIDEO_NEAR: FieldSpec = {
  name: "withinM",
  label: "Starts within",
  prose: false,
  views: VIDEO_WORLD_VIEWS,
  when: { field: "start", value: "near" },
  number: {
    min: TOUR_VIDEO_MIN_WITHIN_M,
    max: TOUR_VIDEO_MAX_WITHIN_M,
    unit: "m",
    required: false,
  },
};

/** Whether a video plays again when it ends (`TOUR_VIDEO_LOOPS`); its
 *  panel draws it as a switch. Absent: off. */
const VIDEO_LOOP: FieldSpec = {
  name: "loop",
  label: "Loop",
  prose: false,
  views: VIDEO_WORLD_VIEWS,
  choice: {
    values: [
      { value: "off", label: "Plays once" },
      { value: "on", label: "Loops" },
    ],
    fallback: "off",
  },
};

/** A video's captions in the world, WebVTT text the visitor's player
 *  shows; its panel says how many cues it read and which lines it left
 *  out. */
const VIDEO_CAPTIONS: FieldSpec = {
  name: "captions",
  label: "Captions (WebVTT)",
  prose: true,
  views: VIDEO_WORLD_VIEWS,
};

/** THE list. Key order is the order of every derived menu. */
export const KIND_EDIT = {
  shortText: {
    label: "Pin",
    article: "a",
    thing: "pin",
    look: "pin",
    searchWords: "pin note short text",
    fields: [
      { name: "description", label: "Description", prose: true },
      {
        name: "readAtM",
        label: "Reads at",
        prose: false,
        number: {
          min: TOUR_SHORT_TEXT_MIN_READ_AT_M,
          max: TOUR_SHORT_TEXT_MAX_READ_AT_M,
          unit: "m",
          required: false,
        },
        views: ["sign", "ground"],
      },
      { name: "role", label: "Role", prose: false, choices: SHORT_TEXT_ROLES },
      {
        name: "orientation",
        label: "Turns",
        prose: false,
        choices: SHORT_TEXT_TURNS,
        views: ["sign", "ground"],
      },
      {
        name: "pointsTo",
        label: "Points to",
        prose: false,
        typed: "point",
        views: ["sign", "ground"],
      },
      { name: "lang", label: "Language", prose: false, typed: "tag" },
      {
        name: "style",
        label: "Ground style",
        prose: false,
        choices: GROUND_STYLES,
        views: ["ground"],
      },
      {
        name: "bendDeg",
        label: "Bend",
        prose: false,
        number: {
          min: -TOUR_GROUND_MAX_BEND_DEG,
          max: TOUR_GROUND_MAX_BEND_DEG,
          unit: "°",
          required: false,
        },
        views: ["ground"],
      },
      {
        name: "floorPlacement",
        label: "Floor arrow",
        prose: false,
        choices: GROUND_FLOOR_PLACEMENTS,
        views: ["ground"],
      },
      {
        name: "captionOnArrow",
        label: "Caption on the arrow",
        prose: false,
        flag: true,
        views: ["ground"],
      },
      {
        name: "color",
        label: "Colour",
        prose: false,
        colour: true,
        views: ["ground"],
      },
      {
        name: "darkColor",
        label: "Dark colour",
        prose: false,
        colour: true,
        views: ["ground"],
      },
    ],
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
      { name: "credit", label: "Credit", prose: false },
      { name: "year", label: "Year", prose: false },
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
    fields: [
      TITLE,
      TRANSCRIPT,
      VIDEO_CAPTIONS,
      VIDEO_START,
      VIDEO_NEAR,
      VIDEO_SOUND,
      VIDEO_LOOP,
      VIDEO_ALPHA,
    ],
    add: {
      label: "Video",
      hint: "A video file, shown as a screen",
      words: "video film clip movie",
      addable: true,
      file: "video",
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

/** A kind's word inside a sentence ("the delete of the long text"): its
 *  label with the first letter lower-cased ("3D" kept). */
export function kindNoun(kind: TourBlockKind): string {
  const label: string = KIND_EDIT[kind].label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** What a block is called in the inspector's head: its kind's label,
 *  or for a short text the view it shows as ("Sign", "Edge hint"). */
export function blockLabel(block: {
  readonly kind: TourBlockKind;
  readonly view: string;
}): string {
  if (block.kind === "shortText") {
    const view = SHORT_TEXT_VIEWS.find((v) => v.value === block.view);
    if (view !== undefined) return view.label;
  }
  return KIND_EDIT[block.kind].label;
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
