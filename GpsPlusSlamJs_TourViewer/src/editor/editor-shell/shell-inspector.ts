/**
 * The 3D view's inspector dock, drawn from its model
 * (`inspector-model.ts`): the selection's name, what it is, its fields,
 * and the position folded away under a disclosure (a station's "Place",
 * its radius first, a slider beside its number (`radius-slider.ts`); an
 * item's "Position"), a station's items under its Contents
 * (`inspector-contents.ts`). A story shows its Entries, a story's block its
 * texts and how it moves on, a choice or a quiz a summary, an item with no
 * place in the world (a video) its texts, each with its Delete. Text only,
 * never markup.
 *
 * The fields a creator types carry `data-field` (a station's `title` and
 * `description`, labelled Name and Description at the top of the body, the
 * head showing the name as text (AU-2: a borderless name in the head read
 * as a heading); its `radius`, `east`, `north` and `heading`; a pin's `title`
 * (its text); an item's `east`, `north`, `height`, `heading` and a
 * model's `size`; a plain folder's `scale` and, under its Place, its
 * `east`, `north`, `height` and `heading`), each drawn with the tour's
 * value as its default, so
 * the shell commits a field only when its text differs; a locked
 * station's place and heading are read-only. The rest are `<output>`s.
 * Every value is tied to its label, so a screen reader reads the two
 * together.
 *
 * The buttons carry `data-act`, and the shell answers them: the head's
 * fold and close (`fold`, `close`), the disclosures (`position`,
 * `contents`), Contents' rows and its add (`goto:<id>`, `add-content`), a
 * station's lock beside its Place (`lock`, pressed while locked), its
 * Earlier and Later beside its place in the tour (`earlier`, `later`, off
 * at the ends), the card picture's choices (`image:<id>`, the shown one
 * pressed), and the selection's commands in words: a station's
 * `ground-items` and `delete`, its own `ground` under Place; an item's
 * `split` ("Move to a new station"), `ground` and `delete`; a story's
 * `add-entry` and `delete`; a story block's `entry-advance:<id>:<mode>` -
 * Delete last, behind a separator. A command the
 * shell is running (`busy`) shows as waiting.
 *
 * A kind's own part of an item (a long text's title, buttons and writer,
 * a model's size, view, notes and sections) is its panel's
 * (`../kind-panels/kind-panel.ts`), handed in as a `KindPanelDraw` and
 * placed without naming the kind: its title in the head, its head
 * buttons before the fold, its kept node under the head (kept in the
 * page across draws, so a writer's focus, selection and undo survive
 * them) and its parts after the item's fields.
 *
 * @see shell-inspector.ts.md
 */
import type { ShellPictures } from "./shell-pictures.js";
import { FREE_LIST } from "../../station-children-moves.js";
import { shellIcon, type ShellIcon } from "gps-plus-slam-editor-kit/chrome";
import { fileFieldPart } from "./inspector-file.js";
import {
  TOUR_STORY_TITLE_RULE,
  type TourStepAdvance,
} from "gps-plus-slam-app-framework/ar/tour-story";
import { KIND_EDIT, kindNoun } from "../../kinds/edit-kinds.js";
import {
  CHARACTER_VIEW_CHOICES,
  ON_GROUND_M,
  type InspectorCharacter,
  type InspectorExtent,
  type InspectorModel,
  type InspectorPosition,
} from "./inspector-model.js";
import {
  chipGroup,
  el,
  fieldId,
  fixed,
  iconButton,
  labelled,
  lineField,
  numberBox,
  numberField,
  severalLines,
  typed,
} from "./inspector-fields.js";
import type { KindPanelDraw } from "../kind-panels/kind-panel.js";
import {
  contentsBody,
  contentsSummary,
  entriesList,
} from "./inspector-contents.js";
import { radiusRange } from "./radius-slider.js";
import { wirePinTextCounter, wireTextCounter } from "../../pin-text.js";
import { blockFieldPlaceholder, type BlockField } from "../block-fields.js";

/** A read-only number: its label and its value (with a unit). */
function readOnlyNumber(label: string, value: string, unit = ""): HTMLElement {
  const box = el("div", "num ro");
  const out = el("output", "val", value);
  box.append(out);
  if (unit !== "") box.append(el("span", "unit", unit));
  return labelled(label, out, box);
}

/** Why a pin's text of several lines is read-only in the head, said on a
 *  line of the dock (a title never shows on a touch screen). */
const PIN_LINES =
  "This text has several lines, which this one-line field cannot keep: edit it in the pin's card on the 2D map.";

/** The id of that line, which the head's field is described by. */
const PIN_LINES_ID = "inspector-pin-lines";

/** The id of a typed pin text's count, which the field names. */
const PIN_COUNT_ID = "inspector-pin-count";

/** Prose to type, named `field`: a text area, which keeps line breaks
 *  (Enter starts a new line there; the shell writes it when it is left).
 *  Its default is the tour's value with its line ends as a text area
 *  reads them (one character each), so an untouched one reads as
 *  untyped. */
function proseField(
  label: string,
  field: string,
  value: string,
  placeholder: string,
): HTMLElement {
  const area = el("textarea", "tfield");
  // Three lines to start with, a box to write in (AU-2); it grows with
  // its text (`field-sizing` in the stylesheet).
  area.rows = 3;
  area.spellcheck = false;
  area.autocomplete = "off";
  area.dataset["field"] = field;
  area.placeholder = placeholder;
  area.defaultValue = value.replace(/\r\n?/g, "\n");
  const row = labelled(label, area);
  row.classList.add("top");
  return row;
}

function readOnlyText(label: string, value: string): HTMLElement {
  const row = labelled(label, el("output", "ro-text", value));
  row.classList.add("top");
  return row;
}

/** One axis of a vector field: its letter, its name, its field and its
 *  value. */
type Axis = readonly [axis: string, name: string, field: string, value: string];

/** A vector's axes in one row: the row's label names the group, and each
 *  axis is named by it ("Offset east"). */
function vectorField(
  label: string,
  axes: readonly Axis[],
  unit: string,
  locked = false,
): HTMLElement {
  const row = el("div", "f");
  const tag = el("span", "flabel", label);
  tag.id = fieldId();
  const vec = el("div", `vec n${String(axes.length)}`);
  vec.setAttribute("role", "group");
  vec.setAttribute("aria-labelledby", tag.id);
  for (const [axis, name, field, value] of axes) {
    const { box, input } = numberBox(field, value, unit, locked, axis);
    input.setAttribute("aria-label", `${label} ${name}`);
    vec.append(box);
  }
  row.append(tag, vec);
  return row;
}

function headingText(deg: number | null): string {
  return deg === null ? "-" : fixed(deg, 1);
}

/** The folded position's one-line summary. */
function positionSummary(p: InspectorPosition): string {
  const heading =
    p.headingDeg === null ? "" : `  ${fixed(p.headingDeg, 0)} deg`;
  return `E ${fixed(p.eastM, 1)}  N ${fixed(p.northM, 1)}${heading}`;
}

/** The disclosure's button, and its fields when open (made only then);
 *  a station's is "Place" (its radius with its position), an item's
 *  "Position". */
function disclosure(
  open: boolean,
  summary: string,
  fields: () => readonly HTMLElement[],
  heading: {
    readonly label: string;
    readonly title: string;
    /** Its `data-act`, and its body's class; the position's by default. */
    readonly act?: string;
    readonly body?: string;
  } = {
    label: "Position",
    title: "Exact position and heading",
  },
): HTMLElement[] {
  const b = el("button", "disc");
  b.type = "button";
  b.dataset["act"] = heading.act ?? "position";
  b.classList.toggle("open", open);
  b.setAttribute("aria-expanded", String(open));
  b.title = heading.title;
  b.append(
    shellIcon("right"),
    el("span", "lab", heading.label),
    el("span", "sum", summary),
  );
  if (!open) return [b];
  const body = el("div", heading.body ?? "pos");
  body.append(...fields());
  return [b, body];
}

/** A station's position lock: pressed while locked. */
function lockButton(locked: boolean): HTMLButtonElement {
  const label = locked
    ? "Unlock the position (to move or turn the station)"
    : "Lock the position";
  const b = iconButton(locked ? "lock" : "unlock", label, "lock");
  b.classList.add("lock");
  b.classList.toggle("on", locked);
  b.setAttribute("aria-pressed", String(locked));
  return b;
}

/** A block's field to type (`block-fields.ts`): a text with its count
 *  against the format's cap under it as it is typed, or a number in a
 *  decimal box with its unit (the format's bounds refuse on the write). */
function blockTextField(field: BlockField): HTMLElement[] {
  const hint = blockFieldPlaceholder(field);
  if (field.number !== undefined) {
    const row = numberField(
      field.label,
      field.name,
      field.value,
      field.number.unit,
    );
    row.querySelector("input")?.setAttribute("placeholder", hint);
    return [row];
  }
  const row = field.prose
    ? proseField(field.label, field.name, field.value, hint)
    : lineField(field.label, field.name, field.value, hint);
  const input = row.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );
  const count = el("output", "note count");
  if (input !== null) {
    count.id = `${input.id}-count`;
    input.setAttribute("aria-describedby", count.id);
    wireTextCounter(input, count, field.max, field.unit);
  }
  return [row, count];
}

/** The page's Delete key, as the command shows and announces it. */
const DELETE_KEY = { shown: "Del", aria: "Delete" } as const;

/** What a command waiting for the ground says. */
const WAITING = "Waiting for the ground...";

/** A command of the selection in words (`data-act` names it), its key
 *  shown and announced when it has one, a short note beside it; while
 *  `busy` names it, it waits and takes no press (`aria-disabled`, not
 *  `disabled`: the button keeps the keyboard's focus while it waits, and
 *  the shell ignores its presses). */
function action(
  act: string,
  icon: ShellIcon,
  label: string,
  options: {
    readonly key?: { readonly shown: string; readonly aria: string };
    readonly note?: string;
    readonly disabled?: boolean;
    readonly busy?: string | null | undefined;
  } = {},
): HTMLButtonElement {
  const b = el("button", act === "delete" ? "act danger" : "act");
  b.type = "button";
  b.dataset["act"] = act;
  const waiting = options.busy === act;
  b.append(shellIcon(icon), el("span", "lbl", waiting ? WAITING : label));
  if (options.note !== undefined && options.note !== "" && !waiting) {
    b.append(el("span", "note", options.note));
  }
  if (options.key !== undefined) {
    const kbd = el("kbd", "", options.key.shown);
    kbd.setAttribute("aria-hidden", "true");
    b.append(kbd);
    b.setAttribute("aria-keyshortcuts", options.key.aria);
  }
  b.disabled = !waiting && options.disabled === true;
  if (waiting) {
    b.setAttribute("aria-disabled", "true");
    b.setAttribute("aria-busy", "true");
  }
  return b;
}

/** `button` marked as a locked station's, which the ground's update
 *  in place leaves off (`groundInPlace`). */
function lockedGround(
  button: HTMLButtonElement,
  locked: boolean,
): HTMLButtonElement {
  if (locked) button.dataset["locked"] = "true";
  return button;
}

/** The selection's commands, Delete last behind a separator. */
function actions(buttons: readonly HTMLButtonElement[]): HTMLElement {
  const box = el("div", "acts");
  for (const button of buttons) {
    if (button.dataset["act"] === "delete") {
      const sep = el("div", "asep");
      sep.setAttribute("role", "separator");
      box.append(sep);
    }
    box.append(button);
  }
  return box;
}

/** Whether `m` off the ground counts as on it (null: not known). */
function onGround(m: number | null): boolean {
  return m !== null && Math.abs(m) <= ON_GROUND_M;
}

/** How far off the ground, in words ("1.5 m up", "0.4 m down"). */
function offText(m: number | null): string {
  if (m === null || onGround(m)) return "";
  return `${fixed(Math.abs(m), 1)} m ${m > 0 ? "up" : "down"}`;
}

/** The drawn "Put on the ground" set to the ground `m` below it, in
 *  place: its note and its off state (on the ground: nothing to do). A
 *  locked station's, or one the shell is running, is left as drawn. */
function groundInPlace(body: HTMLElement, model: InspectorModel): void {
  const button = body.querySelector<HTMLButtonElement>('[data-act="ground"]');
  if (
    button !== null &&
    button.dataset["locked"] !== "true" &&
    "groundOffM" in model
  ) {
    const m = model.groundOffM;
    actionInPlace(button, onGround(m), offText(m));
  }
  const items = body.querySelector<HTMLButtonElement>(
    '[data-act="ground-items"]',
  );
  if (items !== null && model.kind === "station") {
    const off = model.offGround;
    actionInPlace(items, off === 0, offCountText(off));
  }
}

/** How many items are off the ground, in words ("2 off"; none or not
 *  known yet: nothing). */
function offCountText(off: number | null): string {
  return off === null || off === 0 ? "" : `${String(off)} off`;
}

/** A drawn action's off state and note set in place, unless the shell is
 *  running it (it draws its own end state then). */
function actionInPlace(
  button: HTMLButtonElement,
  disabled: boolean,
  text: string,
): void {
  if (button.getAttribute("aria-busy") === "true") return;
  button.disabled = disabled;
  const note = button.querySelector(".note");
  if (text === "") note?.remove();
  else if (note !== null) note.textContent = text;
  else button.append(el("span", "note", text));
}

type StationModel = Extract<InspectorModel, { kind: "station" }>;
type ItemModel = Extract<InspectorModel, { kind: "item" }>;
type FolderModel = Extract<InspectorModel, { kind: "folder" }>;
type CodeModel = Extract<InspectorModel, { kind: "code" }>;
type StoryModel = Extract<InspectorModel, { kind: "story" }>;
type StoryEntryModel = Extract<InspectorModel, { kind: "storyEntry" }>;
type StoryStepModel = Extract<InspectorModel, { kind: "storyStep" }>;

/** The card picture's choices: a button each, the shown one pressed. */
function imagePicker(
  model: StationModel,
  pictures: ShellPictures,
): HTMLElement {
  if (model.images.length === 0) {
    return readOnlyText(
      "Card image",
      "None - a photo of this station or an image of the tour can be its card",
    );
  }
  // Its label centred beside the pictures, as the prototype has it.
  const row = el("div", "f");
  const tag = el("span", "flabel", "Card image");
  const box = el("div", "thumbs");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Card image");
  for (const image of model.images) {
    const b = el("button", "thumb");
    b.type = "button";
    b.dataset["act"] = `image:${image.id}`;
    b.title = image.label;
    b.setAttribute("aria-label", image.label);
    const on = image.id === model.imageId;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    pictures.show(b, image.path);
    box.append(b);
  }
  row.append(tag, box);
  return row;
}

/** The radius's slider and number, and its note. */
function radiusParts(model: StationModel): HTMLElement[] {
  const { box, input } = numberBox("radius", fixed(model.foundRadiusM, 1), "m");
  return [
    labelled("Radius", input, radiusRange(box, model.foundRadiusM)),
    el(
      "div",
      "note",
      `Visitors who step inside this circle see the station's content; it starts loading ${fixed(model.activateRadiusM, 0)} m out.`,
    ),
  ];
}

/** How many items stand outside the circle: shown whether the place is
 *  open or not, since it asks for a change. */
function outsideWarn(model: StationModel): HTMLElement[] {
  if (model.outside <= 0) return [];
  const one = model.outside === 1;
  return [
    el(
      "div",
      "warn",
      `${String(model.outside)} ${one ? "item stands" : "items stand"} outside the circle: visitors see ${one ? "it" : "them"} only from inside the circle.`,
    ),
  ];
}

/** A station's place, height and heading, and its own ground command. */
function stationPosition(
  model: StationModel,
  p: InspectorPosition,
  state: InspectorState,
): HTMLElement[] {
  return [
    vectorField(
      "Anchor",
      [
        ["E", "east", "east", fixed(p.eastM, 2)],
        ["N", "north", "north", fixed(p.northM, 2)],
      ],
      "m",
      model.locked,
    ),
    numberField(
      "Heading",
      "heading",
      headingText(p.headingDeg),
      "deg",
      model.locked,
    ),
    readOnlyNumber("Height", fixed(p.altM, 1), "m"),
    actions([
      lockedGround(
        action("ground", "ground", "Put on the ground", {
          disabled: model.locked || onGround(model.groundOffM),
          note: offText(model.groundOffM),
          busy: state.busy,
        }),
        model.locked,
      ),
    ]),
    el(
      "div",
      "note",
      "Metres east / north of the tour's centre, where the 3D view is centred; the height over the ellipsoid, as the file writes it; the heading clockwise from north. Its items move and turn with it.",
    ),
  ];
}

/** Said under a character's view chips for a view they do not offer
 *  (an older tour's), so no chip being pressed reads as meant. */
const CHARACTER_OLDER_VIEW =
  "He stands in a view of an older tour; a chip moves him to a story view.";

/** Said under his advance chips when his step moves on by itself. */
const CHARACTER_AUTO_ADVANCE =
  "His step moves on by itself after a while; a chip sets it otherwise.";

/** A story block's texts to type, each named `block:<id>:<field>`
 *  (`inspector-edits.ts`), its count under it. Each field is named by its
 *  own label only: its box is a group named by the block's head
 *  (`storyBox`), which a screen reader says once on entering it - so
 *  several blocks' "Title" fields are told apart by their group, and the
 *  head is not said again for every field. */
function storyTextFields(
  id: string,
  fields: readonly BlockField[],
): HTMLElement[] {
  return fields.flatMap((f) =>
    blockTextField({ ...f, name: `block:${id}:${f.name}` }),
  );
}

/** A story block's box: a group named by its head (`head`). */
function storyBox(id: string, className: string, head: string): HTMLElement {
  const box = el("div", className);
  box.dataset["block"] = id;
  const tag = el("span", "flabel", head);
  tag.id = fieldId();
  box.setAttribute("role", "group");
  box.setAttribute("aria-labelledby", tag.id);
  box.append(tag);
  return box;
}

/** A story block that is no character: its kind and name, its texts. */
function storyBlockParts(block: StoryEntryModel["block"]): HTMLElement {
  const box = storyBox(
    block.id,
    "isec story-text",
    `${block.kind} - ${block.title}`,
  );
  box.append(...storyTextFields(block.id, block.fields));
  return box;
}

/** A story character's view, how his step moves on and his facing, as a
 *  model's view is set: chips, the one in use pressed, and a number; his
 *  texts under them. The facing shows in the pop-up alone: it turns only
 *  that stage, a flat figure faces the visitor fully. */
function characterParts(
  id: string,
  name: string,
  c: InspectorCharacter,
  fields: readonly BlockField[],
): HTMLElement {
  const box = storyBox(id, "isec character", name);
  const views = CHARACTER_VIEW_CHOICES.map((v) => ({
    value: v.view,
    label: v.label,
  }));
  const offered = views.some((v) => v.value === c.view);
  box.append(...chipGroup("View", `character-view:${id}`, views, c.view));
  if (!offered) box.append(el("div", "note", CHARACTER_OLDER_VIEW));
  box.append(
    ...chipGroup(
      "Moves on",
      `character-advance:${id}`,
      [
        { value: "tap", label: ADVANCE_WORDS.tap },
        { value: "lineEnd", label: ADVANCE_WORDS.lineEnd },
      ],
      c.advance,
    ),
  );
  if (c.advance === "auto")
    box.append(el("div", "note", CHARACTER_AUTO_ADVANCE));
  if (c.view === "popup") {
    box.append(
      numberField(
        "Facing",
        `character-facing:${id}`,
        String(Math.round(c.facingDeg) % 360),
        "deg",
      ),
    );
  }
  box.append(...storyTextFields(id, fields));
  return box;
}

/** A station's items under their own fold. */
function stationContentsFold(
  model: StationModel,
  state: InspectorState,
): HTMLElement[] {
  return disclosure(
    state.contentsOpen ?? true,
    contentsSummary(model.contents),
    () =>
      contentsBody(
        model.contents,
        actions([action("add-content", "plus", "Add content...")]),
      ),
    {
      label: "Contents",
      title: "What this station holds",
      act: "contents",
      body: "contents",
    },
  );
}

function stationParts(
  model: StationModel,
  state: InspectorState,
  pictures: ShellPictures,
  sub: HTMLElement,
): HTMLElement[] {
  const { number, count } = model.place;
  const earlier = iconButton("earlier", "Earlier in the tour", "earlier");
  earlier.disabled = number <= 1;
  const later = iconButton("later", "Later in the tour", "later");
  later.disabled = number >= count;
  sub.append(el("span", "sp"), earlier, later);
  const off = model.offGround;
  const section = el("div", "isec");
  section.append(
    lineField("Name", "title", model.name, `Station ${String(number)}`),
    proseField(
      "Description",
      "description",
      model.description ?? "",
      "Optional",
    ),
    imagePicker(model, pictures),
  );
  const parts: HTMLElement[] = [
    actions([
      action("ground-items", "ground", "Put items on the ground", {
        disabled: off === 0,
        note: offCountText(off),
        busy: state.busy,
      }),
      action("delete", "trash", "Delete station", { key: DELETE_KEY }),
    ]),
    section,
  ];
  const p = model.position;
  if (p === null) {
    // Nothing for the lock to keep still: the radius and the note stand
    // alone.
    section.append(...radiusParts(model), ...outsideWarn(model));
    parts.push(
      el("div", "note pad", "The file gives this station no position."),
      ...stationContentsFold(model, state),
    );
    return parts;
  }
  const [disc, ...open] = disclosure(
    state.positionOpen,
    `r ${fixed(model.foundRadiusM, 0)} m  ${positionSummary(p)}`,
    () => [...radiusParts(model), ...stationPosition(model, p, state)],
    { label: "Place", title: "Radius, position and heading" },
  );
  // The lock sits on the Place row: the disclosure and the lock side by
  // side.
  const row = el("div", "posrow");
  if (disc !== undefined) row.append(disc);
  row.append(lockButton(model.locked));
  parts.push(
    row,
    ...outsideWarn(model),
    ...open,
    ...stationContentsFold(model, state),
  );
  return parts;
}

/** A story: its Entries in order, the way to add one, its Delete saying
 *  what goes with it. */
function storyParts(model: StoryModel, state: InspectorState): HTMLElement[] {
  const n = model.entries.length;
  const entries = disclosure(
    state.contentsOpen ?? true,
    `${String(n)}, played in order`,
    () => [
      n === 0
        ? el("div", "note", "No entries yet.")
        : entriesList(model.entries),
      actions([action("add-entry", "plus", "Add entry...")]),
    ],
    {
      label: "Entries",
      title: "What this story plays",
      act: "contents",
      body: "contents",
    },
  );
  const goes = n === 1 ? "1 entry" : `${String(n)} entries`;
  return [
    ...entries,
    actions([
      action(
        "delete",
        "trash",
        n === 0 ? "Delete story" : `Delete story and its ${goes}...`,
        { key: DELETE_KEY },
      ),
    ]),
  ];
}

/** What a chip of how a block moves on says. */
const ADVANCE_WORDS = {
  tap: "On a tap",
  auto: "After a while",
  lineEnd: "When the line ends",
} as const satisfies { readonly [M in TourStepAdvance["mode"]]: string };

/** How a story's block moves on: chips, its seconds while automatic. A
 *  mode the chips do not offer shows as its own chip, so none being
 *  pressed never reads as meant. */
function advanceParts(id: string, advance: StoryEntryModel["advance"]) {
  const box = el("div", "isec");
  const modes: TourStepAdvance["mode"][] = [
    "tap",
    "auto",
    ...(advance.mode === "lineEnd" ? (["lineEnd"] as const) : []),
  ];
  box.append(
    ...chipGroup(
      "Moves on",
      `entry-advance:${id}`,
      modes.map((value) => ({ value, label: ADVANCE_WORDS[value] })),
      advance.mode,
    ),
  );
  if (advance.afterS !== null) {
    box.append(
      numberField("After", `entry-after:${id}`, String(advance.afterS), "s"),
    );
  }
  return box;
}

/** A story's block: a character's parts, or its texts and how it moves on,
 *  and its Delete. */
function storyEntryParts(model: StoryEntryModel): HTMLElement[] {
  const { block } = model;
  const parts: HTMLElement[] = [];
  if (block.character !== undefined) {
    parts.push(
      characterParts(block.id, block.title, block.character, block.fields),
    );
  } else {
    if (block.fields.length > 0) parts.push(storyBlockParts(block));
    parts.push(advanceParts(block.id, model.advance));
  }
  parts.push(
    actions([action("delete", "trash", "Delete entry", { key: DELETE_KEY })]),
  );
  return parts;
}

/** A choice or a quiz: what it says and its Delete. */
function storyStepParts(model: StoryStepModel): HTMLElement[] {
  const box = el("div", "isec");
  const list = el("ul", "steplines");
  for (const line of model.lines) list.append(el("li", "", line));
  box.append(el("div", "flabel", model.heading), list);
  return [
    box,
    actions([
      action("delete", "trash", `Delete ${model.stepKind}`, {
        key: DELETE_KEY,
      }),
    ]),
  ];
}

/** An item's Delete, with its key. */
function itemDelete(model: ItemModel): HTMLButtonElement {
  return action("delete", "trash", `Delete ${kindNoun(model.itemKind)}`, {
    key: DELETE_KEY,
  });
}

/** The size an item's white dots change, to type, with what it means. */
function extentParts(extent: InspectorExtent): HTMLElement {
  const section = el("div", "isec");
  section.append(
    numberField(extent.label, "size", fixed(extent.value, 2), "m"),
    el(
      "div",
      "note",
      `${extent.meaning}, from ${String(extent.min)} m to ${String(extent.max)} m. Drag a white dot to resize.`,
    ),
  );
  return section;
}

/** An item's parts: its commands, its fields (unless its kind's panel
 *  types them itself), its panel's parts, its position. An item with no
 *  place in the world (a video) has its texts, its panel's parts and its
 *  Delete only: nothing to move, ground or split off. */
function itemParts(
  model: ItemModel,
  state: InspectorState,
  panel: KindPanelDraw | null,
): HTMLElement[] {
  const parts: HTMLElement[] = [];
  const fields = panel?.ownsFields === true ? [] : model.fields;
  if (model.text !== null && severalLines(model.text)) {
    const why = el("div", "note pad", PIN_LINES);
    why.id = PIN_LINES_ID;
    parts.push(why);
  }
  const o = model.offset;
  if (o === null) {
    const box = el("div", "isec");
    box.append(...fields.flatMap(blockTextField));
    parts.push(box);
    if (panel !== null) parts.push(...panel.parts());
    parts.push(actions([itemDelete(model)]));
    return parts;
  }
  parts.push(
    actions([
      action("split", "split", "Move to a new station"),
      action("ground", "ground", "Put on the ground", {
        disabled: onGround(model.groundOffM),
        note: offText(model.groundOffM),
        busy: state.busy,
      }),
      itemDelete(model),
    ]),
  );
  if (fields.length > 0) {
    const section = el("div", "isec");
    section.append(...fields.flatMap(blockTextField));
    parts.push(section);
  }
  if (model.extent !== null) parts.push(extentParts(model.extent));
  if (panel !== null) parts.push(...panel.parts());
  // A heading only where turning it shows (its placement row's `turns`):
  // a pin, a reading sign or a sound faces the visitor whatever it is.
  const heading = model.headingDeg === null ? "-" : fixed(model.headingDeg, 0);
  parts.push(
    ...disclosure(
      state.positionOpen,
      model.turns
        ? `${fixed(o.upM, 1)} m up  ${heading} deg`
        : `${fixed(o.upM, 1)} m up`,
      () => [
        vectorField(
          "Offset",
          [
            ["E", "east", "east", fixed(o.eastM, 2)],
            ["N", "north", "north", fixed(o.northM, 2)],
          ],
          "m",
        ),
        numberField("Height", "height", fixed(o.upM, 2), "m"),
        ...(model.turns
          ? [
              numberField(
                "Heading",
                "heading",
                headingText(model.headingDeg),
                "deg",
              ),
            ]
          : []),
        el(
          "div",
          "note",
          model.turns
            ? "Metres east / north of its station's anchor, in the station's frame; the height up from the anchor; the heading relative to the station."
            : "Metres east / north of its station's anchor, in the station's frame; the height up from the anchor. It faces the visitor, so it has no heading.",
        ),
      ],
    ),
  );
  return parts;
}

/** A plain folder's parts: its scale to type, and its Place (its
 *  origin's offset, height and heading in its station's frame) folded
 *  away as an item's position is. Its items follow either. */
function folderParts(model: FolderModel, state: InspectorState): HTMLElement[] {
  const o = model.offset;
  const { scale } = model;
  const section = el("div", "isec");
  section.append(
    numberField(scale.label, "scale", fixed(scale.value, 2), "x"),
    el(
      "div",
      "note",
      `${scale.meaning}, from ${String(scale.min)} to ${String(scale.max)} times. Drag a white dot to scale.`,
    ),
  );
  const heading = model.headingDeg === null ? "-" : fixed(model.headingDeg, 0);
  return [
    section,
    ...disclosure(
      state.positionOpen,
      `${fixed(o.upM, 1)} m up  ${heading} deg`,
      () => [
        vectorField(
          "Offset",
          [
            ["E", "east", "east", fixed(o.eastM, 2)],
            ["N", "north", "north", fixed(o.northM, 2)],
          ],
          "m",
        ),
        numberField("Height", "height", fixed(o.upM, 2), "m"),
        numberField("Heading", "heading", headingText(model.headingDeg), "deg"),
        el(
          "div",
          "note",
          "Where the folder's origin stands: metres east / north of its station's anchor, in the station's frame; the height up from the anchor; the heading relative to the station. Its items move with it.",
        ),
      ],
      { label: "Place", title: "Position and heading of the folder" },
    ),
  ];
}

function codeParts(model: CodeModel, state: InspectorState): HTMLElement[] {
  const section = el("div", "isec");
  section.append(
    readOnlyNumber(
      "Print size",
      model.printSizeM === null ? "-" : fixed(model.printSizeM, 2),
      "m",
    ),
  );
  const p = model.position;
  if (p === null) {
    return [section, el("div", "note pad", "No position stored yet.")];
  }
  return [
    section,
    ...disclosure(state.positionOpen, positionSummary(p), () => [
      readOnlyNumber("Anchor east", fixed(p.eastM, 1), "m"),
      readOnlyNumber("Anchor north", fixed(p.northM, 1), "m"),
      readOnlyNumber("Height", fixed(p.altM, 1), "m"),
      readOnlyNumber("Heading", headingText(p.headingDeg), "deg"),
      el(
        "div",
        "note",
        "Measured on site, read-only here. Metres east / north of the tour's centre; the height over the ellipsoid; the heading clockwise from north.",
      ),
    ]),
  ];
}

/** What each dock was last drawn from: a draw from the same model and
 *  state changes nothing, so a store change that is not the inspector's
 *  (an autosave's status) leaves its controls, their focus and a field
 *  being typed in alone. */
const lastDrawn = new WeakMap<HTMLElement, string>();

/** The docks being drawn now. A draw takes the focused field out of the
 *  page, and the browser fires its `focusout` at once, in the middle of
 *  the draw: `inspectorDrawing` lets the shell tell that from a field the
 *  creator left, and a draw asked for meanwhile is not run inside the one
 *  running. */
const drawing = new WeakSet<HTMLElement>();

/** Whether the inspector at `root` is being drawn right now. */
export function inspectorDrawing(root: HTMLElement): boolean {
  return drawing.has(root);
}

/** The control that has the focus in `root`, by the name it is drawn
 *  under again (`data-act` or `data-field`), with a field's selection and
 *  the text typed in it and not yet committed (null: none, the draw's own
 *  value stands). */
interface FocusKept {
  readonly selector: string;
  readonly field: {
    readonly typed: string | null;
    readonly start: number | null;
    readonly end: number | null;
  } | null;
}

/** `value` quoted for an attribute selector. */
function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/** The name `target` is drawn under in the dock at `root` (a selector
 *  by its `data-act` or `data-field`), so the control drawn again in
 *  its place is found by it; null for anything else. */
export function controlName(
  root: HTMLElement,
  target: EventTarget | null,
): string | null {
  if (!(target instanceof HTMLElement) || !root.contains(target)) return null;
  const act = target.dataset["act"];
  const name = target.dataset["field"];
  return act !== undefined
    ? `[data-act=${quoted(act)}]`
    : name !== undefined
      ? `[data-field=${quoted(name)}]`
      : null;
}

/** The control drawn under `name` in `root`, unless it is disabled
 *  (Earlier at the first place) or there is none. */
function controlNamed(root: HTMLElement, name: string): HTMLElement | null {
  const control = root.querySelector<HTMLElement>(name);
  return control === null || (control as HTMLButtonElement).disabled === true
    ? null
    : control;
}

/** The focus put on the control drawn under `name` (`controlName`) in
 *  the dock at `root`: where the focus was going when a draw took that
 *  control out of the page (Chromium then drops the focus to the page).
 *  None, or a disabled one, leaves the focus where it is. `tabbed`: Tab
 *  brought it there, so a one-line field has its text selected, as Tab
 *  selects it in a field no draw replaced. */
export function focusControl(
  root: HTMLElement,
  name: string | null,
  tabbed = false,
): void {
  if (name === null) return;
  const control = controlNamed(root, name);
  if (control === null || control === document.activeElement) return;
  control.focus();
  if (tabbed && control instanceof HTMLInputElement) control.select();
}

function focusIn(root: HTMLElement): FocusKept | null {
  const active = document.activeElement;
  const selector = controlName(root, active);
  if (selector === null || !(active instanceof HTMLElement)) return null;
  const typedIn =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? active
      : null;
  return {
    selector,
    // A control without a caret (a slider) carries nothing: its value is the
    // document's by the time of a draw, and it has no selection to set.
    field:
      typedIn === null || typedIn.selectionStart === null
        ? null
        : {
            // Only text typed and not yet committed is carried over.
            typed:
              typedIn.value !== typedIn.defaultValue ? typedIn.value : null,
            start: typedIn.selectionStart,
            end: typedIn.selectionEnd,
          },
  };
}

/** The focus put back on the control drawn again under the same name; a
 *  disabled one (Earlier at the first place) leaves it where it fell. */
function focusAgain(root: HTMLElement, kept: FocusKept | null): void {
  if (kept === null) return;
  const again = controlNamed(root, kept.selector);
  if (again === null) return;
  if (
    kept.field !== null &&
    (again instanceof HTMLInputElement || again instanceof HTMLTextAreaElement)
  ) {
    if (kept.field.typed !== null) again.value = kept.field.typed;
    again.focus();
    again.setSelectionRange(kept.field.start, kept.field.end);
    return;
  }
  again.focus();
}

/** The dock's own state: folded to its head, the position open, and the
 *  command the shell is running (its `data-act`), if any. */
export interface InspectorState {
  readonly folded: boolean;
  readonly positionOpen: boolean;
  /** A station's Contents unfolded (none said: it is). */
  readonly contentsOpen?: boolean;
  readonly busy?: string | null;
}

/**
 * The dock drawn from `model` (null: hidden), folded to its head or not,
 * its position disclosure open or not. Drawn again only when one of them
 * changed - when only the ground under the selection did (it loads and
 * refines while the view shows, and the shell draws 5 times a second),
 * just its "Put on the ground" is updated in place - and never from
 * inside a draw (`inspectorDrawing`); the
 * control that had the focus has it again after a draw, with text typed
 * in it and not yet committed. `panel`, the selected item's kind's own
 * part (`../kind-panels/kind-panel.ts`), is drawn in its places: its
 * title in the head (else the head's own), its buttons before the fold,
 * its kept node (a long text's writer) under the head, staying in the
 * page while the next draw shows it too, and its parts after the item's
 * fields.
 */
export function drawInspector(
  dock: {
    readonly root: HTMLElement;
    readonly head: HTMLElement;
    readonly body: HTMLElement;
  },
  model: InspectorModel | null,
  state: InspectorState,
  pictures: ShellPictures,
  panel: KindPanelDraw | null = null,
): void {
  if (drawing.has(dock.root)) return;
  const key = JSON.stringify([
    model === null ? null : { ...model, groundOffM: null, offGround: null },
    state,
    panel === null ? null : [panel.key, panel.kept !== null],
  ]);
  if (lastDrawn.get(dock.root) === key) {
    if (model !== null) groundInPlace(dock.body, model);
    return;
  }
  drawing.add(dock.root);
  try {
    lastDrawn.set(dock.root, key);
    const kept = focusIn(dock.root);
    drawDock(dock, model, state, pictures, panel);
    focusAgain(dock.root, kept);
  } finally {
    drawing.delete(dock.root);
  }
}

/** The head's title: its kind's panel's, a pin's text or a story's name
 *  to type, else the title in words (a station's name is typed in its
 *  labelled field, AU-2). */
function headTitle(
  model: InspectorModel,
  panel: KindPanelDraw | null,
): HTMLElement {
  const own = panel?.title() ?? null;
  if (own !== null) return own;
  if (model.kind === "story") {
    const input = typed("story-title", model.title, "ttlin");
    input.setAttribute("aria-label", "Name of the story");
    input.title = "The story's name (Enter keeps it)";
    return input;
  }
  if (model.kind === "item" && model.text !== null) {
    const input = typed("title", model.text, "ttlin");
    input.setAttribute("aria-label", "Pin text");
    if (severalLines(model.text)) {
      // Read-only, so leaving it never writes the text back on one line;
      // the line in the dock says why (`PIN_LINES`).
      input.readOnly = true;
      input.title = PIN_LINES;
      input.setAttribute("aria-describedby", PIN_LINES_ID);
    } else {
      input.title = "The pin's text (Enter keeps it)";
    }
    return input;
  }
  const title = el("span", "ttl", model.title);
  title.title = model.title;
  return title;
}

/** A typed pin text's "12 / 40" (`pin-text.ts`), counted as it is typed
 *  (the edit refuses a longer text, `object-edits.ts`), or null when the
 *  head offers no pin text to type. */
function pinCount(
  model: InspectorModel,
  head: HTMLElement,
): HTMLElement | null {
  const counted = model.kind === "story" || model.kind === "item";
  if (!counted || (model.kind === "item" && model.text === null)) return null;
  if (!(head instanceof HTMLInputElement) || head.readOnly) return null;
  const out = el("output", "note pad");
  out.id = PIN_COUNT_ID;
  head.setAttribute("aria-describedby", PIN_COUNT_ID);
  if (model.kind === "story") {
    const { max, unit } = TOUR_STORY_TITLE_RULE;
    wireTextCounter(head, out, max, unit);
  } else {
    wirePinTextCounter(head, out);
  }
  return out;
}

/** What the head shows of `model`: its look (the icon's style class)
 *  and its icon. A block's are its kind's look (`KIND_EDIT`). */
function headLook(model: InspectorModel): {
  readonly look: string;
  readonly icon: ShellIcon;
} {
  switch (model.kind) {
    case "item": {
      const { look } = KIND_EDIT[model.itemKind];
      return { look, icon: look };
    }
    case "storyEntry":
      return { look: model.rowKind, icon: model.rowKind };
    case "storyStep":
      return { look: model.stepKind, icon: model.stepKind };
    case "station":
      return { look: "station", icon: "station" };
    case "folder":
      return { look: "fold", icon: "folder" };
    case "story":
      return { look: "story", icon: "storyOpen" };
    case "code":
      return { look: "code", icon: "qr" };
  }
}

/** A station's item's or story's moves within its station: Earlier and
 *  Later beside its place (as a station's are), and a "Move" button per
 *  list it may go into (`move-to:<list>`) and a picker of the other
 *  stations it may go onto (`data-move-station`); none for a code or a
 *  station. */
function moveParts(model: InspectorModel, sub: HTMLElement): HTMLElement[] {
  const moves = "moves" in model ? model.moves : undefined;
  if (moves === undefined) return [];
  const { step, targets } = moves;
  if (step !== null) {
    const where = model.kind === "story" ? "among the stories" : "in the story";
    const earlier = iconButton("earlier", `Earlier ${where}`, "earlier");
    earlier.disabled = !step.earlier;
    const later = iconButton("later", `Later ${where}`, "later");
    later.disabled = !step.later;
    sub.append(el("span", "sp"), earlier, later);
  }
  const parts: HTMLElement[] = [];
  if (targets.length > 0) {
    parts.push(
      actions(
        targets.map((t) =>
          action(
            `move-to:${t.list}`,
            t.list === FREE_LIST ? "station" : "story",
            t.label,
          ),
        ),
      ),
    );
  }
  if (moves.stations.length > 0) parts.push(stationPicker(moves.stations));
  return parts;
}

/** The words of the station picker's first, unchosen line. */
const MOVE_TO_STATION = "Move to station…";

/** The inspector's Move to station: a native picker of the other stations
 *  the item may go onto (a finger's list on a phone, the arrow keys on a
 *  desktop), `data-move-station`; choosing one moves it there. */
function stationPicker(
  stations: readonly { readonly id: string; readonly label: string }[],
): HTMLElement {
  const box = el("div", "acts move-station");
  box.append(shellIcon("station"));
  const select = el("select", "move-station-pick");
  select.dataset["moveStation"] = "";
  select.setAttribute("aria-label", "Move to station");
  const first = new Option(MOVE_TO_STATION, "", true, true);
  first.disabled = true;
  select.append(first, ...stations.map((st) => new Option(st.label, st.id)));
  box.append(select);
  return box;
}

/** The dock's parts for `model`, the station's commands beside `sub`. */
function partsOf(
  model: InspectorModel,
  state: InspectorState,
  pictures: ShellPictures,
  sub: HTMLElement,
  panel: KindPanelDraw | null,
): HTMLElement[] {
  switch (model.kind) {
    case "station":
      return stationParts(model, state, pictures, sub);
    case "item":
      return itemParts(model, state, panel);
    case "folder":
      return folderParts(model, state);
    case "story":
      return storyParts(model, state);
    case "storyEntry":
      return storyEntryParts(model);
    case "storyStep":
      return storyStepParts(model);
    default:
      return codeParts(model, state);
  }
}

function drawDock(
  dock: {
    readonly root: HTMLElement;
    readonly head: HTMLElement;
    readonly body: HTMLElement;
  },
  model: InspectorModel | null,
  state: InspectorState,
  pictures: ShellPictures,
  panel: KindPanelDraw | null,
): void {
  dock.root.hidden = model === null;
  if (model === null) {
    dock.head.replaceChildren();
    dock.body.replaceChildren();
    return;
  }
  dock.root.classList.toggle("collapsed", state.folded);
  const { look, icon: drawn } = headLook(model);
  const icon = el("span", `hic ic ${look}`);
  icon.append(shellIcon(drawn));
  const head = headTitle(model, panel);
  const count = pinCount(model, head);
  dock.head.replaceChildren(
    iconButton("right", "Back to the list", "back"),
    icon,
    head,
    ...(panel?.head() ?? []),
    iconButton(
      state.folded ? "down" : "up",
      state.folded ? "Show the details" : "Collapse the details",
      "fold",
    ),
    iconButton("close", "Deselect (Esc)", "close"),
  );
  const sub = el("div", "sub");
  sub.append(el("span", "", model.sub));
  const parts = [
    ...partsOf(model, state, pictures, sub, panel),
    ...moveParts(model, sub),
    ...(model.file === undefined ? [] : [fileFieldPart(model.file)]),
  ];
  const before = [sub, ...(count === null ? [] : [count])];
  placeAround(dock.body, before, panel?.kept ?? null, parts);
}

/** `body` holding `before`, `middle` and `after` in that order. A
 *  `middle` already in it stays in the page (only the nodes around it
 *  change), so a text area in it keeps its focus and its undo. */
function placeAround(
  body: HTMLElement,
  before: readonly HTMLElement[],
  middle: HTMLElement | null,
  after: readonly HTMLElement[],
): void {
  if (middle === null || middle.parentNode !== body) {
    body.replaceChildren(
      ...before,
      ...(middle === null ? [] : [middle]),
      ...after,
    );
    return;
  }
  for (const node of [...body.childNodes]) {
    if (node !== middle) node.remove();
  }
  for (const node of before) body.insertBefore(node, middle);
  body.append(...after);
}
