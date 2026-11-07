/**
 * A sample item kind for the item lab (`item-lab.html?kind=stamp-1`): a stamp
 * on a post. It says its words at once, shows its picture in a card and
 * stands as a figure where a host has a stage; a tap plays its thud.
 *
 * It imports nothing: everything it does goes through the `host` it is given.
 */

/** Every file `show` may read. */
export function assets(block) {
  return [block.image, block.sound];
}

/** Show the item: its words first, its files as they load. */
export function show(block, host) {
  host.slots.text.textContent = block.words;
  host.slots.speaker.textContent = block.name;
  host.slots.speaker.hidden = false;
  host.asset(block.image, "stamp", async (blob) => {
    const problem = await host.checkPicture(blob);
    if (problem !== null) return "The stamp is too large to show here.";
    if (!host.showing()) return undefined;
    host.slots.image.src = host.url(blob);
    host.slots.image.alt = block.name;
    host.slots.image.hidden = false;
    const look = {
      view: "speak",
      name: block.name,
      line: block.words,
      voiced: true,
    };
    await host.stage?.stand("stamp", (world, place) =>
      world.showCharacter(place.stationId, blob, place.onWaiting, look),
    );
    return undefined;
  });
  host.stage?.tapTarget({ bubble: false, voice: block.sound });
}
