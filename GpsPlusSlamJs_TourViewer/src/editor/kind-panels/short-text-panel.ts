/**
 * A short text's panel in the item inspector: how it stands (a pin, a
 * sign, a hint at the screen's edge), its role, and for a sign how it
 * turns, each a group of chips. A view chip writes the view
 * (`editBlockView`); a role or turn chip writes that field through the
 * block's field edit (`block-fields.ts`, its `choices` from the kind's
 * row in `kinds/edit-kinds.ts`), so the choices and their words live in
 * one place. Its typed fields (the description, the reading distance)
 * stay the dock's.
 *
 * @see short-text-panel.ts.md
 */
import {
  KIND_EDIT,
  type FieldChoice,
  type FieldSpec,
} from "../../kinds/edit-kinds.js";
import { chipGroup, el } from "../editor-shell/inspector-fields.js";
import type { KindPanel } from "./kind-panel.js";

/** The views a creator chooses between, in the order they show. */
export const SHORT_TEXT_VIEW_CHOICES: readonly FieldChoice[] = [
  { value: "pin", label: "Pin" },
  { value: "sign", label: "Sign" },
  { value: "edgeHint", label: "Edge hint" },
];

/** What each view does, under its chips. */
const VIEW_NOTE: Readonly<Record<string, string>> = {
  pin: "A label on a stem that faces the visitor.",
  sign: "A board on posts, readable from the distance you set.",
  edgeHint:
    "A ring on the ground; its name slides to the screen's edge when it is out of view.",
};

/** The reader's default role and turn, pressed when none is written. */
const DEFAULT_ROLE = "label";
const DEFAULT_TURN = "world";

/** The choices of the short text's field `name` (its row's). */
function choicesOf(name: string): readonly FieldChoice[] {
  const fields: readonly FieldSpec[] = KIND_EDIT.shortText.fields;
  return fields.find((f) => f.name === name)?.choices ?? [];
}

/** What the panel writes through. */
export interface ShortTextPanelDeps {
  readonly view: (id: string, view: string) => unknown;
  readonly block: (id: string, field: string, value: string) => unknown;
}

/** The chips' acts: `short-view:`, `short-role:`, `short-turn:`. */
const ACTS = {
  "short-view": null,
  "short-role": "role",
  "short-turn": "orientation",
} as const;

/** A short text's panel, writing through `deps`. */
export function createShortTextPanel(deps: ShortTextPanelDeps): KindPanel {
  return {
    sync(item) {
      const parts = item?.shortText;
      if (item === null || parts === undefined) return null;
      return {
        key: "",
        kept: null,
        ownsFields: false,
        title: () => null,
        head: () => [],
        parts() {
          const box = el("div", "isec stext");
          const [viewLabel, viewChips] = chipGroup(
            "Shows as",
            "short-view",
            SHORT_TEXT_VIEW_CHOICES,
            parts.view,
          );
          box.append(
            viewLabel,
            viewChips,
            el("div", "note", VIEW_NOTE[parts.view] ?? ""),
            ...chipGroup(
              "Role",
              "short-role",
              choicesOf("role"),
              parts.role ?? DEFAULT_ROLE,
            ),
          );
          if (parts.view === "sign") {
            box.append(
              ...chipGroup(
                "Turns",
                "short-turn",
                choicesOf("orientation"),
                parts.orientation ?? DEFAULT_TURN,
              ),
            );
          }
          return [box];
        },
      };
    },
    act(name, _item, selected) {
      const colon = name.indexOf(":");
      if (colon < 0) return false;
      const act = name.slice(0, colon);
      const value = name.slice(colon + 1);
      if (!(act in ACTS)) return false;
      const field = ACTS[act as keyof typeof ACTS];
      if (field === null) deps.view(selected, value);
      else deps.block(selected, field, value);
      return true;
    },
    flush() {
      // Nothing is typed here: every chip writes at once.
    },
  };
}
