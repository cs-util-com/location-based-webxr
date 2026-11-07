/**
 * The editor's list of kinds: one row per kind of the format
 * (`TOUR_KINDS`), saying everything the creator pages and the desktop
 * editor know of it - its words, its look (the icon and the style the
 * pages draw it with), the words a search finds it by, whether the editor
 * draws it in the world, its text fields, and whether and how it is added.
 * Keyed by the format's kind type, so a kind the format gains and this
 * list lacks is a compile error here. Pure data; the pages derive their
 * menus, rows and words from it.
 *
 * @see edit-kinds.ts.md
 */
import type { TourBlockKind } from "gps-plus-slam-app-framework/ar/tour-kinds";

/** One text field of a kind, as the inspector draws it. */
export interface FieldSpec {
  /** The block's own field (`data-field` in the inspector). */
  readonly name: string;
  readonly label: string;
  /** Prose: a text area that keeps its lines, else one line. */
  readonly prose: boolean;
}

/** How a kind is added from nothing: its line in the tree's type menu (and,
 *  addable, in the Ctrl+K palette). */
export interface KindAdd {
  readonly label: string;
  /** What it is, or for one that is off, why. */
  readonly hint: string;
  /** The words a search for it matches (its label among them). */
  readonly words: string;
  /** Off: listed, said why, and adds nothing. */
  readonly addable: boolean;
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
  /** The editor draws and edits it in the world (`worldBlocks`); one that
   *  is not stands in the tree and its inspector alone, and a write keeps
   *  it untouched. */
  readonly inWorld: boolean;
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

/** THE list. Key order is the order of every derived menu. */
export const KIND_EDIT = {
  shortText: {
    label: "Pin",
    article: "a",
    thing: "pin",
    look: "pin",
    searchWords: "pin note short text",
    inWorld: true,
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
    inWorld: true,
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
    inWorld: true,
    fields: [
      TITLE,
      { name: "caption", label: "Caption", prose: true },
      { name: "alt", label: "Alt text", prose: true },
    ],
    add: {
      label: "Picture",
      hint: "Taken on site with the phone",
      words: "picture photo image",
      addable: false,
    },
  },
  video: {
    label: "Video",
    article: "a",
    thing: "video",
    look: "video",
    searchWords: "video film",
    inWorld: false,
    fields: [TITLE, TRANSCRIPT],
  },
  audio: {
    label: "Audio",
    article: "an",
    thing: "sound",
    look: "audio",
    searchWords: "audio sound",
    inWorld: false,
    fields: [TITLE, TRANSCRIPT],
  },
  model: {
    label: "3D model",
    article: "a",
    thing: "3D model",
    look: "model",
    searchWords: "3d model",
    inWorld: true,
    fields: [TITLE],
  },
  character: {
    label: "Character",
    article: "a",
    thing: "character",
    look: "character",
    searchWords: "character figure guide",
    inWorld: false,
    fields: [
      { name: "name", label: "Name", prose: false },
      { name: "caption", label: "Caption", prose: true },
    ],
  },
} as const satisfies { readonly [K in TourBlockKind]: KindEditRow };

type Rows = typeof KIND_EDIT;

/** A kind's look ({@link KindEditRow.look}). */
export type KindLook = Rows[TourBlockKind]["look"];

/** The kinds the editor draws and edits in the world. */
export type WorldKind = {
  [K in TourBlockKind]: Rows[K]["inWorld"] extends true ? K : never;
}[TourBlockKind];

/** The kinds the editor can make from nothing. */
export type AddKind = {
  [K in TourBlockKind]: Rows[K] extends {
    readonly add: { readonly addable: true };
  }
    ? K
    : never;
}[TourBlockKind];

/** Whether the editor draws and edits `kind` in the world. */
export function isWorldKind(kind: TourBlockKind): kind is WorldKind {
  return KIND_EDIT[kind].inWorld;
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
