/**
 * The question the 3D editor asks before moving a station's item onto
 * another station (pure): where it will stand there, in words, so a yes is
 * given knowing it must be placed again.
 *
 * @see station-move-question.ts.md
 */

/** What moves: a story (its entries go with it) or one item. */
export interface StationMoveSubject {
  readonly kind: "story" | "item";
  readonly name: string;
}

/** The question before `subject` moves onto the station `station` (its
 *  title): a free item or an entry stands at that station's centre; a
 *  story's entries keep their offsets, now around that centre. */
export function stationMoveQuestion(
  subject: StationMoveSubject,
  station: string,
): string {
  const name = subject.name.trim();
  const title = station.trim();
  const to = title === "" ? "the other station" : `"${title}"`;
  if (subject.kind === "story") {
    const story = name === "" ? "this story" : `the story "${name}"`;
    return (
      `Move ${story} to ${to}? Its entries keep their places around the ` +
      "station's centre, so they will stand around the new station: place " +
      "them again where they belong. You can undo this."
    );
  }
  const item = name === "" ? "this item" : `"${name}"`;
  return (
    `Move ${item} to ${to}? It will stand at the centre of that station: ` +
    "place it again where it belongs. You can undo this."
  );
}
