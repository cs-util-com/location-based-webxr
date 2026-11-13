/**
 * A short text's panel in the item inspector: how it stands (a pin, a
 * sign, a hint at the screen's edge, an arrow on the ground), its role,
 * and for a sign or a ground arrow how it turns, each a group of chips;
 * for a ground arrow also its style, a floor arrow's placement and
 * caption switch, and its two colours with the sun check. A view chip writes the view
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
  SHORT_TEXT_VIEWS,
  type FieldChoice,
  type FieldSpec,
} from "../../kinds/edit-kinds.js";
import {
  GROUND_DARK_DEFAULT,
  GROUND_SUN_MIN_RATIO,
  sunContrast,
} from "../../kinds/short-text/ground-route.js";
import { SHORT_TEXT_ACCENT } from "../../kinds/short-text/plate.js";
import { chipGroup, el } from "../editor-shell/inspector-fields.js";
import type { KindPanel, PanelItem } from "./kind-panel.js";

/** What each view does, under its chips. */
const VIEW_NOTE: Readonly<Record<string, string>> = {
  pin: "A label on a stem that faces the visitor.",
  sign: "A board on posts, readable from the distance you set.",
  edgeHint:
    "A ring on the ground; its name slides to the screen's edge when it is out of view.",
  ground:
    "Marks on the ground toward the point it points to, ending 2 m before it.",
};

/** A ground style's two colours, by the parts they paint. */
const GROUND_PARTS: Readonly<
  Record<string, { readonly main: string; readonly dark: string }>
> = {
  ribbon: { main: "Edge and head", dark: "Body" },
  vanes: { main: "Vane face", dark: "Rim" },
  footprints: { main: "Print", dark: "Rim" },
  lights: { main: "Lens", dark: "Ring" },
  floor: { main: "Top", dark: "Flanks" },
};
const DEFAULT_STYLE = "ribbon";
const DEFAULT_FLOOR = "lying";

/** The reader's default role and turn, pressed when none is written. */
const DEFAULT_ROLE = "label";
const DEFAULT_TURN = "world";

/** The choices of the short text's field `name` (its row's). */
function choicesOf(name: string): readonly FieldChoice[] {
  const fields: readonly FieldSpec[] = KIND_EDIT.shortText.fields;
  return fields.find((f) => f.name === name)?.choices ?? [];
}

/** What the panel writes through; `changed` asks for a new draw after
 *  a write that came from no press (a switch, a colour well). */
export interface ShortTextPanelDeps {
  readonly view: (id: string, view: string) => unknown;
  readonly block: (id: string, field: string, value: string) => unknown;
  readonly changed?: () => void;
}

/** The chips' acts: `short-view:`, `short-role:`, `short-turn:`,
 *  `short-style:`, `short-floor:`. */
const ACTS = {
  "short-view": null,
  "short-role": "role",
  "short-turn": "orientation",
  "short-style": "style",
  "short-floor": "floorPlacement",
} as const;

type GroundLook = NonNullable<NonNullable<PanelItem["shortText"]>["ground"]>;

/** The sun check of `dark` on the part it paints, in words. */
function sunLine(dark: string, part: string): HTMLElement {
  const r = sunContrast(dark);
  const ratio = (Math.round(r * 10) / 10).toFixed(1);
  const name = part.toLowerCase();
  return r < GROUND_SUN_MIN_RATIO
    ? el(
        "div",
        "note sunwarn",
        `Sun warning: in direct sun the ${name} reads only ${ratio} : 1 against pale paving (it needs 3 : 1), and it is what carries the shape there. Pick a darker ${name}.`,
      )
    : el(
        "div",
        "note",
        `Sun check: the ${name} reads ${ratio} : 1 against pale paving in direct sun (at least 3 : 1).`,
      );
}

/** A ground arrow's own controls, writing through `deps`. */
function groundParts(
  look: GroundLook,
  role: string,
  deps: ShortTextPanelDeps,
): HTMLElement[] {
  const style = look.style ?? DEFAULT_STYLE;
  const parts = GROUND_PARTS[style] ?? { main: "Main", dark: "Dark" };
  const write = (field: string, value: string) => {
    deps.block(look.id, field, value);
    deps.changed?.();
  };
  const out: HTMLElement[] = [
    ...chipGroup("Ground style", "short-style", choicesOf("style"), style),
  ];
  if (style === "floor") {
    out.push(
      ...chipGroup(
        "Floor arrow",
        "short-floor",
        choicesOf("floorPlacement"),
        look.floorPlacement ?? DEFAULT_FLOOR,
      ),
    );
    const label = el("label", "chkrow");
    const box = el("input", "");
    box.type = "checkbox";
    box.checked = look.captionOnArrow;
    box.addEventListener("change", () => {
      write("captionOnArrow", box.checked ? "true" : "");
    });
    label.append(box, "Caption on the arrow");
    out.push(label);
  }
  const accent =
    SHORT_TEXT_ACCENT[role as keyof typeof SHORT_TEXT_ACCENT] ??
    SHORT_TEXT_ACCENT.label;
  const darkDefault =
    GROUND_DARK_DEFAULT[style as keyof typeof GROUND_DARK_DEFAULT] ??
    GROUND_DARK_DEFAULT.ribbon;
  const dark = look.darkColor ?? darkDefault;
  const well = (field: string, name: string, value: string) => {
    const label = el("label", "colwell");
    const input = el("input", "");
    input.type = "color";
    input.value = value;
    input.setAttribute("aria-label", `${name} colour`);
    input.addEventListener("change", () => {
      write(field, input.value);
    });
    label.append(input, name);
    return label;
  };
  const row = el("div", "colrow");
  const reset = el("button", "chip", "Role colours");
  reset.type = "button";
  reset.dataset["act"] = "short-colours:reset";
  row.append(
    well("color", parts.main, look.color ?? accent),
    well("darkColor", parts.dark, dark),
    reset,
  );
  out.push(el("span", "flabel", "Colours"), row, sunLine(dark, parts.dark));
  return out;
}

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
            SHORT_TEXT_VIEWS,
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
          if (parts.ground !== undefined) {
            box.append(
              ...groundParts(parts.ground, parts.role ?? DEFAULT_ROLE, deps),
            );
          }
          if (parts.view === "sign" || parts.view === "ground") {
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
      if (name === "short-colours:reset") {
        deps.block(selected, "color", "");
        deps.block(selected, "darkColor", "");
        return true;
      }
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
