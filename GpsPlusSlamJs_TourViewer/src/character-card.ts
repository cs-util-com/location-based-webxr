/**
 * The character's row of the visitor's kinds (`play-kinds.ts`): his card and
 * the files it reads. A story view stands him as a character look (from his
 * declared frames sheet when he has one), `stage` as the plain cut-out,
 * `card` only in the card; his voice plays on a tap on a story view, with
 * the step otherwise. In the editor's world a free character stands
 * through `kinds/character/world.ts`; in play the free host stands him.
 *
 * @see character-card.ts.md
 */

import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";
import type { TourCharacterBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { isStageCharacterView } from "./character-views.js";
import type { ItemCardHost } from "./item-card.js";
import type { KindPlay } from "./play-kinds.js";
import { characterWorld } from "./kinds/character/world.js";
import type { StageCharacterLook } from "./scene-stage.js";

/** The status line's name for him while he loads and waits. */
const FIGURE = "figure";

/** The portrait (the `portrait` view): measured like a picture. */
async function showPortrait(
  blob: Blob,
  name: string,
  host: ItemCardHost,
): Promise<void> {
  const portrait = host.slots.portrait;
  if (portrait === undefined) return;
  if ((await host.checkPicture(blob)) !== null) return;
  if (!host.showing()) return;
  portrait.src = host.url(blob);
  portrait.alt = name;
  portrait.hidden = false;
}

/** Stand him from `blob`; with no `look`, the plain cut-out (called without
 *  one, as a stage that tells the two apart expects). */
function standFigure(
  host: ItemCardHost,
  blob: Blob,
  look: StageCharacterLook | undefined,
): Promise<void> {
  return (
    host.stage?.stand(FIGURE, (world, { stationId, onWaiting }) =>
      look === undefined
        ? world.showCharacter(stationId, blob, onWaiting)
        : world.showCharacter(stationId, blob, onWaiting, look),
    ) ?? Promise.resolve()
  );
}

function card(block: TourCharacterBlock, host: ItemCardHost): void {
  const { slots } = host;
  slots.text.textContent = block.caption ?? "";
  slots.speaker.textContent = block.name;
  slots.speaker.hidden = false;
  // A story view stands as a character look; `stage`
  // as the plain cut-out; `card` only in the card.
  const view = block.view;
  const look = isStageCharacterView(view)
    ? {
        view,
        name: block.name,
        line: block.caption ?? "",
        voiced: view !== "bubble" && block.voice !== undefined,
        pose: block.pose,
      }
    : undefined;
  const { stage } = host;
  // A declared character's frames sheet (his talking and beckoning
  // poses) stands a story view; the portrait stays his image.
  const sheet =
    look === undefined || block.character === undefined
      ? undefined
      : host.characters?.get(block.character)?.frames;
  if (stage !== undefined && look !== undefined && sheet !== undefined) {
    if (view === "portrait") {
      host.asset(block.image, "portrait", (blob) => {
        void showPortrait(blob, block.name, host);
      });
    }
    host.asset(
      sheet,
      FIGURE,
      (blob) => standFigure(host, blob, { ...look, sheet: true }),
      () => {
        // An unreadable sheet: he stands in his one pose, so the
        // figure's failure line the host just wrote does not hold
        // (another asset's line stays); the debug readout names the
        // sheet.
        host.notice(FIGURE, null);
        host.debugLine(
          `story: the frames sheet "${sheet}" of "${block.character ?? ""}" could not be read - he stands in his one pose`,
        );
        host.asset(block.image, FIGURE, (blob) =>
          standFigure(host, blob, look),
        );
      },
    );
  } else if (stage !== undefined && (view === "stage" || look !== undefined)) {
    host.asset(block.image, FIGURE, async (blob) => {
      if (view === "portrait") void showPortrait(blob, block.name, host);
      await standFigure(host, blob, look);
    });
  }
  // A story view's voice plays on a tap on him (the prototype's
  // rule), the bubble view's never; the stage and card views play it
  // with the step.
  if (look !== undefined) {
    stage?.tapTarget({ bubble: look.view === "bubble", voice: block.voice });
  } else {
    // A plain figure takes the stage from him; a card view leaves
    // the stage as it was.
    if (view === "stage") stage?.tapTarget(null);
    // Not the voice of a figure the visitor taps: his look (if one
    // stands) is left alone.
    if (block.voice !== undefined) host.sound(block.voice);
  }
}

/** His figure in any view but the card (a story view of a declared
 *  character with a frames sheet stands from the sheet, his image then only
 *  for the portrait view's portrait), and his voice in every view. */
function assets(
  block: TourCharacterBlock,
  characters: ReadonlyMap<string, TourCharacter>,
): readonly string[] {
  const sheet =
    isStageCharacterView(block.view) && block.character !== undefined
      ? characters.get(block.character)?.frames
      : undefined;
  const figure =
    block.view === "card"
      ? []
      : sheet === undefined
        ? [block.image]
        : block.view === "portrait"
          ? [block.image, sheet]
          : [sheet];
  return block.voice === undefined ? figure : [...figure, block.voice];
}

export const CHARACTER_PLAY: KindPlay<TourCharacterBlock> = {
  card,
  assets,
  world: characterWorld,
};
