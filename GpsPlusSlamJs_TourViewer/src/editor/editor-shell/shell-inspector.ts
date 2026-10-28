/**
 * The 3D view's inspector dock, drawn from its model
 * (`inspector-model.ts`): the selection's name, what it is, its fields,
 * and the position folded away under a disclosure. Text only, never
 * markup.
 *
 * The fields a creator types carry `data-field` (a station's `title` and
 * `description`, labelled Name and Description at the top of the body, the
 * head showing the name as text (AU-2: a borderless name in the head read
 * as a heading); its `radius`, `east`, `north` and `heading`; a pin's `title`
 * (its text); an item's `east`, `north`, `height`, `heading` and a
 * model's `size`), each drawn with the tour's value as its default, so
 * the shell commits a field only when its text differs; a locked
 * station's place and heading are read-only. The rest are `<output>`s.
 * Every value is tied to its label, so a screen reader reads the two
 * together.
 *
 * The buttons carry `data-act`, and the shell answers them: the head's
 * fold and close (`fold`, `close`), the disclosure (`position`), a
 * station's lock beside its Position (`lock`, pressed while locked), its
 * Earlier and Later beside its place in the tour (`earlier`, `later`, off
 * at the ends), the card picture's choices (`image:<id>`, the shown one
 * pressed), and the selection's commands in words: a station's `add-pin`,
 * `ground-items` and `delete`, its own `ground` under Position; an item's
 * `split` ("Move to a new station"), `ground` and `delete`. A command the
 * shell is running (`busy`) shows as waiting.
 *
 * @see shell-inspector.ts.md
 */
import type { ShellPictures } from "./shell-pictures.js";
import { shellIcon, type ShellIcon } from "./shell-icons.js";
import {
  ON_GROUND_M,
  type InspectorModel,
  type InspectorPosition,
} from "./inspector-model.js";
import { wirePinTextCounter, wireTextCounter } from "../../pin-text.js";
import { blockFieldPlaceholder, type BlockField } from "../block-fields.js";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** `value` with `digits` decimals, "-0" shown as "0". */
function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
}

/** A fresh id for a field's value: labels point at their value by it.
 *  Only one inspector exists, and each draw replaces every field. */
let fieldCount = 0;
function fieldId(): string {
  fieldCount += 1;
  return `inspector-field-${String(fieldCount)}`;
}

function iconButton(
  icon: ShellIcon,
  label: string,
  act: string,
): HTMLButtonElement {
  const b = el("button", "ib");
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.dataset["act"] = act;
  b.append(shellIcon(icon));
  return b;
}

/** A row: `label` tied to the value `value` (given an id here), the row
 *  showing `shown` (the value, or a box holding it). */
function labelled(
  label: string,
  value: HTMLElement,
  shown: HTMLElement = value,
): HTMLElement {
  const row = el("div", "f");
  value.id = fieldId();
  const tag = el("label", "", label);
  tag.htmlFor = value.id;
  row.append(tag, shown);
  return row;
}

/** A read-only number: its label and its value (with a unit). */
function readOnlyNumber(label: string, value: string, unit = ""): HTMLElement {
  const box = el("div", "num ro");
  const out = el("output", "val", value);
  box.append(out);
  if (unit !== "") box.append(el("span", "unit", unit));
  return labelled(label, out, box);
}

/** Whether `value` holds a line break. */
function severalLines(value: string): boolean {
  return /[\r\n]/.test(value);
}

/** Why a pin's text of several lines is read-only in the head, said on a
 *  line of the dock (a title never shows on a touch screen). */
const PIN_LINES =
  "This text has several lines, which this one-line field cannot keep: edit it in the pin's card on the 2D map.";

/** The id of that line, which the head's field is described by. */
const PIN_LINES_ID = "inspector-pin-lines";

/** The id of a typed pin text's count, which the field names. */
const PIN_COUNT_ID = "inspector-pin-count";

/** A field to type in, named `field` (`data-field`), the tour's value
 *  `value` its default, so text that differs from it is typed. A text
 *  input drops line breaks: a value of several lines is shown, and taken
 *  as its default, on one line, so a field left untouched reads as
 *  untyped and is never written back flattened. */
function typed(
  field: string,
  value: string,
  className: string,
): HTMLInputElement {
  const input = el("input", className);
  input.type = "text";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.dataset["field"] = field;
  input.defaultValue = severalLines(value)
    ? value.replace(/\s*[\r\n]+\s*/g, " ")
    : value;
  return input;
}

/** A number to type, in a box with its unit; read-only (`locked`) while
 *  a lock keeps it still. */
function numberBox(
  field: string,
  value: string,
  unit: string,
  locked = false,
  axis?: string,
): { box: HTMLElement; input: HTMLInputElement } {
  const box = el("div", locked ? "num ro" : "num");
  const input = typed(field, value, "val");
  input.inputMode = "decimal";
  if (locked) {
    input.readOnly = true;
    input.title = "Unlock the position to type it";
  }
  if (axis !== undefined) {
    box.append(el("span", `ax ${axis.toLowerCase()}`, axis));
  }
  box.append(input);
  if (unit !== "") box.append(el("span", "unit", unit));
  return { box, input };
}

function numberField(
  label: string,
  field: string,
  value: string,
  unit: string,
  locked = false,
): HTMLElement {
  const { box, input } = numberBox(field, value, unit, locked);
  return labelled(label, input, box);
}

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

/** A line to type, named `field`, under its label. */
function lineField(
  label: string,
  field: string,
  value: string,
  placeholder: string,
): HTMLElement {
  const input = typed(field, value, "tfield");
  input.placeholder = placeholder;
  return labelled(label, input);
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

/** The disclosure's button, and its fields when open (made only then). */
function disclosure(
  open: boolean,
  summary: string,
  fields: () => readonly HTMLElement[],
): HTMLElement[] {
  const b = el("button", "disc");
  b.type = "button";
  b.dataset["act"] = "position";
  b.classList.toggle("open", open);
  b.setAttribute("aria-expanded", String(open));
  b.title = "Exact position and heading";
  b.append(
    shellIcon("right"),
    el("span", "lab", "Position"),
    el("span", "sum", summary),
  );
  if (!open) return [b];
  const body = el("div", "pos");
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

/** An item's kind in a command's words (the block model's, B2c). */
const ITEM_WORD: Readonly<Record<string, string>> = {
  pin: "short text",
  photo: "picture",
  model: "3D model",
};

/** A block's text field to type (`block-fields.ts`), its count against
 *  the format's cap under it as it is typed. */
function blockTextField(field: BlockField): HTMLElement[] {
  const hint = blockFieldPlaceholder(field);
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

function actions(buttons: readonly HTMLButtonElement[]): HTMLElement {
  const box = el("div", "acts");
  box.append(...buttons);
  return box;
}

const KIND_ICON: Readonly<Record<string, ShellIcon>> = {
  station: "station",
  code: "qr",
  pin: "pin",
  photo: "photo",
  model: "model",
};

/** Whether `m` off the ground counts as on it (null: not known). */
function onGround(m: number | null): boolean {
  return m !== null && Math.abs(m) <= ON_GROUND_M;
}

/** How far off the ground, in words ("1.5 m up", "0.4 m down"). */
function offText(m: number | null): string {
  if (m === null || onGround(m)) return "";
  return `${fixed(Math.abs(m), 1)} m ${m > 0 ? "up" : "down"}`;
}

type StationModel = Extract<InspectorModel, { kind: "station" }>;
type ItemModel = Extract<InspectorModel, { kind: "item" }>;
type CodeModel = Extract<InspectorModel, { kind: "code" }>;

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

/** The radius's note, and how many items stand outside the circle. */
function radiusNotes(model: StationModel): HTMLElement[] {
  const notes = [
    el(
      "div",
      "note",
      `Visitors who step inside this circle see the station's content; it starts loading ${fixed(model.activateRadiusM, 0)} m out.`,
    ),
  ];
  if (model.outside > 0) {
    const one = model.outside === 1;
    notes.push(
      el(
        "div",
        "warn",
        `${String(model.outside)} ${one ? "item stands" : "items stand"} outside the circle: visitors see ${one ? "it" : "them"} only from inside the circle.`,
      ),
    );
  }
  return notes;
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
      action("ground", "ground", "Put on the ground", {
        disabled: model.locked || onGround(model.groundOffM),
        note: offText(model.groundOffM),
        busy: state.busy,
      }),
    ]),
    el(
      "div",
      "note",
      "Metres east / north of the tour's centre, where the 3D view is centred; the height over the ellipsoid, as the file writes it; the heading clockwise from north. Its items move and turn with it.",
    ),
  ];
}

/** The blocks the station's story shows, a row each by kind and name:
 *  listed, not edited, here (the 3D view draws none of them). */
function storyList(model: StationModel): HTMLElement {
  const box = el("div", "isec story");
  const tag = el("span", "flabel", "In its story");
  tag.id = fieldId();
  const list = el("ul", "story-blocks");
  list.setAttribute("aria-labelledby", tag.id);
  for (const block of model.story) {
    const row = el("li", "");
    row.dataset["block"] = block.id;
    row.append(el("span", "kind", block.kind), el("span", "name", block.title));
    list.append(row);
  }
  box.append(
    tag,
    list,
    el(
      "div",
      "note",
      "Shown while the station's story runs; listed here, not edited here yet.",
    ),
  );
  return box;
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
    numberField("Radius", "radius", fixed(model.foundRadiusM, 1), "m"),
    ...radiusNotes(model),
  );
  const parts: HTMLElement[] = [
    actions([
      action("add-pin", "pin", "Add short text"),
      action("ground-items", "ground", "Put items on the ground", {
        disabled: off === 0,
        note: off === null || off === 0 ? "" : `${String(off)} off`,
        busy: state.busy,
      }),
      action("delete", "trash", "Delete station", { key: DELETE_KEY }),
    ]),
    section,
  ];
  if (model.story.length > 0) parts.push(storyList(model));
  const p = model.position;
  if (p === null) {
    // Nothing for the lock to keep still: the note stands alone.
    parts.push(
      el("div", "note pad", "The file gives this station no position."),
    );
    return parts;
  }
  const [disc, ...open] = disclosure(
    state.positionOpen,
    positionSummary(p),
    () => stationPosition(model, p, state),
  );
  // The lock sits on the Position row: the disclosure and the lock side
  // by side.
  const row = el("div", "posrow");
  if (disc !== undefined) row.append(disc);
  row.append(lockButton(model.locked));
  parts.push(row, ...open);
  return parts;
}

function itemParts(model: ItemModel, state: InspectorState): HTMLElement[] {
  const parts: HTMLElement[] = [];
  if (model.text !== null && severalLines(model.text)) {
    const why = el("div", "note pad", PIN_LINES);
    why.id = PIN_LINES_ID;
    parts.push(why);
  }
  parts.push(
    actions([
      action("split", "split", "Move to a new station"),
      action("ground", "ground", "Put on the ground", {
        disabled: onGround(model.groundOffM),
        note: offText(model.groundOffM),
        busy: state.busy,
      }),
      action("delete", "trash", `Delete ${ITEM_WORD[model.itemKind]}`, {
        key: DELETE_KEY,
      }),
    ]),
  );
  if (model.fields.length > 0) {
    const section = el("div", "isec");
    section.append(...model.fields.flatMap(blockTextField));
    parts.push(section);
  }
  if (model.sizeM !== null) {
    const section = el("div", "isec");
    section.append(
      numberField("Size", "size", fixed(model.sizeM, 2), "m"),
      el(
        "div",
        "note",
        "Its largest side, from 0.05 m to 500 m. Drag a white dot to resize.",
      ),
    );
    parts.push(section);
  }
  const o = model.offset;
  const heading = model.headingDeg === null ? "-" : fixed(model.headingDeg, 0);
  parts.push(
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
          "Metres east / north of its station's anchor, in the station's frame; the height up from the anchor; the heading relative to the station.",
        ),
      ],
    ),
  );
  return parts;
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
 *  under again (`data-act` or `data-field`), with a field's text. */
interface FocusKept {
  readonly selector: string;
  readonly typed: {
    readonly value: string;
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
 *  None, or a disabled one, leaves the focus where it is. */
export function focusControl(root: HTMLElement, name: string | null): void {
  if (name === null) return;
  const control = controlNamed(root, name);
  if (control !== null && control !== document.activeElement) control.focus();
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
    // Only text typed and not yet committed is carried over.
    typed:
      typedIn !== null && typedIn.value !== typedIn.defaultValue
        ? {
            value: typedIn.value,
            start: typedIn.selectionStart,
            end: typedIn.selectionEnd,
          }
        : null,
  };
}

/** The focus put back on the control drawn again under the same name; a
 *  disabled one (Earlier at the first place) leaves it where it fell. */
function focusAgain(root: HTMLElement, kept: FocusKept | null): void {
  if (kept === null) return;
  const again = controlNamed(root, kept.selector);
  if (again === null) return;
  if (
    kept.typed !== null &&
    (again instanceof HTMLInputElement || again instanceof HTMLTextAreaElement)
  ) {
    again.value = kept.typed.value;
    again.focus();
    again.setSelectionRange(kept.typed.start, kept.typed.end);
    return;
  }
  again.focus();
}

/** The dock's own state: folded to its head, the position open, and the
 *  command the shell is running (its `data-act`), if any. */
export interface InspectorState {
  readonly folded: boolean;
  readonly positionOpen: boolean;
  readonly busy?: string | null;
}

/**
 * The dock drawn from `model` (null: hidden), folded to its head or not,
 * its position disclosure open or not. Drawn again only when one of them
 * changed, and never from inside a draw (`inspectorDrawing`); the
 * control that had the focus has it again after a draw, with text typed
 * in it and not yet committed.
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
): void {
  if (drawing.has(dock.root)) return;
  const key = JSON.stringify([model, state]);
  if (lastDrawn.get(dock.root) === key) return;
  drawing.add(dock.root);
  try {
    lastDrawn.set(dock.root, key);
    const kept = focusIn(dock.root);
    drawDock(dock, model, state, pictures);
    focusAgain(dock.root, kept);
  } finally {
    drawing.delete(dock.root);
  }
}

/** The head's title: a pin's text to type, else the title in words (a
 *  station's name is typed in its labelled field, AU-2). */
function headTitle(model: InspectorModel): HTMLElement {
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
  if (model.kind !== "item" || model.text === null) return null;
  if (!(head instanceof HTMLInputElement) || head.readOnly) return null;
  const out = el("output", "note pad");
  out.id = PIN_COUNT_ID;
  head.setAttribute("aria-describedby", PIN_COUNT_ID);
  wirePinTextCounter(head, out);
  return out;
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
): void {
  dock.root.hidden = model === null;
  if (model === null) {
    dock.head.replaceChildren();
    dock.body.replaceChildren();
    return;
  }
  dock.root.classList.toggle("collapsed", state.folded);
  const kind = model.kind === "item" ? model.itemKind : model.kind;
  const icon = el("span", `hic ic ${kind}`);
  icon.append(shellIcon(KIND_ICON[kind] ?? "station"));
  const head = headTitle(model);
  const count = pinCount(model, head);
  dock.head.replaceChildren(
    icon,
    head,
    iconButton(
      state.folded ? "down" : "up",
      state.folded ? "Show the details" : "Collapse the details",
      "fold",
    ),
    iconButton("close", "Deselect (Esc)", "close"),
  );
  const sub = el("div", "sub");
  sub.append(el("span", "", model.sub));
  const parts =
    model.kind === "station"
      ? stationParts(model, state, pictures, sub)
      : model.kind === "item"
        ? itemParts(model, state)
        : codeParts(model, state);
  dock.body.replaceChildren(sub, ...(count === null ? [] : [count]), ...parts);
}
